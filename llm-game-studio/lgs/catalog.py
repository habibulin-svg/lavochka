"""Каталог моделей: встроенный catalog.json + свои (data/custom_models.json); что уже стоит на диске."""
import fnmatch
import json
import pathlib

from . import config, gguf

HERE = pathlib.Path(__file__).parent
CUSTOM = config.DATA / 'custom_models.json'
KINDS = {
    'llm': 'Языковая модель', 'image': 'Картинки', 'video': 'Видео', 'music': 'Музыка', 'sfx': 'Звуки',
    'tts': 'Озвучка', 'asr': 'Распознавание речи', 'cutout': 'Вырезка фона', 'upscale': 'Апскейл', 'to3d': 'Картинка → 3D',
}
# примерные биты на вес у квантов GGUF — для оценки размера, пока файл не скачан
BPW = {'Q2_K': 2.9, 'Q3_K_S': 3.5, 'Q3_K_M': 3.9, 'Q3_K_XL': 4.0, 'IQ3_XXS': 3.1, 'IQ4_XS': 4.3, 'IQ4_NL': 4.5,
       'Q4_0': 4.5, 'Q4_K_S': 4.6, 'Q4_K_M': 4.85, 'Q4_K_XL': 5.0, 'Q5_K_S': 5.5, 'Q5_K_M': 5.7, 'Q5_K_XL': 5.9,
       'Q6_K': 6.6, 'Q6_K_XL': 6.9, 'Q8_0': 8.5, 'Q8_K_XL': 9.0, 'BF16': 16, 'F16': 16}


def quant_bpw(q: str) -> float:
    q = q.upper().removeprefix('UD-')
    return BPW.get(q, 4.85)


def load() -> list[dict]:
    models = json.loads((HERE / 'catalog.json').read_text(encoding='utf-8'))['models']
    if CUSTOM.exists():
        try:
            mine = json.loads(CUSTOM.read_text(encoding='utf-8'))
            ids = {m['id'] for m in mine}
            models = [m for m in models if m['id'] not in ids] + [{**m, 'custom': True} for m in mine]
        except ValueError:
            pass
    return models


def get(model_id: str) -> dict | None:
    return next((m for m in load() if m['id'] == model_id), None)


def add_custom(entry: dict):
    mine = json.loads(CUSTOM.read_text(encoding='utf-8')) if CUSTOM.exists() else []
    mine = [m for m in mine if m['id'] != entry['id']] + [entry]
    config.DATA.mkdir(parents=True, exist_ok=True)
    CUSTOM.write_text(json.dumps(mine, ensure_ascii=False, indent=1), encoding='utf-8')


def dest_dir(dest: str) -> pathlib.Path:
    c = config.CFG
    if dest.startswith('comfy:'):
        return pathlib.Path(c['comfy_dir'] or config.DATA / 'comfy') / 'models' / dest[6:]
    if dest == 'llm':
        return pathlib.Path(c['llm_dir'])
    if dest.startswith('models:'):
        return pathlib.Path(c['models_dir']) / dest[7:]
    return pathlib.Path(dest)


def _find_file(folder: pathlib.Path, names: list[str]) -> pathlib.Path | None:
    for n in names:
        p = folder / n
        if p.exists():
            return p
    return None


def file_status(f: dict) -> dict:
    """Один файл из files: есть ли на диске и где."""
    folder = dest_dir(f['dest'])
    if f.get('snapshot'):
        ok = (folder / f.get('check', 'config.json')).exists()
        return {'installed': ok, 'path': str(folder)}
    names = f.get('names') or [pathlib.PurePosixPath(f.get('path') or f.get('url', '')).name]
    p = _find_file(folder, names)
    return {'installed': bool(p), 'path': str(p or folder / names[0]), 'name': p.name if p else names[0]}


def llm_local(m: dict) -> list[dict]:
    """Найденные GGUF модели: свои имена из local + всё, что подходит по шаблону имени, в папке LLM (с подпапками)."""
    root = pathlib.Path(config.CFG['llm_dir'])
    if not root.is_dir():
        return []
    base = m['repo'].split('/')[-1].removesuffix('-GGUF') if m.get('repo') else m['id']
    pats = [n.lower() for n in m.get('local', [])] + [f'{base.lower()}*.gguf', f'*{base.lower().split("_")[-1]}*.gguf']
    found = []
    for p in root.rglob('*.gguf'):
        n = p.name.lower()
        if 'mmproj' in n or not any(fnmatch.fnmatch(n, pat) for pat in pats):
            continue
        if any(x['path'] == str(p) for x in found):
            continue
        found.append({'path': str(p), 'name': p.name, 'size_gb': round(p.stat().st_size / 2**30, 2), 'quant': guess_quant(p.name)})
    return found


def llm_mmproj(m: dict, model_path: str) -> str | None:
    folder = pathlib.Path(model_path).parent
    for n in m.get('local_mmproj', []) + ([m['mmproj']] if m.get('mmproj') else []):
        if (folder / n).exists():
            return str(folder / n)
    cands = sorted(folder.glob('*mmproj*.gguf'))
    base = (m.get('repo') or '').split('/')[-1].removesuffix('-GGUF').lower()
    cands = [c for c in cands if base and base.split('-')[0] in c.name.lower()] or (cands if len(cands) == 1 else [])
    return str(cands[0]) if cands else None


def guess_quant(name: str) -> str:
    n = name.upper()
    for q in sorted(BPW, key=len, reverse=True):
        if q in n:
            return ('UD-' if 'UD-' + q in n else '') + q
    return '?'


_meta_cache: dict = {}


def gguf_info(path: str) -> dict | None:
    if path not in _meta_cache:
        try:
            _meta_cache[path] = gguf.summary(path)
        except (OSError, ValueError, KeyError):
            _meta_cache[path] = None
    return _meta_cache[path]


def status(m: dict) -> dict:
    if m['kind'] == 'llm':
        local = llm_local(m)
        return {'installed': bool(local), 'files': local}
    files = [file_status(f) for f in m.get('files', [])]
    missing_gb = sum(f.get('size_gb', 0) for f, s in zip(m.get('files', []), files) if not s['installed'])
    return {'installed': all(s['installed'] for s in files) and bool(files), 'files': files, 'missing_gb': round(missing_gb, 1)}


def with_status() -> list[dict]:
    return [{**m, 'status': status(m), 'kind_title': KINDS.get(m['kind'], m['kind'])} for m in load()]


def resolved_names(m: dict) -> dict:
    """role → имя установленного файла (для подстановки в граф ComfyUI)."""
    out = {}
    for f in m.get('files', []):
        if f.get('role'):
            out[f['role']] = file_status(f).get('name')
    return out
