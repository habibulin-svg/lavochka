#!/usr/bin/env python3
"""Колода «Классическая» (Лавочка+) из Vector Playing Cards 1.3 (LGPL-3.0, Byron Knoll), PNG 500×726.

    python -I tools/cards/classic.py <папка PNG-cards-1.3> public/cards/classic

  * размер — как у остальных колод, 480×744 (58×90 мм): исходник чуть вытянут по высоте (≈7%);
  * фигуры — «…2.png» (с рисунком), туз пик — узорный; у тузов червей, бубен и треф глянцевая заливка
    заменена ровной краской, как у значков числовых карт;
  * бумага — тёплый белый, скругление и тёмный обрез — как у остальных колод (finish из build.py);
  * рубашка — своя (сетка ромбов и розетка), не из набора.
Лицензия набора лежит рядом с картами: public/cards/classic/LICENSE.txt.
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

W, H = 480, 744
RADIUS = 24
PAPER = (251, 250, 246)
RED = (223, 0, 0)  # краска значков исходника
BLACK = (0, 0, 0)
SUIT = {'S': 'spades', 'C': 'clubs', 'D': 'diamonds', 'H': 'hearts'}
RANK = {11: 'jack', 12: 'queen', 13: 'king', 14: 'ace'}


def finish(card: Image.Image) -> Image.Image:
    """Скруглённые углы и чёткий тёмный обрез (как tools/cards/build.py)."""
    S = 3
    big = Image.new('L', (W * S, H * S), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, W * S - 1, H * S - 1), RADIUS * S, fill=255)
    alpha = big.resize((W, H), Image.LANCZOS)
    line = Image.new('L', (W * S, H * S), 0)
    ImageDraw.Draw(line).rounded_rectangle((0, 0, W * S - 1, H * S - 1), RADIUS * S, outline=255, width=7)
    line = line.resize((W, H), Image.LANCZOS)
    out = Image.composite(Image.new('RGB', (W, H), (70, 60, 50)), card.convert('RGB'), line).convert('RGBA')
    out.putalpha(alpha)
    return out


def load(src: Path, name: str) -> Image.Image:
    im = Image.open(src / f'{name}.png').convert('RGBA')
    bg = Image.new('RGBA', im.size, PAPER + (255,))
    bg.alpha_composite(im)
    rgb = bg.convert('RGB')
    # серая рамка исходника (1–2 px) — под нашу бумагу, обрез нарисует finish
    d = ImageDraw.Draw(rgb)
    w, h = rgb.size
    d.rounded_rectangle((0, 0, w - 1, h - 1), 30, outline=PAPER, width=4)
    # белое исходника → наша бумага
    white = rgb.convert('L').point(lambda v: 255 if v > 246 else 0)
    rgb = Image.composite(Image.new('RGB', rgb.size, PAPER), rgb, white)
    return rgb


def flat_ace(im: Image.Image, color) -> Image.Image:
    """Большой значок туза — ровной краской вместо глянца (индексы в углах не трогаем)."""
    w, h = im.size
    box = (int(w * 0.16), int(h * 0.16), int(w * 0.84), int(h * 0.84))
    part = im.crop(box)
    r, g, b = part.split()
    if color == RED:
        ink = g.point(lambda v: max(0, min(255, int((250 - v) * 2.4))))
    else:
        L = part.convert('L')
        ink = L.point(lambda v: max(0, min(255, int((250 - v) * 2.0))))
    flat = Image.composite(Image.new('RGB', part.size, color), Image.new('RGB', part.size, PAPER), ink)
    im = im.copy()
    im.paste(flat, box[:2])
    return im


def face(src: Path, s: str, r: int) -> Image.Image:
    color = RED if s in 'HD' else BLACK
    if r <= 10:
        im = load(src, f'{r}_of_{SUIT[s]}')
    elif r == 14:
        im = load(src, f'ace_of_{SUIT[s]}')
        if s != 'S':
            im = flat_ace(im, color)
    else:
        im = load(src, f'{RANK[r]}_of_{SUIT[s]}2')
    im = im.resize((W, H), Image.LANCZOS)
    im = im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    return finish(im)


def back() -> Image.Image:
    """Своя рубашка: белое поле, красная сетка ромбов в двойной рамке, розетка посередине."""
    S = 3
    w, h = W * S, H * S
    red = (158, 28, 36)
    light = (232, 196, 190)
    im = Image.new('RGB', (w, h), PAPER)
    d = ImageDraw.Draw(im)
    m = 26 * S  # белое поле
    d.rounded_rectangle((m, m, w - m, h - m), 12 * S, fill=red)
    # сетка ромбов
    field = Image.new('L', (w, h), 0)
    fd = ImageDraw.Draw(field)
    step = 30 * S
    for k in range(-h // step - 2, w // step + h // step + 3):
        x = k * step
        fd.line((x, 0, x + h * 0.62, h), fill=255, width=int(2.2 * S))
        fd.line((x, 0, x - h * 0.62, h), fill=255, width=int(2.2 * S))
    # точки в ромбах
    for i in range(-2, w // step + 3):
        for j in range(-2, int(h / (step / 0.62)) + 3):
            cx = i * step + (j % 2) * step / 2
            cy = j * step / 0.62 / 2 + step / 0.62 / 4
            fd.ellipse((cx - 3 * S, cy - 3 * S, cx + 3 * S, cy + 3 * S), fill=255)
    inner = Image.new('L', (w, h), 0)
    ImageDraw.Draw(inner).rounded_rectangle((m + 14 * S, m + 14 * S, w - m - 14 * S, h - m - 14 * S), 6 * S, fill=255)
    field = ImageChops.multiply(field, inner)
    im = Image.composite(Image.new('RGB', (w, h), light), im, field)
    d = ImageDraw.Draw(im)
    # двойная рамка
    d.rounded_rectangle((m + 6 * S, m + 6 * S, w - m - 6 * S, h - m - 6 * S), 9 * S, outline=light, width=int(2.5 * S))
    d.rounded_rectangle((m + 11 * S, m + 11 * S, w - m - 11 * S, h - m - 11 * S), 7 * S, outline=light, width=int(1.2 * S))
    # розетка: круг, лепестки, кольца
    cx, cy = w / 2, h / 2
    R = 92 * S
    d.ellipse((cx - R, cy - R, cx + R, cy + R), fill=red, outline=light, width=int(3 * S))
    d.ellipse((cx - R + 9 * S, cy - R + 9 * S, cx + R - 9 * S, cy + R - 9 * S), outline=light, width=int(1.4 * S))
    for k in range(16):
        a = k * math.pi / 8
        # лепесток — вытянутый эллипс вдоль луча
        L0, L1, half = 18 * S, 74 * S, 9 * S
        p = [
            (cx + math.cos(a) * L0, cy + math.sin(a) * L0),
            (cx + math.cos(a) * (L0 + L1) / 2 + math.cos(a + math.pi / 2) * half, cy + math.sin(a) * (L0 + L1) / 2 + math.sin(a + math.pi / 2) * half),
            (cx + math.cos(a) * L1, cy + math.sin(a) * L1),
            (cx + math.cos(a) * (L0 + L1) / 2 - math.cos(a + math.pi / 2) * half, cy + math.sin(a) * (L0 + L1) / 2 - math.sin(a + math.pi / 2) * half),
        ]
        d.polygon(p, fill=light if k % 2 == 0 else None, outline=light, width=int(1.4 * S))
    d.ellipse((cx - 16 * S, cy - 16 * S, cx + 16 * S, cy + 16 * S), fill=light)
    d.ellipse((cx - 8 * S, cy - 8 * S, cx + 8 * S, cy + 8 * S), fill=red)
    im = im.resize((W, H), Image.LANCZOS)
    return finish(im)


def save(im: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, 'WEBP', quality=88, method=5)


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    for s in 'SCDH':
        for r in range(2, 15):
            save(face(src, s, r), out / f'{s}{r}.webp')
    save(back(), out / 'back.webp')
    print('ok', out)


if __name__ == '__main__':
    main()
