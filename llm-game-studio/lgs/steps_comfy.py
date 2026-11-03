"""Шаги через ComfyUI: image, video, upscale, music (YuE2), comfy (любой граф)."""
import copy
import json
import pathlib
import re

from . import catalog, services
from .comfy import Comfy, fill
from .runner import Cancelled, adapter

WORKFLOWS = pathlib.Path(__file__).resolve().parent.parent / 'workflows'


def _service(ctx) -> Comfy:
    """Поднять ComfyUI на карте шага (если не запущен) и вернуть клиента."""
    svc = services.comfy_for_gpu(ctx.gpu)
    if not svc.alive():
        need = (ctx.model or {}).get('vram_gb', 6)
        if isinstance(ctx.gpu, int):
            stopped = services.free_gpu_for(ctx.gpu, need, keep={svc.name})
            if stopped:
                ctx.log('освободил карту: остановлены ' + ', '.join(stopped))
        ctx.progress(message=f'запускаю {svc.title}…')
        ctx.log(f'запускаю {svc.title} (порт {svc.port})')
        svc.start()
        svc.wait_ready(300)
    return Comfy(svc.port)


def _load_workflow(name: str) -> dict:
    p = pathlib.Path(name)
    if not p.suffix:
        p = WORKFLOWS / f'{name}.json'
    if not p.exists():
        raise RuntimeError(f'нет графа {p}')
    return json.loads(p.read_text(encoding='utf-8'))


def _save_outputs(ctx, c: Comfy, entry: dict, u: dict, prompt_meta: dict):
    saved = 0
    for i, (fn, data, _) in enumerate(c.outputs(entry)):
        ext = pathlib.Path(fn).suffix or '.bin'
        name = u['key'] + (f'-{i + 1}' if i else '') + ext
        dest = ctx.dir / name
        dest.write_bytes(data)
        ctx.output(dest, key=u['key'], item=u['name'], seed=u.get('seed'), **prompt_meta)
        saved += 1
    if not saved:
        raise RuntimeError('граф ничего не сохранил (нет SaveImage/SaveVideo/SaveAudio?)')


def _each(ctx, units, make_graph, meta=lambda u: {}):
    c = _service(ctx)
    todo = [u for u in units if not ctx.is_done(u['key'])]
    for u in units:
        if u not in todo:
            ctx.reuse(u['key'])
    done = len(units) - len(todo)
    ctx.progress(done, len(units), f'готово раньше: {done}' if done else '')
    for u in todo:
        ctx.check()
        ctx.progress(message=f'{u["key"]}…')
        graph = make_graph(c, u)
        pid = c.submit(graph)
        try:
            entry = c.wait(pid, timeout=float(u.get('timeout', 3600)), cancelled=lambda: ctx.cancelled,
                           tick=lambda s, k=u['key']: ctx.progress(message=f'{k}: {s:.0f} с'))
        except InterruptedError:
            raise Cancelled() from None
        _save_outputs(ctx, c, entry, u, meta(u))
        done += 1
        ctx.log(f'готово {u["key"]}')
        ctx.progress(done, len(units), '')


def _model_values(ctx) -> dict:
    return {k: v for k, v in catalog.resolved_names(ctx.model or {}).items() if v}


@adapter('image')
def image(ctx, units):
    wf = _load_workflow((ctx.model or {}).get('workflow', 'z_image_turbo'))
    names = _model_values(ctx)

    def graph(c, u):
        vals = {'negative': '', 'cfg': 7, **u, **names, 'prefix': f'lgs/{ctx.run.name}/{u["key"]}'}
        return fill(copy.deepcopy(wf), vals)
    _each(ctx, units, graph, lambda u: {'prompt': u.get('prompt')})


@adapter('video')
def video(ctx, units):
    wf = _load_workflow((ctx.model or {}).get('workflow', 'wan22_i2v'))
    names = _model_values(ctx)

    def graph(c, u):
        g = copy.deepcopy(wf)
        img = u.get('image') or u.get('input')
        vals = {**u, **names, 'prefix': f'lgs/{ctx.run.name}/{u["key"]}'}
        if img:
            vals['image'] = c.upload(img)
        else:   # без картинки — текст → видео: убрать LoadImage и вход start_image
            for k, n in list(g.items()):
                if isinstance(n, dict) and n.get('class_type') == 'LoadImage':
                    del g[k]
                    for m in g.values():
                        if isinstance(m, dict):
                            m.get('inputs', {}).pop('start_image', None)
        return fill(g, vals)
    _each(ctx, units, graph, lambda u: {'prompt': u.get('prompt'), 'image': u.get('image') or u.get('input')})


@adapter('upscale')
def upscale(ctx, units):
    wf = _load_workflow((ctx.model or {}).get('workflow', 'upscale'))
    names = _model_values(ctx)

    def graph(c, u):
        src = u.get('input') or u.get('image')
        if not src:
            raise RuntimeError(f'{u["key"]}: нет входной картинки (inputs)')
        return fill(copy.deepcopy(wf), {'scale': 1.0, **u, **names, 'image': c.upload(src),
                                        'prefix': f'lgs/{ctx.run.name}/{u["key"]}'})
    _each(ctx, units, graph, lambda u: {'source': u.get('input')})


@adapter('comfy')
def comfy_any(ctx, units):
    def graph(c, u):
        wf = _load_workflow(u['workflow'])
        vals = {**u, 'prefix': f'lgs/{ctx.run.name}/{u["key"]}'}
        for k in ('image', 'input'):
            if isinstance(vals.get(k), str) and pathlib.Path(vals[k]).exists():
                vals[k] = c.upload(vals[k])
        return fill(wf, vals)
    _each(ctx, units, graph, lambda u: {'prompt': u.get('prompt')})


# ---------- музыка YuE2: партитура ABC → звук ----------

def _yue2_loader(ckpt, lora):
    g = {'1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': ckpt}}}
    if not lora:
        return g, ['1', 1]
    g['L'] = {'class_type': 'LoraLoader', 'inputs': {'model': ['1', 0], 'clip': ['1', 1], 'lora_name': lora,
                                                     'strength_model': 0.0, 'strength_clip': 1.0}}
    return g, ['L', 1]


def _silence_vocal(abc: str) -> str:
    """Голос Vocal → паузы той же длины (аккорды остаются): инструментал без адаптеров."""
    m = re.search(r'^M:\s*(\d+)/(\d+)', abc, re.M)
    l_ = re.search(r'^L:\s*1/(\d+)', abc, re.M)
    num, den = (int(m.group(1)), int(m.group(2))) if m else (4, 4)
    L = num * (int(l_.group(1)) if l_ else 8) // den
    out, voice = [], None
    for line in abc.split('\n'):
        mv = re.match(r'^V:\s*(\S+)', line)
        if mv:
            voice = mv.group(1)
            out.append(line)
            continue
        if voice == 'Vocal' and line and not line.startswith(('%', 'X:', 'T:', 'M:', 'L:', 'Q:', 'K:')):
            new = []
            for b in line.split('|'):
                if not b.strip() or b.strip().startswith('Z'):
                    new.append(b)
                    continue
                chords = re.findall(r'"[^"]*"', b)
                if not chords:
                    new.append(f'z{L}')
                else:
                    parts = [L // len(chords)] * len(chords)
                    parts[-1] += L - sum(parts)
                    new.append(''.join(f'{c}z{p}' for c, p in zip(chords, parts)))
            out.append('|'.join(new))
        else:
            out.append(line)
    return '\n'.join(out)


@adapter('music')
def music(ctx, units):
    if (ctx.model or {}).get('engine') == 'python':
        from .steps_proc import model_runner
        return model_runner(ctx, units)
    ckpt = _model_values(ctx).get('ckpt') or 'yue2_3b_int8_convrot.safetensors'
    c = _service(ctx)
    done = 0
    for u in units:
        ctx.check()
        if ctx.is_done(u['key']):
            ctx.reuse(u['key'])
            done += 1
            ctx.progress(done, len(units))
            continue
        style = u.get('style') or u.get('prompt') or ''
        lyrics = u.get('lyrics') or '[intro]\n[verse]\n[chorus]\n[outro]'
        seed = int(u.get('seed', 1))
        lora = u.get('lora')
        if u.get('abc_file'):
            abc = pathlib.Path(u['abc_file']).read_text(encoding='utf-8')
        else:
            ctx.progress(message=f'{u["key"]}: партитура…')
            g, clip = _yue2_loader(ckpt, lora)
            g.update({'2': {'class_type': 'YuE2GenerateABC', 'inputs': {
                'clip': clip, 'style': style, 'lyrics': lyrics, 'seed': seed, 'mode': 'full', 'max_abc_tokens': 8192,
                'temperature': 0.7, 'top_p': 0.9, 'top_k': 30, 'repetition_penalty': 1.005, 'penalty_window': 100}},
                '3': {'class_type': 'PreviewAny', 'inputs': {'source': ['2', 0]}}})
            abc = c.text(c.wait(c.submit(g), 1800, lambda: ctx.cancelled))
        (ctx.dir / f'{u["key"]}.abc').write_text(abc, encoding='utf-8')
        if u.get('silence_vocal'):
            abc = _silence_vocal(abc)
        ctx.progress(message=f'{u["key"]}: звук…')
        g, clip = _yue2_loader(ckpt, lora)
        g.update({
            '2': {'class_type': 'YuE2GenerateMusic', 'inputs': {
                'clip': clip, 'style': style, 'lyrics': lyrics, 'abc': abc, 'seed': seed, 'mode': 'full',
                'max_duration': int(u.get('max_duration', 150)), 'temperature': 1.0, 'top_p': 0.95, 'top_k': 100,
                'repetition_penalty': 1.2}},
            '3': {'class_type': 'ConditioningZeroOut', 'inputs': {'conditioning': ['2', 0]}},
            '4': {'class_type': 'EmptyYuE2LatentAudio', 'inputs': {'seconds': ['2', 1], 'batch_size': 1}},
            '5': {'class_type': 'KSampler', 'inputs': {
                'model': ['1', 0], 'positive': ['2', 0], 'negative': ['3', 0], 'latent_image': ['4', 0],
                'seed': seed, 'steps': 32, 'cfg': 1.0, 'sampler_name': 'dpm_2', 'scheduler': 'sgm_uniform', 'denoise': 1.0}},
            '6': {'class_type': 'VAEDecodeAudio', 'inputs': {'samples': ['5', 0], 'vae': ['1', 2]}},
            '7': {'class_type': 'SaveAudio', 'inputs': {'audio': ['6', 0], 'filename_prefix': f'lgs/{ctx.run.name}/{u["key"]}'}},
        })
        try:
            entry = c.wait(c.submit(g), 3600, lambda: ctx.cancelled,
                           tick=lambda s, k=u['key']: ctx.progress(message=f'{k}: звук {s:.0f} с'))
        except InterruptedError:
            raise Cancelled() from None
        _save_outputs(ctx, c, entry, u, {'style': style, 'lyrics': lyrics})
        done += 1
        ctx.progress(done, len(units), '')
