"""Загрузки моделей: Hugging Face (основной адрес → зеркала → ModelScope), прямые ссылки, докачка с места обрыва.

Очередь с несколькими потоками; прогресс — событиями «download» в шину (байты, скорость, остаток).
"""
import fnmatch
import json
import pathlib
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from . import catalog, config, events

CHUNK = 1 << 20
_jobs: dict[str, dict] = {}
_queue: list[str] = []
_cv = threading.Condition()
_workers: list[threading.Thread] = []
_orig_getaddrinfo = socket.getaddrinfo
_after: dict = {}          # id загрузки → что сделать после (распаковать и т.п.)


def on_done(job_id: str, fn):
    j = _jobs.get(job_id)
    if j and j['status'] == 'done':
        fn(j)
    else:
        _after[job_id] = fn


def _apply_ipv4():
    if config.CFG.get('ipv4_only'):
        socket.getaddrinfo = lambda *a, **k: [x for x in _orig_getaddrinfo(*a, **k) if x[0] == socket.AF_INET] or _orig_getaddrinfo(*a, **k)
    else:
        socket.getaddrinfo = _orig_getaddrinfo


def _headers(url: str) -> dict:
    h = {'User-Agent': 'llm-game-studio/0.1'}
    tok = config.CFG.get('hf_token')
    host = urllib.parse.urlparse(url).netloc
    if tok and ('huggingface' in host or 'hf-mirror' in host):
        h['Authorization'] = f'Bearer {tok}'
    return h


def _open(url: str, start: int = 0, timeout: float = 30):
    h = _headers(url)
    if start:
        h['Range'] = f'bytes={start}-'
    return urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout)


def hf_bases() -> list[str]:
    return [config.CFG.get('hf_endpoint') or 'https://huggingface.co'] + list(config.CFG.get('hf_mirrors', []))


def file_urls(repo: str, path: str) -> list[str]:
    q = urllib.parse.quote(path)
    urls = [f'{b.rstrip("/")}/{repo}/resolve/main/{q}' for b in hf_bases()]
    if config.CFG.get('modelscope', True):
        urls.append(f'https://modelscope.cn/models/{repo}/resolve/master/{q}')
    return urls


def list_repo(repo: str) -> list[dict]:
    """Файлы репозитория с размерами: [{path, size}]. Пробует HF, зеркала, ModelScope."""
    _apply_ipv4()
    errors = []
    for b in hf_bases():
        url = f'{b.rstrip("/")}/api/models/{repo}/tree/main?recursive=true'
        try:
            with _open(url, timeout=20) as r:
                data = json.loads(r.read())
            return [{'path': x['path'], 'size': x.get('size') or (x.get('lfs') or {}).get('size', 0)} for x in data if x.get('type') == 'file']
        except (OSError, ValueError) as e:
            errors.append(f'{b}: {e}')
    if config.CFG.get('modelscope', True):
        url = f'https://modelscope.cn/api/v1/models/{repo}/repo/files?Recursive=true'
        try:
            with _open(url, timeout=20) as r:
                data = json.loads(r.read())
            files = data.get('Data', {}).get('Files', [])
            return [{'path': x['Path'], 'size': x.get('Size', 0)} for x in files if x.get('Type') == 'blob']
        except (OSError, ValueError) as e:
            errors.append(f'modelscope: {e}')
    raise RuntimeError('репозиторий недоступен: ' + '; '.join(errors))


def check_source(f: dict) -> dict:
    """Есть ли файл по источнику (HEAD/первый байт), не скачивая."""
    _apply_ipv4()
    urls = [f['url']] if f.get('url') else (None if f.get('snapshot') else file_urls(f['repo'], f['path']))
    if urls is None:
        try:
            files = list_repo(f['repo'])
            return {'ok': bool(files), 'detail': f'{len(files)} файлов, {sum(x["size"] for x in files) / 2**30:.1f} ГБ'}
        except RuntimeError as e:
            return {'ok': False, 'detail': str(e)}
    errs = []
    for u in urls:
        try:
            with _open(u, start=0, timeout=15) as r:
                size = int(r.headers.get('Content-Length') or 0)
                return {'ok': True, 'detail': f'{urllib.parse.urlparse(u).netloc}: {size / 2**30:.2f} ГБ'}
        except (OSError, ValueError) as e:
            errs.append(f'{urllib.parse.urlparse(u).netloc}: {getattr(e, "code", "") or e}')
    return {'ok': False, 'detail': '; '.join(errs)}


def _public(j: dict) -> dict:
    return {k: v for k, v in j.items() if not k.startswith('_')}


def jobs() -> list[dict]:
    return [_public(j) for j in _jobs.values()]


def _emit(j):
    events.publish('download', _public(j))


def enqueue(title: str, files: list[dict], model_id: str | None = None) -> dict:
    """files: [{urls: [...], dest: путь, size: байт}] — один пункт очереди на модель."""
    j = {'id': uuid.uuid4().hex[:8], 'title': title, 'model': model_id, 'status': 'queued', 'done': 0,
         'total': sum(f.get('size', 0) for f in files), 'speed': 0, 'eta': None, 'error': None,
         'file': None, 'files_done': 0, 'files_total': len(files), '_files': files, '_cancel': False}
    with _cv:
        _jobs[j['id']] = j
        _queue.append(j['id'])
        _cv.notify()
    _ensure_workers()
    _emit(j)
    return _public(j)


def cancel(job_id: str):
    j = _jobs.get(job_id)
    if j:
        j['_cancel'] = True
        if j['status'] == 'queued':
            j['status'] = 'cancelled'
            _emit(j)


def _ensure_workers():
    alive = [w for w in _workers if w.is_alive()]
    _workers[:] = alive
    for _ in range(max(1, int(config.CFG.get('parallel_downloads', 2))) - len(alive)):
        w = threading.Thread(target=_worker, daemon=True)
        w.start()
        _workers.append(w)


def _worker():
    while True:
        with _cv:
            while not _queue:
                _cv.wait()
            jid = _queue.pop(0)
        j = _jobs[jid]
        if j['status'] == 'cancelled':
            continue
        j['status'] = 'running'
        _emit(j)
        try:
            _apply_ipv4()
            base_done = 0
            for f in j['_files']:
                j['file'] = pathlib.Path(f['dest']).name
                _fetch(j, f, base_done)
                base_done += f.get('size') or pathlib.Path(f['dest']).stat().st_size
                j['files_done'] += 1
                if j['_cancel']:
                    break
            j['status'] = 'cancelled' if j['_cancel'] else 'done'
            j['done'] = j['total'] if j['status'] == 'done' else j['done']
            if j['status'] == 'done' and jid in _after:
                j['status'] = 'unpacking'
                _emit(j)
                _after.pop(jid)(j)
                j['status'] = 'done'
        except Exception as e:  # noqa: BLE001 — любая ошибка сети должна дойти до пользователя
            j['status'] = 'error'
            j['error'] = str(e)
        j['speed'] = 0
        _emit(j)


def _fetch(j: dict, f: dict, base_done: int):
    dest = pathlib.Path(f['dest'])
    if dest.exists() and (not f.get('size') or dest.stat().st_size == f['size']):
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + '.part')
    errors = []
    for url in f['urls']:
        for attempt in range(3):
            have = part.stat().st_size if part.exists() else 0
            try:
                with _open(url, start=have, timeout=60) as r:
                    if have and r.status != 206:      # сервер не умеет докачку — с начала
                        have = 0
                        part.unlink(missing_ok=True)
                    total = have + int(r.headers.get('Content-Length') or 0)
                    if not f.get('size') and total:
                        j['total'] += total
                        f['size'] = total
                    t0, got0, last = time.time(), have, 0.0
                    with open(part, 'ab') as out:
                        while True:
                            if j['_cancel']:
                                return
                            buf = r.read(CHUNK)
                            if not buf:
                                break
                            out.write(buf)
                            have += len(buf)
                            now = time.time()
                            if now - last > 0.5:
                                last = now
                                j['done'] = base_done + have
                                j['speed'] = (have - got0) / max(0.1, now - t0)
                                j['eta'] = (j['total'] - j['done']) / j['speed'] if j['speed'] else None
                                _emit(j)
                part.replace(dest)
                return
            except urllib.error.HTTPError as e:
                errors.append(f'{urllib.parse.urlparse(url).netloc}: HTTP {e.code}' + (' (нужен токен и согласие на странице модели)' if e.code in (401, 403) else ''))
                break                                  # 4xx — пробуем другой источник
            except OSError as e:
                errors.append(f'{urllib.parse.urlparse(url).netloc}: {e}')
                time.sleep(2 + attempt * 3)
    raise RuntimeError(f'{dest.name}: ' + '; '.join(errors[-4:]))


# --- что скачать для модели каталога ---

def has_quant(path: str, q: str) -> bool:
    """Файл — именно этот квант (Q4_K_M не путать с UD-Q4_K_XL и Q4_K_S)."""
    n = pathlib.PurePosixPath(path).name.upper()
    q = q.upper()
    if q.startswith('UD-') != ('UD-' in n):
        return False
    return re.search(r'[-_.]' + re.escape(q.removeprefix('UD-')) + r'([-_.]|$)', n) is not None


def plan_model(m: dict, quant: str | None = None) -> list[dict]:
    """Список файлов модели, которых нет на диске: [{urls, dest, size}]."""
    out = []
    if m['kind'] == 'llm':
        files = list_repo(m['repo'])
        q = (quant or 'Q4_K_M').upper()
        ggufs = [x for x in files if x['path'].lower().endswith('.gguf') and 'mmproj' not in x['path'].lower()]
        pick = [x for x in ggufs if has_quant(x['path'], q)]
        if not pick:
            raise RuntimeError(f'в {m["repo"]} нет кванта {q}; есть: ' + ', '.join(sorted({catalog.guess_quant(x["path"]) for x in ggufs})))
        # разбитые на части (-00001-of-00003) берём все части одного кванта
        first = sorted(pick, key=lambda x: x['path'])
        stem = first[0]['path'].split('-00001-of-')[0] if '-00001-of-' in first[0]['path'] else first[0]['path']
        pick = [x for x in first if x['path'].startswith(stem.removesuffix('.gguf'))]
        root = pathlib.Path(config.CFG['llm_dir']) / m['repo'].split('/')[-1]
        for x in pick:
            out.append({'urls': file_urls(m['repo'], x['path']), 'dest': str(root / pathlib.PurePosixPath(x['path']).name), 'size': x['size']})
        if m.get('vision'):
            mm = [x for x in files if 'mmproj' in x['path'].lower()]
            mm.sort(key=lambda x: ('f16' not in x['path'].lower(), x['size']))
            if mm:
                out.append({'urls': file_urls(m['repo'], mm[0]['path']), 'dest': str(root / pathlib.PurePosixPath(mm[0]['path']).name), 'size': mm[0]['size']})
        return [f for f in out if not pathlib.Path(f['dest']).exists()]
    for f in m.get('files', []):
        st = catalog.file_status(f)
        if st['installed']:
            continue
        folder = catalog.dest_dir(f['dest'])
        if f.get('url'):
            out.append({'urls': [f['url']], 'dest': str(folder / pathlib.PurePosixPath(urllib.parse.urlparse(f['url']).path).name), 'size': 0})
        elif f.get('snapshot'):
            for x in list_repo(f['repo']):
                if fnmatch.fnmatch(x['path'], f.get('skip', '') or '\0'):
                    continue
                dest = folder / x['path']
                if not dest.exists():
                    out.append({'urls': file_urls(f['repo'], x['path']), 'dest': str(dest), 'size': x['size']})
        else:
            name = pathlib.PurePosixPath(f['path']).name
            out.append({'urls': file_urls(f['repo'], f['path']), 'dest': str(folder / name), 'size': int(f.get('size_gb', 0) * 2**30)})
    return out


def download_model(model_id: str, quant: str | None = None) -> dict:
    m = catalog.get(model_id)
    if not m:
        raise KeyError(model_id)
    files = plan_model(m, quant)
    if not files:
        return {'status': 'done', 'title': m['title'], 'note': 'всё уже на диске'}
    return enqueue(m['title'] + (f' {quant}' if quant else ''), files, model_id)
