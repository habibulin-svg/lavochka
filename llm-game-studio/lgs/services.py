"""Серверы моделей: llama-server (LLM/VLM) и ComfyUI на каждой карте. Запуск, остановка, логи, проверка «жив ли».

Сервис, запущенный не студией (порт уже занят), помечается «внешний»: им можно пользоваться,
а остановить — только явно (force), чтобы не уронить чужую работу.
"""
import os
import pathlib
import re
import subprocess
import sys
import threading
import time
import urllib.request

from . import advisor, config, events, hardware

LOGS = config.DATA / 'logs'
_NOWINDOW = 0x08000000 if sys.platform == 'win32' else 0
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # локальное — мимо прокси


def http_alive(url: str, timeout: float = 2) -> bool:
    try:
        with _opener.open(url, timeout=timeout) as r:
            return r.status < 500
    except OSError:
        return False


class Service:
    def __init__(self, name: str, title: str, kind: str):
        self.name, self.title, self.kind = name, title, kind
        self.proc: subprocess.Popen | None = None
        self.state = 'stopped'
        self.error = None
        self.cmd: list[str] = []
        self.profile: dict | None = None
        self.started = None
        self.log = LOGS / f'{name}.log'

    @property
    def port(self) -> int:
        return int(config.CFG['ports'].get(self.name, 0) or 0)

    @property
    def gpus(self) -> list[int]:
        if self.kind == 'comfy':
            role = 'big' if self.name.endswith('big') else 'small'
            return [config.CFG['gpu_roles'].get(role, 0)]
        return (self.profile or {}).get('gpus', [])

    def health_url(self) -> str:
        return f'http://127.0.0.1:{self.port}' + ('/system_stats' if self.kind == 'comfy' else '/health')

    def alive(self) -> bool:
        return bool(self.port) and http_alive(self.health_url())

    def info(self) -> dict:
        return {'name': self.name, 'title': self.title, 'kind': self.kind, 'port': self.port, 'state': self.state,
                'ours': self.proc is not None and self.proc.poll() is None, 'pid': self.proc.pid if self.proc else None,
                'gpus': self.gpus, 'error': self.error, 'cmd': ' '.join(self.cmd), 'started': self.started,
                'profile': self.profile, 'available': self.available()}

    def available(self) -> str | None:
        """None — можно запускать; иначе — чего не хватает."""
        if self.kind == 'comfy':
            d = config.CFG.get('comfy_dir')
            if not d or not (pathlib.Path(d) / 'main.py').exists():
                return 'ComfyUI не найден — укажите папку в настройках'
            if not config.CFG.get('comfy_python'):
                return 'не указан питон ComfyUI'
            return None
        exe = pathlib.Path(config.CFG['llama_dir'])
        if not ((exe / 'llama-server.exe').exists() or (exe / 'llama-server').exists()):
            return 'llama.cpp не установлен — вкладка «Движки»'
        return None

    def _command(self, profile: dict | None):
        if self.kind == 'comfy':
            role = 'big' if self.name.endswith('big') else 'small'
            gpu = config.CFG['gpu_roles'].get(role, 0)
            out = config.DATA / 'comfy-out' / self.name
            cmd = [config.CFG['comfy_python'], 'main.py', '--cuda-device', str(gpu), '--port', str(self.port),
                   '--output-directory', str(out)]
            if role == 'small':
                cmd.append('--lowvram')
            return cmd, {'CUDA_DEVICE_ORDER': 'PCI_BUS_ID'}, config.CFG['comfy_dir']
        if not profile or not profile.get('path'):
            raise RuntimeError('нет профиля LLM с установленной моделью — выберите на вкладке «Железо»')
        cmd, env = advisor.llama_command(profile)
        return cmd, env, None

    def start(self, profile: dict | None = None, wait: float = 0) -> dict:
        if self.alive():
            self.state = 'running' if self.proc and self.proc.poll() is None else 'external'
            return self.info()
        why = self.available()
        if why:
            raise RuntimeError(why)
        self.profile = profile or self.profile or (config.CFG.get('llm_profile') if self.kind == 'llm' else None)
        cmd, env, cwd = self._command(self.profile)
        LOGS.mkdir(parents=True, exist_ok=True)
        logf = open(self.log, 'w', encoding='utf-8', errors='replace')
        logf.write(' '.join(cmd) + '\n\n')
        logf.flush()
        e = {**os.environ, **env, 'PYTHONIOENCODING': 'utf-8'}
        if config.CFG.get('ai_root'):
            e.setdefault('HF_HOME', str(pathlib.Path(config.CFG['ai_root']) / 'hf'))
        if config.CFG.get('ffmpeg'):
            e['PATH'] = str(pathlib.Path(config.CFG['ffmpeg']).parent) + os.pathsep + e.get('PATH', '')
        self.cmd = cmd
        self.proc = subprocess.Popen(cmd, cwd=cwd, env=e, stdout=logf, stderr=subprocess.STDOUT, creationflags=_NOWINDOW)
        self.state, self.error, self.started = 'starting', None, time.time()
        events.publish('service', self.info())
        if wait:
            self.wait_ready(wait)
        return self.info()

    def wait_ready(self, timeout: float) -> bool:
        t0 = time.time()
        while time.time() - t0 < timeout:
            if self.alive():
                self.state = 'running'
                events.publish('service', self.info())
                return True
            if self.proc and self.proc.poll() is not None:
                self.state, self.error = 'error', f'процесс завершился (код {self.proc.returncode}) — см. лог'
                events.publish('service', self.info())
                raise RuntimeError(f'{self.title}: {self.error}\n' + self.tail(15))
            time.sleep(1)
        raise TimeoutError(f'{self.title} не поднялся за {timeout:.0f} с')

    def stop(self, force: bool = False) -> dict:
        if self.proc and self.proc.poll() is None:
            kill_tree(self.proc.pid)
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                pass
        elif force and self.alive():
            for pid in pids_on_port(self.port):
                kill_tree(pid)
        self.proc = None
        self.state = 'stopped'
        events.publish('service', self.info())
        return self.info()

    def tail(self, n: int = 200) -> str:
        try:
            lines = self.log.read_text(encoding='utf-8', errors='replace').splitlines()
            return '\n'.join(lines[-n:])
        except OSError:
            return ''

    def refresh(self) -> bool:
        """Обновить состояние; True — изменилось."""
        before = self.state
        ours = self.proc is not None and self.proc.poll() is None
        up = self.alive()
        if up:
            self.state = 'running' if ours else 'external'
        elif ours:
            self.state = 'starting'
        elif self.proc is not None and self.proc.poll() is not None and self.state in ('starting', 'running'):
            self.state, self.error = 'error', f'процесс завершился (код {self.proc.returncode})'
        elif self.state != 'error':
            self.state = 'stopped'
        return before != self.state


def kill_tree(pid: int):
    if sys.platform == 'win32':
        subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True, creationflags=_NOWINDOW)
    else:
        try:
            os.killpg(os.getpgid(pid), 15)
        except OSError:
            pass


def pids_on_port(port: int) -> list[int]:
    try:
        out = subprocess.run(['netstat', '-ano'], capture_output=True, text=True, creationflags=_NOWINDOW).stdout
    except OSError:
        return []
    return sorted({int(m.group(1)) for m in re.finditer(rf'[:.]{port}\s+\S+\s+LISTEN\w*\s+(\d+)', out)})


SERVICES = {
    'llm': Service('llm', 'LLM (llama-server)', 'llm'),
    'comfy-big': Service('comfy-big', 'ComfyUI — большая карта', 'comfy'),
    'comfy-small': Service('comfy-small', 'ComfyUI — малая карта', 'comfy'),
}


def all_info() -> list[dict]:
    return [s.info() for s in SERVICES.values()]


def monitor():
    """Фоновый опрос: состояние сервисов + живое железо для интерфейса."""
    def loop():
        while True:
            for s in SERVICES.values():
                try:
                    if s.refresh():
                        events.publish('service', s.info())
                except Exception:  # noqa: BLE001
                    pass
            try:
                events.publish('hw', hardware.live())
            except Exception:  # noqa: BLE001
                pass
            time.sleep(2)
    threading.Thread(target=loop, daemon=True).start()


def comfy_for_gpu(gpu) -> Service:
    """ComfyUI на нужной карте: big — по роли, иначе small."""
    if gpu in (None, 'auto'):
        return SERVICES['comfy-big']
    return SERVICES['comfy-big'] if int(gpu) == config.CFG['gpu_roles'].get('big', 0) else SERVICES['comfy-small']


def free_gpu_for(gpu: int, need_gb: float, keep: set[str]) -> list[str]:
    """Освободить видеопамять на карте: остановить свои сервисы на ней, кроме keep. Возвращает остановленные."""
    stopped = []
    g = next((x for x in hardware.gpus() if x['index'] == gpu), None)
    if not g or g['free_gb'] >= need_gb or not config.CFG.get('auto_switch', True):
        return stopped
    for s in SERVICES.values():
        if s.name in keep or gpu not in s.gpus:
            continue
        if s.proc and s.proc.poll() is None:
            s.stop()
            stopped.append(s.name)
    return stopped
