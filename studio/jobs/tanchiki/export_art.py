"""Танчики: отобранные картинки 02-art → lavochka/public/tanchiki/art/*.webp (раскладывает их lavochka/src/games/tanchiki/art.ts).

G:/ai/venvs/3d/Scripts/python.exe studio/jobs/tanchiki/export_art.py
(venv с torch: вырезка BiRefNet — studio/runners/cutout.py, вызывается отсюда же.)

Что делается с картинками (только подгонка, рисунок — модели):
- танки: вырезка, ствол вверх, вписаны в квадрат 128; второй кадр — полосы гусениц по краям сдвинуты на ползвена (рисунок гусениц
  берётся из тех же пикселей выше, силуэт не меняется) → лента 256×128;
- кирпич, вода, лёд: середина листа, бесшовная плитка (post/seamless.py) на 16 единиц поля = 128 px; вода — три кадра сдвигами плитки;
- бетон: плита по краю, 64 px; земля поля — 512 px целиком;
- взрывы и вспышка появления — на чёрном: прозрачность по яркости;
- остальное (кусты, база, бонусы, снаряд, флажок) — вырезка, вписаны в квадрат.
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

SRC = pathlib.Path('G:/temp/studio/out/tanchiki/02-art')
CUT = pathlib.Path('G:/temp/studio/out/tanchiki/cut')
DST = STUDIO.parent / 'lavochka/public/tanchiki/art'

# какой сид взят (смотрел листы глазами); flip — ствол на картинке смотрит вниз
TANKS = {
    'tank-p1': ('tank-p1', 11, False),
    'tank-p2': ('tank-p2', 13, False),
    'enemy-0': ('enemy-basic', 13, False),
    'enemy-1': ('enemy-fast', 11, True),
    'enemy-2': ('enemy-power', 12, False),
    'enemy-3': ('enemy-armor', 12, False),
}
TEX = {'brick': 11, 'water': 13, 'ice': 11}
STEEL = 11
GROUND = 12
BUSHES = [11, 12, 13]
CUTS = {  # имя в игре: (позиция, сид, сторона квадрата)
    'base': ('base', 13, 128),
    'base-ruin': ('base-ruin', 13, 128),
    'bonus-helmet': ('bonus-helmet', 13, 96),
    'bonus-clock': ('bonus-clock', 13, 96),
    'bonus-shovel': ('bonus-shovel', 14, 96),
    'bonus-star': ('bonus-star', 12, 96),
    'bonus-grenade': ('bonus-grenade', 21, 96),
    'bonus-tank': ('bonus-tank', 14, 96),
    'flag': ('flag', 13, 64),
}
SHELL = 13
GLOWS = {'boom-0': ('boom-small', 12), 'boom-1': ('boom-big', 13), 'boom-2': ('boom-smoke', 12), 'spawn': ('spawn', 12)}
BG = 12


def src(name: str, seed: int) -> pathlib.Path:
    f = SRC / f'{name}-{seed}.png'
    # переделки — в своих партиях (03-granata: граната вместо ананаса)
    return f if f.exists() else next(SRC.parent.glob(f'*/{name}-{seed}.png'), f)


def cut_all(files: list[pathlib.Path]):
    need = [f for f in files if not (CUT / f.name).exists()]
    if need:
        subprocess.run([sys.executable, str(STUDIO / 'runners/cutout.py'), str(CUT), *map(str, need)], check=True)


def square(im: Image.Image, side: int, pad: float = 0.02) -> Image.Image:
    """Вписать RGBA в прозрачный квадрат по центру."""
    w, h = im.size
    s = int(max(w, h) * (1 + pad))
    sq = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    sq.paste(im, ((s - w) // 2, (s - h) // 2), im)
    return sq.resize((side, side), Image.LANCZOS)


def clean_alpha(im: Image.Image, lo: int = 40) -> Image.Image:
    """Полупрозрачную тень на подложке BiRefNet иногда оставляет — слабую прозрачность в ноль."""
    a = np.asarray(im.split()[-1]).astype(np.float32)
    a = np.clip((a - lo) * 255 / (255 - lo), 0, 255).astype(np.uint8)
    out = im.copy()
    out.putalpha(Image.fromarray(a))
    bbox = out.split()[-1].point(lambda v: 255 if v > 16 else 0).getbbox()
    return out.crop(bbox) if bbox else out


def tread_frame(im: Image.Image) -> Image.Image:
    """Второй кадр гусениц: в полосах по краям (по 13% ширины) цвет берётся на ползвена выше, прозрачность — своя."""
    a = np.asarray(im).copy()
    h, w, _ = a.shape
    d = max(2, round(h * 0.016))
    side = round(w * 0.13)
    for x0, x1 in ((0, side), (w - side, w)):
        band = a[:, x0:x1, :3]
        shifted = band.copy()
        shifted[d:] = band[:-d]
        op = a[:, x0:x1, 3] > 128
        ok = op & np.roll(op, d, axis=0)
        ok[:d] = False
        band[ok] = shifted[ok]
    return Image.fromarray(a)


def tanks():
    for out, (name, seed, flip) in TANKS.items():
        im = clean_alpha(Image.open(CUT / f'{name}-{seed}.png').convert('RGBA'))
        if flip:
            im = im.rotate(180)
        f0 = square(im, 128)
        f1 = tread_frame(f0)
        strip = Image.new('RGBA', (256, 128))
        strip.paste(f0, (0, 0))
        strip.paste(f1, (128, 0))
        strip.save(DST / f'{out}.webp', quality=88, method=6)
        print(out)


def textures():
    for name, seed in TEX.items():
        im = Image.open(src(f'tex-{name}', seed)).convert('RGB')
        w, h = im.size
        # кирпич крупнее: середина листа — около восьми рядов на 16 единиц, как четыре ряда на клетку у приставки
        k = 0.62 if name == 'brick' else 0.7
        im = im.crop((int(w * (1 - k) / 2), int(h * (1 - k) / 2), int(w * (1 + k) / 2), int(h * (1 + k) / 2)))
        arr = np.asarray(im.resize((256, 256), Image.LANCZOS), dtype=np.float32)
        t = Image.fromarray(seamless(arr).clip(0, 255).astype(np.uint8)).resize((128, 128), Image.LANCZOS)
        if name == 'water':
            for i in range(3):
                Image.fromarray(np.roll(np.asarray(t), (i * 43, i * 26), axis=(1, 0))).save(DST / f'water-{i}.webp', quality=85, method=6)
        else:
            t.save(DST / f'{name}.webp', quality=88, method=6)
        print(name)
    st = Image.open(src('tex-steel', STEEL)).convert('RGB')
    st.resize((64, 64), Image.LANCZOS).save(DST / 'steel.webp', quality=90, method=6)
    Image.open(src('tex-ground', GROUND)).convert('RGB').resize((512, 512), Image.LANCZOS).save(DST / 'ground.webp', quality=80, method=6)
    print('steel, ground')


def cutouts():
    for i, seed in enumerate(BUSHES):
        square(clean_alpha(Image.open(CUT / f'bush-{seed}.png').convert('RGBA')), 96).save(DST / f'bush-{i}.webp', quality=88, method=6)
    for out, (name, seed, side) in CUTS.items():
        square(clean_alpha(Image.open(CUT / f'{name}-{seed}.png').convert('RGBA')), side).save(DST / f'{out}.webp', quality=88, method=6)
    # снаряд: от патрона берём только пулю (верхние 42%), стоймя, вписан в 30×64
    im = clean_alpha(Image.open(CUT / f'shell-{SHELL}.png').convert('RGBA'))
    im = im.crop((0, 0, im.width, int(im.height * 0.42)))
    w, h = im.size
    if w > h:
        im = im.rotate(90, expand=True)
        w, h = im.size
    s = max(w / 30, h / 64)
    im = im.resize((max(1, round(w / s)), max(1, round(h / s))), Image.LANCZOS)
    box = Image.new('RGBA', (30, 64))
    box.paste(im, ((30 - im.width) // 2, (64 - im.height) // 2), im)
    box.save(DST / 'shell.webp', quality=90, method=6)
    print('cutouts')


def glows():
    for out, (name, seed) in GLOWS.items():
        a = np.asarray(Image.open(src(name, seed)).convert('RGB'), dtype=np.float32)
        al = a.max(axis=2)
        al = np.clip((al - 12) * 255 / 243, 0, 255)
        rgb = np.where(al[..., None] > 0, a * 255 / np.maximum(al[..., None], 1), 0).clip(0, 255)
        # дым тёмный — прозрачность по яркости его съедает: поднимаем
        if name == 'boom-smoke':
            al = np.clip(al * 1.8, 0, 255)
        im = Image.fromarray(np.dstack([rgb, al]).astype(np.uint8), 'RGBA')
        bbox = im.split()[-1].point(lambda v: 255 if v > 10 else 0).getbbox()
        square(im.crop(bbox) if bbox else im, 128, 0.04).save(DST / f'{out}.webp', quality=88, method=6)
    print('glows')


def main():
    DST.mkdir(parents=True, exist_ok=True)
    cut_all(
        [src(n, s) for n, s, _ in TANKS.values()]
        + [src('bush', s) for s in BUSHES]
        + [src(n, s) for n, s, _ in CUTS.values()]
        + [src('shell', SHELL)]
    )
    tanks()
    textures()
    cutouts()
    glows()
    Image.open(src('bg', BG)).convert('RGB').save(DST / 'bg.webp', quality=72, method=6)
    total = sum(f.stat().st_size for f in DST.glob('*.webp'))
    print('итого', len(list(DST.glob('*.webp'))), 'файлов,', total // 1024, 'КБ')


if __name__ == '__main__':
    main()
