"""Пулук: картинки из gen.py → public/tex/puluk/. Спрайты — убрать пурпурный фон (функция key из tools/daldos/cut.py)
и обрезать по рисунку; зерно с меткой — то же зерно с нарисованной угольной точкой (чтобы обе стороны были одним зерном);
циновка — просто ужать.

  python tools/puluk/cut.py
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "daldos"))
from cut import key  # noqa: E402

RAW = "D:/temp/puluk/raw"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "tex", "puluk")
SPRITES = {
    "kernel": ("kernel-0", ("h", 120)),
    "w0": ("w0-0", ("h", 200)),
    "w1": ("w1-0", ("h", 200)),
    "stick": ("stick-0", ("w", 600), (96, 250, 934, 330)),  # в углу — блик лампы, режем по палочке
    "home": ("home-1", ("w", 320)),
}
FLAT = {"table": ("table-0", 768)}


def clean(img: Image.Image, tint=None, flat=False, shade=False) -> Image.Image:
    """Добрать пурпурную тень и отсвет, что key оставил у края; tint — перекрасить по яркости; flat — снять розовый отлив."""
    a = np.asarray(img).astype(np.float32)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    al = np.where((r > g + 30) & (b > g + (8 if shade else 15)), 0, al)
    if shade:  # тёмная бордовая тень под зерном и корзинкой
        lum = r * 0.3 + g * 0.55 + b * 0.15
        al = np.where((lum < 120) & (r > g + 10) & (b > g - 6), 0, al)
    if flat:
        r, b = np.minimum(r, g + 10), np.minimum(b, g + 12)
    rgb = np.dstack([r, g, b])
    if tint:
        lum = rgb @ np.array([0.3, 0.55, 0.15], np.float32)
        rgb = np.clip(lum[..., None] * np.array(tint, np.float32), 0, 255)
    out = Image.fromarray(np.dstack([rgb, al]).clip(0, 255).astype(np.uint8), "RGBA")
    return out.crop(out.getchannel("A").point(lambda v: 255 if v > 128 else 0).getbbox())


def mark(img: Image.Image) -> Image.Image:
    """Чёрная точка углём посередине зерна, чуть размытая и с прозрачностью по краю."""
    w, h = img.size
    dot = Image.new("L", (w, h), 0)
    r = w * 0.2
    cx, cy = w / 2, h * 0.47
    ImageDraw.Draw(dot).ellipse((cx - r, cy - r, cx + r, cy + r), fill=235)
    dot = dot.filter(ImageFilter.GaussianBlur(1.2))
    ink = Image.new("RGBA", (w, h), (24, 18, 14, 255))
    out = img.copy()
    out.paste(ink, (0, 0), dot)
    out.putalpha(img.getchannel("A"))
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, (src, size, *box) in SPRITES.items():
        img = key(f"{RAW}/{src}.png", size, box[0] if box else None)
        img = clean(img, (1.07, 1.0, 0.84) if name == "kernel" else None, flat=name == "w1", shade=name in ("kernel", "home", "stick"))
        img.save(os.path.join(OUT, f"{name}.webp"), quality=88, method=6)
        print(name, img.size)
        if name == "kernel":
            m = mark(img)
            m.save(os.path.join(OUT, "kernelm.webp"), quality=88, method=6)
    for name, (src, size) in FLAT.items():
        img = Image.open(f"{RAW}/{src}.png").convert("RGB").resize((size, size), Image.LANCZOS)
        img.save(os.path.join(OUT, f"{name}.webp"), quality=80, method=6)
        print(name, img.size)


if __name__ == "__main__":
    main()
