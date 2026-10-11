"""Кинь-двинь: пуговицы игроков — рендер по рельефу (обод, вогнутая серединка, сквозные дырки) с освещением как у материала:
диффуз + блик + отражение окна + френель + затенение впадин. Материалы разные, как в настоящей коробке с пуговицами:
глянцевый и мраморный пластик, металл, перламутр, дерево (фототекстура ореха CC0, Poly Haven — public/tex/holdem/walnut_col.webp).
Дырки прозрачные — сквозь них видно поле. Тень рисует CSS (она растёт, когда пуговицу берут).

Запуск из lavochka/:  python tools/hodilki/buttons.py  →  public/hodilki/buttons/<место>.webp
"""
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
LAV = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(LAV, 'public', 'hodilki', 'buttons')
SIZE = 160
SS = 3
N = SIZE * SS

# цвета мест — как SEATS в src/games/hodilki/core.ts
SEATS = [
    ('#d8241c', 'gloss', 4), ('#2060d0', 'marble', 4), ('#2a9a3a', 'satin', 2), ('#e8b020', 'amber', 4), ('#8a3ac8', 'marble', 2),
    ('#a8aab0', 'metal', 4), ('#f0a8c8', 'pearl', 4), ('#1a9a9a', 'gloss', 2), ('#f07a1a', 'marble', 4), ('#6a4a2a', 'wood', 2),
]


def hexrgb(h):
    return np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)])


def noise(seed, scales=(4, 8, 16, 32), amps=(1, 0.5, 0.25, 0.12)):
    rng = np.random.default_rng(seed)
    acc = np.zeros((N, N))
    for s, a in zip(scales, amps):
        small = Image.fromarray((rng.random((s, s)) * 255).astype(np.uint8))
        acc += a * (np.asarray(small.resize((N, N), Image.BICUBIC), dtype=float) / 255 - 0.5)
    return acc / sum(amps)


def blur(a, r):
    k = np.exp(-0.5 * (np.arange(-3 * r, 3 * r + 1) / r) ** 2)
    k /= k.sum()
    a = np.apply_along_axis(lambda v: np.convolve(np.pad(v, 3 * r, mode='edge'), k, 'valid'), 0, a)
    return np.apply_along_axis(lambda v: np.convolve(np.pad(v, 3 * r, mode='edge'), k, 'valid'), 1, a)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def render(seat, color, mat, holes):
    c = (np.arange(N) + 0.5) / N * 2.04 - 1.02
    x, y = np.meshgrid(c, c)
    r = np.hypot(x, y)
    th = np.arctan2(y, x)
    R = 0.97
    rr = r / R
    # профиль: вогнутая серединка, валик-обод, скруглённый край
    dish = 0.06 + 0.07 * np.clip(rr / 0.72, 0, 1) ** 2
    rim = 0.13 * np.exp(-(((rr - 0.84) / 0.085) ** 2))
    edge = np.sqrt(np.clip(1 - ((rr - 0.86) / 0.14).clip(0, None) ** 2, 0, 1))
    h = (dish + rim + 0.05) * edge
    # дырки с раззенковкой
    hr = 0.085
    pts = [(-0.2, 0), (0.2, 0)] if holes == 2 else [(-0.165, -0.165), (0.165, -0.165), (-0.165, 0.165), (0.165, 0.165)]
    alpha = (rr < 1).astype(float)
    for px, py in pts:
        d = np.hypot(x / R - px, y / R - py)
        h -= 0.045 * smooth(hr + 0.07, hr, d)
        alpha *= (d > hr).astype(float)
    # мелкий рельеф материала
    n1 = noise(seat * 7 + 1, (16, 48, 120), (0.4, 0.4, 0.2))
    if mat == 'metal':
        h += 0.0025 * np.sin(rr * 420 + n1 * 6)  # точёные кольца
    elif mat == 'wood':
        h += 0.004 * n1
    else:
        h += 0.0012 * n1

    px = 2.04 / N
    gy, gx = np.gradient(h, px)
    nx, ny, nz = -gx, -gy, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / ln, ny / ln, nz / ln

    L = np.array([-0.45, -0.6, 0.66])
    L /= np.linalg.norm(L)
    V = np.array([0, 0, 1.0])
    Hh = L + V
    Hh /= np.linalg.norm(Hh)
    ndl = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    ndh = np.clip(nx * Hh[0] + ny * Hh[1] + nz * Hh[2], 0, 1)
    ndv = np.clip(nz, 0, 1)
    # отражённый луч: окно слева сверху + светлый потолок
    rx, ry, rz = 2 * ndv * nx, 2 * ndv * ny, 2 * ndv * nz - 1
    window = smooth(0.55, 0.9, -(rx * 0.55 + ry * 0.7) + rz * 0.2) * 1.0
    sky = 0.35 + 0.35 * np.clip(-ry * 0.6 + rz * 0.6, 0, 1)
    # впадины темнее
    cav = h - blur(h, 6 * SS)
    ao = np.clip(1 + cav * 9, 0.45, 1.1)

    base = hexrgb(color)
    col = np.ones((N, N, 3)) * base
    rough = 0.15
    f0 = 0.04
    metal = False
    if mat == 'marble':
        # мягкие разводы, как у советского «мраморного» пластика: искажённый шум, без резких жилок
        w1 = noise(seat * 13 + 5, (3, 6, 12), (1, 0.6, 0.3))
        w2 = noise(seat * 17 + 9, (3, 6, 12), (1, 0.6, 0.3))
        v = noise(seat * 19 + 3, (4, 8, 16, 32), (1, 0.5, 0.3, 0.15))
        v = np.sin(v * 9 + w1 * 6 + (x + w2 * 0.8) * 2.5)
        light = np.clip(base * 1.35 + 0.18, 0, 1)
        deep = base * 0.55
        t = (0.5 + 0.5 * v)[..., None] ** 1.6
        col = deep * (1 - t) + light * t
        col = col * 0.55 + base * 0.45
        rough = 0.12
    elif mat == 'satin':
        col *= 1 + 0.08 * n1[..., None]
        rough = 0.45
    elif mat == 'amber':
        glow = np.clip(1 - rr, 0, 1) ** 0.7
        col = col * (0.75 + 0.45 * glow[..., None]) + 0.05 * n1[..., None]
        rough = 0.08
    elif mat == 'pearl':
        irid = (np.arctan2(ny, nx) + np.pi) / (2 * np.pi) + noise(seat * 3 + 2, (3, 7, 14), (1, 0.6, 0.3)) * 2
        tint = np.stack([0.5 + 0.5 * np.cos(2 * np.pi * (irid + k / 3)) for k in range(3)], -1)
        col = col * 0.85 + 0.15 + 0.06 * (tint - 0.5) * (0.6 + (1 - ndv)[..., None] * 3)
        rough = 0.2
    elif mat == 'metal':
        metal = True
        f0 = 1.0
        brushed = 0.9 + 0.1 * np.sin(rr * 900 + n1 * 20)
        col = col * brushed[..., None]
        rough = 0.28
    elif mat == 'wood':
        tex = Image.open(os.path.join(LAV, 'public', 'tex', 'holdem', 'walnut_col.webp')).convert('RGB')
        tex = tex.rotate(17 + seat * 31, resample=Image.BICUBIC).crop((200, 200, 824, 824)).resize((N, N), Image.LANCZOS)
        t = np.asarray(tex, dtype=float) / 255
        # фото ореха, подтянутое к тёплому коричневому
        lum = t.mean(-1, keepdims=True)
        lum = (lum - lum.mean()) / (lum.std() + 1e-6)
        col = np.clip(base * 1.3 * (1 + 0.28 * lum) + (t - lum.mean()) * 0.15, 0, 1)
        rough = 0.35

    shin = 2 / max(rough, 0.02) ** 2.2
    spec = ndh ** shin * (shin + 8) / 60
    fres = f0 + (1 - f0) * (1 - ndv) ** 5
    if metal:
        # никель: отражает светлую комнату и окно, тёмный пол снизу
        env = 0.25 + 0.75 * smooth(-0.6, 0.6, -ry * 0.8 + rz * 0.3) + window * 1.2
        out = col * env[..., None] * 1.15 + spec[..., None] * 0.5
    else:
        diff = col * (0.32 + 0.78 * ndl)[..., None]
        coat = (fres * (sky * 0.25 + window * (1.1 - rough * 1.5)) + spec * (1 - rough))[..., None]
        out = diff + coat * np.array([1, 0.98, 0.95])
    out = out * ao[..., None]
    # тонкая тёмная кромка по краю — читается на пёстром поле
    out *= (1 - 0.35 * smooth(0.95, 1.0, rr))[..., None]
    rgba = np.dstack([np.clip(out, 0, 1), alpha]) * 255
    im = Image.fromarray(rgba.astype(np.uint8), 'RGBA').resize((SIZE, SIZE), Image.LANCZOS)
    im.save(os.path.join(OUT, f'{seat}.webp'), quality=90, method=6)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for i, (color, mat, holes) in enumerate(SEATS):
        render(i, color, mat, holes)
    sheet = Image.new('RGBA', (SIZE * 5, SIZE * 2), (235, 220, 190, 255))
    for i in range(10):
        b = Image.open(os.path.join(OUT, f'{i}.webp'))
        sheet.alpha_composite(b, ((i % 5) * SIZE, (i // 5) * SIZE))
    sheet.save(os.path.join(HERE, 'buttons-sheet.png'))
    print('ok')
