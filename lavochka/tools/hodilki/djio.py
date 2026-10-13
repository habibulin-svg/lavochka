"""«Чудовище Джио-Джанги» — граф поля: 154 точки на белой ленте, связи по дороге.

Как и в «Звезде Африки», поле — лента с точками и развилками. Связи ищем волной по маске ленты:
для каждой пары точек считаем расстояние ВДОЛЬ дороги и берём те, что соединены напрямую (между
ними нет третьей точки на той же дороге).

Пишем: materials/nastolki/djio-djanga/graph.json (клетки с next) и check-2.webp (проверка глазами).

Запуск из lavochka/:  python -I tools/hodilki/djio.py
"""
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(ROOT, 'materials', 'nastolki', 'djio-djanga')
SCALE = 4
NEAR = 420.0      # какие пары вообще проверяем (пиксели поля)
K = 1.45          # допуск «вдоль дороги не дальше, чем K × по прямой»
TOL = 60.0        # третья точка «между» — если geo(a,c)+geo(c,b) ≤ geo(a,b)+TOL


def ribbon_mask(im):
    """Лента дороги — белая. Точки (цветные кружки) тоже считаем проходимыми."""
    a = np.asarray(im.convert('RGB')).astype(np.int16)
    mn = a.min(axis=2)
    mx = a.max(axis=2)
    white = (mn > 165) & ((mx - mn) < 60)
    grow = white.copy()
    # лента нарисована отдельными белыми квадратиками с чёрной обводкой: расширяем маску,
    # чтобы волна перешагивала обводку между квадратиками (пути друг от друга далеко — не склеятся)
    for _ in range(6):
        g = grow.copy()
        g[1:, :] |= grow[:-1, :]
        g[:-1, :] |= grow[1:, :]
        g[:, 1:] |= grow[:, :-1]
        g[:, :-1] |= grow[:, 1:]
        grow = g
    return grow


def wave(mask, cx, cy, rad):
    y0, y1 = max(0, cy - rad), min(mask.shape[0], cy + rad + 1)
    x0, x1 = max(0, cx - rad), min(mask.shape[1], cx + rad + 1)
    sub = mask[y0:y1, x0:x1]
    seen = np.zeros_like(sub)
    ys, xs = np.nonzero(sub)
    if not len(ys):
        return None, (0, 0)
    d = (ys - (cy - y0)) ** 2 + (xs - (cx - x0)) ** 2
    i = int(np.argmin(d))
    seen[ys[i], xs[i]] = True
    dist = np.zeros_like(sub, dtype=np.int16)
    step = 0
    while step < rad * 3:
        step += 1
        g = np.zeros_like(seen)
        g[1:, :] |= seen[:-1, :]
        g[:-1, :] |= seen[1:, :]
        g[:, 1:] |= seen[:, :-1]
        g[:, :-1] |= seen[:, 1:]
        g[1:, 1:] |= seen[:-1, :-1]
        g[:-1, :-1] |= seen[1:, 1:]
        g[1:, :-1] |= seen[:-1, 1:]
        g[:-1, 1:] |= seen[1:, :-1]
        g &= sub
        g &= ~seen
        if not g.any():
            break
        dist[g] = step
        seen |= g
    return dist, (y0, x0)


def main():
    pts = json.load(open(os.path.join(SRC, 'points.json'), encoding='utf8'))
    pts = pts if isinstance(pts, list) else pts['points']
    im = Image.open(os.path.join(SRC, 'field.webp')).convert('RGB')
    W, H = im.size
    small = im.resize((W // SCALE, H // SCALE), Image.BOX)
    mask = ribbon_mask(small)
    # кружки точек перекрывают ленту — считаем их проходимыми, иначе волна не пройдёт между точками
    dots = Image.new('L', (W // SCALE, H // SCALE), 0)
    dd = ImageDraw.Draw(dots)
    for p in pts:
        x, y = p['x'] / SCALE, p['y'] / SCALE
        r = 24 / SCALE + 1
        dd.ellipse([x - r, y - r, x + r, y + r], fill=255)
    mask = mask | (np.asarray(dots) > 0)
    # окно волны — весь радиус поиска: дорога виляет, и вдоль неё путь заметно длиннее прямой
    rad = int(NEAR / SCALE) + 4
    geo = {}
    for i, p in enumerate(pts):
        dist, (y0, x0) = wave(mask, int(p['x'] / SCALE), int(p['y'] / SCALE), rad)
        if dist is None:
            continue
        row = {}
        for j, q in enumerate(pts):
            if i == j:
                continue
            eu = math.hypot(q['x'] - p['x'], q['y'] - p['y'])
            if eu > NEAR or eu < 1:
                continue
            ox, oy = int(q['x'] / SCALE) - x0, int(q['y'] / SCALE) - y0
            if not (0 <= ox < dist.shape[1] and 0 <= oy < dist.shape[0]):
                continue
            # кружок точки шире самой ленты и перекрывает дорогу: волна обходит его стороной,
            # поэтому «дошли до точки» проверяем в окне радиусом с сам кружок
            near = dist[max(0, oy - 9):oy + 10, max(0, ox - 9):ox + 10]
            vals = near[near > 0]
            if len(vals):
                row[j] = float(vals.min()) * SCALE
        geo[i] = row
    edges = set()
    for i, row in geo.items():
        for j, g in row.items():
            eu = math.hypot(pts[j]['x'] - pts[i]['x'], pts[j]['y'] - pts[i]['y'])
            if g > K * eu:
                continue
            # если третья точка лежит на той же дороге между ними — это не прямое ребро
            between = False
            for k, gik in geo.get(i, {}).items():
                if k == j:
                    continue
                gkj = geo.get(k, {}).get(j)
                if gkj is None:
                    continue
                if gik + gkj <= g + TOL:
                    between = True
                    break
            if not between:
                edges.add(frozenset((i, j)))
    # сшивка разорванных кусков: лента рвётся у кружков, домиков и обводок — соединяем куски
    # по ближайшим клеткам разных кусков (каждый мост печатаем, чтобы можно было проверить глазами)
    def components(edges):
        par = list(range(len(pts)))

        def find(x):
            while par[x] != x:
                par[x] = par[par[x]]
                x = par[x]
            return x

        for e in edges:
            a, b = sorted(e)
            ra, rb = find(a), find(b)
            if ra != rb:
                par[ra] = rb
        return {i: find(i) for i in range(len(pts))}

    bridges = []
    while True:
        comp = components(edges)
        groups = {}
        for i, r in comp.items():
            groups.setdefault(r, []).append(i)
        if len(groups) <= 1:
            break
        # самый большой кусок — главный; к нему и подшиваем остальные
        main = max(groups.values(), key=len)
        best = None
        for r, cells in groups.items():
            if cells is main:
                continue
            for i in cells:
                for j in main:
                    d = (pts[i]['x'] - pts[j]['x']) ** 2 + (pts[i]['y'] - pts[j]['y']) ** 2
                    if best is None or d < best[0]:
                        best = (d, i, j)
        if not best:
            break
        _, i, j = best
        edges.add(frozenset((i, j)))
        bridges.append((pts[i]['n'], pts[j]['n'], round(best[0] ** 0.5)))
    # клетки и соседи
    adj = {i: [] for i in range(len(pts))}
    for e in edges:
        a, b = sorted(e)
        adj[a].append(b)
        adj[b].append(a)
    lone = [i for i in range(len(pts)) if not adj[i]]
    cells = [
        {'n': p['n'], 'x': p['x'], 'y': p['y'], 'type': p['type'], 'next': sorted(adj[i])}
        for i, p in enumerate(pts)
    ]
    out = {
        'field': {'w': W, 'h': H, 'src': 'materials/nastolki/djio-djanga/field.webp'},
        'cells': cells,
    }
    json.dump(out, open(os.path.join(SRC, 'graph.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    # данные для игры: клетки с типом и связями (карточки, снаряжение и звери лежат рядом, в rules.json)
    game = {
        'w': W,
        'h': H,
        'cells': [
            {'n': c['n'], 'x': c['x'], 'y': c['y'], 'kind': c['type'], 'next': c['next']}
            for c in cells
        ],
    }
    dst = os.path.join(ROOT, 'lavochka', 'src', 'games', 'djio')
    os.makedirs(dst, exist_ok=True)
    json.dump(game, open(os.path.join(dst, 'data.json'), 'w', encoding='utf8'), ensure_ascii=False)
    print('данные игры: %s' % os.path.join(dst, 'data.json'))
    # проверка глазами: линии связей поверх уменьшенного поля
    chk = im.copy()
    dr = ImageDraw.Draw(chk)
    for e in edges:
        a, b = sorted(e)
        dr.line([pts[a]['x'], pts[a]['y'], pts[b]['x'], pts[b]['y']], fill=(0, 200, 0), width=6)
    for i, p in enumerate(pts):
        col = (255, 0, 255) if not adj[i] else (255, 0, 0) if len(adj[i]) == 1 else (0, 0, 255)
        dr.ellipse([p['x'] - 22, p['y'] - 22, p['x'] + 22, p['y'] + 22], outline=col, width=8)
    chk.resize((1200, int(1200 * H / W)), Image.LANCZOS).save(os.path.join(SRC, 'check-graph.webp'))
    deg = {}
    for i in range(len(pts)):
        deg[len(adj[i])] = deg.get(len(adj[i]), 0) + 1
    print('мостов добавлено %d: %s' % (len(bridges), bridges[:12]))
    print('точек %d, связей %d, без связей %d (номера: %s)' % (len(pts), len(edges), len(lone), lone[:20]))
    print('сколько точек с какой степенью:', dict(sorted(deg.items())))


if __name__ == '__main__':
    main()
