"""Чаупар: картинки из gen.py → public/tex/chaupar/. Фишки и каури — убрать пурпурный фон (по цвету, связанный с краем кадра),
обрезать по рисунку; ткань и медальон центра — просто ужать.

  python tools/chaupar/cut.py
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage

RAW = "D:/temp/chaupar/raw"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "tex", "chaupar")
SPRITES = {"g0": "g0-1", "g1": "g1-1", "g2": "g2-0", "g3": "g3-1", "cowrie_up": "cowrie_up-0", "cowrie_down": "cowrie_down-0"}
FLAT = {"cloth": ("cloth-1", 1024, None), "center": ("center-1", 512, 0.86)}


def key(path: str, width: int, shell: bool) -> Image.Image:
    """shell — раковина: в ней самой есть розовое, поэтому фоном считаем только яркий пурпур (тень остаётся)."""
    im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    src = Image.open(path).convert("RGB")
    hue = np.asarray(src.convert("HSV")).astype(np.float32)[..., 0] * 360 / 255
    mx, mn = im.max(axis=2), im.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    # пурпурный фон с тенью и светлый розовый отсвет лампы
    lo, dark = (285, 110) if shell else (300, 55)
    pink = ((hue > lo) & (hue < 352) & (sat > 0.2) & (mx > dark)) | ((r > g + 12) & (b > g + 5) & (mn > 150)) | ((mn > 228) & (b >= g - 3))
    lab, _ = ndimage.label(pink)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge))
    bg = ndimage.binary_closing(bg, iterations=2)
    a = 1 - np.clip((ndimage.gaussian_filter(bg.astype(np.float32), 1.0) - 0.15) / 0.7, 0, 1)
    solid, n = ndimage.label(a > 0.4)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(solid), solid, range(1, n + 1))
        a = a * ndimage.binary_dilation(solid == 1 + int(np.argmax(sizes)), iterations=3)
    # розовый отсвет фона на краях — гасим лишний синий/красный против зелёного
    edge_px = (a < 0.98) & (a > 0)
    b2 = np.where(edge_px, np.minimum(b, g + 30), b)
    out = np.dstack([r, g, b2, a * 255]).clip(0, 255).astype(np.uint8)
    ys, xs = np.nonzero(a > 0.5)
    img = Image.fromarray(out, "RGBA").crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    w, h = img.size
    return img.resize((width, round(h * width / w)), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, src in SPRITES.items():
        img = key(f"{RAW}/{src}.png", 160 if name.startswith("g") else 120, name.startswith("cowrie"))
        img.save(os.path.join(OUT, f"{name}.webp"), quality=90, method=6)
        print(name, img.size)
    for name, (src, size, crop) in FLAT.items():
        img = Image.open(f"{RAW}/{src}.png").convert("RGB")
        if crop:
            w, h = img.size
            m = (1 - crop) / 2
            img = img.crop((int(w * m), int(h * m), int(w * (1 - m)), int(h * (1 - m))))
        img = img.resize((size, size), Image.LANCZOS)
        img.save(os.path.join(OUT, f"{name}.webp"), quality=84, method=6)
        print(name, img.size)


if __name__ == "__main__":
    main()
