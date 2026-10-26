"""Петтейя: картинки из gen.py → public/tex/petteia/. Фишки — убрать зелёный фон (по цвету, связанный с краем кадра),
обрезать по рисунку, вписать в круг; фактуры досок и стол — обрезать поля и ужать.

  python tools/petteia/cut.py
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage

RAW = "D:/temp/petteia/raw"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "tex", "petteia")
SPRITES = {"pw": "pw-0", "pb": "pb-0", "gw": "gw-0", "gb": "gb-0"}
FLAT = {"marble": ("marble-0", 640), "clay": ("clay-0", 640), "table": ("table-0", 768)}


def key(path: str, size: int) -> Image.Image:
    src = Image.open(path).convert("RGB")
    im = np.asarray(src).astype(np.float32)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    bgc = (g > r + 30) & (g > b + 20)
    lab, _ = ndimage.label(bgc)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = ndimage.binary_closing(np.isin(lab, list(edge)), iterations=2)
    a = 1 - np.clip((ndimage.gaussian_filter(bg.astype(np.float32), 1.0) - 0.15) / 0.7, 0, 1)
    solid, n = ndimage.label(a > 0.4)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(solid), solid, range(1, n + 1))
        a = a * ndimage.binary_dilation(solid == 1 + int(np.argmax(sizes)), iterations=3)
    # зелёный отсвет на краях и бликах — гасим зелёный выше среднего красного и синего
    g = np.minimum(g, np.maximum(r, (r + b) / 2 + 6))
    out = np.dstack([r, g, b, a * 255]).clip(0, 255).astype(np.uint8)
    ys, xs = np.nonzero(a > 0.5)
    img = Image.fromarray(out, "RGBA").crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    # квадрат по большей стороне — камешек чуть овальный, но стоит в клетке по центру
    w, h = img.size
    m = max(w, h)
    sq = Image.new("RGBA", (m, m))
    sq.paste(img, ((m - w) // 2, (m - h) // 2))
    return sq.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, src in SPRITES.items():
        img = key(f"{RAW}/{src}.png", 160)
        img.save(os.path.join(OUT, f"{name}.webp"), quality=88, method=6)
        print(name, img.size)
    for name, (src, size) in FLAT.items():
        img = Image.open(f"{RAW}/{src}.png").convert("RGB")
        w, h = img.size
        c = int(min(w, h) * (0.07 if name == "marble" else 0.03))  # у плиты мрамора по краю — сколы
        img = img.crop((c, c, w - c, h - c)).resize((size, size), Image.LANCZOS)
        img.save(os.path.join(OUT, f"{name}.webp"), quality=80, method=6)
        print(name, img.size)


if __name__ == "__main__":
    main()
