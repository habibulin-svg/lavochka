"""«Конверсия» — три таблицы ввоза-вывоза из PnP (conversion-fields(x1).tif) → public/konversiya/track-*.webp
и src/games/konversiya/tracks.json (центры клеток по порядку: 0 — серая «0», последняя — красная, доли ширины/высоты).

Запуск: python tools/konversiya/tracks.py D:/temp/konv [--check]   (--check — наложение номеров в D:/temp/konv_pnp/)
Клетки — связные области цветной заливки (чёрные линии и цифры — не заливка). Порядок:
  короткая — два кольца рядом, поэтому по ломаной через центры полос (точки сняты с листа);
  средняя — косые столбцы разделены чёрными промежутками: следующая клетка дорожки — ближайшая из непройденных;
  длинная — прямые столбцы «змейкой»: первый сверху вниз, следующий снизу вверх и т. д."""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SRC = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 'D:/temp/konv'
CHECK = '--check' in sys.argv
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
OUT = os.path.join(ROOT, 'public', 'konversiya')
SCALE = 1.5

full = np.asarray(Image.open(os.path.join(SRC, 'conversion-fields(x1).tif')).convert('RGB')).astype(np.int16)
# полосы листа: между ними — белые линии
BANDS = {'short': (0, 322), 'medium': (326, 648), 'long': (652, 973)}


def cells_of(rgb, erode=0):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(2), rgb.min(2)
    colored = (mx - mn > 60) & (mx > 120)
    if erode:  # средняя: фиолетовый темнее, разделители бледнее — линия = темнее соседей
        lum = rgb.mean(2)
        colored = (mx - mn > 45) & (mx > 75) & (lum > 0.8 * ndi.maximum_filter(lum, 7))
    grey = (np.abs(r - g) < 18) & (np.abs(g - b) < 18) & (mx > 60) & (mx < 190)
    # сужение на 2 px: бледные разделительные линии иначе склеивают соседние клетки
    lab, n = ndi.label(colored | grey)
    out = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        m = lab[sl] == i
        area = m.sum()
        if area < 200:
            continue
        ys, xs = np.nonzero(m)
        cy, cx = ys.mean() + sl[0].start, xs.mean() + sl[1].start
        px = rgb[int(round(cy)) - 2:int(round(cy)) + 3, int(round(cx)) - 2:int(round(cx)) + 3]
        col = rgb[lab == i].mean(0)
        out.append({'x': cx, 'y': cy, 'area': int(area), 'col': col, 'lab': i})
    med = np.median([c['area'] for c in out])
    out = [c for c in out if c['area'] > 0.4 * med]  # осколки у скруглённых углов
    return out, lab


def kind(c):
    r, g, b = c['col']
    if max(r, g, b) - min(r, g, b) < 30 and max(r, g, b) > 55:
        return 'grey'
    if r > 180 and g < 90 and b < 90:
        return 'red'
    return 'c'


def order_poly(cells, pts):
    pts = np.array(pts, float)
    seg = pts[1:] - pts[:-1]
    L = np.hypot(seg[:, 0], seg[:, 1])
    cum = np.concatenate([[0], np.cumsum(L)])

    def t_of(c):
        p = np.array([c['x'], c['y']])
        best = (1e9, 0)
        for k in range(len(seg)):
            u = np.clip(np.dot(p - pts[k], seg[k]) / L[k] ** 2, 0, 1)
            d = np.hypot(*(pts[k] + u * seg[k] - p))
            if d < best[0]:
                best = (d, cum[k] + u * L[k])
        return best[1]

    return sorted(cells, key=t_of)


def order_touch(cells, lab):
    # соседство: области касаются через тонкую чёрную линию (раздуваем на 3 px)
    idx = {c['lab']: c for c in cells}
    grown = {}
    for c in cells:
        grown[c['lab']] = ndi.binary_dilation(lab == c['lab'], iterations=4)
    adj = {c['lab']: set() for c in cells}
    for a in cells:
        ga = grown[a['lab']]
        for b in cells:
            if b['lab'] <= a['lab'] or abs(a['x'] - b['x']) > 90 or abs(a['y'] - b['y']) > 90:
                continue
            if (ga & grown[b['lab']]).sum() > 25:
                adj[a['lab']].add(b['lab'])
                adj[b['lab']].add(a['lab'])
    start = next(c for c in cells if kind(c) == 'grey')
    path = [start['lab']]
    seen = {start['lab']}
    while True:
        nxt = [x for x in adj[path[-1]] if x not in seen]
        if not nxt:
            break
        if len(nxt) > 1:
            # развилка (касание углами): ближайшая
            p = idx[path[-1]]
            nxt.sort(key=lambda x: np.hypot(idx[x]['x'] - p['x'], idx[x]['y'] - p['y']))
        path.append(nxt[0])
        seen.add(nxt[0])
    if len(path) != len(cells):
        print('  !! touch-путь прошёл', len(path), 'из', len(cells))
    return [idx[x] for x in path]


def order_near(cells):
    start = next(c for c in cells if kind(c) == 'grey')
    path, rest = [start], [c for c in cells if c is not start]
    while rest:
        p = path[-1]
        rest.sort(key=lambda c: np.hypot(c['x'] - p['x'], c['y'] - p['y']))
        path.append(rest.pop(0))
    return path


def order_snake(cells):
    start = next(c for c in cells if kind(c) == 'grey')
    end = next(c for c in cells if kind(c) == 'red')
    rest = sorted([c for c in cells if c is not start and c is not end], key=lambda c: c['x'])
    cols, cur = [], [rest[0]]
    for c in rest[1:]:
        if c['x'] - np.mean([q['x'] for q in cur]) > 22:
            cols.append(cur)
            cur = [c]
        else:
            cur.append(c)
    cols.append(cur)
    out = [start]
    for k, col in enumerate(cols):
        out += sorted(col, key=lambda c: c['y'], reverse=k % 2 == 1)
    return out + [end]


# короткая: ломаная через центры полос (координаты листа)
SHORT_PATH = [(914, 57), (1255, 57), (1300, 62), (1352, 86), (1388, 135), (1388, 190), (1352, 242), (1300, 268), (360, 268),
              (308, 240), (276, 187), (276, 132), (308, 80), (356, 57), (743, 57), (787, 62), (830, 78), (870, 95), (913, 99),
              (1290, 101), (1330, 135), (1336, 185), (1298, 222), (1253, 226), (405, 226), (358, 216), (322, 183), (322, 135),
              (356, 102), (745, 99)]
EXPECT = {'short': 101, 'medium': 127, 'long': 192}

data = {}
for name, (y0, y1) in BANDS.items():
    rgb = full[y0:y1]
    cells, lab = cells_of(rgb, 1 if name == 'medium' else 0)
    # обрезка по клеткам с полями
    xs = [c['x'] for c in cells]
    ys = [c['y'] for c in cells]
    ys_m, xs_m = np.nonzero(lab > 0)
    bx0, bx1 = max(0, xs_m.min() - 14), min(rgb.shape[1], xs_m.max() + 15)
    by0, by1 = max(0, ys_m.min() - 14), min(rgb.shape[0], ys_m.max() + 15)
    if name == 'short':
        for c in cells:
            c['y'] += y0  # ломаная — в координатах листа
        cells = order_poly(cells, SHORT_PATH)
        for c in cells:
            c['y'] -= y0
    elif name == 'medium':
        cells = order_near(cells)
    else:
        cells = order_snake(cells)
    print(name, 'клеток', len(cells), 'ждали', EXPECT[name], '| первая', kind(cells[0]), 'последняя', kind(cells[-1]))
    w, h = bx1 - bx0, by1 - by0
    im = Image.fromarray(rgb[by0:by1, bx0:bx1].astype(np.uint8))
    im = im.resize((round(w * SCALE), round(h * SCALE)), Image.LANCZOS)
    im.save(os.path.join(OUT, f'track-{name}.webp'), quality=88, method=6)
    data[name] = {'w': int(w), 'h': int(h), 'cells': [[round((c['x'] - bx0) / w, 4), round((c['y'] - by0) / h, 4)] for c in cells]}
    if CHECK:
        from PIL import ImageDraw
        big = im.resize((im.width * 2, im.height * 2))
        d = ImageDraw.Draw(big)
        for k, c in enumerate(cells):
            x, y = (c['x'] - bx0) * SCALE * 2, (c['y'] - by0) * SCALE * 2
            d.ellipse([x - 13, y - 13, x + 13, y + 13], fill='white')
            d.text((x - 9, y - 6), str(k), fill='black')
        big.save(f'D:/temp/konv_pnp/check-{name}.png')

with open(os.path.join(ROOT, 'src', 'games', 'konversiya', 'tracks.json'), 'w', encoding='utf-8') as f:
    json.dump(data, f, separators=(',', ':'))
print('ok')
