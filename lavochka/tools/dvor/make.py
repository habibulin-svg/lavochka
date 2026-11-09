"""Фон двора: картинка (Z-Image, studio/jobs/site/02-dvor.yaml) → public/dvor/*.webp и src/launcher/dvor-data.ts.

Слой анимаций лежит поверх картинки в её координатах, поэтому окна, телевизор, звёзды и фонарь ищутся на ней самой:
  - горящие окна — тёплые яркие пятна оконного размера (часть из них иногда гаснет);
  - телевизор — самое крупное ярко-синее пятно;
  - звёзды — точки на ровном тёмном небе (в верхней части, где нет зданий и деревьев);
  - фонарь — задаётся вручную (--lamp x,y,r), по картинке его не отличить от окна.

Запуск — питоном с numpy и scipy (они есть в venv ComfyUI):
  G:/ai/ComfyUI/venv/Scripts/python.exe tools/dvor/make.py G:/temp/studio/out/site/02-dvor/dvor-c-222.png --lamp 730,545,90
"""
import argparse
import json
import random
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/dvor'

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('--lamp', required=True, help='x,y,r ореола фонаря в пикселях картинки')
ap.add_argument('--windows', type=int, default=14, help='сколько окон иногда гаснет')
ap.add_argument('--stars', type=int, default=70)
ap.add_argument('--keep', type=float, default=1.0, help='оставить эту долю высоты сверху (низ — пустой асфальт, его всё равно закрывают гаражи)')
ap.add_argument('--sky', type=float, default=0.42, help='звёзды — только выше этой доли высоты')
a = ap.parse_args()

img = Image.open(a.src).convert('RGB')
img = img.crop((0, 0, img.width, round(img.height * a.keep)))
W, H = img.size
px = np.asarray(img).astype(np.int16)
R, G, B = px[..., 0], px[..., 1], px[..., 2]
lx, ly, lr = (int(v) for v in a.lamp.split(','))
rnd = random.Random(1993)


def blobs(mask, amin, amax):
    lab, n = ndimage.label(mask)
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        if sl is None:
            continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        w, h = x1 - x0, y1 - y0
        area = int((lab[sl] == i).sum())
        if not (amin <= area <= amax) or area < 0.55 * w * h or not (0.35 <= w / h <= 2.2):
            continue
        out.append((x0, y0, w, h, area))
    return out


# горящие окна: тёплые яркие пятна, не у фонаря
warm = (R > 170) & (G > 105) & (B < 170) & (R - B > 50)
wins = [b for b in blobs(ndimage.binary_closing(warm, iterations=3), 150, 6000) if (b[0] + b[2] / 2 - lx) ** 2 + (b[1] + b[3] / 2 - ly) ** 2 > (lr * 1.4) ** 2]
rnd.shuffle(wins)
wins = sorted(wins[: a.windows], key=lambda b: (b[1], b[0]))

# телевизор: крупнейшее ярко-синее пятно
blue = ndimage.binary_closing((B > 140) & (B - R > 45) & (B - G > 10), iterations=3)
tvs = sorted(blobs(blue, 60, 8000), key=lambda b: -b[4])
tv = list(tvs[0][:4]) if tvs else None

# звёзды: ровное тёмное небо (малый разброс яркости вокруг), синее, чем красное
lum = (R * 0.3 + G * 0.59 + B * 0.11).astype(np.float32)
mean = ndimage.uniform_filter(lum, 15)
var = ndimage.uniform_filter(lum * lum, 15) - mean * mean
sky = (var < 9) & (B - G > 22) & (lum < 130)  # небо сиренево-синее, стены серые
ys, xs = np.nonzero(sky[: int(H * a.sky)])
stars = []
for _ in range(20000):
    if len(stars) >= a.stars or len(xs) == 0:
        break
    k = rnd.randrange(len(xs))
    x, y = int(xs[k]), int(ys[k])
    if all((x - sx) ** 2 + (y - sy) ** 2 > 60 ** 2 for sx, sy, _r in stars):
        stars.append((x, y, round(rnd.uniform(0.9, 2.2), 1)))

OUT.mkdir(parents=True, exist_ok=True)
img.save(OUT / 'dvor.webp', 'WEBP', quality=80, method=6)
img.resize((W // 2, H // 2), Image.LANCZOS).save(OUT / 'dvor-s.webp', 'WEBP', quality=80, method=6)
data = {'w': W, 'h': H, 'lamp': [lx, ly, lr], 'tv': tv, 'windows': [list(b[:4]) for b in wins], 'stars': [list(s) for s in stars]}
(ROOT / 'src/launcher/dvor-data.ts').write_text(
    '/* Фон двора: размер картинки и что на ней оживает (окна, телевизор, звёзды, фонарь). Создаёт tools/dvor/make.py — руками не править. */\n'
    f'export const DVOR = {json.dumps(data, ensure_ascii=False)} as const;\n',
    encoding='utf-8',
)
print(f'{W}x{H}: окон {len(wins)} (всего тёплых {len(blobs(warm, 150, 6000))}), телевизор {tv}, звёзд {len(stars)}')
