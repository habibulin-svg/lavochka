"""Проверка разметки «Шёл солдат со службы»: вырезки скана с найденными клетками и участками.

Запуск из lavochka/:  python tools/hodilki/shel-check.py
Кладёт tools/hodilki/shel-check-<участок>.webp: синие рамки — пронумерованные клетки (cells.json),
жёлтые — найденные безномерные (shel-branches.json), подписи — номера и порядок в участке.
"""
import json
import os
import sys

from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SRC = os.path.join(ROOT, 'materials', 'nastolki', 'shumov', 'field.webp')
CELLS = os.path.join(ROOT, 'materials', 'nastolki', 'shumov', 'cells.json')
BR = os.path.join(ROOT, 'lavochka', 'src', 'games', 'hodilki', 'data', 'shel-branches.json')

# участок: имя, входные клетки (по ним строится кадр)
# участок: имя кадра, ключи shel-branches.json, клетки ленты в кадре; круги (leshiy, pastukh) замкнуты
PARTS = [('fork', ['forkLow', 'forkMid', 'forkUp'], [3, 4, 5]), ('river', ['river'], [36, 37, 38]), ('leshiy', ['leshiy'], [63, 64, 65, 66]), ('pastukh', ['pastukh'], [132, 133, 134])]


def main():
    im = Image.open(SRC).convert('RGB')
    numbered = json.load(open(CELLS, encoding='utf-8'))['cells']
    br = json.load(open(BR, encoding='utf-8'))['parts'] if os.path.exists(BR) else {}
    for name, keys, entry in PARTS:
        pts = [p for p in numbered if p['n'] in entry]
        own = [c for k in keys for c in br.get(k, [])]
        xs = [p['x'] for p in pts] + [c['x'] for c in own]
        ys = [p['y'] for p in pts] + [c['y'] for c in own]
        pad = 260
        x0, x1 = max(0, min(xs) - pad), min(im.size[0], max(xs) + pad)
        y0, y1 = max(0, min(ys) - pad), min(im.size[1], max(ys) + pad)
        crop = im.crop((x0, y0, x1, y1))
        dr = ImageDraw.Draw(crop)

        def mark(x, y, col, text):
            dr.ellipse((x - x0 - 20, y - y0 - 20, x - x0 + 20, y - y0 + 20), outline=col, width=4)
            if text:
                dr.text((x - x0 + 22, y - y0 - 10), text, fill=col, stroke_width=2, stroke_fill=(255, 255, 255))

        for p in numbered:
            mark(p['x'], p['y'], (0, 90, 255), str(p['n']))
        for k in keys:
            road = br.get(k, [])
            # рёбра по ходу фишки: круг замкнут, дорога — цепочка
            pairs = list(zip(road, road[1:])) + ([(road[-1], road[0])] if k in ('leshiy', 'pastukh') else [])
            for a, b in pairs:
                dr.line((a['x'] - x0, a['y'] - y0, b['x'] - x0, b['y'] - y0), fill=(230, 60, 0), width=4)
            for i, c in enumerate(road):
                mark(c['x'], c['y'], (230, 180, 0), f'{k[-3:] if k.startswith("fork") else ""}{i + 1}')
        out = os.path.join(HERE, f'shel-check-{name}.webp')
        crop.save(out, quality=88, method=6)
        print(out, crop.size)


if __name__ == '__main__':
    sys.exit(main())
