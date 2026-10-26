"""Шен: картинки из gen.py → public/tex/shen/. Фишки и палочки — убрать зелёный фон (по цвету, связанный с краем кадра),
доски — тёмно-серый фон; обрезать по рисунку. Циновку — просто ужать.

  python tools/shen/cut.py
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage

RAW = "D:/temp/shen/raw"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "tex", "shen")
# имя → (исходник, ('w'|'h', размер), фон)
SPRITES = {
    "board": ("board-1", ("h", 1200), "grey"),
    "boardw": ("boardw-1", ("h", 1200), "grey"),
    "dog": ("dog-1", ("h", 300), "green"),
    "jackal": ("jackal-0", ("h", 300), "green"),
    "stickl": ("stickl-1", ("w", 360), "green"),
    "stickd": ("stickd-1", ("w", 360), "green"),
}
FLAT = {"table": ("table-0", 768)}


def key(path: str, size, bgkind: str) -> Image.Image:
    src = Image.open(path).convert("RGB")
    im = np.asarray(src).astype(np.float32)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    mx, mn = im.max(axis=2), im.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    if bgkind == "green":
        bgc = (g > r + 30) & (g > b + 20)
    else:
        # тёмно-серый фон: доска — светлая кость или тёплое дерево, рамка — чёрное эбеновое дерево (её не трогаем: она внутри)
        bgc = (sat < 0.12) & (mx < 120) & (mx > 35)
    lab, _ = ndimage.label(bgc)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge))
    bg = ndimage.binary_closing(bg, iterations=2)
    a = 1 - np.clip((ndimage.gaussian_filter(bg.astype(np.float32), 1.0) - 0.15) / 0.7, 0, 1)
    solid, n = ndimage.label(a > 0.4)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(solid), solid, range(1, n + 1))
        a = a * ndimage.binary_dilation(solid == 1 + int(np.argmax(sizes)), iterations=3)
    a[:3, :] = a[-3:, :] = 0
    a[:, :3] = a[:, -3:] = 0
    if bgkind == "green":
        # зелёный отсвет на краях и на кости — гасим зелёный выше среднего красного и синего
        g = np.minimum(g, np.maximum(r, (r + b) / 2 + 8))
    out = np.dstack([r, g, b, a * 255]).clip(0, 255).astype(np.uint8)
    ys, xs = np.nonzero(a > 0.5)
    img = Image.fromarray(out, "RGBA").crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    w, h = img.size
    side, n = size
    k = n / w if side == "w" else n / h
    return img.resize((round(w * k), round(h * k)), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, (src, size, bgkind) in SPRITES.items():
        img = key(f"{RAW}/{src}.png", size, bgkind)
        img.save(os.path.join(OUT, f"{name}.webp"), quality=86, method=6)
        print(name, img.size)
    for name, (src, size) in FLAT.items():
        img = Image.open(f"{RAW}/{src}.png").convert("RGB").resize((size, size), Image.LANCZOS)
        img.save(os.path.join(OUT, f"{name}.webp"), quality=80, method=6)
        print(name, img.size)


if __name__ == "__main__":
    main()
