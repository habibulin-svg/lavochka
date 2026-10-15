#!/usr/bin/env python3
"""Доски и камни для «Манкалы» (Pillow + numpy):

    python tools/boards/mancala.py public/tex/mancala

  * kalah.webp — резная доска на 2×6 лунок и два дома по краям (тёмное дерево сапеле, волокно вдоль доски);
  * togyz.webp — доска тогыз кумалака как турнирный деревянный кейс: светлое дерево, латунные петли,
    2×9 отсеков со скошенными стенками, номера краской, длинный казан вдоль петли;
  * marble0..6 — стеклянные шарики разных цветов (калах), seed0..3 — серые семена цезальпинии (оваре),
    kum0..5 — тёмные шарики-кумалаки и tuz — белый (метка туздыка); у камней тень уже в картинке.
Геометрия лунок — та же, что в src/games/mancala/layout.ts (доли ширины и высоты доски).
Объём — по карте высот: нормали, свет слева сверху, затенение в глубине лунок, лак.
"""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

LIGHT = np.array([-0.5, -0.62, 0.6])
LIGHT /= np.linalg.norm(LIGHT)


def smooth_noise(w, h, cx, cy, seed):
    r = np.random.default_rng(seed)
    small = Image.fromarray((r.random((cy, cx)) * 255).astype(np.uint8), 'L')
    return np.asarray(small.resize((w, h), Image.BICUBIC), dtype=np.float32) / 255.0


def wood(w, h, light, dark, seed, along='x', period=26.0, waves=30.0):
    """Дерево: волокно вдоль оси — неровные слои разной ширины, тонкие штрихи, пятна тона."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    u, t = (y, x) if along == 'x' else (x, y)
    warp = (smooth_noise(w, h, 4, 3, seed) - 0.5) * waves * 0.45 + (smooth_noise(w, h, 9, 6, seed + 1) - 0.5) * 5
    v = u + warp
    # слои: период плавает по доске, фаза сбивается шумом вдоль волокна
    ph = smooth_noise(w, h, 3, 40, seed + 2) * 5 + smooth_noise(w, h, 2, 9, seed + 5) * 3
    ring = 0.5 + 0.5 * np.sin(v * 2 * np.pi / period + ph)
    ring = ring ** 2.2
    streak = np.asarray(Image.fromarray((np.random.default_rng(seed + 3).random((h, 1)) * 255).astype(np.uint8)).resize((w, h), Image.NEAREST), np.float32) / 255
    streak = np.clip((streak - 0.82) * 5, 0, 1) * (0.6 + 0.4 * smooth_noise(w, h, 12, 3, seed + 6))
    tone = smooth_noise(w, h, 5, 3, seed + 4)
    k = 0.28 + 0.24 * ring + 0.16 * streak + 0.28 * tone
    k = k[..., None]
    return np.array(light, np.float32) * (1 - k) + np.array(dark, np.float32) * k


def rounded_rect_dist(w, h, r):
    """Расстояние внутрь от края скруглённого прямоугольника (отрицательное — снаружи)."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    qx = np.abs(x - (w - 1) / 2) - ((w - 1) / 2 - r)
    qy = np.abs(y - (h - 1) / 2) - ((h - 1) / 2 - r)
    out = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0)
    return r - out


def shade(hgt, albedo, mask, ao, gloss=0.25):
    gy, gx = np.gradient(hgt)
    n = np.dstack([-gx, -gy, np.ones_like(hgt)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    diff = np.clip((n * LIGHT).sum(2), 0, 1)
    half = LIGHT + np.array([0, 0, 1.0])
    half /= np.linalg.norm(half)
    spec = np.clip((n * half).sum(2), 0, 1) ** 40 * gloss
    col = albedo * (0.38 + 0.78 * diff)[..., None] * ao[..., None] + spec[..., None] * 255
    a = (np.clip(mask, 0, 1) * 255).astype(np.uint8)
    return Image.fromarray(np.dstack([col.clip(0, 255).astype(np.uint8), a]), 'RGBA')


def carve(hgt, ao, w, h, cx, cy, rx, ry, depth):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    if rx > ry * 3:  # длинный паз: расстояние до отрезка, концы круглые
        half = rx - ry
        dx = np.maximum(np.abs(x - cx) - half, 0)
        d = np.sqrt((dx / ry) ** 2 + ((y - cy) / ry) ** 2)
    else:
        d = np.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)
    inside = d < 1
    bowl = depth * np.clip(1 - d ** 2, 0, 1) ** 0.6
    # мягкая кромка: чуть скруглена
    lip = np.clip((1.06 - d) / 0.06, 0, 1)
    hgt -= bowl * lip
    ao *= np.where(inside, 0.55 + 0.45 * d ** 1.5, 1)


def board(kind, out: Path):
    if kind == 'kalah':
        W, H = 1600, 520
        alb = wood(W, H, (168, 98, 52), (98, 50, 22), 11, 'x', 31, 26)
        dist = rounded_rect_dist(W, H, 230)
        pits = [(0.1875 + i * 0.125, y, 0.0513, 0.158) for y in (0.279, 0.721) for i in range(6)]
        stores = [(0.075, 0.5, 0.05, 0.385), (0.925, 0.5, 0.05, 0.385)]
        depth = 55
    else:
        W, H = 1800, 760
        alb = wood(W, H, (214, 166, 104), (156, 104, 52), 21, 'x', 38, 20)
        dist = rounded_rect_dist(W, H, 60)
        pits = [(0.0722 + i * 0.107, y, 0.0333, 0.152) for y in (0.217, 0.783) for i in range(9)]
        stores = [(0.5, 0.435, 0.40, 0.052), (0.5, 0.565, 0.40, 0.052)]
        depth = 52
    hgt = np.clip(dist / 26.0, 0, 1) ** 0.5 * 28.0  # скруглённый край доски
    mask = np.clip(dist + 0.5, 0, 1)
    ao = np.ones((H, W), np.float32)
    for (fx, fy, frx, fry) in pits:
        carve(hgt, ao, W, H, fx * W, fy * H, frx * W, fry * H, depth)
    for (fx, fy, frx, fry) in stores:
        carve(hgt, ao, W, H, fx * W, fy * H, frx * W, fry * H, depth * 0.9)
    if kind == 'togyz':
        # выжженный орнамент по краю: двойная рамка и ромбы между казанами
        orn = Image.new('L', (W, H), 0)
        d = ImageDraw.Draw(orn)
        for m, wd in ((22, 4), (34, 2)):
            d.rounded_rectangle((m, m, W - 1 - m, H - 1 - m), 50 - m // 2, outline=255, width=wd)
        for cx in (0.04 * W, 0.96 * W):
            cy = H / 2
            for k in range(3):
                s = 26 - k * 8
                d.polygon([(cx, cy - s * 1.6), (cx + s, cy), (cx, cy + s * 1.6), (cx - s, cy)], outline=255, width=3)
        # «рога» (кошкар-муйз) по углам
        for (cx, cy, sx, sy) in ((70, 70, 1, 1), (W - 70, 70, -1, 1), (70, H - 70, 1, -1), (W - 70, H - 70, -1, -1)):
            for r in (18, 30):
                d.arc((cx - r, cy - r, cx + r, cy + r), 0, 360, fill=255, width=3)
        orn = np.asarray(orn.filter(ImageFilter.GaussianBlur(1.1)), np.float32) / 255
        alb = alb * (1 - 0.5 * orn[..., None])
        hgt -= orn * 1.5
    img = shade(hgt, alb, mask, ao)
    # тень доски под ней — отдельно делает CSS
    img.save(out / f'{kind}.webp', 'WEBP', quality=86, method=6)


TW, TH = 1800, 1120
T_PIT_W = 1720 / 9


def togyz_board(out: Path):
    """Тогыз кумалак — как турнирная деревянная доска: раскладной кейс из светлого дерева на латунных петлях,
    в каждой половине 9 длинных отсеков со скошенными стенками, номера 1–9 краской, длинный казан вдоль петли."""
    from PIL import ImageFont
    W, H = TW, TH
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    hgt = np.zeros((H, W), np.float32)
    ao = np.ones((H, W), np.float32)
    mask = np.zeros((H, W), np.float32)

    def rect_in(x0, y0, x1, y1):
        """Расстояние внутрь прямоугольника (<0 — снаружи)."""
        return np.minimum(np.minimum(x - x0, x1 - x), np.minimum(y - y0, y1 - y))

    def tray(x0, y0, x1, y1, depth, bevel):
        d = rect_in(x0, y0, x1, y1)
        inside = d > 0
        k = np.clip(d / bevel, 0, 1)
        hgt[inside] = np.minimum(hgt[inside], -depth * k[inside])
        ao[inside] *= (0.78 + 0.22 * k[inside])

    for (fy0, fy1) in ((20, 557), (563, 1100)):
        d = rect_in(20, fy0, W - 20, fy1)
        mask[:] = np.maximum(mask, np.clip(d / 2 + 0.5, 0, 1))
        hgt[:] += np.where(d > 0, np.clip(d / 10, 0, 1) * 6, 0)
    top = dict(pits=(40, 360), kazan=(372, 522))
    bot = dict(pits=(760, 1080), kazan=(598, 748))
    for half in (top, bot):
        py0, py1 = half['pits']
        for i in range(9):
            x0 = 40 + i * T_PIT_W + 5
            tray(x0, py0, x0 + T_PIT_W - 10, py1, 46, 40)
        ky0, ky1 = half['kazan']
        tray(40, ky0, W - 40, ky1, 40, 34)
    # петля
    hinge = (y > 548) & (y < 572)
    cyl = np.sqrt(np.clip(1 - ((y - 560) / 12) ** 2, 0, 1)) * 12
    knuck = hinge & (((x > 300) & (x < 380)) | ((x > 1420) & (x < 1500)))
    hgt = np.where(knuck, cyl + 4, hgt)
    mask = np.where(knuck, 1, mask)
    # номера 1–9 выдавлены на верхней стенке отсеков (у верхней половины — перевёрнуты: для соперника)
    num = Image.new('L', (W, H), 0)
    dd = ImageDraw.Draw(num)
    font = ImageFont.truetype('C:/Windows/Fonts/ariali.ttf', 34)
    for i in range(9):
        cx = 40 + (i + 0.5) * T_PIT_W
        dd.text((cx, 770), str(i + 1), font=font, fill=255, anchor='mt')
    numtop = Image.new('L', (W, H), 0)
    dt = ImageDraw.Draw(numtop)
    for i in range(9):
        cx = 40 + (i + 0.5) * T_PIT_W
        dt.text((cx, H - 350), str(i + 1), font=font, fill=255, anchor='mt')
    num = np.asarray(num, np.float32) / 255 + np.asarray(numtop.rotate(180), np.float32) / 255
    hgt += num * 0.3
    for _ in range(2):  # сгладить рёбра (3×3 среднее дважды)
        p_ = np.pad(hgt, 1, mode='edge')
        hgt = sum(p_[1 + dy:1 + dy + H, 1 + dx:1 + dx + W] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9
    # светлое дерево (бук/сосна) с волокном вдоль отсеков, номера — чёрной краской; латунные петли
    alb = wood(W, H, (234, 200, 156), (200, 156, 108), 41, 'y', 22, 4)
    alb = alb * (1 - 0.85 * np.clip(num, 0, 1)[..., None])
    alb = np.where(knuck[..., None], np.array([196, 160, 70], np.float32), alb)
    img = shade(hgt, alb, mask, ao, gloss=0.18)
    img.save(out / 'togyz.webp', 'WEBP', quality=86, method=6)


def sprite(kind, seed, size=96):
    S = size * 3
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    cx, cy = S * 0.46, S * 0.44
    R = S * 0.34
    if kind == 'seed':  # семя — чуть овальное
        nx, ny = (x - cx) / (S * 0.36), (y - cy) / (S * 0.32)
    else:
        nx, ny = (x - cx) / R, (y - cy) / R
    r2 = nx * nx + ny * ny
    inside = r2 <= 1
    z = np.sqrt(np.clip(1 - r2, 0, 1))
    N = np.dstack([nx, ny, z])
    diff = np.clip((N * LIGHT).sum(2), 0, 1)
    half = LIGHT + np.array([0, 0, 1.0])
    half /= np.linalg.norm(half)
    ndh = np.clip((N * half).sum(2), 0, 1)
    if kind == 'marble':
        cols = [(200, 40, 40), (40, 90, 200), (230, 180, 30), (40, 150, 80), (130, 60, 170), (230, 110, 30), (60, 170, 180)]
        c = np.array(cols[seed % len(cols)], np.float32)
        glass = c * (0.35 + 0.5 * diff)[..., None]
        # каустика — светлое пятно напротив света
        caus = np.exp(-(((nx - 0.35) / 0.35) ** 2 + ((ny - 0.4) / 0.3) ** 2))
        glass += (c * 0.9 + 60) * caus[..., None] * 0.7
        # «кошачий глаз» — изогнутая лента внутри
        t = ny * math.cos(seed) + nx * math.sin(seed)
        band = np.exp(-((t - 0.25 * (nx * nx)) / 0.12) ** 2) * (z > 0.2)
        bc = np.array([250, 250, 240], np.float32) if seed % 2 else np.array([255, 220, 120], np.float32)
        glass = glass * (1 - 0.6 * band[..., None]) + bc * 0.6 * band[..., None] * (0.5 + 0.5 * diff)[..., None]
        rim = np.clip((np.sqrt(r2) - 0.8) / 0.2, 0, 1) ** 2
        glass *= (1 - 0.45 * rim)[..., None]
        col = glass + (ndh ** 90 * 255 + ndh ** 20 * 50)[..., None]
    elif kind == 'seed':
        base = np.array([150, 156, 140], np.float32) * (0.92 + 0.12 * rng.random())
        lines = 0.5 + 0.5 * np.sin((np.sqrt(r2) * 9 + smooth_noise(S, S, 10, 10, seed + 50) * 3) * math.pi)
        tex = base * (1 - 0.08 * lines ** 6)[..., None]
        col = tex * (0.45 + 0.7 * diff)[..., None] + (ndh ** 30 * 70)[..., None]
    elif kind == 'tuz':  # белый шарик — метка туздыка
        col = np.array([238, 236, 230], np.float32) * (0.55 + 0.5 * diff)[..., None] + (ndh ** 30 * 60)[..., None]
    else:  # кумалак — тёмный литой шарик (как в стандартном наборе), едва заметный шов
        tones = [(46, 36, 34), (40, 34, 34), (52, 40, 36), (36, 32, 32), (48, 38, 34), (42, 36, 36)]
        base = np.array(tones[seed % len(tones)], np.float32)
        seam = np.exp(-((nx * math.cos(seed) + ny * math.sin(seed)) / 0.04) ** 2) * 0.25
        col = base * (0.6 + 0.9 * diff)[..., None] * (1 - seam)[..., None] + (ndh ** 50 * 150 + ndh ** 10 * 30)[..., None]
    a = np.where(inside, 255, 0).astype(np.float32)
    stone = np.dstack([col.clip(0, 255), a]).astype(np.uint8)
    im = Image.fromarray(stone, 'RGBA')
    # мягкая тень вправо-вниз
    sh = Image.fromarray(np.where(inside, 150, 0).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(S * 0.03))
    shadow = Image.new('RGBA', (S, S), (20, 10, 0, 0))
    shadow.putalpha(sh)
    base_img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    base_img.alpha_composite(shadow, (round(S * 0.05), round(S * 0.07)))
    base_img.alpha_composite(im)
    return base_img.resize((size, size), Image.LANCZOS)


def main(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    board('kalah', out)
    togyz_board(out)
    for i in range(7):
        sprite('marble', i).save(out / f'marble{i}.webp', 'WEBP', quality=90, method=6)
    for i in range(4):
        sprite('seed', i).save(out / f'seed{i}.webp', 'WEBP', quality=90, method=6)
    for i in range(6):
        sprite('kum', i).save(out / f'kum{i}.webp', 'WEBP', quality=90, method=6)
    sprite('tuz', 0).save(out / 'tuz.webp', 'WEBP', quality=90, method=6)
    print('готово:', out)


if __name__ == '__main__':
    main(Path(sys.argv[1] if len(sys.argv) > 1 else 'public/tex/mancala'))
