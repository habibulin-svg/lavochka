"""Клиент ComfyUI API: отправить граф, дождаться, загрузить картинку, скачать все выходы."""
import json
import mimetypes
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Comfy:
    def __init__(self, port: int):
        self.base = f'http://127.0.0.1:{port}'
        self.client_id = uuid.uuid4().hex

    def _get(self, path: str, timeout=30):
        with _opener.open(self.base + path, timeout=timeout) as r:
            return r.read()

    def _post(self, path: str, body: bytes, ctype: str):
        req = urllib.request.Request(self.base + path, body, {'Content-Type': ctype})
        with _opener.open(req, timeout=60) as r:
            return r.read()

    def alive(self) -> bool:
        try:
            self._get('/system_stats', 3)
            return True
        except OSError:
            return False

    def submit(self, graph: dict) -> str:
        body = json.dumps({'prompt': graph, 'client_id': self.client_id}).encode()
        try:
            return json.loads(self._post('/prompt', body, 'application/json'))['prompt_id']
        except urllib.error.HTTPError as e:
            raise RuntimeError(f'ComfyUI отклонил граф: {e.read().decode(errors="replace")[:3000]}') from None

    def interrupt(self):
        try:
            self._post('/interrupt', b'{}', 'application/json')
        except OSError:
            pass

    def wait(self, prompt_id: str, timeout: float = 3600, cancelled=lambda: False, tick=None) -> dict:
        t0 = time.time()
        while time.time() - t0 < timeout:
            if cancelled():
                self.interrupt()
                raise InterruptedError('отменено')
            h = json.loads(self._get('/history/' + prompt_id))
            if prompt_id in h:
                entry = h[prompt_id]
                status = entry.get('status', {})
                if status.get('status_str') == 'error':
                    msgs = [m for m in status.get('messages', []) if m and m[0] == 'execution_error']
                    detail = msgs[0][1].get('exception_message', '') if msgs else json.dumps(status.get('messages'), ensure_ascii=False)[:1500]
                    raise RuntimeError(f'ошибка в графе: {detail}')
                if status.get('completed', True):
                    return entry
            if tick:
                tick(time.time() - t0)
            time.sleep(1)
        raise TimeoutError(f'ComfyUI не ответил за {timeout:.0f} с')

    def outputs(self, entry: dict):
        """(имя, байты, вид) всех файлов-выходов: картинки, видео, звук."""
        for node in entry.get('outputs', {}).values():
            for key, items in node.items():
                if not isinstance(items, list):
                    continue
                for it in items:
                    if isinstance(it, dict) and 'filename' in it:
                        q = urllib.parse.urlencode({'filename': it['filename'], 'subfolder': it.get('subfolder', ''), 'type': it.get('type', 'output')})
                        yield it['filename'], self._get('/view?' + q, 300), key

    def text(self, entry: dict) -> str:
        for node in entry.get('outputs', {}).values():
            for key in ('text', 'string', 'STRING'):
                if key in node:
                    v = node[key]
                    return v[0] if isinstance(v, list) else v
        raise RuntimeError('в выходах графа нет текста')

    def upload(self, path: str) -> str:
        """Загрузить картинку во входы ComfyUI, вернуть имя для LoadImage."""
        p = pathlib.Path(path)
        boundary = uuid.uuid4().hex
        ctype = mimetypes.guess_type(p.name)[0] or 'application/octet-stream'
        name = f'lgs_{uuid.uuid4().hex[:6]}_{p.name}'
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
                f'Content-Type: {ctype}\r\n\r\n').encode() + p.read_bytes() + \
               f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--{boundary}--\r\n'.encode()
        r = json.loads(self._post('/upload/image', body, f'multipart/form-data; boundary={boundary}'))
        return (r.get('subfolder') + '/' if r.get('subfolder') else '') + r['name']


def fill(node, values: dict):
    """{{ключ}} строкой целиком → значение как есть (число остаётся числом)."""
    if isinstance(node, dict):
        return {k: fill(v, values) for k, v in node.items() if k != '_about'}
    if isinstance(node, list):
        return [fill(v, values) for v in node]
    if isinstance(node, str) and node.startswith('{{') and node.endswith('}}'):
        key = node[2:-2]
        if key not in values:
            raise KeyError(f'в графе есть {{{{{key}}}}}, а значения нет — добавьте {key} в with/items')
        return values[key]
    return node
