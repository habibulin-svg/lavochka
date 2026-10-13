"""Где на скане напечатаны розовые квадраты жетонов и совпадают ли с ними координаты из разметки.

Розовые квадраты — плоские пятна малинового цвета. Ищем их пятнами, считаем центры и сравниваем
с координатами клеток-жетонов из path.json: если разметка ставит координату в угол квадрата, это видно.

Запуск:  python -I tools/hodilki/star-squares.py    (отчёт в %TEMP%/star-squares.txt)
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(ROOT, 'materials', 'nastolki', 'zvezda-afriki')
MIN_AREA = 2500


def main():
    d = json.load(open(os.path.join(SRC, 'path.json'), encoding='utf8'))
    cells = d['cells']
    im = Image.open(os.path.join(SRC, 'field.webp')).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    pink = (r > 190) & (b > 90) & (g < 120) & (r - g > 90)
    # пятна: помечаем строки/столбцы и растим волной по сетке (грубо, шагом 4 px)
    small = pink[::4, ::4]
    seen = np.zeros_like(small)
    boxes = []
    ys, xs = np.nonzero(small)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        stack = [(y0, x0)]
        seen[y0, x0] = True
        pts = []
        while stack:
            y, x = stack.pop()
            pts.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < small.shape[0] and 0 <= nx < small.shape[1] and small[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if len(pts) * 16 < MIN_AREA:
            continue
        py = [p[0] for p in pts]
        px = [p[1] for p in pts]
        boxes.append((min(px) * 4, min(py) * 4, max(px) * 4 + 4, max(py) * 4 + 4))
    tokens = [c for c in cells if c.get('kind') == 'token']
    out = ['пятен найдено: %d, клеток-жетонов: %d' % (len(boxes), len(tokens)), '']
    draw = ImageDraw.Draw(im)
    for c in tokens:
        best, bd = None, 1e9
        for bx0, by0, bx1, by1 in boxes:
            cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
            dd = ((cx - c['x']) ** 2 + (cy - c['y']) ** 2) ** 0.5
            if dd < bd:
                bd, best = dd, (bx0, by0, bx1, by1, cx, cy)
        if not best:
            out.append('%s — квадрата рядом нет' % c['id'])
            continue
        bx0, by0, bx1, by1, cx, cy = best
        w, h = bx1 - bx0, by1 - by0
        out.append('%s: разметка (%d,%d), квадрат %dx%d центр (%d,%d), сдвиг %.0f px'
                   % (c['id'], c['x'], c['y'], w, h, cx, cy, bd))
        draw.rectangle([c['x'] - 8, c['y'] - 8, c['x'] + 8, c['y'] + 8], outline=(0, 255, 255), width=4)
        draw.rectangle([cx - 8, cy - 8, cx + 8, cy + 8], outline=(0, 0, 255), width=4)
    p = os.path.join(os.environ['TEMP'], 'star-squares.txt')
    open(p, 'w', encoding='utf8').write('\n'.join(out))
    print(p, '| пятен:', len(boxes))


if __name__ == '__main__':
    main()
