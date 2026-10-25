"""Санторин: спрайты из gen.py — убрать зелёный хромакей (по оттенку: фон с переливами и тенью тоже зелёный), снять зелёный отсвет
с краёв, обрезать по рисунку, привести к ширине 360 px → public/santorini/<имя>.webp. Остров — public/santorini/island.webp.

  python tools/santorini/cut.py
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage

RAW = "D:/temp/santorini/raw"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "santorini")
PICK = {"l1": "l1-0", "l2": "l2-1", "l3": "l3-1", "l3d": "l3d-1", "w0": "w0-1", "w1": "w1-0"}
ISLAND = "iso-0"  # углы плиты в view.ts (SLAB) сняты с этой картинки 1024×768
W = 360


def key(path: str, strict: bool) -> Image.Image:
    """strict — постройки: фоном считается любой зелёный, в том числе тень (в белых стенах зелёного нет);
    иначе (глянцевые строители) — только светлый зелёный, чтобы отсветы фона на глянце не стали дырами."""
    src = Image.open(path).convert("RGB")
    im = np.asarray(src).astype(np.float32)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    mx = im.max(axis=2)
    mn = im.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    hue = np.asarray(src.convert("HSV")).astype(np.float32)[..., 0] * 360 / 255
    bgish = (hue > 62) & (hue < 175) & (sat > 0.1) & (mx > 80)
    if strict:
        bgish |= (g - np.maximum(r, b)) > 6
    # фон — только то, что связано с краем кадра
    lab, _ = ndimage.label(bgish)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge))
    a = 1 - np.clip((ndimage.gaussian_filter(bg.astype(np.float32), 1.0) - 0.15) / 0.7, 0, 1)
    # самое крупное пятно предмета (отсвет лампы у края кадра — отдельное пятно)
    solid, n = ndimage.label(a > 0.4)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(solid), solid, range(1, n + 1))
        a = a * ndimage.binary_dilation(solid == 1 + int(np.argmax(sizes)), iterations=3)
    g2 = np.minimum(g, np.maximum(r, b) + 6)  # зелёный отсвет на краях
    out = np.dstack([r, g2, b, a * 255]).clip(0, 255).astype(np.uint8)
    ys, xs = np.nonzero(a > 0.5)
    img = Image.fromarray(out, "RGBA").crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    w, h = img.size
    return img.resize((W, round(h * W / w)), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, src in PICK.items():
        p = f"{RAW}/{src}.png"
        if not os.path.exists(p):
            print("нет", p)
            continue
        img = key(p, strict=name != 'w1')  # синий глянец отражает зелёный фон
        img.save(os.path.join(OUT, f"{name}.webp"), quality=90, method=6)
        print(name, src, img.size)
    p = f"{RAW}/{ISLAND}.png"
    if os.path.exists(p):
        isl = Image.open(p).convert("RGB")
        isl.thumbnail((1600, 1600), Image.LANCZOS)
        isl.save(os.path.join(OUT, "island.webp"), quality=86, method=6)
        print("island", isl.size)


if __name__ == "__main__":
    main()
