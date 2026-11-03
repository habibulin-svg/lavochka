"""HTTP-сервер студии: интерфейс (ui/), API и поток событий (SSE). Только стандартная библиотека."""
import json
import mimetypes
import pathlib
import queue
import sys
import threading
import time
import traceback
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import VERSION, advisor, catalog, config, download, engines, events, hardware, runner, script, services
from . import steps_comfy, steps_llm, steps_proc  # noqa: F401 — регистрируют исполнители шагов

ROOT = config.ROOT
UI = ROOT / 'ui'
SCRIPT_DIRS = {'scripts': ROOT / 'scripts', 'examples': ROOT / 'examples'}
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('audio/ogg', '.ogg')
mimetypes.add_type('audio/ogg', '.opus')
mimetypes.add_type('audio/flac', '.flac')
mimetypes.add_type('model/gltf-binary', '.glb')
mimetypes.add_type('text/markdown', '.md')


def _paths() -> list[str]:
    c = config.CFG
    return [c['llm_dir'], c['models_dir'], c['out_dir'], c.get('comfy_dir') or '']


def allowed_file(p: pathlib.Path) -> bool:
    """Отдаём только выходы запусков, данные студии и файлы, показанные как результаты/источники."""
    try:
        rp = p.resolve()
    except OSError:
        return False
    roots = [pathlib.Path(config.CFG['out_dir']), config.DATA] + [r.dir for r in runner.RUNS.values()]
    if any(rp.is_relative_to(x.resolve()) for x in roots if x):
        return True
    s = str(rp).replace('\\', '/').lower()
    for r in runner.RUNS.values():
        for st in r.steps.values():
            for o in st.outputs:
                for k in ('path', 'source', 'image'):
                    v = o.get(k)
                    if isinstance(v, str) and str(pathlib.Path(v).resolve()).replace('\\', '/').lower() == s:
                        return True
    return False


def llm_prompt() -> str:
    """Готовый промпт для любой LLM: формат + что есть на этой машине."""
    fmt = (ROOT / 'SCRIPT_FORMAT.md').read_text(encoding='utf-8')
    hw = hardware.snapshot()
    rec = runner.recommendations()
    lines = ['', '## Эта машина (вставлено студией автоматически)', '',
             f'Видеокарты: {", ".join(f"[{g["index"]}] {g["name"]} {g["vram_gb"]:g} ГБ" for g in hw["gpus"]) or "нет"}; '
             f'RAM {hw["ram"]["total_gb"]} ГБ; CPU {hw["cpu"]["name"]}.', '', 'Модели (id → для чего, установлена ли):']
    for m in catalog.with_status():
        mark = 'есть' if m['status']['installed'] else 'скачается'
        best = ' ← подбор по железу' if rec.get(m['kind'], {}).get('model') == m['id'] else ''
        lines.append(f'- `{m["id"]}` — {m["kind_title"]}: {m["title"]} ({mark}){best}')
    prof = config.CFG.get('llm_profile')
    if prof:
        lines.append(f'\nLLM для шагов llm/vlm/code: {prof["title"]} {prof["quant"]}, контекст {prof["ctx"]}, '
                     f'зрение: {"да" if prof.get("vision") else "нет"}.')
    return fmt + '\n'.join(lines) + '\n'


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    # --- ответы ---
    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def json(self, data, code=200):
        self._send(code, json.dumps(data, ensure_ascii=False, default=str).encode(), 'application/json; charset=utf-8')

    def err(self, msg, code=400):
        self.json({'error': str(msg)}, code)

    def body(self) -> dict:
        n = int(self.headers.get('Content-Length') or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n).decode('utf-8'))

    def file(self, p: pathlib.Path):
        if not p.is_file():
            return self.err('нет файла', 404)
        ctype = mimetypes.guess_type(p.name)[0] or 'application/octet-stream'
        if ctype.startswith('text/') or ctype in ('application/json',):
            ctype += '; charset=utf-8'
        size = p.stat().st_size
        rng = self.headers.get('Range')
        if rng and rng.startswith('bytes='):
            a, _, b = rng[6:].partition('-')
            start = int(a or 0)
            end = min(int(b) if b else size - 1, size - 1)
            with open(p, 'rb') as f:
                f.seek(start)
                data = f.read(end - start + 1)
            return self._send(206, data, ctype, {'Content-Range': f'bytes {start}-{end}/{size}', 'Accept-Ranges': 'bytes'})
        self._send(200, p.read_bytes(), ctype, {'Accept-Ranges': 'bytes'})

    # --- маршруты ---
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        path = u.path
        try:
            if path == '/' or path == '/index.html':
                return self.file(UI / 'index.html')
            if path.startswith('/ui/'):
                p = (UI / path[4:]).resolve()
                return self.file(p) if p.is_relative_to(UI.resolve()) else self.err('нет', 404)
            if path == '/api/events':
                return self.sse()
            if path == '/api/state':
                return self.json({'version': VERSION, 'config': config.CFG, 'services': services.all_info(),
                                  'downloads': download.jobs(), 'runs': [r.public() for r in runner.RUNS.values()] + runner.load_history(),
                                  'kinds': catalog.KINDS, 'step_types': {k: v[1] for k, v in script.STEP_TYPES.items()}})
            if path == '/api/hw':
                hw = hardware.snapshot(_paths())
                return self.json({'hw': hw, 'recommend': advisor.recommend(hw),
                                  'llm': advisor.llm_profiles(hw, q.get('purpose', 'code'))})
            if path == '/api/models':
                return self.json(catalog.with_status())
            if path == '/api/engines':
                return self.json(engines.status())
            if path == '/api/services/log':
                return self.json({'log': services.SERVICES[q['name']].tail(int(q.get('n', 300)))})
            if path == '/api/scripts':
                out = []
                for label, d in SCRIPT_DIRS.items():
                    if d.is_dir():
                        for p in sorted(d.glob('*.y*ml')) + sorted(d.glob('*.json')):
                            out.append({'group': label, 'name': p.name, 'path': str(p)})
                return self.json(out)
            if path == '/api/scripts/read':
                p = pathlib.Path(q['path']).resolve()
                if not any(p.is_relative_to(d.resolve()) for d in SCRIPT_DIRS.values()) and not allowed_file(p):
                    return self.err('вне папок скриптов', 403)
                return self.json({'text': p.read_text(encoding='utf-8'), 'path': str(p)})
            if path == '/api/runs':
                return self.json([r.public() for r in runner.RUNS.values()] + runner.load_history())
            if path.startswith('/api/runs/'):
                d = runner.get_public(path.split('/')[3])
                return self.json(d) if d else self.err('нет запуска', 404)
            if path == '/api/file':
                p = pathlib.Path(q['path'])
                return self.file(p) if allowed_file(p) else self.err('файл вне выходов студии', 403)
            if path == '/api/docs/format':
                return self._send(200, (ROOT / 'SCRIPT_FORMAT.md').read_bytes(), 'text/markdown; charset=utf-8')
            if path == '/api/docs/prompt':
                return self._send(200, llm_prompt().encode(), 'text/markdown; charset=utf-8')
            if path == '/api/docs/readme':
                return self._send(200, (ROOT / 'README.md').read_bytes(), 'text/markdown; charset=utf-8')
            self.err('нет такого адреса', 404)
        except BrokenPipeError:
            pass
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            self.err(e, 500)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            b = self.body()
            if path == '/api/config':
                return self.json(config.save(b))
            if path == '/api/models/download':
                return self.json(download.download_model(b['id'], b.get('quant')))
            if path == '/api/models/check':
                m = catalog.get(b['id'])
                if m['kind'] == 'llm':
                    try:
                        files = download.list_repo(m['repo'])
                        qs = sorted({catalog.guess_quant(f['path']) for f in files if f['path'].endswith('.gguf')})
                        return self.json([{'ok': True, 'detail': f'{m["repo"]}: кванты {", ".join(qs)}'}])
                    except RuntimeError as e:
                        return self.json([{'ok': False, 'detail': str(e)}])
                return self.json([download.check_source(f) for f in m.get('files', [])])
            if path == '/api/models/hf':
                return self.json(download.list_repo(b['repo']))
            if path == '/api/models/add':
                return self.json(runner.custom_from_requires(b))
            if path == '/api/downloads/cancel':
                download.cancel(b['id'])
                return self.json({'ok': True})
            if path == '/api/services/start':
                s = services.SERVICES[b['name']]
                prof = b.get('profile') or (steps_proc.pick_llm_profile() if s.kind == 'llm' else None)
                return self.json(s.start(prof))
            if path == '/api/services/stop':
                return self.json(services.SERVICES[b['name']].stop(bool(b.get('force'))))
            if path == '/api/llm/profile':
                config.save({'llm_profile': b.get('profile')})
                return self.json({'ok': True})
            if path == '/api/llm/bench':
                return self.json(bench())
            if path == '/api/engines/llama/install':
                return self.json(engines.install_llama())
            if path == '/api/engines/venv':
                text = engines.venv_setup_script(b['name'], b.get('packages') or [], b.get('cuda', 'cu128'))
                return self.json(runner.start(script.parse(text), text, 'система').public())
            if path == '/api/scripts/plan':
                sc = script.parse(b['text'])
                return self.json(runner.plan(sc))
            if path == '/api/scripts/run':
                sc = script.parse(b['text'])
                return self.json(runner.start(sc, b['text'], b.get('source', '')).public())
            if path == '/api/scripts/fetch':
                sc = script.parse(b['text'])
                pl = runner.plan(sc)
                jobs = []
                for m in pl['missing']:
                    try:
                        jobs.append(download.download_model(m['id'], b.get('quants', {}).get(m['id'])))
                    except Exception as e:  # noqa: BLE001
                        jobs.append({'title': m['title'], 'status': 'error', 'error': str(e)})
                return self.json(jobs)
            if path == '/api/scripts/save':
                d = SCRIPT_DIRS['scripts']
                d.mkdir(exist_ok=True)
                sc = script.parse(b['text'])
                p = d / f'{sc["name"]}.yaml'
                p.write_text(b['text'], encoding='utf-8')
                return self.json({'path': str(p)})
            if path.startswith('/api/runs/'):
                parts = path.split('/')
                rid, act = parts[3], parts[4]
                if act == 'cancel':
                    runner.cancel(rid)
                elif act == 'approve':
                    runner.approve(rid, b['step'], b.get('selected', []))
                elif act == 'rerun':
                    d = runner.get_public(rid)
                    return self.json(runner.start(script.parse(d['text']), d['text'], d.get('source', '')).public())
                return self.json({'ok': True})
            self.err('нет такого адреса', 404)
        except script.ScriptError as e:
            self.err(e, 422)
        except (KeyError, ValueError) as e:
            self.err(f'{type(e).__name__}: {e}', 400)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            self.err(e, 500)

    def sse(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()
        q = events.subscribe()
        try:
            self.wfile.write(b': hello\n\n')
            self.wfile.flush()
            while True:
                try:
                    msg = q.get(timeout=15)
                    self.wfile.write(f'data: {msg}\n\n'.encode())
                except queue.Empty:
                    self.wfile.write(b': ping\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass
        finally:
            events.unsubscribe(q)


def bench() -> dict:
    """Замер скорости запущенной LLM: 256 токенов, скорость генерации и разбора промпта от самого llama-server."""
    s = services.SERVICES['llm']
    if not s.alive():
        raise RuntimeError('LLM не запущена — сначала «Запустить»')
    import urllib.request
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    body = json.dumps({'prompt': 'Напиши короткий рассказ о дворе 90-х, где дети играют в настольные игры.\n',
                       'n_predict': 256, 'cache_prompt': False}).encode()
    t0 = time.time()
    with op.open(urllib.request.Request(f'http://127.0.0.1:{s.port}/completion', body, {'Content-Type': 'application/json'}), timeout=600) as r:
        d = json.loads(r.read())
    t = d.get('timings', {})
    res = {'gen_tps': round(t.get('predicted_per_second', 0), 1), 'prompt_tps': round(t.get('prompt_per_second', 0), 1),
           'tokens': t.get('predicted_n'), 'secs': round(time.time() - t0, 1), 'profile': s.profile}
    bp = config.DATA / 'bench.json'
    hist = json.loads(bp.read_text(encoding='utf-8')) if bp.exists() else []
    hist.append({**res, 'at': time.strftime('%Y-%m-%d %H:%M')})
    bp.write_text(json.dumps(hist[-50:], ensure_ascii=False, indent=1), encoding='utf-8')
    events.publish('bench', res)
    return res


def main():
    config.load()
    port = int(config.CFG.get('port', 7870))
    for i, a in enumerate(sys.argv):
        if a == '--port':
            port = int(sys.argv[i + 1])
    services.monitor()
    srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    srv.daemon_threads = True
    url = f'http://127.0.0.1:{port}/'
    print(f'LLM Game Studio {VERSION}: {url}', flush=True)
    if '--no-browser' not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
