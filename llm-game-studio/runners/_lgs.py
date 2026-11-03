"""Общее для раннеров: задание из JSON и протокол вывода студии (@progress / @output)."""
import json
import pathlib
import subprocess
import sys


def job() -> dict:
    return json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))


def progress(done: int, total: int, msg: str = ''):
    print(f'@progress {done}/{total} {msg}'.rstrip(), flush=True)


def output(path, key: str | None = None, **meta):
    m = {'key': key, **meta} if key else meta
    print(f'@output {path} {json.dumps(m, ensure_ascii=False)}' if m else f'@output {path}', flush=True)


def device(j: dict) -> str:
    """CUDA_VISIBLE_DEVICES ставит студия — внутри процесса нужная карта всегда cuda:0."""
    return 'cuda:0' if j.get('device') == 'cuda' else 'cpu'


def find_dir(j: dict, *names) -> pathlib.Path:
    for d in j['model_dirs']:
        p = pathlib.Path(d)
        if not names or any(n.lower() in p.name.lower() for n in names):
            return p
    return pathlib.Path(j['model_dirs'][0])


def to_opus(src, dst, ffmpeg='ffmpeg', af=None):
    cmd = [ffmpeg, '-v', 'error', '-y', '-i', str(src)]
    if af:
        cmd += ['-af', af]
    cmd += ['-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', str(dst)]
    subprocess.run(cmd, check=True)
