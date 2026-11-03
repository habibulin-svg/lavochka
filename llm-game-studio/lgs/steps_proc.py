"""Шаги-процессы: shell, python, питон-раннеры моделей (sfx, tts, asr, cutout, музыка Stable Audio) и управление: approve, service.

Протокол вывода процесса (stdout, по строке):
  @progress 3/10 текст     — прогресс
  @output путь [{json}]    — готовый файл (покажется в превью), json — подписи
  всё остальное            — в журнал шага
"""
import json
import os
import pathlib
import subprocess
import sys
import threading

from . import advisor, catalog, config, hardware, services
from .runner import Cancelled, adapter

RUNNERS = pathlib.Path(__file__).resolve().parent.parent / 'runners'
_NOWINDOW = 0x08000000 if sys.platform == 'win32' else 0


def run_process(ctx, cmd, cwd=None, env=None, shell=False, timeout=None, unit_base=0, unit_total=None) -> int:
    e = {**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUNBUFFERED': '1', 'CUDA_DEVICE_ORDER': 'PCI_BUS_ID',
         'LGS_OUT': str(ctx.dir), 'LGS_RUN_DIR': str(ctx.run.dir)}
    if config.CFG.get('ffmpeg'):
        e['PATH'] = str(pathlib.Path(config.CFG['ffmpeg']).parent) + os.pathsep + e.get('PATH', '')
        e['LGS_FFMPEG'] = config.CFG['ffmpeg']
    if isinstance(ctx.gpu, int):
        e['CUDA_VISIBLE_DEVICES'] = str(ctx.gpu)
    elif ctx.gpu == 'cpu':
        e['CUDA_VISIBLE_DEVICES'] = '-1'
    e.update({k: str(v) for k, v in (env or {}).items()})
    ctx.log('$ ' + (cmd if isinstance(cmd, str) else ' '.join(map(str, cmd))))
    p = subprocess.Popen(cmd, cwd=cwd, env=e, shell=shell, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         stdin=subprocess.DEVNULL, text=True, encoding='utf-8', errors='replace', creationflags=_NOWINDOW)
    ctx.run.procs.add(p)
    timer = None
    if timeout:
        timer = threading.Timer(float(timeout), lambda: services.kill_tree(p.pid))
        timer.start()
    try:
        for line in p.stdout:
            line = line.rstrip('\n')
            if line.startswith('@progress '):
                parts = line[10:].split(' ', 1)
                try:
                    d, t = parts[0].split('/')
                    ctx.progress(unit_base + int(d), unit_total or int(t), parts[1] if len(parts) > 1 else None)
                except ValueError:
                    ctx.log(line)
            elif line.startswith('@output '):
                rest = line[8:].strip()
                path, meta = rest, {}
                if ' {' in rest:
                    path, js = rest.split(' {', 1)
                    try:
                        meta = json.loads('{' + js)
                    except ValueError:
                        meta = {}
                pth = pathlib.Path(path.strip())
                if not pth.is_absolute():
                    pth = pathlib.Path(cwd or ctx.dir) / pth
                ctx.output(pth, key=meta.pop('key', None), **meta)
            else:
                ctx.log(line)
        p.wait()
    finally:
        if timer:
            timer.cancel()
        ctx.run.procs.discard(p)
    if ctx.cancelled:
        raise Cancelled()
    return p.returncode


@adapter('shell')
def shell(ctx, units):
    for i, u in enumerate(units):
        ctx.check()
        ctx.progress(i, len(units), u['key'] if len(units) > 1 else None)
        rc = run_process(ctx, u['run'], cwd=u.get('cwd') or str(ctx.dir), env=u.get('env'), shell=True,
                         timeout=u.get('timeout'), unit_base=i, unit_total=len(units) if len(units) > 1 else None)
        if rc:
            raise RuntimeError(f'команда завершилась с кодом {rc}')
        _collect(ctx, u)
    ctx.progress(len(units), len(units))


@adapter('python')
def python(ctx, units):
    for i, u in enumerate(units):
        ctx.check()
        py = config.venv_python(str(u['python'])) if u.get('python') else sys.executable
        if not py:
            raise RuntimeError(f'нет окружения {u["python"]} — добавьте его в Настройках')
        args = [str(a) for a in (u.get('args') or [])]
        ctx.progress(i, len(units), u['key'] if len(units) > 1 else None)
        rc = run_process(ctx, [py, '-X', 'utf8', str(u['script']), *args], cwd=u.get('cwd') or str(ctx.dir), env=u.get('env'),
                         timeout=u.get('timeout'), unit_base=i, unit_total=len(units) if len(units) > 1 else None)
        if rc:
            raise RuntimeError(f'скрипт завершился с кодом {rc}')
        _collect(ctx, u)
    ctx.progress(len(units), len(units))


def _collect(ctx, u):
    """outputs: шаблоны путей, которые после команды надо показать как результаты."""
    import glob
    for pat in (u.get('outputs') or []):
        for p in sorted(glob.glob(str(pat))):
            if not any(o['path'] == p.replace('\\', '/') for o in ctx.state.outputs):
                ctx.output(p)


@adapter('sfx', 'tts', 'asr', 'cutout')
def model_runner(ctx, units):
    m = ctx.model
    if not m:
        raise RuntimeError('модель не выбрана')
    runner = m.get('runner')
    if not runner:
        raise RuntimeError(f'у {m["title"]} нет встроенного раннера — используйте шаг python со своим скриптом')
    py = config.venv_python(m.get('python', ''))
    if not py:
        raise RuntimeError(f'нет окружения {m.get("python")} для {m["title"]}: укажите venv в Настройках '
                           f'(нужны пакеты: torch, {", ".join(m.get("pip", []))})')
    todo = [u for u in units if not ctx.is_done(u['key'])]
    for u in units:
        if u not in todo:
            ctx.reuse(u['key'])
    base = len(units) - len(todo)
    ctx.progress(base, len(units))
    if not todo:
        return
    dirs = [str(catalog.dest_dir(f['dest'])) for f in m.get('files', [])]
    job = {'model': m['id'], 'model_dirs': dirs, 'out': str(ctx.dir), 'units': todo,
           'device': 'cpu' if ctx.gpu == 'cpu' else 'cuda', 'ffmpeg': config.CFG.get('ffmpeg') or 'ffmpeg',
           'voices': ctx.st.get('voices') or {}, 'language': ctx.st.get('language', 'Russian'),
           'kind': m['kind'], 'voice_dir': str(ctx.run.dir / '_voices')}
    jp = ctx.dir / '_job.json'
    jp.write_text(json.dumps(job, ensure_ascii=False, indent=1), encoding='utf-8')
    rc = run_process(ctx, [py, '-X', 'utf8', str(RUNNERS / f'{runner}.py'), str(jp)], cwd=str(ctx.dir),
                     unit_base=base, unit_total=len(units))
    if rc:
        raise RuntimeError(f'раннер {runner} завершился с кодом {rc}')


@adapter('approve')
def approve(ctx, units):
    """Ждать, пока человек отметит лучшее в интерфейсе. Пишет selected.json — его берут следующие шаги (items_from)."""
    import threading as th
    u = units[0]
    shows = u.get('show') if isinstance(u.get('show'), list) else [u.get('show')]
    outs = [o for sid in shows for o in ctx.run.steps[sid].outputs]
    ctx.state.status = 'approval'
    ctx.state.approval = {'message': u.get('message') or 'Отметьте лучшие и нажмите «Утвердить»',
                          'pick': u.get('pick', 'many'), 'show': shows, 'count': len(outs)}
    ctx.progress(0, 1, 'ждёт решения человека')
    ev = th.Event()
    ctx.run.approvals[ctx.state.id] = ev
    ev.wait()
    ctx.check()
    chosen = ctx.run.selected.get(ctx.state.id, [])
    picked = [o for o in outs if o['path'] in chosen]
    data = [{'name': o.get('item') or o.get('key'), 'file': o['path'], 'step': o['step'], 'key': o.get('key'),
             **{k: o[k] for k in ('prompt', 'seed') if k in o}} for o in picked]
    sel = ctx.dir / 'selected.json'
    sel.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    ctx.state.status = 'running'
    ctx.state.approval = None
    ctx.log(f'утверждено: {len(data)} из {len(outs)}')
    ctx.output(sel, key='selected')
    ctx.progress(1, 1, f'выбрано {len(data)}')


@adapter('service')
def service(ctx, units):
    u = units[0]
    for name in (u.get('stop') or []):
        s = services.SERVICES.get(name)
        if s:
            ctx.log(f'останавливаю {s.title}')
            s.stop()
    for name in (u.get('start') or []):
        s = services.SERVICES.get(name)
        if not s:
            raise RuntimeError(f'нет сервиса {name} (есть: {", ".join(services.SERVICES)})')
        prof = None
        if name == 'llm':
            prof = pick_llm_profile(u.get('llm'))
        ctx.log(f'запускаю {s.title}')
        s.start(prof)
        s.wait_ready(900)
    ctx.progress(1, 1)


def pick_llm_profile(want=None) -> dict:
    """Профиль LLM: id модели / exclusive / shared / сохранённый в настройках / лучший по железу."""
    hw = hardware.snapshot()
    if not want and config.CFG.get('llm_profile'):
        return config.CFG['llm_profile']
    profs = advisor.llm_profiles(hw, 'any')
    if want in profs:
        p = profs[want]['best']
    else:
        mode = 'shared' if services.SERVICES['comfy-big'].alive() and 'shared' in profs else next(iter(profs))
        cands = [x for x in profs[mode]['all'] if x['installed'] and (not want or x['model'] == want)]
        p = cands[0] if cands else profs[mode]['best']
    if not p or not p.get('installed'):
        raise RuntimeError('нет подходящей установленной LLM — скачайте на вкладке «Модели»')
    return p
