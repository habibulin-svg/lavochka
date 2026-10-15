#!/usr/bin/env python3
"""Текстуры для Го и Рэндзю (нужны Pillow и numpy):

    python tools/boards/go.py public/tex/go

  * kaya.webp — доска из кая: светлое дерево с прямым частым волокном (масамэ), лёгкая неровность тона;
  * slate0..1.webp — чёрные камни: матовый сланец, широкий тусклый блик;
  * shell0..3.webp — белые камни: раковина с тонкими полосами, тёплый белый, блик поострее.
Камни — вид сверху на двояковыпуклую линзу, свет слева сверху; тень рисует SVG.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

rng = np.random.default_rng(7)


def smooth_noise(w, h, cells_x, cells_y, seed):
    r = np.random.default_rng(seed)
    small = Image.fromarray((r.random((cells_y, cells_x)) * 255).astype(np.uint8), 'L')
    return np.asarray(small.resize((w, h), Image.BICUBIC), dtype=np.float32) / 255.0


def kaya(size=1200):
    w = h = size
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    # волокно вдоль доски (вертикально), слегка гуляет
    warp = (smooth_noise(w, h, 4, 2, 1) - 0.5) * 16 + (smooth_noise(w, h, 14, 5, 2) - 0.5) * 3
    u = x + warp
    # годичные слои: частые тонкие и реже — потемнее
    fine = 0.5 + 0.5 * np.sin(u * 2 * np.pi / 7.0 + smooth_noise(w, h, 40, 12, 3) * 4)
    coarse = 0.5 + 0.5 * np.sin(u * 2 * np.pi / 61.0 + smooth_noise(w, h, 9, 4, 4) * 5)
    lines = np.clip((fine - 0.8) * 4.5, 0, 1) * 0.28 + np.clip((coarse - 0.85) * 5, 0, 1) * 0.45
    tone = smooth_noise(w, h, 4, 6, 5) * 0.5 + smooth_noise(w, h, 2, 2, 6) * 0.5
    grain = rng.normal(0, 1, (h, w)).astype(np.float32)
    grain = np.asarray(Image.fromarray(((grain * 18) + 128).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)), dtype=np.float32) / 255 - 0.5
    light = np.array([238, 204, 138], np.float32)
    dark = np.array([196, 146, 74], np.float32)
    k = (0.16 + tone * 0.2 + lines * 0.5 + grain * 0.1)[..., None]
    img = light * (1 - k) + dark * k
    return Image.fromarray(img.clip(0, 255).astype(np.uint8), 'RGB')


def stone(kind, size=192, seed=0):
    S = size * 3  # сглаживание края
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    cx = cy = (S - 1) / 2
    R = S * 0.48
    nx, ny = (x - cx) / R, (y - cy) / R
    r2 = nx * nx + ny * ny
    inside = r2 <= 1
    # двояковыпуклая линза: высота невелика, к краю круто падает
    z = np.sqrt(np.clip(1 - r2, 0, 1))
    nz = 0.35 + z * 0.9
    norm = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-6
    Nx, Ny, Nz = nx / norm, ny / norm, nz / norm
    L = np.array([-0.45, -0.55, 0.70])
    L /= np.linalg.norm(L)
    diff = np.clip(Nx * L[0] + Ny * L[1] + Nz * L[2], 0, 1)
    Hh = L + np.array([0, 0, 1.0])
    Hh /= np.linalg.norm(Hh)
    ndh = np.clip(Nx * Hh[0] + Ny * Hh[1] + Nz * Hh[2], 0, 1)
    rnd = np.random.default_rng(seed)
    if kind == 'slate':
        base = np.array([30, 30, 34], np.float32)
        tex = smooth_noise(S, S, 22, 22, 100 + seed) - 0.5
        col = base * (0.7 + 0.6 * diff)[..., None] + tex[..., None] * 5
        spec = ndh ** 10 * 34 + ndh ** 60 * 22
        col += spec[..., None]
    else:
        base = np.array([241, 238, 228], np.float32)
        ang = rnd.uniform(0, np.pi)
        t = nx * np.cos(ang) + ny * np.sin(ang)
        bend = (nx * -np.sin(ang) + ny * np.cos(ang)) ** 2 * 0.25
        freq = rnd.uniform(16, 22)
        stripes = 0.5 + 0.5 * np.sin((t + bend) * freq + smooth_noise(S, S, 8, 8, 200 + seed) * 2.5)
        stripes = stripes ** 3
        col = base[None, None, :] * (1 - 0.03 * stripes[..., None])
        col = col * (0.82 + 0.22 * diff)[..., None]
        col[..., 2] -= 4 * stripes  # полосы чуть теплее
        spec = ndh ** 24 * 30 + ndh ** 120 * 40
        col += spec[..., None]
        # ободок: торец камня чуть темнее
        col *= (1 - 0.18 * np.clip((np.sqrt(r2) - 0.86) / 0.14, 0, 1) ** 2)[..., None]
    a = np.where(inside, 255, 0).astype(np.uint8)
    img = np.dstack([col.clip(0, 255).astype(np.uint8), a])
    im = Image.fromarray(img, 'RGBA').resize((size, size), Image.LANCZOS)
    return im


def main(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    kaya().save(out / 'kaya.webp', 'WEBP', quality=86, method=6)
    for i in range(2):
        stone('slate', seed=i).save(out / f'slate{i}.webp', 'WEBP', quality=90, method=6)
    for i in range(4):
        stone('shell', seed=i).save(out / f'shell{i}.webp', 'WEBP', quality=90, method=6)
    print('готово:', out)


if __name__ == '__main__':
    main(Path(sys.argv[1] if len(sys.argv) > 1 else 'public/tex/go'))
