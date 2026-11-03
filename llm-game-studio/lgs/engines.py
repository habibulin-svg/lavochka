"""Движки: llama.cpp (ставится сам с GitHub под нужную CUDA), ComfyUI (находится), ffmpeg, питон-окружения раннеров."""
import json
import pathlib
import shutil
import subprocess
import sys
import urllib.request
import zipfile

from . import catalog, config, download, events, hardware

_NOWINDOW = 0x08000000 if sys.platform == 'win32' else 0


def _version(cmd: list[str]) -> str | None:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=15, creationflags=_NOWINDOW)
        out = (r.stdout + r.stderr).strip().splitlines()
        return next((x for x in out if 'version' in x.lower()), out[0] if out else None)
    except (OSError, subprocess.TimeoutExpired):
        return None


def status() -> dict:
    c = config.CFG
    ld = pathlib.Path(c['llama_dir'])
    exe = ld / ('llama-server.exe' if sys.platform == 'win32' else 'llama-server')
    comfy = pathlib.Path(c['comfy_dir']) if c.get('comfy_dir') else None
    ff = c.get('ffmpeg') or shutil.which('ffmpeg')
    venvs = []
    need = {}
    for m in catalog.load():
        if m.get('engine') == 'python' and m.get('python'):
            need.setdefault(m['python'].removeprefix('venv:'), []).append(m['title'])
    for name in sorted(set(c.get('venvs', {})) | set(need)):
        venvs.append({'name': name, 'path': c.get('venvs', {}).get(name), 'python': config.venv_python(name),
                      'used_by': need.get(name, [])})
    return {
        'llama': {'path': str(exe), 'installed': exe.exists(), 'version': _version([str(exe), '--version']) if exe.exists() else None},
        'comfy': {'path': str(comfy) if comfy else None, 'installed': bool(comfy and (comfy / 'main.py').exists()),
                  'python': c.get('comfy_python')},
        'ffmpeg': {'path': ff, 'installed': bool(ff and pathlib.Path(ff).exists() if ff else False)},
        'venvs': venvs,
    }


def llama_release_assets() -> tuple[str, list[dict]]:
    """Свежий выпуск со сборками: «latest» у llama.cpp бывает без файлов — сборки лежат в выпусках b#####."""
    url = 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=8'
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'llm-game-studio'}), timeout=20) as r:
        rels = json.loads(r.read())
    for rel in rels:
        if any('-bin-' in a['name'] for a in rel['assets']):
            return rel['tag_name'], [{'name': a['name'], 'url': a['browser_download_url'], 'size': a['size']} for a in rel['assets']]
    raise RuntimeError('в последних выпусках llama.cpp нет сборок')


def pick_llama_assets(assets: list[dict], cuda13: bool, has_gpu: bool) -> list[dict]:
    """Сборка под систему: Windows CUDA 13 (RTX 50xx) или 12, иначе Vulkan/CPU; плюс библиотеки CUDA."""
    if sys.platform == 'win32':
        if has_gpu:
            ver = 'cuda-13' if cuda13 else 'cuda-12'
            main = [a for a in assets if f'bin-win-{ver}' in a['name'] and a['name'].endswith('x64.zip') and not a['name'].startswith('cudart-')]
            rt = [a for a in assets if a['name'].startswith('cudart-') and f'win-{ver}' in a['name'] and a['name'].endswith('x64.zip')]
            if main:
                return main[:1] + rt[:1]
        return [a for a in assets if 'bin-win-cpu-x64' in a['name']][:1]
    if sys.platform == 'darwin':
        return [a for a in assets if 'bin-macos-arm64' in a['name']][:1]
    pref = ['bin-ubuntu-cuda-13', 'bin-ubuntu-cuda-12'] if has_gpu else []
    for key in pref + ['bin-ubuntu-vulkan-x64', 'bin-ubuntu-x64']:
        found = [a for a in assets if key in a['name'] and a['name'].endswith('x64.tar.gz') and not a['name'].startswith('cudart-')]
        if found:
            rt = [a for a in assets if a['name'].startswith('cudart-') and key.removeprefix('bin-') in a['name']] if 'cuda' in key else []
            return found[:1] + rt[:1]
    return []


def install_llama() -> dict:
    hw = hardware.snapshot()
    tag, assets = llama_release_assets()
    pick = pick_llama_assets(assets, hw['cuda13'], bool(hw['gpus']))
    if not pick:
        raise RuntimeError(f'в выпуске {tag} нет сборки под эту систему')
    dest = pathlib.Path(config.CFG['llama_dir'])
    tmp = config.DATA / 'engines' / '_zip'
    files = [{'urls': [a['url']], 'dest': str(tmp / a['name']), 'size': a['size']} for a in pick]
    job = download.enqueue(f'llama.cpp {tag}', files)

    def after(j):
        dest.mkdir(parents=True, exist_ok=True)
        for f in files:
            if f['dest'].endswith('.zip'):
                with zipfile.ZipFile(f['dest']) as z:
                    members = [(m, z.read) for m in z.namelist() if not m.endswith('/')]
                    for m, read in members:     # архивы бывают с папкой внутри — кладём файлы плоско
                        (dest / pathlib.PurePosixPath(m).name).write_bytes(read(m))
            else:
                import tarfile
                with tarfile.open(f['dest']) as t:
                    for m in t.getmembers():
                        if m.isfile():
                            (dest / pathlib.PurePosixPath(m.name).name).write_bytes(t.extractfile(m).read())
                for exe in dest.glob('llama-*'):
                    exe.chmod(0o755)
        events.publish('engines', status())
    download.on_done(job['id'], after)
    return job


def venv_setup_script(name: str, packages: list[str], cuda: str = 'cu128') -> str:
    """LGS-скрипт, который создаёт окружение и ставит torch + пакеты — запускается как обычный запуск (видно прогресс)."""
    root = pathlib.Path(config.CFG.get('ai_root') or config.DATA) / 'venvs' / name
    py = sys.executable.replace('\\', '/')
    pip = (root / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')).as_posix()
    pk = ' '.join(packages)
    return f"""lgs: 1
name: setup-venv-{name}
title: "Окружение {name}"
project: _system
steps:
  - id: venv
    title: Создать окружение
    uses: shell
    run: '"{py}" -m venv "{root.as_posix()}"'
  - id: torch
    title: PyTorch ({cuda})
    uses: shell
    after: venv
    run: '"{pip}" -m pip install --upgrade pip && "{pip}" -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/{cuda}'
  - id: packages
    title: Пакеты
    uses: shell
    after: torch
    run: '"{pip}" -m pip install {pk}'
"""
