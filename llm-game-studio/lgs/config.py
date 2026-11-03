"""Настройки студии: data/config.json поверх найденного на машине (G:/ai/ai.json, если есть) и умолчаний."""
import copy
import json
import os
import pathlib
import threading

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
CONFIG_PATH = DATA / 'config.json'

DEFAULTS = {
    'port': 7870,
    'ai_root': '',          # корень ИИ-стека (модели, движки)
    'comfy_dir': '',        # ComfyUI (main.py рядом)
    'comfy_python': '',     # питон ComfyUI (обычно venv внутри)
    'llama_dir': '',        # llama.cpp (llama-server)
    'llm_dir': '',          # куда класть GGUF
    'models_dir': '',       # прочие модели (TTS, ASR, вырезка, 3D)
    'out_dir': '',          # выход запусков
    'ffmpeg': '',
    'venvs': {},            # имя → папка venv для питоновых раннеров
    'ports': {'llm': 8080, 'comfy-big': 8188, 'comfy-small': 8189},
    'gpu_roles': {'big': 0, 'small': 1},   # большая карта — картинки/видео/музыка, малая — звук/вырезка
    'hf_endpoint': 'https://huggingface.co',
    'hf_mirrors': ['https://hf-mirror.com'],
    'modelscope': True,     # запасной источник для репозиториев Hugging Face
    'hf_token': '',
    'ipv4_only': False,     # качать только по IPv4 (у части провайдеров IPv6 рвётся)
    'parallel_downloads': 2,
    'llm_profile': None,    # выбранный профиль llama-server (см. advisor.llm_profiles)
    'auto_switch': True,    # останавливать свои сервисы, если шагу не хватает видеопамяти
}

_lock = threading.Lock()
CFG: dict = {}


def detect() -> dict:
    """То, что можно понять о машине без пользователя."""
    d: dict = {}
    ai_json = pathlib.Path('G:/ai/ai.json')
    if ai_json.exists():
        try:
            ai = json.loads(ai_json.read_text(encoding='utf-8'))
            p = ai.get('paths', {})
            root = ai.get('root', 'G:/ai')
            d.update({
                'ai_root': root,
                'comfy_dir': p.get('comfy', ''),
                'llm_dir': p.get('llm', ''),
                'models_dir': p.get('models', ''),
                'ffmpeg': p.get('ffmpeg', ''),
                'llama_dir': str(pathlib.Path(root) / 'llama.cpp'),
            })
            venvs = pathlib.Path(root) / 'venvs'
            if venvs.is_dir():
                d['venvs'] = {v.name: str(v) for v in venvs.iterdir() if (v / 'Scripts' / 'python.exe').exists() or (v / 'bin' / 'python').exists()}
            s = ai.get('servers', {})
            d['ports'] = {'llm': s.get('code', 8080), 'comfy-big': s.get('comfy-big', 8188), 'comfy-small': s.get('comfy-small', 8189)}
            if ai.get('big') and ai.get('small'):
                d['gpu_roles'] = {'big': ai['big']['index'], 'small': ai['small']['index']}
        except (OSError, ValueError):
            pass
    own = DATA / 'venvs'
    if own.is_dir():
        d.setdefault('venvs', {})
        d['venvs'].update({v.name: str(v) for v in own.iterdir() if (v / 'Scripts' / 'python.exe').exists() or (v / 'bin' / 'python').exists()})
    if pathlib.Path('G:/temp').is_dir():
        d['out_dir'] = 'G:/temp/lgs/out'
    if d.get('comfy_dir'):
        py = pathlib.Path(d['comfy_dir']) / 'venv' / 'Scripts' / 'python.exe'
        if py.exists():
            d['comfy_python'] = str(py)
    return d


def _fill_empty(cfg: dict):
    """Пустые пути — в data/ рядом со студией."""
    base = pathlib.Path(cfg['ai_root']) if cfg['ai_root'] else DATA
    cfg['llm_dir'] = cfg['llm_dir'] or str(base / 'llm')
    cfg['models_dir'] = cfg['models_dir'] or str(base / 'models')
    cfg['llama_dir'] = cfg['llama_dir'] or str(DATA / 'engines' / 'llama.cpp')
    cfg['out_dir'] = cfg['out_dir'] or str(DATA / 'out')
    if not cfg['hf_token']:
        cfg['hf_token'] = os.environ.get('HF_TOKEN', '')


def load() -> dict:
    cfg = copy.deepcopy(DEFAULTS)
    cfg.update(detect())
    if CONFIG_PATH.exists():
        try:
            saved = json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
            for k, v in saved.items():
                if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                    cfg[k] = {**cfg[k], **v}
                else:
                    cfg[k] = v
        except ValueError:
            pass
    _fill_empty(cfg)
    with _lock:
        CFG.clear()
        CFG.update(cfg)
    return CFG


def save(patch: dict) -> dict:
    """Сохранить изменения пользователя (только отличия от найденного — чтобы переезд путей подхватывался)."""
    with _lock:
        saved = json.loads(CONFIG_PATH.read_text(encoding='utf-8')) if CONFIG_PATH.exists() else {}
        saved.update(patch)
        DATA.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(json.dumps(saved, ensure_ascii=False, indent=1), encoding='utf-8')
    return load()


def venv_python(name: str) -> str | None:
    """«venv:3d» или имя → питон этого окружения; путь к python.exe — как есть."""
    name = name.removeprefix('venv:')
    if name in ('comfy', 'comfyui'):
        return CFG.get('comfy_python') or None
    root = CFG.get('venvs', {}).get(name)
    if not root:
        p = pathlib.Path(name)
        return str(p) if p.suffix in ('.exe', '') and p.exists() and p.is_file() else None
    for sub in ('Scripts/python.exe', 'bin/python'):
        if (pathlib.Path(root) / sub).exists():
            return str(pathlib.Path(root) / sub)
    return None
