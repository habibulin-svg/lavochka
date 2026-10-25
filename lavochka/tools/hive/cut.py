"""Насекомые «Улья»: из картинок gen.py убираем белый фон, обрезаем по рисунку и кладём в public/hive/<буква>.webp (256 px).

  python tools/hive/cut.py
"""
import os

import numpy as np
from PIL import Image

RAW = "D:/temp/hive/raw"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "hive")
# какой вариант взят для каждого насекомого
PICK = {"Q": "queen-0", "B": "beetle-0", "G": "hopper-1", "S": "spider-1", "A": "ant-0", "M": "mosquito-0", "L": "ladybug-1", "P": "pillbug-1"}
SIZE = 256


def cut(path: str) -> Image.Image:
    im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    # «белизна»: насколько пиксель далёк от белого; мягкий край вместо резкого порога
    d = 255 - im.min(axis=2)
    a = np.clip((d - 18) / 50, 0, 1)
    # цвет без белой примеси на краях: c = (p - (1 - a)·255) / a
    rgb = np.where(a[..., None] > 0.01, (im - (1 - a[..., None]) * 255) / np.maximum(a[..., None], 0.01), 0)
    out = np.dstack([np.clip(rgb, 0, 255), a * 255]).astype(np.uint8)
    img = Image.fromarray(out, "RGBA")
    box = img.getbbox()
    img = img.crop(box)
    w, h = img.size
    side = max(w, h)
    sq = Image.new("RGBA", (side, side))
    sq.paste(img, ((side - w) // 2, (side - h) // 2))
    return sq.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for bug, name in PICK.items():
        cut(f"{RAW}/{name}.png").save(os.path.join(OUT, f"{bug}.webp"), quality=90, method=6)
        print(bug, name)


if __name__ == "__main__":
    main()
