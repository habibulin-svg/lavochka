"""Пинбол: отобранные картинки 04-parts → lavochka/public/pinbol/art/*.webp (раскладывает их lavochka/src/games/pinbol/art.ts).

G:/ai/venvs/3d/Scripts/python.exe studio/jobs/pinbol/export_art.py
(venv с torch: вырезка BiRefNet — studio/runners/cutout.py, вызывается отсюда же.)

Что делается с картинками (только подгонка, рисунок — модели):
- детали (шар, флипперы, грибки, столбик, мишени, лунка, вертушка, фигуры): вырезка, обрезка по содержимому,
  круглые — вписаны в квадрат, вытянутые (флипперы, мишени, вертушка, пружина) — по своей форме;
- лампы (круглая, стрелка) — на чёрном: прозрачность по яркости;
- чёрная дыра — на чёрном: прозрачность по яркости, середина — непрозрачная (дыра должна закрывать поле);
- текстуры: рейка и рампа — полоса из середины листа, бесшовная вдоль; резина, пластик — бесшовные плитки; дерево корпуса — лист целиком (post/seamless.py).
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

SRC = pathlib.Path('G:/temp/studio/out/pinbol/04-parts')
CUT = pathlib.Path('G:/temp/studio/out/pinbol/cut')
DST = STUDIO.parent / 'lavochka/public/pinbol/art'

# какой сид взят (смотрел листы глазами)
PICK = {
    'ball': 51,
    'plunger': 53,
    'flipper-red': 52,
    'flipper-pink': 52,
    'flipper-orange': 52,
    'bumper-park': 51,
    'bumper-disco': 53,
    'bumper-kosmos': 51,
    'post': 53,
    'drop': 51,
    'standup': 51,
    'saucer': 52,
    'spinner': 51,
    'insert': 52,
    'arrow': 52,
    'tex-rail': 52,
    'tex-ramp': 51,
    'tex-wood': 61,
    'tex-rubber': 51,
    'tex-plastic-park': 53,
    'tex-plastic-disco': 51,
    'tex-plastic-kosmos': 51,
    'carousel': 61,
    'coaster': 62,
    'mirrorball': 52,
    'vinyl': 51,
    'blackhole': 52,
    'rocket': 51,
}
# имя в игре: (позиция, сторона квадрата) — круглые и компактные
SQUARE = {
    'ball': ('ball', 64),
    'bumper-park': ('bumper-park', 128),
    'bumper-disco': ('bumper-disco', 128),
    'bumper-kosmos': ('bumper-kosmos', 128),
    'post': ('post', 48),
    'saucer': ('saucer', 96),
    'carousel': ('carousel', 192),
    'mirrorball': ('mirrorball', 128),
    'vinyl': ('vinyl', 160),
    'coaster': ('coaster', 128),
}
# вытянутые: (позиция, длинная сторона, повернуть так, чтобы длинная — по x)
LONG = {
    'flipper-park': ('flipper-red', 256),
    'flipper-disco': ('flipper-pink', 256),
    'flipper-kosmos': ('flipper-orange', 256),
    'drop': ('drop', 128),
    'standup': ('standup', 128),
    'spinner': ('spinner', 128),
}
GLOW = {'insert': ('insert', 64), 'arrow': ('arrow', 64)}
TILES = {'rubber': ('tex-rubber', 64), 'plastic-park': ('tex-plastic-park', 256), 'plastic-disco': ('tex-plastic-disco', 256), 'plastic-kosmos': ('tex-plastic-kosmos', 256)}


def src(name: str) -> pathlib.Path:
    # переделки — в своих партиях (05-fix: карусель сверху, вагончик горок, дерево)
    f = SRC / f'{name}-{PICK[name]}.png'
    return f if f.exists() else next(SRC.parent.glob(f'*/{name}-{PICK[name]}.png'), f)


def cut(name: str) -> Image.Image:
    return clean_alpha(Image.open(CUT / f'{name}-{PICK[name]}.png').convert('RGBA'))


def cut_all(names: list[str]):
    files = [src(n) for n in names]
    need = [f for f in files if not (CUT / f.name).exists()]
    if need:
        subprocess.run([sys.executable, str(STUDIO / 'runners/cutout.py'), str(CUT), *map(str, need)], check=True)


def square(im: Image.Image, side: int, pad: float = 0.02) -> Image.Image:
    w, h = im.size
    s = int(max(w, h) * (1 + pad))
    sq = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    sq.paste(im, ((s - w) // 2, (s - h) // 2), im)
    return sq.resize((side, side), Image.LANCZOS)


def clean_alpha(im: Image.Image, lo: int = 40) -> Image.Image:
    """Полупрозрачную тень на подложке BiRefNet иногда оставляет — слабую прозрачность в ноль, обрезка по содержимому."""
    a = np.asarray(im.split()[-1]).astype(np.float32)
    a = np.clip((a - lo) * 255 / (255 - lo), 0, 255).astype(np.uint8)
    out = im.copy()
    out.putalpha(Image.fromarray(a))
    bbox = out.split()[-1].point(lambda v: 255 if v > 16 else 0).getbbox()
    return out.crop(bbox) if bbox else out


def save(im: Image.Image, name: str, q: int = 88):
    im.save(DST / f'{name}.webp', quality=q, method=6)
    print(name, im.size)


def by_light(name: str, keep_core: float = 0.0) -> Image.Image:
    """Картинка на чёрном → RGBA: прозрачность по яркости; keep_core — доля радиуса в середине, которая остаётся непрозрачной."""
    a = np.asarray(Image.open(src(name)).convert('RGB'), dtype=np.float32)
    al = a.max(axis=2)
    al = np.clip((al - 14) * 255 / 241, 0, 255)
    rgb = np.where(al[..., None] > 0, a * 255 / np.maximum(al[..., None], 1), 0).clip(0, 255)
    bbox = Image.fromarray(al.astype(np.uint8)).point(lambda v: 255 if v > 10 else 0).getbbox()
    if keep_core:
        x0, y0, x1, y1 = bbox
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        r = max(x1 - x0, y1 - y0) / 2
        yy, xx = np.mgrid[: al.shape[0], : al.shape[1]]
        d = np.hypot(xx - cx, yy - cy) / r
        core = np.clip((keep_core - d) / 0.08, 0, 1) * 255
        al = np.maximum(al, core)
        rgb = np.where(core[..., None] > 0, a * (1 - core[..., None] / 255) + 0, rgb)
    im = Image.fromarray(np.dstack([rgb, al]).astype(np.uint8), 'RGBA')
    return im.crop(bbox) if bbox else im


def strip_tex(name: str, w: int, h: int, frac: float) -> Image.Image:
    """Полоса из середины листа по высоте (frac — доля высоты), бесшовная вдоль x."""
    im = Image.open(src(name)).convert('RGB')
    W, H = im.size
    band = im.crop((0, int(H * (0.5 - frac / 2)), W, int(H * (0.5 + frac / 2))))
    arr = np.asarray(band.resize((512, max(8, int(512 * band.height / band.width))), Image.LANCZOS), dtype=np.float32)
    # бесшовность только вдоль: склейка краёв перекрёстным переходом
    n = arr.shape[1] // 6
    left = arr[:, :n].copy()
    right = arr[:, -n:].copy()
    k = np.linspace(0, 1, n)[None, :, None]
    arr[:, :n] = left * k + right * (1 - k)
    arr = arr[:, : arr.shape[1] - n]
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)


def main():
    DST.mkdir(parents=True, exist_ok=True)
    cut_all([n for n, _ in SQUARE.values()] + [n for n, _ in LONG.values()] + ['plunger', 'rocket'])
    for out, (name, side) in SQUARE.items():
        save(square(cut(name), side), out)
    for out, (name, side) in LONG.items():
        im = cut(name)
        if out == 'standup':
            # только лицо мишени, без ножки-пружины
            im = clean_alpha(im.crop((0, 0, im.width, int(im.height * 0.62))))
        elif im.height > im.width:
            im = im.rotate(90, expand=True)
        k = side / im.width
        save(im.resize((side, max(4, round(im.height * k))), Image.LANCZOS), out)
    # пружина — стоймя, узкая
    im = cut('plunger')
    save(im.resize((max(8, round(im.width * 256 / im.height)), 256), Image.LANCZOS), 'plunger')
    im = cut('rocket')
    save(im.resize((max(8, round(im.width * 160 / im.height)), 160), Image.LANCZOS), 'rocket')
    for out, (name, side) in GLOW.items():
        save(square(by_light(name), side, 0.04), out)
    save(square(by_light('blackhole', 0.22), 256, 0.02), 'blackhole')
    # дерево корпуса — одним листом (кладётся растянутым на весь фон, без повторов)
    save(Image.open(src('tex-wood')).convert('RGB').resize((768, 768), Image.LANCZOS), 'wood', 80)
    # текстуры
    save(strip_tex('tex-rail', 256, 32, 0.22), 'rail')
    save(strip_tex('tex-ramp', 256, 96, 0.9), 'ramp')
    for out, (name, side) in TILES.items():
        im = Image.open(src(name)).convert('RGB')
        W, H = im.size
        im = im.crop((int(W * 0.15), int(H * 0.15), int(W * 0.85), int(H * 0.85))).resize((256, 256), Image.LANCZOS)
        t = seamless(np.asarray(im, dtype=np.float32)).clip(0, 255).astype(np.uint8)
        save(Image.fromarray(t).resize((side, side), Image.LANCZOS), out, 82)
    total = sum(f.stat().st_size for f in DST.glob('*.webp'))
    print('итого', len(list(DST.glob('*.webp'))), 'файлов,', total // 1024, 'КБ')


if __name__ == '__main__':
    main()
