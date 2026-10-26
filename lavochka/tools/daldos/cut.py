"""Далдос: картинки из gen.py → public/tex/daldos/. Доска, фишки и кость — убрать пурпурный фон (по цвету, связанный
с краем кадра), обрезать по рисунку; стол — просто ужать.

  python tools/daldos/cut.py
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage

RAW = "D:/temp/daldos/raw"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "tex", "daldos")
# имя → (исходник, ширина или высота: ('w', n) / ('h', n))
SPRITES = {
    "board": ("board-1", ("w", 1400)),
    "die": ("die-0", ("w", 300)),
    "p0": ("p0-0", ("h", 220)),
    "p0e": ("p0e-1", ("h", 220), (420, 200, 610, 1000)),  # в углу — блик лампы, режем по фишке
    "p1": ("p1-0", ("h", 220)),
    "p1e": ("p1e-1", ("h", 220)),
}
FLAT = {"table": ("table-1", 768)}


def honey(img: Image.Image, tint=(1.08, 0.9, 0.66)) -> Image.Image:
    """Берёзовые фишки в пурпурном свете выходят розовыми — перекрашиваем по яркости в медовый."""
    a = np.asarray(img).astype(np.float32)
    lum = a[..., :3] @ np.array([0.3, 0.55, 0.15], np.float32)
    tint = np.array(tint, np.float32)
    rgb = np.clip(lum[..., None] * tint, 0, 255)
    return Image.fromarray(np.dstack([rgb, a[..., 3]]).astype(np.uint8), "RGBA")


def key(path: str, size, box=None) -> Image.Image:
    src = Image.open(path).convert("RGB")
    if box:
        src = src.crop(box)
    im = np.asarray(src).astype(np.float32)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    hue = np.asarray(src.convert("HSV")).astype(np.float32)[..., 0] * 360 / 255
    mx, mn = im.max(axis=2), im.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    # пурпурный фон (с тенью и розовым отсветом); дерево — жёлто-коричневое, его оттенок далеко
    pink = ((hue > 290) | (hue < 8)) & (sat > 0.25) & (b > g + 20)
    pink |= (r > g + 40) & (b > g + 25)
    pink |= (mn > 140) & (r > g + 14) & (b > g + 4)  # светлый отсвет лампы
    lab, _ = ndimage.label(pink)
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
    # розовый отсвет на краях — гасим лишний синий/красный против зелёного
    edge_px = (a < 0.98) & (a > 0)
    b2 = np.where(edge_px, np.minimum(b, g + 10), b)
    r2 = np.where(edge_px, np.minimum(r, g + 70), r)
    out = np.dstack([r2, g, b2, a * 255]).clip(0, 255).astype(np.uint8)
    ys, xs = np.nonzero(a > 0.5)
    img = Image.fromarray(out, "RGBA").crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    w, h = img.size
    side, n = size
    k = n / w if side == "w" else n / h
    return img.resize((round(w * k), round(h * k)), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, (src, size, *box) in SPRITES.items():
        img = key(f"{RAW}/{src}.png", size, box[0] if box else None)
        if name == "die":
            img = img.resize((300, round(300 / 3.4)), Image.LANCZOS)  # настоящая кость короче: 2 × 2 × 4 см
        if name in ("p0", "p0e", "die"):
            img = honey(img)
        if name in ("p1", "p1e"):
            img = honey(img, (1.85, 1.3, 0.95))  # орех, а не красное дерево (и посветлее, иначе на доске чёрный)
        img.save(os.path.join(OUT, f"{name}.webp"), quality=88, method=6)
        print(name, img.size)
    for name, (src, size) in FLAT.items():
        img = Image.open(f"{RAW}/{src}.png").convert("RGB").resize((size, size), Image.LANCZOS)
        img.save(os.path.join(OUT, f"{name}.webp"), quality=80, method=6)
        print(name, img.size)


if __name__ == "__main__":
    main()
