"""Скрипт LGS: разбор, проверка, подстановки ${...}, развёртка шагов в единицы работы. Формат — SCRIPT_FORMAT.md."""
import glob
import json
import pathlib
import re

try:
    import yaml
except ImportError:  # без PyYAML — только JSON
    yaml = None

from . import config

STEP_TYPES = {
    # тип: (вид модели или None, что делает)
    'llm': ('llm', 'текст/JSON от языковой модели'),
    'vlm': ('llm', 'оценка картинок языковой моделью со зрением'),
    'code': ('llm', 'код по заданию: модель пишет файлы, тест проверяет, ошибки — обратно модели'),
    'image': ('image', 'картинки по промпту'),
    'video': ('video', 'ролик по промпту и картинке'),
    'upscale': ('upscale', 'увеличение картинок'),
    'music': ('music', 'музыка'),
    'sfx': ('sfx', 'звуки'),
    'tts': ('tts', 'озвучка фраз'),
    'asr': ('asr', 'распознавание речи, оценка дублей'),
    'cutout': ('cutout', 'вырезка фона'),
    'comfy': (None, 'любой граф ComfyUI (API-формат) с подстановками'),
    'python': (None, 'свой питон-скрипт'),
    'shell': (None, 'команда оболочки'),
    'approve': (None, 'пауза: человек смотрит результаты и отмечает лучшие'),
    'service': (None, 'запустить/остановить серверы моделей'),
}
NAME_RE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_.-]*$')
VAR_RE = re.compile(r'\$\{([^}]+)\}')
TOP_KEYS = {'lgs', 'name', 'title', 'description', 'project', 'vars', 'options', 'requires', 'steps', 'author'}
STEP_KEYS = {'id', 'title', 'uses', 'after', 'gpu', 'model', 'with', 'items', 'items_from', 'inputs', 'seeds', 'out',
             'continue_on_error', 'force', 'note',
             # тип-специфичные (могут быть и в with/items)
             'prompt', 'system', 'json', 'max_tokens', 'temperature', 'images', 'task', 'files', 'context', 'test',
             'workdir', 'max_iters', 'workflow', 'outputs', 'script', 'args', 'python', 'env', 'cwd', 'run',
             'message', 'show', 'pick', 'start', 'stop', 'llm', 'voices', 'language', 'expected', 'timeout'}


class ScriptError(ValueError):
    pass


def parse(text: str) -> dict:
    text = text.lstrip('﻿')
    s = text.strip()
    # из ответа LLM часто приходит блок ```yaml ... ``` — достаём содержимое
    m = re.search(r'```(?:ya?ml|json)?\s*\n(.*?)```', s, re.S)
    if m and not s.startswith(('lgs', '{')):
        s = m.group(1)
    if s.startswith('{'):
        return json.loads(s)
    if yaml is None:
        raise ScriptError('PyYAML не установлен — дайте скрипт в JSON или запустите студию через start.cmd')
    data = yaml.safe_load(s)
    if not isinstance(data, dict):
        raise ScriptError('скрипт должен быть словарём (lgs: 1, name: ..., steps: [...])')
    return data


def validate(sc: dict) -> list[str]:
    return check(sc)[0]


def check(sc: dict) -> tuple[list[str], list[str]]:
    """(ошибки, предупреждения). Незнакомый ключ шага — не ошибка: он уходит в значения единиц (как with)."""
    err, warn = [], []
    if sc.get('lgs') != 1:
        err.append('первая строка должна быть «lgs: 1» (версия формата)')
    if not isinstance(sc.get('name'), str) or not NAME_RE.match(sc.get('name', '')):
        err.append('name — латиница/цифры/-_. (это имя папки выхода)')
    if sc.get('project') is not None and not NAME_RE.match(str(sc['project'])):
        err.append('project — латиница/цифры/-_.')
    for k in sc:
        if k not in TOP_KEYS:
            err.append(f'неизвестный ключ верхнего уровня «{k}»')
    steps = sc.get('steps')
    if not isinstance(steps, list) or not steps:
        err.append('steps — непустой список шагов')
        return err, warn
    ids = set()
    for i, st in enumerate(steps):
        where = f'шаг {i + 1}'
        if not isinstance(st, dict):
            err.append(f'{where}: должен быть словарём')
            continue
        sid = st.get('id')
        if not isinstance(sid, str) or not NAME_RE.match(sid):
            err.append(f'{where}: id — латиница/цифры/-_.')
        elif sid in ids:
            err.append(f'{where}: id «{sid}» повторяется')
        ids.add(sid)
        where = f'шаг «{sid}»'
        uses = st.get('uses')
        if uses not in STEP_TYPES:
            err.append(f'{where}: uses — один из: {", ".join(STEP_TYPES)}')
        for k in st:
            if k not in STEP_KEYS:
                warn.append(f'{where}: ключ «{k}» не из формата — считаю параметром (как в with)')
        for dep in _list(st.get('after')):
            if dep not in ids:
                err.append(f'{where}: after «{dep}» — нет такого шага выше')
        if 'items' in st and not isinstance(st['items'], list):
            err.append(f'{where}: items — список')
        for j, it in enumerate(st.get('items') or []):
            if not isinstance(it, dict) or not it.get('name'):
                err.append(f'{where}: items[{j}] — словарь с name')
            elif not NAME_RE.match(str(it['name'])):
                err.append(f'{where}: items[{j}].name «{it["name"]}» — латиница/цифры/-_.')
        if st.get('seeds') is not None and not (isinstance(st['seeds'], list) and all(isinstance(x, int) for x in st['seeds'])):
            err.append(f'{where}: seeds — список целых')
        g = st.get('gpu', 'auto')
        if g not in ('auto', 'cpu') and not isinstance(g, int):
            err.append(f'{where}: gpu — auto, cpu или номер карты')
        need = {'shell': ['run'], 'python': ['script'], 'comfy': ['workflow'], 'code': ['task', 'test'],
                'approve': ['show'], 'service': []}.get(uses, [])
        for k in need:
            if not st.get(k) and not (st.get('with') or {}).get(k):
                err.append(f'{where}: для uses: {uses} нужен ключ «{k}»')
        if uses in ('llm', 'vlm', 'image', 'video', 'sfx') and not _has_field(st, 'prompt'):
            err.append(f'{where}: нужен prompt (в шаге, в with или в каждом элементе items)')
        if uses == 'tts' and not _has_field(st, 'text'):
            err.append(f'{where}: в items нужны text (и voice, если голосов несколько)')
        if uses in ('upscale', 'cutout', 'asr') and not (st.get('inputs') or st.get('items') or st.get('items_from')):
            err.append(f'{where}: нужны inputs (шаблон путей, например "${{steps.art.dir}}/*.png")')
        if uses == 'approve':
            for dep in _list(st.get('show')):
                if dep not in ids:
                    err.append(f'{where}: show «{dep}» — нет такого шага выше')
    for r in sc.get('requires') or []:
        if not isinstance(r, dict) or not ({'kind', 'model', 'hf'} & set(r)):
            err.append('requires: каждый элемент — {kind: ...} | {model: ...} | {hf: репозиторий, ...}')
    return err, warn


def _has_field(st: dict, key: str) -> bool:
    if st.get(key) or (st.get('with') or {}).get(key):
        return True
    items = st.get('items')
    if items:
        return all(isinstance(i, dict) and i.get(key) for i in items)
    return bool(st.get('items_from'))


def _list(v) -> list:
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def run_dir(sc: dict) -> pathlib.Path:
    out = (sc.get('options') or {}).get('out') or config.CFG['out_dir']
    return pathlib.Path(out) / (sc.get('project') or 'misc') / sc['name']


def step_dir(sc: dict, st: dict) -> pathlib.Path:
    return run_dir(sc) / (st.get('out') or st['id'])


class Ctx(dict):
    """Значения для ${...}: поля единицы → vars → встроенные (run.dir, steps.<id>.dir, out)."""

    def lookup(self, key: str):
        key = key.strip()
        cur = self
        for part in key.split('.'):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                raise KeyError(key)
        return cur


def subst(v, ctx: Ctx):
    """Подставить ${...} во всё дерево. Строка целиком «${x}» → значение как есть (число, список)."""
    if isinstance(v, dict):
        return {k: subst(x, ctx) for k, x in v.items()}
    if isinstance(v, list):
        return [subst(x, ctx) for x in v]
    if not isinstance(v, str) or '${' not in v:
        return v
    m = VAR_RE.fullmatch(v)
    if m:
        try:
            return ctx.lookup(m.group(1))
        except KeyError:
            return v

    def rep(mm):
        try:
            x = ctx.lookup(mm.group(1))
            return x if isinstance(x, str) else json.dumps(x, ensure_ascii=False)
        except KeyError:
            return mm.group(0)
    # несколько проходов: vars могут ссылаться друг на друга
    for _ in range(4):
        nv = VAR_RE.sub(rep, v)
        if nv == v:
            break
        v = nv
    return v


def base_ctx(sc: dict) -> Ctx:
    steps = {st['id']: {'dir': str(step_dir(sc, st)).replace('\\', '/')} for st in sc['steps']}
    ctx = Ctx(sc.get('vars') or {})
    ctx.update({'run': {'dir': str(run_dir(sc)).replace('\\', '/'), 'name': sc['name']}, 'steps': steps,
                'out': str(run_dir(sc)).replace('\\', '/'), 'project': sc.get('project') or 'misc',
                'studio': {'dir': str(config.ROOT).replace('\\', '/')}})
    ctx['vars'] = sc.get('vars') or {}
    return ctx


def units(sc: dict, st: dict, model_defaults: dict | None = None) -> list[dict]:
    """Развернуть шаг в единицы работы: item × seed, с подставленными значениями.
    Вызывается в момент запуска шага — items_from/inputs читают выход предыдущих шагов."""
    ctx = base_ctx(sc)
    with_ = st.get('with') or {}
    common = {k: v for k, v in st.items() if k not in ('id', 'title', 'uses', 'after', 'gpu', 'model', 'with', 'items',
                                                       'items_from', 'inputs', 'seeds', 'out', 'continue_on_error',
                                                       'force', 'note')}
    items = list(st.get('items') or [])
    if st.get('items_from'):
        items += load_items(subst(st['items_from'], ctx))
    if st.get('inputs'):
        before = len(items)
        pats = _list(subst(st['inputs'], ctx))
        for pat in pats:
            for p in sorted(glob.glob(str(pat))):
                pp = pathlib.Path(p)
                if pp.name in ('manifest.json', 'results.json', 'selected.json'):
                    continue
                items.append({'name': pp.stem, 'input': str(pp).replace('\\', '/')})
        if len(items) == before:
            raise ScriptError(f'шаг «{st["id"]}»: по inputs ничего не нашлось: {", ".join(map(str, pats))}')
    if not items:
        items = [{'name': st['id']}]
    seeds = st.get('seeds')
    out = []
    for it in items:
        for seed in (it.get('seeds') or seeds or [None]):
            vals = {**(model_defaults or {}), **with_, **common, **{k: v for k, v in it.items() if k != 'seeds'}}
            if seed is not None:
                vals['seed'] = seed
            vals.setdefault('seed', 1)
            u = Ctx(ctx)
            u.update({k: v for k, v in vals.items()})
            u['item'] = it
            resolved = subst(vals, u)
            # второй проход: поля, ссылающиеся на поля этой же единицы (prompt: "${subject}, ${style}")
            u.update(resolved)
            resolved = subst(resolved, u)
            resolved['name'] = str(resolved.get('name', st['id']))
            resolved['key'] = resolved['name'] + (f"-{resolved['seed']}" if seeds or it.get('seeds') else '')
            out.append(resolved)
    return out


def load_items(path: str) -> list[dict]:
    """Элементы из файла предыдущего шага: список словарей / {имя: {...}} / results.json / selected.json."""
    p = pathlib.Path(path)
    if not p.exists():
        raise ScriptError(f'items_from: нет файла {p}')
    data = json.loads(p.read_text(encoding='utf-8'))
    if isinstance(data, dict) and 'items' in data:
        data = data['items']
    if isinstance(data, dict):
        data = [{'name': k, **(v if isinstance(v, dict) else {'value': v})} for k, v in data.items()]
    raw = []
    for i, x in enumerate(data):
        if isinstance(x, dict) and isinstance(x.get('json'), (dict, list)):
            # results.json шага llm: {name, json: {...}} → поля json наверх; список внутри — каждый элемент отдельно
            j = x['json']
            if isinstance(j, dict) and len(j) == 1 and isinstance(next(iter(j.values())), list):
                j = next(iter(j.values()))      # {"items": [...]} — режим JSON часто требует объект сверху
            if isinstance(j, list):
                for k, y in enumerate(j):
                    y = y if isinstance(y, dict) else {'value': y}
                    raw.append({**y, 'name': y.get('name') or f"{x['name']}-{k + 1}"})
                continue
            x = {**x, **j}
        raw.append(x if isinstance(x, dict) else {'name': f'item{i + 1}', 'value': x})
    items = []
    for i, x in enumerate(raw):
        x.setdefault('name', x.get('key') or f'item{i + 1}')
        f = x.get('file')
        if isinstance(f, str) and f and not pathlib.Path(f).is_absolute():   # manifest.json: пути от папки шага
            x['file'] = (p.parent / f).as_posix()
        x['name'] = re.sub(r'[^a-zA-Z0-9_.-]+', '-', str(x['name'])).strip('-') or f'item{i + 1}'
        items.append(x)
    return items


def deps(st: dict) -> list[str]:
    d = _list(st.get('after'))
    if st.get('uses') == 'approve':
        d += [x for x in _list(st.get('show')) if x not in d]
    # ссылка ${steps.X.dir} в inputs/items_from — тоже зависимость
    blob = json.dumps({k: st.get(k) for k in ('inputs', 'items_from', 'with', 'items', 'image', 'images')}, ensure_ascii=False)
    for m in re.finditer(r'\$\{steps\.([^.}]+)\.', blob):
        if m.group(1) != st['id'] and m.group(1) not in d:
            d.append(m.group(1))
    return d


def load_file(path: str) -> tuple[dict, str]:
    text = pathlib.Path(path).read_text(encoding='utf-8')
    return parse(text), text
