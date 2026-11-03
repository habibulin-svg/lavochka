"""Шаги на языковой модели (llama-server, OpenAI-совместимый API): llm, vlm, code."""
import base64
import json
import mimetypes
import pathlib
import re
import subprocess
import time
import urllib.request

from . import services
from .runner import adapter
from .steps_proc import pick_llm_profile

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def ensure_llm(ctx) -> str:
    """Поднять llama-server, если не запущен. Возвращает базовый адрес."""
    s = services.SERVICES['llm']
    if not s.alive():
        prof = pick_llm_profile(ctx.st.get('llm'))
        for g in prof.get('gpus', []):
            stopped = services.free_gpu_for(g, prof['size_gb'] / max(1, len(prof['gpus'])) + 1, keep={'llm'})
            if stopped:
                ctx.log('освободил карту под LLM: остановлены ' + ', '.join(stopped))
        ctx.progress(message=f'запускаю {prof["title"]} {prof["quant"]}…')
        ctx.log(f'запускаю LLM: {prof["title"]} {prof["quant"]}, контекст {prof["ctx"]}')
        s.start(prof)
        s.wait_ready(900)
    return f'http://127.0.0.1:{s.port}'


def chat(base: str, messages: list, *, json_mode=None, max_tokens=2048, temperature=None, think=None,
         on_token=None, cancelled=lambda: False, timeout=1800) -> str:
    body = {'messages': messages, 'max_tokens': int(max_tokens), 'stream': True}
    if temperature is not None:
        body['temperature'] = float(temperature)
    if json_mode:
        body['response_format'] = {'type': 'json_object', **({'schema': json_mode} if isinstance(json_mode, dict) else {})}
    if think is not None:
        body['chat_template_kwargs'] = {'enable_thinking': bool(think)}
    req = urllib.request.Request(base + '/v1/chat/completions', json.dumps(body).encode(), {'Content-Type': 'application/json'})
    text, n, t0 = [], 0, time.time()
    with _opener.open(req, timeout=timeout) as r:
        for raw in r:
            if cancelled():
                raise InterruptedError('отменено')
            line = raw.decode('utf-8', errors='replace').strip()
            if not line.startswith('data:'):
                continue
            data = line[5:].strip()
            if data == '[DONE]':
                break
            try:
                delta = json.loads(data)['choices'][0].get('delta', {})
            except (ValueError, KeyError, IndexError):
                continue
            piece = delta.get('content') or ''
            if piece:
                text.append(piece)
            n += 1
            if on_token and n % 16 == 0:
                on_token(n, n / max(0.1, time.time() - t0), bool(delta.get('reasoning_content')))
    out = ''.join(text)
    return re.sub(r'<think>.*?</think>\s*', '', out, flags=re.S).strip()


def parse_json(text: str):
    t = text.strip()
    m = re.search(r'```(?:json)?\s*\n(.*?)```', t, re.S)
    if m:
        t = m.group(1)
    try:
        return json.loads(t)
    except ValueError:
        i = min([x for x in (t.find('{'), t.find('[')) if x >= 0] or [0])
        return json.loads(t[i:])


def _image_part(path: str) -> dict:
    mt = mimetypes.guess_type(path)[0] or 'image/png'
    data = base64.b64encode(pathlib.Path(path).read_bytes()).decode()
    return {'type': 'image_url', 'image_url': {'url': f'data:{mt};base64,{data}'}}


def _gen(ctx, units, vision=False):
    base = ensure_llm(ctx)
    results = []
    rp = ctx.dir / 'results.json'
    old = {r['name']: r for r in json.loads(rp.read_text(encoding='utf-8'))} if rp.exists() and not ctx.st.get('force') else {}
    for i, u in enumerate(units):
        ctx.check()
        want_json = u.get('json')
        ext = 'json' if want_json else u.get('ext', 'md')
        dest = ctx.dir / f'{u["key"]}.{ext}'
        if ctx.is_done(u['key']) and u['name'] in old:
            ctx.reuse(u['key'])
            results.append(old[u['name']])
            ctx.progress(i + 1, len(units))
            continue
        content = [{'type': 'text', 'text': u['prompt']}]
        imgs = []
        if vision:
            imgs = u.get('images') or ([u['input']] if u.get('input') else []) or ([u['image']] if u.get('image') else [])
            imgs = imgs if isinstance(imgs, list) else [imgs]
            content = [_image_part(p) for p in imgs] + content
        msgs = ([{'role': 'system', 'content': u['system']}] if u.get('system') else []) + \
               [{'role': 'user', 'content': content if vision else u['prompt']}]

        def tick(n, tps, thinking, k=u['key']):
            ctx.progress(message=f'{k}: {"думает" if thinking else "пишет"} {n} ток · {tps:.0f} ток/с')
        try:
            text = chat(base, msgs, json_mode=want_json, max_tokens=u.get('max_tokens', 2048), temperature=u.get('temperature'),
                        think=u.get('think'), on_token=tick, cancelled=lambda: ctx.cancelled)
        except InterruptedError:
            ctx.check()
            raise
        rec = {'name': u['name'], 'key': u['key'], 'text': text}
        if vision and imgs:
            rec['images'] = imgs
        if want_json:
            try:
                rec['json'] = parse_json(text)
                dest.write_text(json.dumps(rec['json'], ensure_ascii=False, indent=1), encoding='utf-8')
            except ValueError:
                ctx.log(f'{u["key"]}: ответ не JSON — сохраняю как текст')
                dest = dest.with_suffix('.txt')
                dest.write_text(text, encoding='utf-8')
        else:
            dest.write_text(text, encoding='utf-8')
        results.append(rec)
        meta = {'item': u['name'], 'prompt': u['prompt'][:500]}
        if vision and imgs:
            meta['source'] = imgs[0]
            if isinstance(rec.get('json'), dict):
                meta['verdict'] = rec['json']
        ctx.output(dest, key=u['key'], **meta)
        rp.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding='utf-8')
        ctx.progress(i + 1, len(units), '')
    rp.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding='utf-8')


@adapter('llm')
def llm(ctx, units):
    _gen(ctx, units, vision=False)


@adapter('vlm')
def vlm(ctx, units):
    _gen(ctx, units, vision=True)


# ---------- code: модель пишет файлы, тест проверяет ----------

CODE_SYSTEM = """Ты пишешь код по заданию. Отвечай ТОЛЬКО блоками файлов, каждый файл целиком:

```<язык> path=<путь от рабочей папки>
<полное содержимое файла>
```

Можно писать только в разрешённые файлы. Без пояснений вне блоков. Если тест упал — исправь по его выводу."""

FILE_RE = re.compile(r'```[\w+.#-]*[ \t]+(?:path=|file:|file=)?([^\s`]+)[ \t]*\n(.*?)```', re.S)


def _allowed(rel: str, patterns: list[str]) -> bool:
    import fnmatch
    rel = rel.replace('\\', '/').lstrip('./')
    return any(fnmatch.fnmatch(rel, p.replace('\\', '/').lstrip('./')) for p in patterns)


@adapter('code')
def code(ctx, units):
    u = units[0]
    work = pathlib.Path(u.get('workdir') or ctx.run.dir).resolve()
    allowed = u.get('files') or []
    if not allowed:
        raise RuntimeError('code: перечислите files — какие файлы модели можно писать (пути или шаблоны от workdir)')
    task = u['task']
    if isinstance(task, str) and len(task) < 260 and not task.count('\n') and (work / task).is_file():
        task = (work / task).read_text(encoding='utf-8')
    max_iters = int(u.get('max_iters', 3))
    base = ensure_llm(ctx)
    backup = ctx.dir / 'backup'
    originals: dict[str, str | None] = {}

    def show_files():
        parts = []
        import glob
        for pat in allowed:
            for p in sorted(glob.glob(str(work / pat), recursive=True)):
                pp = pathlib.Path(p)
                if pp.is_file():
                    parts.append(f'--- {pp.relative_to(work).as_posix()} ---\n{pp.read_text(encoding="utf-8", errors="replace")}')
        for c in (u.get('context') or []):
            pp = work / c
            if pp.is_file():
                parts.append(f'--- {c} (только чтение) ---\n{pp.read_text(encoding="utf-8", errors="replace")[:20000]}')
        return '\n\n'.join(parts) or '(файлов ещё нет)'

    msgs = [{'role': 'system', 'content': CODE_SYSTEM},
            {'role': 'user', 'content': f'Рабочая папка: {work}\nРазрешённые файлы: {", ".join(allowed)}\n'
                                        f'Тест: {u["test"]}\n\nЗАДАНИЕ:\n{task}\n\nТЕКУЩИЕ ФАЙЛЫ:\n{show_files()}'}]
    report = [f'# {ctx.state.title}\n', f'Задание: {task[:2000]}\n']
    ok = False
    for it in range(1, max_iters + 1):
        ctx.check()
        ctx.progress(it - 1, max_iters, f'попытка {it}: модель пишет…')

        def tick(n, tps, thinking, it=it):
            ctx.progress(message=f'попытка {it}: {"думает" if thinking else "пишет"} {n} ток · {tps:.0f} ток/с')
        reply = chat(base, msgs, max_tokens=u.get('max_tokens', 8192), temperature=u.get('temperature', 0.3),
                     think=u.get('think'), on_token=tick, cancelled=lambda: ctx.cancelled)
        blocks = FILE_RE.findall(reply)
        if not blocks:
            ctx.log(f'попытка {it}: в ответе нет блоков файлов')
            msgs += [{'role': 'assistant', 'content': reply},
                     {'role': 'user', 'content': 'Нет ни одного блока файла. Ответь блоками ```язык path=файл ... ```.'}]
            continue
        written = []
        for rel, body in blocks:
            if not _allowed(rel, allowed):
                ctx.log(f'попытка {it}: {rel} — не из разрешённых, пропускаю')
                continue
            dest = (work / rel).resolve()
            if not dest.is_relative_to(work):
                ctx.log(f'попытка {it}: {rel} — вне рабочей папки, пропускаю')
                continue
            if str(dest) not in originals:
                originals[str(dest)] = dest.read_text(encoding='utf-8') if dest.exists() else None
                if dest.exists():
                    (backup / rel).parent.mkdir(parents=True, exist_ok=True)
                    (backup / rel).write_text(originals[str(dest)], encoding='utf-8')
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(body, encoding='utf-8')
            written.append(rel)
        ctx.log(f'попытка {it}: записаны {", ".join(written) or "—"}')
        ctx.progress(message=f'попытка {it}: тест…')
        r = subprocess.run(u['test'], shell=True, cwd=str(work), capture_output=True, text=True, encoding='utf-8',
                           errors='replace', timeout=float(u.get('timeout', 600)))
        out = (r.stdout + '\n' + r.stderr).strip()
        for line in out.splitlines()[-40:]:
            ctx.log('  ' + line)
        report.append(f'\n## Попытка {it}: {"тест пройден" if r.returncode == 0 else f"код {r.returncode}"}\n'
                      f'Файлы: {", ".join(written)}\n\n```\n{out[-3000:]}\n```\n')
        if r.returncode == 0:
            ok = True
            break
        msgs += [{'role': 'assistant', 'content': reply},
                 {'role': 'user', 'content': f'Тест упал (код {r.returncode}). Вывод:\n```\n{out[-6000:]}\n```\nИсправь. '
                                             f'Текущие файлы:\n{show_files()}'}]
    rp = ctx.dir / 'report.md'
    if not ok and not u.get('keep_on_fail'):
        for path, text in originals.items():
            p = pathlib.Path(path)
            if text is None:
                p.unlink(missing_ok=True)
            else:
                p.write_text(text, encoding='utf-8')
        report.append('\n**Не вышло — файлы возвращены как были** (keep_on_fail: true — оставить черновик).\n')
    rp.write_text(''.join(report), encoding='utf-8')
    ctx.output(rp, key='report')
    for path in originals:
        if ok and pathlib.Path(path).exists():
            ctx.output(path, key=pathlib.Path(path).name)
    if not ok:
        raise RuntimeError(f'тест не прошёл за {max_iters} попыток — см. report.md')
    ctx.progress(max_iters, max_iters, 'тест пройден')
