"""Викторина: отобранные картинки 01-art → lavochka/public/viktorina/art/*.webp (раскладывает их lavochka/src/games/viktorina/art.ts).

G:/ai/venvs/3d/Scripts/python.exe studio/jobs/viktorina/export_art.py
(venv с torch: вырезка BiRefNet — studio/runners/cutout.py, вызывается отсюда же.)

Что делается (рисунок — модели, код только подгоняет и собирает):
- фоны студии — лист целиком, уменьшен;
- барабан — собирается по ТОЧНОЙ геометрии секторов (SECTORS — как в engine.ts) из лаковых фактур, нарисованных моделью;
  поверх — латунный обод с лампочками (внутренность обода вырезана по кругу) и ступица; надписи секторов — шрифтом
  (модель кириллицу и цифры по кругу не напишет);
- стрелка, кнопка (обычная и горящая), трибуна, плашка, ячейка табло, панель — вырезка BiRefNet и обрезка по содержимому.
"""
import math
import pathlib
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = pathlib.Path(__file__).resolve()
STUDIO = HERE.parents[2]
SRC = pathlib.Path('G:/temp/studio/out/viktorina/01-art')
CUT = pathlib.Path('G:/temp/studio/out/viktorina/cut')
DST = STUDIO.parent / 'lavochka/public/viktorina/art'

# какой сид взят (смотрел лист глазами)
PICK = {
    'bg-studio': 92,
    'bg-studio-tall': 93,
    'wheel-rim': 91,
    'wheel-hub': 92,
    'lacquer-red': 92,
    'lacquer-yellow': 91,
    'lacquer-blue': 92,
    'lacquer-green': 93,
    'lacquer-black': 92,
    'lacquer-white': 91,
    'pointer': 93,
    'buzzer': 92,
    'buzzer-lit': 92,
    'podium': 92,
    'plate': 91,
    'tile': 93,
    'panel': 93,
}

# секторы барабана — ровно как SECTORS в lavochka/src/games/viktorina/engine.ts (по часовой стрелке от верха)
SECTORS = [350, 'x2', 500, 'Б', 250, 600, '0', 400, 'П', 300, 800, '+', 450, 1000, 200, 'Б', 700, 150]
NUM_COLORS = ['red', 'yellow', 'blue', 'green']
SPECIAL = {'Б': 'black', '0': 'white', 'П': 'red', '+': 'green', 'x2': 'yellow'}
WHEEL_PX = 1024
FONT = 'C:/Windows/Fonts/ariblk.ttf'


def src(name: str) -> pathlib.Path:
    return SRC / f'{name}-{PICK[name]}.png'


def cut_all(names):
    files = [src(n) for n in names]
    need = [f for f in files if not (CUT / f.name).exists()]
    if need:
        subprocess.run([sys.executable, str(STUDIO / 'runners/cutout.py'), str(CUT), *map(str, need)], check=True)


def clean_alpha(im: Image.Image, lo: int = 40) -> Image.Image:
    a = np.asarray(im.split()[-1]).astype(np.float32)
    a = np.clip((a - lo) * 255 / (255 - lo), 0, 255).astype(np.uint8)
    out = im.copy()
    out.putalpha(Image.fromarray(a))
    bbox = out.split()[-1].point(lambda v: 255 if v > 16 else 0).getbbox()
    return out.crop(bbox) if bbox else out


def save(im: Image.Image, name: str, q: int = 86):
    im.save(DST / f'{name}.webp', quality=q, method=6)
    print(name, im.size)


def fit(im: Image.Image, w: int) -> Image.Image:
    if im.width <= w:
        return im
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


def tex(name: str) -> np.ndarray:
    return np.asarray(Image.open(src(name)).convert('RGB').resize((WHEEL_PX, WHEEL_PX)), dtype=np.float32)


def sector_colors():
    out = []
    k = 0
    for s in SECTORS:
        if isinstance(s, int):
            out.append(NUM_COLORS[k % 4])
            k += 1
        else:
            out.append(SPECIAL[s])
    return out


def ring_radii(rim: Image.Image):
    """Внешний и внутренний радиус обода (доли половины стороны): по лучам от центра — где кончается белая середина."""
    a = np.asarray(rim.convert('RGB'), dtype=np.float32)
    h, w, _ = a.shape
    cx, cy = w / 2, h / 2
    inner, outer = [], []
    for k in range(72):
        ang = k * math.tau / 72
        r_in = None
        r_out = None
        for r in range(10, int(min(w, h) / 2) - 2):
            x = int(cx + r * math.cos(ang))
            y = int(cy + r * math.sin(ang))
            p = a[y, x]
            white = p.min() > 205 and p.max() - p.min() < 30
            if r_in is None and not white:
                r_in = r
            if r_in is not None and not white:
                r_out = r
        if r_in and r_out:
            inner.append(r_in)
            outer.append(r_out)
    return np.median(inner), np.median(outer), (cx, cy)


def build_wheel():
    N = WHEEL_PX
    rim = Image.open(src('wheel-rim')).convert('RGB')
    r_in, r_out, (cx, cy) = ring_radii(rim)
    print('обод: внутренний', r_in, 'внешний', r_out)
    # обод: вырезать середину и всё вне внешнего круга; масштаб — внешний край к краю картинки
    s = (N / 2) / r_out
    rim_s = rim.resize((round(rim.width * s), round(rim.height * s)), Image.LANCZOS)
    ox = round(N / 2 - cx * s)
    oy = round(N / 2 - cy * s)
    rim_full = Image.new('RGB', (N, N))
    rim_full.paste(rim_s, (ox, oy))
    yy, xx = np.mgrid[:N, :N].astype(np.float32)
    rr = np.hypot(xx - N / 2 + 0.5, yy - N / 2 + 0.5)
    R_IN = r_in * s + 3  # чуть внутрь — под край обода
    R_OUT = N / 2 - 1
    ring_a = np.clip(np.minimum(rr - (R_IN - 2), R_OUT - rr) * 0.8, 0, 1)
    # диск секторов
    cols = sector_colors()
    tx = {c: tex(f'lacquer-{c}') for c in set(cols)}
    deg = (np.degrees(np.arctan2(xx - N / 2, -(yy - N / 2))) + 360) % 360
    n = len(SECTORS)
    idx = (((deg + 180 / n) % 360) // (360 / n)).astype(np.int32) % n
    disk = np.zeros((N, N, 3), dtype=np.float32)
    for i, c in enumerate(cols):
        m = idx == i
        disk[m] = tx[c][m]
    # тень к ободу и тонкие латунные спицы между секторами
    rel = np.clip(rr / R_IN, 0, 1)
    disk *= (1 - 0.35 * rel**6)[..., None]
    edge = np.abs(((deg + 180 / n) % (360 / n)) - 0) * math.pi / 180 * rr
    edge = np.minimum(edge, (360 / n) * math.pi / 180 * rr - edge)
    spoke = np.clip(1.6 - edge, 0, 1) * (rr > 40)
    brass = np.array([200, 160, 80], dtype=np.float32)
    disk = disk * (1 - spoke[..., None]) + brass * spoke[..., None]
    img = Image.fromarray(np.clip(disk, 0, 255).astype(np.uint8)).convert('RGBA')
    # надписи
    d = ImageDraw.Draw(img)
    for i, sct in enumerate(SECTORS):
        label = {'x2': '×2', 'Б': 'Б', '0': '0', 'П': 'П', '+': '+'}.get(sct, str(sct)) if not isinstance(sct, int) else str(sct)
        col = cols[i]
        ink = (30, 20, 10) if col in ('yellow', 'white') else (255, 246, 220)
        size = 74 if not isinstance(sct, int) else (58 if len(label) <= 3 else 50)
        f = ImageFont.truetype(FONT, size)
        tile = Image.new('RGBA', (420, 120), (0, 0, 0, 0))
        td = ImageDraw.Draw(tile)
        tb = td.textbbox((0, 0), label, font=f)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        td.text(((420 - tw) / 2 - tb[0], (120 - th) / 2 - tb[1]), label, font=f, fill=ink + (255,))
        # надпись вдоль радиуса: читается от края к центру
        tile = tile.rotate(90, expand=True, resample=Image.BICUBIC)
        ang = i * 360 / n
        tile = tile.rotate(-ang, expand=True, resample=Image.BICUBIC)
        rad = R_IN * 0.66
        x = N / 2 + rad * math.sin(math.radians(ang))
        y = N / 2 - rad * math.cos(math.radians(ang))
        img.alpha_composite(tile, (round(x - tile.width / 2), round(y - tile.height / 2)))
    # обод поверх
    rim_rgba = rim_full.convert('RGBA')
    rim_rgba.putalpha(Image.fromarray((ring_a * 255).astype(np.uint8)))
    disk_a = (rr <= R_IN + 2).astype(np.float32)
    img.putalpha(Image.fromarray((np.maximum(disk_a, 0) * 255).astype(np.uint8)))
    img.alpha_composite(rim_rgba)
    # ступица
    hub = clean_alpha(Image.open(CUT / src('wheel-hub').name).convert('RGBA'))
    hs = round(N * 0.2)
    hub = hub.resize((hs, round(hub.height * hs / hub.width)), Image.LANCZOS)
    img.alpha_composite(hub, (round(N / 2 - hub.width / 2), round(N / 2 - hub.height / 2)))
    save(img, 'wheel', 88)
    print(f'барабан: радиус диска {R_IN / N:.3f} стороны')


def main():
    DST.mkdir(parents=True, exist_ok=True)
    cut_all(['wheel-hub', 'pointer', 'buzzer', 'buzzer-lit', 'podium', 'plate', 'tile', 'panel'])
    save(fit(Image.open(src('bg-studio')).convert('RGB'), 1600), 'bg', 80)
    save(fit(Image.open(src('bg-studio-tall')).convert('RGB'), 900), 'bg-tall', 80)
    build_wheel()
    for name, w in [('pointer', 160), ('buzzer', 480), ('buzzer-lit', 480), ('podium', 420), ('plate', 900), ('tile', 360), ('panel', 1200)]:
        im = clean_alpha(Image.open(CUT / src(name).name).convert('RGBA'))
        if name == 'tile':
            # у «телевизора» снизу ножки — срезаем
            im = im.crop((0, 0, im.width, round(im.height * 0.95)))
        save(fit(im, w), name)


if __name__ == '__main__':
    main()
