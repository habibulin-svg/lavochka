"""Автоподбор: какая модель под какую задачу на этом железе и как запускать llama-server.

Оценки грубые, но честные: размер весов + кэш контекста + запас; скорость LLM — от полосы памяти
(каждый токен читает активные веса один раз: карта — по своей полосе, остаток в RAM — по полосе DDR).
"""
import math

from . import catalog, config, hardware

HEAVY = {'image', 'video', 'music', 'to3d'}           # на большую карту
CTX_STEPS = [131072, 65536, 32768, 16384, 8192, 4096]
GPU_OVERHEAD_GB = 0.6                                 # CUDA-контекст и буферы на каждую карту
RAM_RESERVE_GB = 6                                    # системе и прочему


def _gpu_roles(gpus: list[dict]) -> tuple[dict | None, dict | None]:
    if not gpus:
        return None, None
    roles = config.CFG.get('gpu_roles', {})
    by_idx = {g['index']: g for g in gpus}
    big = by_idx.get(roles.get('big')) or max(gpus, key=lambda g: g['vram_gb'])
    small = by_idx.get(roles.get('small'))
    if not small or small is big:
        rest = [g for g in gpus if g is not big]
        small = max(rest, key=lambda g: g['vram_gb']) if rest else big
    return big, small


def recommend(hw: dict) -> dict:
    """Лучшая модель на каждую задачу (кроме LLM) и карта для неё."""
    gpus = hw.get('gpus', [])
    big, small = _gpu_roles(gpus)
    ram = hw.get('ram', {}).get('total_gb') or 16
    res = {}
    models = catalog.with_status()
    for kind in catalog.KINDS:
        if kind == 'llm':
            continue
        cands = sorted((m for m in models if m['kind'] == kind), key=lambda m: (-m.get('quality', 5), not m['status']['installed']))
        pick, why, gpu, alts = None, '', None, []
        order = [big, small] if kind in HEAVY else [small, big]
        for m in cands:
            fits = [g for g in order if g and g['vram_gb'] >= m.get('vram_gb', 0)]
            ram_ok = ram >= m.get('ram_gb', 0)
            if fits and ram_ok and not pick:
                pick, gpu = m, fits[0]
                why = f"{gpu['name']} {gpu['vram_gb']:g} ГБ ≥ {m['vram_gb']} ГБ"
                if gpu is not order[0]:
                    why += ' (на другой карте — основная мала)'
            elif fits and ram_ok:
                alts.append(m['id'])
            elif not pick:
                alts.append(m['id'])
        if not pick and cands:
            m = cands[-1]
            pick, gpu, why = m, None, 'видеокарты не хватает — только на процессоре, очень медленно' if not gpus else 'не влезает в видеопамять'
        if pick:
            res[kind] = {'model': pick['id'], 'title': pick['title'], 'gpu': gpu['index'] if gpu else 'cpu',
                         'gpu_name': gpu['name'] if gpu else 'процессор', 'reason': why,
                         'installed': pick['status']['installed'], 'alternatives': [a for a in alts if a != pick['id']],
                         'missing_gb': pick['status'].get('missing_gb', 0)}
    return res


def _variants(m: dict) -> list[dict]:
    """Установленные кванты (точный размер, шапка GGUF) и возможные к скачиванию (оценка)."""
    out = []
    for f in catalog.llm_local(m):
        info = catalog.gguf_info(f['path'])
        out.append({'quant': f['quant'], 'size_gb': f['size_gb'], 'path': f['path'], 'installed': True, 'info': info})
    have = {v['quant'].removeprefix('UD-') for v in out}
    for q in m.get('quants', []):
        if q.removeprefix('UD-') in have:
            continue
        size = m['params_b'] * catalog.quant_bpw(q) / 8 * 1.02
        out.append({'quant': q, 'size_gb': round(size, 1), 'path': None, 'installed': False, 'info': None})
    return out


def _kv_gb(m: dict, info: dict | None, ctx: int) -> float:
    per_tok = (info or {}).get('kv_bytes_per_token_q8') or m['params_b'] * 4000
    return per_tok * ctx / 2**30


def plan_llm(m: dict, v: dict, gpus: list[dict], ram_gb: float, min_ctx: int = 8192, use_free: bool = False,
             ctx_pref: int = 65536) -> dict | None:
    """Как разложить одну модель+квант по данным картам. None — не влезает совсем."""
    size = v['size_gb']
    info = v.get('info') or {}
    layers = info.get('layers') or int(20 + m['params_b'] * 1.3)
    vram = [(g['free_gb'] if use_free else g['vram_gb']) - GPU_OVERHEAD_GB for g in gpus]
    total_vram = sum(max(0, x) for x in vram)
    ram_free = max(0, ram_gb - RAM_RESERVE_GB)
    moe = m.get('moe') or bool(info.get('experts'))
    active_frac = (m.get('active_b') or m['params_b']) / m['params_b']
    ctx_cap = min(m.get('ctx_max', 32768), info.get('ctx_train') or 10**9)
    fits = []
    for ctx in CTX_STEPS:
        if ctx > ctx_cap or ctx < min_ctx:
            continue
        kv = _kv_gb(m, info, ctx)
        need = size + kv
        if need <= total_vram and gpus:
            cpu_gb = 0.0
        elif moe and gpus:
            dense = size * min(1.0, active_frac * 1.6) + kv   # внимание, общие эксперты, эмбеддинги + кэш — на карте
            if dense > total_vram:
                continue
            cpu_gb = need - total_vram
            if cpu_gb > ram_free:
                continue
        else:
            cpu_gb = need - (total_vram if gpus else 0)
            if cpu_gb > ram_free or (gpus and cpu_gb > size * 0.35):   # плотная модель, больше трети в RAM — неюзабельно
                continue
        fits.append((ctx, kv, cpu_gb))
    if not fits:
        return None
    # контекст: самый длинный (до ctx_pref), при котором веса целиком на картах; иначе — минимальный (меньше выгрузки в RAM)
    full = [f for f in fits if f[2] == 0 and f[0] <= ctx_pref]
    best = max(full) if full else min(fits, key=lambda f: (f[2], -f[0]))
    ctx, kv, cpu_gb = best
    gpu_gb = size - cpu_gb
    # скорость: каждый токен читает активные веса (у MoE — доля), кэш не считаем
    read_gpu = gpu_gb * (active_frac if moe else 1)
    read_cpu = cpu_gb * (active_frac if moe else 1)
    t = 0.0
    if gpus and read_gpu > 0:
        # при -sm layer слои идут по очереди: время — сумма по картам пропорционально доле
        shares = [max(0, x) / total_vram for x in vram] if total_vram else [0]
        t += sum(read_gpu * s / g['bandwidth'] for s, g in zip(shares, gpus))
    t += read_cpu / hardware.CPU_BANDWIDTH
    # 85 % полосы на деле + постоянные накладные на токен (запуск ядер по слоям); сверено с замерами 9B/27B/35B-A3B
    tps = round(1 / (t / 0.85 + 0.004 + 0.00015 * layers), 1) if t else None

    args = ['-c', str(ctx), '-fa', 'on', '-ctk', 'q8_0', '-ctv', 'q8_0', '--jinja', '-np', '1']
    if gpus:
        args += ['-ngl', '999']
        if len(gpus) > 1:
            args += ['-ts', ','.join(f'{max(0, x):.0f}' for x in vram), '-sm', 'layer']
        if cpu_gb > 0 and moe:
            experts_total = size * (1 - min(1.0, active_frac * 1.6))
            n = math.ceil(layers * min(1.0, (cpu_gb + 0.5) / max(experts_total, 0.1)))
            args += ['--n-cpu-moe', str(min(layers, n))]
        elif cpu_gb > 0:
            args[args.index('-ngl') + 1] = str(max(0, int(layers * (gpu_gb / size)) - 1))
    else:
        args += ['-ngl', '0']
    s = m.get('sampling', {})
    for k, flag in (('temp', '--temp'), ('top_p', '--top-p'), ('top_k', '--top-k')):
        if k in s:
            args += [flag, str(s[k])]
    args += m.get('extra_args', [])
    return {
        'model': m['id'], 'title': m['title'], 'quant': v['quant'], 'size_gb': size, 'installed': v['installed'],
        'path': v['path'], 'ctx': ctx, 'kv_gb': round(kv, 2), 'cpu_gb': round(cpu_gb, 1), 'tps': tps,
        'gpus': [g['index'] for g in gpus], 'cuda_visible': ','.join(str(g['index']) for g in gpus),
        'args': args, 'quality': m.get('quality', 5), 'vision': m.get('vision', False), 'moe': moe,
        'tasks': m.get('tasks', []),
    }


def llm_profiles(hw: dict, purpose: str = 'code') -> dict:
    """Профили запуска LLM в двух режимах:
    exclusive — все карты под LLM (окно «код», ComfyUI остановлен);
    shared    — LLM на малой карте (+RAM), большая остаётся генерации картинок/видео.
    """
    gpus = hw.get('gpus', [])
    ram = hw.get('ram', {}).get('total_gb') or 16
    big, small = _gpu_roles(gpus)
    min_ctx = 16384 if purpose == 'code' else 8192
    modes = {'exclusive': gpus, 'shared': [small] if small and small is not big else []}
    if not gpus:
        modes = {'cpu': []}
    out = {}
    for mode, devs in modes.items():
        if mode == 'shared' and not devs:
            continue
        plans = []
        for m in catalog.load():
            if m['kind'] != 'llm':
                continue
            if purpose and m.get('tasks') and purpose not in m['tasks'] and purpose != 'any':
                continue
            for v in _variants(m):
                p = plan_llm(m, v, devs, ram, min_ctx)
                if p:
                    plans.append(p)
        usable = [p for p in plans if (p['tps'] or 0) >= 8]
        rank = lambda p: (p['quality'], p['installed'], min(p['tps'] or 0, 40), catalog.quant_bpw(p['quant']))  # noqa: E731
        plans.sort(key=rank, reverse=True)
        usable.sort(key=rank, reverse=True)
        out[mode] = {'best': (usable or plans or [None])[0], 'all': plans[:24],
                     'gpus': [g['name'] for g in devs] or ['процессор']}
    return out


def llama_command(profile: dict) -> tuple[list[str], dict]:
    """Готовая команда llama-server по профилю (порт — из настроек) и переменные окружения."""
    import pathlib
    exe = pathlib.Path(config.CFG['llama_dir']) / ('llama-server.exe' if (pathlib.Path(config.CFG['llama_dir']) / 'llama-server.exe').exists() else 'llama-server')
    m = catalog.get(profile['model']) or {}
    cmd = [str(exe), '-m', profile['path']]
    mm = catalog.llm_mmproj(m, profile['path']) if profile.get('vision') and profile.get('path') else None
    if mm:
        cmd += ['--mmproj', mm]
    cmd += profile['args'] + ['--host', '127.0.0.1', '--port', str(config.CFG['ports']['llm'])]
    env = {'CUDA_DEVICE_ORDER': 'PCI_BUS_ID'}
    if profile.get('cuda_visible') is not None:
        env['CUDA_VISIBLE_DEVICES'] = profile['cuda_visible'] or '-1'
    return cmd, env
