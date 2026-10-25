"""Плиточник: картинки gen.py → public/azul/. Плитки — обрезка по краю плитки, 160 px; мастерок и ящик — хромакей;
фактуры (стена, прилавок, пол) — уменьшить до 1024 px.

  python tools/azul/cut.py
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "santorini"))
from cut import key  # noqa: E402  (тот же хромакей, что у Санторина)

RAW = "D:/temp/azul/raw"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "azul")
TILES = {"t0": "t0-1", "t1": "t1-1", "t2": "t2-0", "t3": "t3-1", "t4": "t4-1"}
KEYED = {"trowel": "trowel-1", "box": "box-0"}
TEX = {"wall": "wall-1", "counter": "counter-1", "floor": "floor-1"}


def tile(path: str) -> Image.Image:
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    # край плитки: строки и столбцы, заметно отличающиеся от белого фона по краям кадра
    bg = a[:6, :6].reshape(-1, 3).mean(axis=0)
    d = np.abs(a - bg).sum(axis=2) > 40
    ys, xs = np.nonzero(d)
    if len(xs) > 1000:
        x0, x1, y0, y1 = np.percentile(xs, 1), np.percentile(xs, 99), np.percentile(ys, 1), np.percentile(ys, 99)
    else:
        x0, y0, x1, y1 = 0, 0, im.width, im.height
    side = min(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    inset = side * 0.03
    box = (cx - side / 2 + inset, cy - side / 2 + inset, cx + side / 2 - inset, cy + side / 2 - inset)
    return im.crop(tuple(int(round(v)) for v in box)).resize((160, 160), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, src in TILES.items():
        p = f"{RAW}/{src}.png"
        if os.path.exists(p):
            tile(p).save(os.path.join(OUT, f"{name}.webp"), quality=90, method=6)
            print(name, src)
    for name, src in KEYED.items():
        p = f"{RAW}/{src}.png"
        if os.path.exists(p):
            img = key(p, strict=True)
            img.save(os.path.join(OUT, f"{name}.webp"), quality=90, method=6)
            print(name, src, img.size)
    for name, src in TEX.items():
        p = f"{RAW}/{src}.png"
        if os.path.exists(p):
            im = Image.open(p).convert("RGB")
            im.thumbnail((1024, 1024), Image.LANCZOS)
            im.save(os.path.join(OUT, f"{name}.webp"), quality=84, method=6)
            print(name, src)


if __name__ == "__main__":
    main()
