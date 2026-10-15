#!/usr/bin/env python3
"""Фишки людо и парчиса (Pillow + numpy):

    python tools/boards/ludo.py public/tex/ludo

  * pawn0..3 — пешки людо (красная, зелёная, жёлтая, синяя): круглое основание и шарик-голова, вид сверху под углом;
  * disc0..3 — плоские фишки парчиса с ободком и бороздками.
Свет слева сверху, мягкая тень в картинке. Порядок цветов — как места: 0 красный, 1 зелёный, 2 жёлтый, 3 синий.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

COLORS = [(205, 40, 36), (30, 140, 64), (240, 186, 20), (30, 96, 186)]
L = np.array([-0.45, -0.6, 0.66])
L /= np.linalg.norm(L)
H = L + np.array([0, 0, 1.0])
H /= np.linalg.norm(H)


def sphere_shade(nx, ny, base, spec=1.0, amb=0.45):
    r2 = nx * nx + ny * ny
    z = np.sqrt(np.clip(1 - r2, 0, 1))
    d = np.clip(nx * L[0] + ny * L[1] + z * L[2], 0, 1)
    h = np.clip(nx * H[0] + ny * H[1] + z * H[2], 0, 1)
    col = np.array(base, np.float32) * (amb + 0.7 * d)[..., None] + (h ** 60 * 230 * spec + h ** 12 * 30 * spec)[..., None]
    return col, r2 <= 1


def layer(canvas, col, mask):
    a = np.where(mask, 255, 0).astype(np.uint8)
    im = Image.fromarray(np.dstack([col.clip(0, 255).astype(np.uint8), a]), 'RGBA')
    canvas.alpha_composite(im)


def shadow(canvas, S, cx, cy, rx, ry, alpha=150, blur=0.04):
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    m = (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2) <= 1
    sh = Image.fromarray(np.where(m, alpha, 0).astype(np.uint8)).filter(ImageFilter.GaussianBlur(S * blur))
    im = Image.new('RGBA', (S, S), (10, 6, 0, 0))
    im.putalpha(sh)
    canvas.alpha_composite(im)


def pawn(c, size=128):
    S = size * 3
    cv = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    shadow(cv, S, S * 0.56, S * 0.6, S * 0.36, S * 0.3)
    # основание — сплюснутый диск
    bx, by, br = S * 0.5, S * 0.56, S * 0.36
    nx, ny = (x - bx) / br, (y - by) / (br * 0.92)
    col, m = sphere_shade(nx, ny * 1.0, c, spec=0.6)
    col *= (0.75 + 0.25 * np.clip(1 - (nx * nx + ny * ny), 0, 1))[..., None]
    layer(cv, col, m)
    # «шейка» — кольцо потемнее
    nx, ny = (x - S * 0.49) / (S * 0.2), (y - S * 0.5) / (S * 0.2)
    col, m = sphere_shade(nx, ny, tuple(v * 0.8 for v in c), spec=0.5)
    layer(cv, col, m)
    # голова — шарик, сдвинут к свету (вид под углом)
    nx, ny = (x - S * 0.46) / (S * 0.17), (y - S * 0.42) / (S * 0.17)
    col, m = sphere_shade(nx, ny, c, spec=1.0, amb=0.5)
    layer(cv, col, m)
    return cv.resize((size, size), Image.LANCZOS)


def disc(c, size=128):
    S = size * 3
    cv = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    shadow(cv, S, S * 0.53, S * 0.56, S * 0.4, S * 0.4, alpha=160, blur=0.03)
    cx, cy, R = S * 0.5, S * 0.5, S * 0.4
    r = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / R
    nx, ny = (x - cx) / R, (y - cy) / R
    # плоская фишка: торец (обод) скруглён, сверху — плоскость с бороздками
    hgt = np.where(r < 1, np.clip((1 - r) / 0.16, 0, 1) ** 0.5, 0)
    groove = np.exp(-((r - 0.62) / 0.03) ** 2) * 0.25 + np.exp(-((r - 0.38) / 0.025) ** 2) * 0.2
    hgt = hgt - groove
    gy, gx = np.gradient(hgt * S * 0.03)
    n = np.dstack([-gx, -gy, np.ones_like(hgt)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    d = np.clip((n * L).sum(2), 0, 1)
    h = np.clip((n * H).sum(2), 0, 1)
    col = np.array(c, np.float32) * (0.4 + 0.72 * d)[..., None] + (h ** 50 * 160 + h ** 10 * 20)[..., None]
    layer(cv, col, r < 1)
    return cv.resize((size, size), Image.LANCZOS)


def main(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    for i, c in enumerate(COLORS):
        pawn(c).save(out / f'pawn{i}.webp', 'WEBP', quality=90, method=6)
        disc(c).save(out / f'disc{i}.webp', 'WEBP', quality=90, method=6)
    print('готово:', out)


if __name__ == '__main__':
    main(Path(sys.argv[1] if len(sys.argv) > 1 else 'public/tex/ludo'))
