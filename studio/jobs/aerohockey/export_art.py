"""Аэрохоккей: отобранные картинки 01-art → lavochka/public/aerohockey/art/*.webp (раскладывает их lavochka/src/games/aerohockey/art.ts).

G:/ai/venvs/3d/Scripts/python.exe studio/jobs/aerohockey/export_art.py
(venv с torch: вырезка BiRefNet — studio/runners/cutout.py, вызывается отсюда же.)

Что делается с картинками (только подгонка, рисунок — модели):
- окружение (bg) — лист целиком, уменьшен;
- поверхность поля (surf) — лист целиком, растягивается игрой на всё поле;
- фактура борта (rail) — середина листа, бесшовная плитка (post/seamless.py);
- эмблема, шайбы, биты — вырезка, обрезка по содержимому, вписаны в квадрат.
"""
import pathlib
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = pathlib.Path(__file__).resolve()
STUDIO = HERE.parents[2]
sys.path.insert(0, str(STUDIO / 'post'))
from seamless import seamless  # noqa: E402

SRC = pathlib.Path('G:/temp/studio/out/aerohockey/01-art')
CUT = pathlib.Path('G:/temp/studio/out/aerohockey/cut')
DST = STUDIO.parent / 'lavochka/public/aerohockey/art'

T = ['katok', 'disco', 'lager', 'kosmos']

# какой сид взят (смотрел листы глазами)
PICK = {
    'bg-katok': 72,
    'bg-disco': 72,
    'bg-lager': 72,
    'bg-kosmos': 71,
    'surf-katok': 71,
    'surf-disco': 71,
    'surf-lager': 71,
    'surf-kosmos': 73,
    'rail-katok': 71,
    'rail-disco': 71,
    'rail-lager': 71,
    'rail-kosmos': 72,
    'emblem-katok': 72,
    'emblem-disco': 71,
    'emblem-lager': 73,
    'emblem-kosmos': 72,
    'puck-katok': 72,
    'puck-disco': 71,
    'puck-lager': 71,
    'puck-kosmos': 73,
    'mallet-red': 73,
    'mallet-blue': 73,
    'scoreboard': 73,
}
# вырезка: имя в игре → (позиция, сторона квадрата)
SQUARE = {
    **{f'emblem-{t}': (f'emblem-{t}', 256) for t in T},
    **{f'puck-{t}': (f'puck-{t}', 128) for t in T},
    'mallet-0': ('mallet-red', 160),
    'mallet-1': ('mallet-blue', 160),
}


def src(name: str) -> pathlib.Path:
    f = SRC / f'{name}-{PICK[name]}.png'
    return f if f.exists() else next(SRC.parent.glob(f'*/{name}-{PICK[name]}.png'), f)


def clean_alpha(im: Image.Image, lo: int = 40) -> Image.Image:
    """Полупрозрачную тень на подложке BiRefNet иногда оставляет — слабую прозрачность в ноль, обрезка по содержимому."""
    a = np.asarray(im.split()[-1]).astype(np.float32)
    a = np.clip((a - lo) * 255 / (255 - lo), 0, 255).astype(np.uint8)
    out = im.copy()
    out.putalpha(Image.fromarray(a))
    bbox = out.split()[-1].point(lambda v: 255 if v > 16 else 0).getbbox()
    return out.crop(bbox) if bbox else out


def cut(name: str) -> Image.Image:
    return clean_alpha(Image.open(CUT / src(name).name).convert('RGBA'))


def cut_all(names: list[str]):
    files = [src(n) for n in names]
    need = [f for f in files if not (CUT / f.name).exists()]
    if need:
        subprocess.run([sys.executable, str(STUDIO / 'runners/cutout.py'), str(CUT), *map(str, need)], check=True)


def square(im: Image.Image, side: int, pad: float = 0.0) -> Image.Image:
    w, h = im.size
    s = int(max(w, h) * (1 + pad))
    sq = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    sq.paste(im, ((s - w) // 2, (s - h) // 2), im)
    return sq.resize((side, side), Image.LANCZOS)


def round_mask(im: Image.Image) -> Image.Image:
    """Круглые детали (шайбы, биты) — точно по кругу: край вырезки модели неровный, а физика — круг."""
    s = im.size[0]
    yy, xx = np.mgrid[:s, :s]
    d = np.hypot(xx - (s - 1) / 2, yy - (s - 1) / 2) / (s / 2)
    m = np.clip((1 - d) * s / 2, 0, 1)
    a = np.asarray(im.split()[-1]).astype(np.float32) / 255
    a = np.maximum(a, (d < 0.9).astype(np.float32)) * m
    out = im.copy()
    out.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    return out


def save(im: Image.Image, name: str, q: int = 86):
    im.save(DST / f'{name}.webp', quality=q, method=6)
    print(name, im.size)


def main():
    DST.mkdir(parents=True, exist_ok=True)
    cut_all([n for n, _ in SQUARE.values()] + ['scoreboard'])
    for out, (name, side) in SQUARE.items():
        im = cut(name)
        if out == 'emblem-disco':
            # зеркальный шар висит на крючке — берём только шар (нижний квадрат)
            im = clean_alpha(im.crop((0, max(0, im.height - im.width), im.width, im.height)))
        im = square(im, side)
        if not out.startswith('emblem') or out == 'emblem-disco':
            im = round_mask(im)
        save(im, out)
    im = cut('scoreboard')
    save(im.resize((480, round(im.height * 480 / im.width)), Image.LANCZOS), 'scoreboard')
    for t in T:
        save(Image.open(src(f'bg-{t}')).convert('RGB').resize((1536, 1024), Image.LANCZOS), f'bg-{t}', 74)
        im = Image.open(src(f'surf-{t}')).convert('RGB')
        W, H = im.size
        # края листа модель иногда рисует рамкой (скругление панели) — берём середину
        im = im.crop((int(W * 0.05), int(H * 0.03), int(W * 0.95), int(H * 0.97)))
        save(im.resize((512, 1024), Image.LANCZOS), f'surf-{t}', 80)
        im = Image.open(src(f'rail-{t}')).convert('RGB')
        W, H = im.size
        im = im.crop((int(W * 0.15), int(H * 0.15), int(W * 0.85), int(H * 0.85))).resize((256, 256), Image.LANCZOS)
        tile = seamless(np.asarray(im, dtype=np.float32)).clip(0, 255).astype(np.uint8)
        save(Image.fromarray(tile), f'rail-{t}', 82)
    total = sum(f.stat().st_size for f in DST.glob('*.webp'))
    print('итого', len(list(DST.glob('*.webp'))), 'файлов,', total // 1024, 'КБ')


if __name__ == '__main__':
    main()
