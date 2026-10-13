"""«Шёл солдат со службы»: поиск безномерных клеток (маленькие светлые кружки без цифры).

Разметку 140 пронумерованных клеток дал разбор (materials/nastolki/shumov/cells.json).
Остальные клетки — четыре участка поля: развилка у Распутья (4), обход Огненной реки (37/38),
круги Лешего (64/65) и круги Пастуха (133). На поле это светлые кружки без цифры; на развилке
и обходе часть кружков красные.

Как ищем: светлые связные области круглой формы (диаметр 46–60 px — у пронумерованных клеток
он 62–68), у которых ядро заметно светлее обводки. Так находятся все кружки обоих «кругов»
(Лешего и Пастуха) и часть клеток развилки; остальные на скане слиплись с соседними или попали
в рисунок — их координаты вписаны вручную по проверочной вырезке (--check).

Проверка: python tools/hodilki/shel-check.py (вырезки участков с рамками и номерами).

Запуск из lavochka/:
  python tools/hodilki/shel-cells.py            — пересобрать src/games/hodilki/data/shel-branches.json
  python tools/hodilki/shel-cells.py --check    — ещё и нарисовать вырезки участков
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(ROOT, 'materials', 'nastolki', 'shumov', 'field.webp')
CELLS = os.path.join(ROOT, 'materials', 'nastolki', 'shumov', 'cells.json')
OUT = os.path.join(ROOT, 'lavochka', 'src', 'games', 'hodilki', 'data', 'shel-branches.json')

# участок: имя, клетки вокруг которых ищем, радиус поиска
PARTS = [
    ('fork', [3, 4, 5], 700),
    ('river', [37, 38], 950),
    ('leshiy', [63, 64, 65, 66], 480),
    ('pastukh', [132, 133, 134], 430),
]
# отобранные глазами клетки участков (в порядке движения): координаты ядра кружка
KEEP = {
    # три дороги Распутья: b1 — 5 кружков от 4 до 5, b2 — 4 кружка, b3 — 5 кружков
    'fork': [
        (496, 2972), (605, 3010), (721, 3020), (834, 3014), (949, 2996),
        (511, 2885), (606, 2867), (799, 2872), (894, 2872),
        (510, 2886), (989, 2862), (1036, 2776), (858, 2708), (673, 2710), (591, 2753),
    ],
    # обход Огненной реки: восемь кружков от 38 до 37
    'river': [(1196, 2140), (1206, 2242), (1164, 2337), (1060, 2356), (962, 2324), (900, 2241), (894, 2138), (1166, 2042)],
    # круги Лешего: 11 кружков вокруг пня
    'leshiy': [
        (1231, 1160), (1303, 1157), (1362, 1195), (1230, 1351), (1184, 1292), (1184, 1218),
        (1056, 1202), (1022, 1272), (1028, 1346), (1050, 1420), (1108, 1469),
    ],
    # круги Пастуха: 7 кружков
    'pastukh': [(1804, 598), (1776, 532), (1792, 462), (1867, 444), (1933, 481), (1926, 556), (1878, 608)],
}
LO = 190  # ярче этого ядро безномерной клетки (замеры: 203…252)
DMIN, DMAX = 46, 60
MINPIX = 380


def blobs(mask):
    """Связные области маски: рамка и число пикселей (свой обход, без scipy)."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    ys, xs = np.nonzero(mask)
    out = []
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if seen[y0, x0]:
            continue
        stack = [(y0, x0)]
        seen[y0, x0] = True
        minx = maxx = x0
        miny = maxy = y0
        cnt = 0
        while stack:
            y, x = stack.pop()
            cnt += 1
            minx = min(minx, x)
            maxx = max(maxx, x)
            miny = min(miny, y)
            maxy = max(maxy, y)
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        out.append((minx, miny, maxx - minx + 1, maxy - miny + 1, cnt))
    return out


def detect(im):
    """Светлые круглые пятна с тёмной обводкой — кандидаты в безномерные клетки."""
    a = np.asarray(im, dtype=np.int16)
    bright = (a[:, :, 0] > LO) & (a[:, :, 1] > LO - 20) & (a[:, :, 2] > LO - 40)
    grey = a[:, :, 0] * 0.299 + a[:, :, 1] * 0.587 + a[:, :, 2] * 0.114
    hh, ww = grey.shape
    out = []
    for x, y, bw, bh, cnt in blobs(bright):
        if cnt < MINPIX or not (DMIN <= bw <= DMAX and DMIN <= bh <= DMAX):
            continue
        if abs(bw - bh) > 14 or cnt / (bw * bh) < 0.6:
            continue
        x0, x1 = max(0, x - 6), min(ww, x + bw + 6)
        y0, y1 = max(0, y - 6), min(hh, y + bh + 6)
        reg = grey[y0:y1, x0:x1]
        yy, xx = np.mgrid[y0:y1, x0:x1]
        cx, cy = x + bw / 2, y + bh / 2
        d = np.hypot(xx - cx, yy - cy)
        core = reg[d < bw * 0.3]
        ring = reg[(d > bw * 0.45) & (d < bw * 0.62)]
        if not core.size or not ring.size or float(core.mean()) - float(ring.mean()) < 45:
            continue
        out.append({'x': round(cx), 'y': round(cy), 'd': round((bw + bh) / 2), 'c': round(float(core.mean())), 'r': round(float(ring.mean()))})
    return out


def main():
    im = Image.open(SRC).convert('RGB')
    w, h = im.size
    numbered = json.load(open(CELLS, encoding='utf-8'))['cells']
    found = detect(im)
    known = [c for c in found if min(math.hypot(c['x'] - p['x'], c['y'] - p['y']) for p in numbered) <= 30]
    print(f'найдено кружков: {len(found)}, из них пронумерованных: {len(known)}, безномерных: {len(found) - len(known)}')
    for name, around, r in PARTS:
        pts = [p for p in numbered if p['n'] in around]
        near = [c for c in found if min(math.hypot(c['x'] - p['x'], c['y'] - p['y']) for p in pts) < r]
        kept = [c for c in KEEP[name] if any(math.hypot(c[0] - n['x'], c[1] - n['y']) < 40 for n in near)]
        print(f'{name}: в данных {len(KEEP[name])}, подтверждено поиском {len(kept)}')

    if '--check' in sys.argv:
        for name, around, r in PARTS:
            pts = [p for p in numbered if p['n'] in around] + [{'x': x, 'y': y} for x, y in KEEP[name]]
            xs = [p['x'] for p in pts]
            ys = [p['y'] for p in pts]
            pad = 260
            x0, x1 = max(0, min(xs) - pad), min(w, max(xs) + pad)
            y0, y1 = max(0, min(ys) - pad), min(h, max(ys) + pad)
            crop = im.crop((x0, y0, x1, y1))
            dr = ImageDraw.Draw(crop)
            for p in numbered:
                if not (x0 < p['x'] < x1 and y0 < p['y'] < y1):
                    continue
                dr.ellipse((p['x'] - x0 - 20, p['y'] - y0 - 20, p['x'] - x0 + 20, p['y'] - y0 + 20), outline=(0, 90, 255), width=4)
                dr.text((p['x'] - x0 + 22, p['y'] - y0 - 10), str(p['n']), fill=(0, 90, 255), stroke_width=2, stroke_fill=(255, 255, 255))
            for i, (x, y) in enumerate(KEEP[name], 1):
                dr.ellipse((x - x0 - 20, y - y0 - 20, x - x0 + 20, y - y0 + 20), outline=(230, 150, 0), width=4)
                dr.text((x - x0 + 22, y - y0 - 10), f'{name[0]}{i}', fill=(230, 120, 0), stroke_width=2, stroke_fill=(255, 255, 255))
            out = os.path.join(ROOT, 'lavochka', 'tools', 'hodilki', f'shel-check-{name}.webp')
            crop.save(out, quality=88, method=6)
            print('проверка:', out)
        return

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(
            {
                'note': 'Безномерные клетки «Шёл солдат со службы» (tools/hodilki/shel-cells.py): светлые кружки '
                        'без цифры, координаты в пикселях скана 2435×3094, порядок — вдоль участка. Разбивка '
                        'по дорогам — в коде поля (src/games/hodilki/shel.ts).',
                'parts': {k: [{'x': x, 'y': y} for x, y in v] for k, v in KEEP.items()},
            },
            f,
            ensure_ascii=False,
            indent=1,
        )
        f.write('\n')
    print('записано:', OUT)


if __name__ == '__main__':
    main()
