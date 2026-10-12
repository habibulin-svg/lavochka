"""Корпус Brick Game из картинки пользователя (materials/brick/brick2.webp, голубой «9999 in 1»):
перекрасить в серый пластик как у E-23 по фото, стереть нарисованное на ЖК (там будет эмулятор)
и надписи у кнопок (подпишем по-настоящему, как в прошивке E-23), низ с логотипом отрезать.

  python tools/brick/case.py   →  public/brick/case.webp
"""
import colorsys
import os

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SRC = os.path.join(ROOT, 'materials', 'brick', 'brick2.webp')
OUT = os.path.join(ROOT, 'lavochka', 'public', 'brick', 'case.webp')

CUT = 940          # ниже — логотип и полоски, не нужны
SCALE = 2          # исходник узкий (488), на сайте — до ~600 px CSS: удваиваем
LCD = (112, 66, 377, 409)  # окно ЖК в исходнике (с запасом)
LABELS = [          # надписи у кнопок, которые стираем: (x0, y0, x1, y1)
    (95, 639, 400, 660, 'h'),  # PAUSE SOUND THEME RESET (между кнопками — слева направо)
    (168, 712, 262, 736),    # UP/MODE
    (36, 834, 96, 868),      # LEFT SPEED
    (168, 834, 228, 868),    # RIGHT LEVEL
    (100, 892, 166, 926),    # DOWN MODE
    (338, 850, 434, 894),    # ROTATE DIRECTION
]

im = Image.open(SRC).convert('RGB')
a = np.asarray(im).astype(np.float32) / 255
h, w, _ = a.shape
hsv = np.zeros_like(a)
mx = a.max(2)
mn = a.min(2)
sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
# голубой пластик: синий канал главный, насыщенность заметная
blue = (a[..., 2] >= a[..., 0]) & (a[..., 2] >= a[..., 1] - 0.02) & (sat > 0.18)
lum = 0.30 * a[..., 0] + 0.59 * a[..., 1] + 0.11 * a[..., 2]
# яркость пластика: светлое голубое (~0.72) → светло-серое (~0.86), тени сохраняются
g = np.clip(0.35 + lum * 0.72, 0, 1)
tint = np.array([1.0, 0.982, 0.948], dtype=np.float32)
grey = g[..., None] * tint
out = np.where(blue[..., None], grey, a)

# чёрные надписи/кирпичики стали бы чёрными на сером — кирпичики у экрана тёмно-зелёные, как на E-23
dark = (mx < 0.35) & (sat < 0.5)
side = np.zeros_like(dark)
side[30:440, :100] = True
side[30:440, 390:] = True
green = np.array([0.18, 0.36, 0.24], dtype=np.float32)
k = np.clip((0.35 - mx) / 0.35, 0, 1)[..., None]
out = np.where((dark & side)[..., None], out * (1 - k) + green * k + out * 0, out)

img = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))

def heal(img, box):
    """Закрасить прямоугольник пластиком: по столбцам — плавно от верхнего края к нижнему ('h' — по строкам)."""
    x0, y0, x1, y1 = box[:4]
    px = img.load()
    if len(box) > 4:
        for y in range(y0, y1):
            l = np.array(px[x0 - 2, y], dtype=float)
            r = np.array(px[x1 + 1, y], dtype=float)
            for x in range(x0, x1):
                t = (x - x0) / max(1, x1 - x0)
                px[x, y] = tuple(int(v) for v in l * (1 - t) + r * t)
        return
    for x in range(x0, x1):
        t0 = np.array(px[x, y0 - 2], dtype=float)
        b0 = np.array(px[x, y1 + 1], dtype=float)
        for y in range(y0, y1):
            t = (y - y0) / max(1, y1 - y0)
            px[x, y] = tuple(int(v) for v in t0 * (1 - t) + b0 * t)

for b in LABELS:
    heal(img, b)

# ЖК — ровный серо-зелёный, нарисованное убираем (сетку «призраков» даст эмулятор)
x0, y0, x1, y1 = LCD
lcd = Image.new('RGB', (x1 - x0, y1 - y0), (163, 171, 148))
grad = Image.linear_gradient('L').resize((x1 - x0, y1 - y0))
lcd2 = Image.new('RGB', lcd.size, (148, 157, 134))
img.paste(Image.composite(lcd, lcd2, grad), (x0, y0))

img = img.crop((0, 0, w, CUT))
img = img.resize((w * SCALE, CUT * SCALE), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
# низ — мягко в прозрачность (корпус уходит за край)
alpha = Image.new('L', img.size, 255)
fade = 40 * SCALE
ap = alpha.load()
for y in range(img.size[1] - fade, img.size[1]):
    v = int(255 * (img.size[1] - y) / fade)
    for x in range(img.size[0]):
        ap[x, y] = v
img.putalpha(alpha)
img.save(OUT, 'WEBP', quality=88)
print(OUT, img.size, os.path.getsize(OUT) // 1024, 'КБ')
