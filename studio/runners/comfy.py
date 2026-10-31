"""Клиент ComfyUI API: отправить граф, дождаться, скачать картинки."""
import json
import time
import urllib.parse
import urllib.request
import uuid

# локальный прокси пользователя (HTTPS_PROXY) не должен ловить 127.0.0.1
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Comfy:
    def __init__(self, port: int):
        self.base = f'http://127.0.0.1:{port}'
        self.client_id = uuid.uuid4().hex

    def _get(self, path: str):
        with _opener.open(self.base + path, timeout=30) as r:
            return r.read()

    def alive(self) -> bool:
        try:
            self._get('/system_stats')
            return True
        except OSError:
            return False

    def object_info(self, node: str) -> dict:
        return json.loads(self._get('/object_info/' + urllib.parse.quote(node)))[node]

    def submit(self, graph: dict) -> str:
        body = json.dumps({'prompt': graph, 'client_id': self.client_id}).encode()
        req = urllib.request.Request(self.base + '/prompt', body, {'Content-Type': 'application/json'})
        try:
            with _opener.open(req, timeout=30) as r:
                return json.loads(r.read())['prompt_id']
        except urllib.error.HTTPError as e:
            raise RuntimeError(f'ComfyUI отклонил граф: {e.read().decode(errors="replace")}') from None

    def wait(self, prompt_id: str, timeout: float = 900) -> dict:
        t0 = time.time()
        while time.time() - t0 < timeout:
            h = json.loads(self._get('/history/' + prompt_id))
            if prompt_id in h:
                entry = h[prompt_id]
                status = entry.get('status', {})
                if status.get('status_str') == 'error':
                    raise RuntimeError(f'ошибка в графе: {json.dumps(status.get("messages"), ensure_ascii=False)[:2000]}')
                if status.get('completed', True):
                    return entry
            time.sleep(1)
        raise TimeoutError(prompt_id)

    def images(self, entry: dict):
        """Байты всех картинок из выходов SaveImage."""
        for out in entry.get('outputs', {}).values():
            for im in out.get('images', []):
                q = urllib.parse.urlencode({'filename': im['filename'], 'subfolder': im['subfolder'], 'type': im['type']})
                yield im['filename'], self._get('/view?' + q)
