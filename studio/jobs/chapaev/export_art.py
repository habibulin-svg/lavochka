"""Чапаев: отобранные картинки 01-art → lavochka/public/chapaev/art/*.webp (раскладывает их lavochka/src/games/chapaev/view.ts).

G:/ai/venvs/3d/Scripts/python.exe studio/jobs/chapaev/export_art.py
(venv с torch: вырезка BiRefNet — studio/runners/cutout.py, вызывается отсюда же; видеокарта одна — 4070.)

Что делается с картинками (только подгонка, рисунок — модели):
- коробки, корона, флажок, лёд, песок — вырезка, обрезка по содержимому;
- лунка — круг вокруг тёмной дыры вместе с ободком доски, край растушёван.
"""
import pathlib
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = pathlib.Path(__file__).resolve()
STUDIO = HERE.parents[2]
SRC = pathlib.Path('G:/temp/studio/out/chapaev/01-art')
CUT = pathlib.Path('G:/temp/studio/out/chapaev/cut')
DST = STUDIO.parent / 'lavochka/public/chapaev/art'

# какой сид взят (смотрел листы глазами)
PICK = {
    'matchbox': 92,
    'matchbox2': 92,
    'hole': 92,
    'ice': 93,
    'sand': 93,
    'crown': 91,
    'flag': 91,
}
# вырезка: имя в игре → (позиция, наибольшая сторона)
OUT = {
    'matchbox-0': ('matchbox', 256),
    'matchbox-1': ('matchbox2', 256),
    'ice': ('ice', 320),
    'sand': ('sand', 256),
    'crown': ('crown', 96),
    'flag': ('flag', 64),
}


def src(name: str) -> pathlib.Path:
    return SRC / f'{name}-{PICK[name]}.png'


def clean_alpha(im: Image.Image, lo: int = 40) -> Image.Image:
    a = np.asarray(im.split()[-1]).astype(np.float32)
    a = np.clip((a - lo) * 255 / (255 - lo), 0, 255).astype(np.uint8)
    out = im.copy()
    out.putalpha(Image.fromarray(a))
    bbox = out.split()[-1].point(lambda v: 255 if v > 16 else 0).getbbox()
    return out.crop(bbox) if bbox else out


def cut_all(names: list[str]):
    files = [src(n) for n in names]
    need = [f for f in files if not (CUT / f.name).exists()]
    if need:
        subprocess.run([sys.executable, str(STUDIO / 'runners/cutout.py'), str(CUT), *map(str, need)], check=True)


def fit(im: Image.Image, side: int) -> Image.Image:
    w, h = im.size
    k = side / max(w, h)
    return im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)


def hole() -> Image.Image:
    im = Image.open(src('hole')).convert('RGB')
    g = np.asarray(im.convert('L')).astype(np.float32)
    ys, xs = np.nonzero(g < 60)
    cx, cy = xs.mean(), ys.mean()
    r = np.sqrt(len(xs) / np.pi)
    R = r * 1.3
    box = (int(cx - R), int(cy - R), int(cx + R), int(cy + R))
    c = im.crop(box).convert('RGBA')
    s = c.size[0]
    yy, xx = np.mgrid[:s, :s]
    d = np.hypot(xx - (s - 1) / 2, yy - (s - 1) / 2) / (s / 2)
    a = np.clip((1 - d) / 0.12, 0, 1)
    c.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    return c.resize((160, 160), Image.LANCZOS)


def save(im: Image.Image, name: str, q: int = 86):
    im.save(DST / f'{name}.webp', quality=q, method=6)
    print(name, im.size)


def main():
    DST.mkdir(parents=True, exist_ok=True)
    cut_all(sorted({n for n, _ in OUT.values()}))
    for out, (name, side) in OUT.items():
        save(fit(clean_alpha(Image.open(CUT / src(name).name).convert('RGBA')), side), out)
    save(hole(), 'hole')
    total = sum(f.stat().st_size for f in DST.glob('*.webp'))
    print('итого', len(list(DST.glob('*.webp'))), 'файлов,', total // 1024, 'КБ')


if __name__ == '__main__':
    main()
