"""«Корона Эмбера» — граф дорог поля 1.

Дороги на поле нарисованы светлыми полосами между клетками; в данных их нет, а движку нужен
список соседей для каждой клетки. Делаем как для «Джио-Джанги»:
 1. маска дорог на уменьшенной копии поля (по светлоте);
 2. волна (BFS) от каждой клетки по маске — расстояния вдоль дорог;
 3. ребро между клетками, если путь по дороге близок к прямой (не длиннее 1.35 от прямой);
 4. отсечение хорд: если между парой стоит третья клетка почти на том же пути, ребро убираем;
 5. сшивка компонент по ближайшим клеткам (чтобы граф был связным).

Пишем: lavochka/src/games/korona/roads.json и картинку для проверки глазами
tools/korona/roads-check.webp
Запуск из lavochka/:  python -I tools/korona/roads.py
"""
import json
import os
from collections import deque

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DATA = os.path.join(ROOT, 'lavochka', 'src', 'games', 'korona', 'data.json')
FIELD = os.path.join(ROOT, 'lavochka', 'public', 'korona', 'field1.webp')
OUT = os.path.join(ROOT, 'lavochka', 'src', 'games', 'korona', 'roads.json')
CHECK = os.path.join(ROOT, 'lavochka', 'tools', 'korona', 'roads-check.webp')
SCALE = 150 / 72
DOWN = 4


def main():
    data = json.load(open(DATA, encoding='utf8'))
    cells = [c for c in data['cells'] if not c.get('panel')]
    im = Image.open(FIELD).convert('RGB')
    small = im.resize((im.width // DOWN, im.height // DOWN), Image.LANCZOS)
    a = np.asarray(small).astype(np.int16)
    # «дорога» — светлые полосы: и светлые, и малонасыщенные пиксели
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    light = (mx > 150) & ((mx - mn) < 55)
    print('доля светлых пикселей: %.3f' % light.mean())
    h, w = light.shape
    # координаты клеток в уменьшенном масштабе
    pts = []
    for c in cells:
        x = int((c['x'] + c['w'] / 2) * SCALE / DOWN)
        y = int((c['y'] + c['h'] / 2) * SCALE / DOWN)
        pts.append((min(max(x, 0), w - 1), min(max(y, 0), h - 1)))
    # волна от каждой клетки: расстояние по дороге (8 направлений, шаг 1/1.414)
    dist = {}
    for i, (sx, sy) in enumerate(pts):
        d = np.full((h, w), -1.0, dtype=np.float32)
        d[sy, sx] = 0.0
        q = deque([(sx, sy)])
        while q:
            x, y = q.popleft()
            base = d[y, x]
            for dx, dy, step in ((1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0), (1, 1, 1.414), (1, -1, 1.414), (-1, 1, 1.414), (-1, -1, 1.414)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and light[ny, nx] and d[ny, nx] < 0:
                    d[ny, nx] = base + step
                    q.append((nx, ny))
        dist[i] = d
    euclid = np.zeros((len(pts), len(pts)))
    road = np.zeros((len(pts), len(pts)))
    for i, (x1, y1) in enumerate(pts):
        for j, (x2, y2) in enumerate(pts):
            euclid[i, j] = ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5
            d = dist[i][y2, x2]
            road[i, j] = d if d > 0 else 1e9
    # кандидаты: по дороге не длиннее 1.35 прямой и не больше 130 px (в уменьшенном масштабе)
    edges = set()
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            e = euclid[i, j]
            r = road[i, j]
            if e < 1 or r > 1.35 * e or r > 130:
                continue
            edges.add((i, j))
    # отсечение хорд: третья клетка почти на том же пути
    drop = set()
    for i, j in list(edges):
        for k in range(len(pts)):
            if k == i or k == j:
                continue
            if abs(road[i, k] + road[k, j] - road[i, j]) < 0.15 * road[i, j] and euclid[i, k] > 2 and euclid[k, j] > 2:
                drop.add((i, j))
                break
    edges -= drop
    # сшивка компонент по ближайшим клеткам
    parent = list(range(len(pts)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, j in edges:
        parent[find(i)] = find(j)
    bridges = []
    comps = {}
    for i in range(len(pts)):
        comps.setdefault(find(i), []).append(i)
    order = sorted(comps.values(), key=len, reverse=True)
    for a_comp in order[1:]:
        best = None
        for i in a_comp:
            for j in order[0]:
                d = euclid[i, j]
                if best is None or d < best[0]:
                    best = (d, i, j)
        if best:
            bridges.append((best[1], best[2]))
            for k in a_comp:
                parent[find(k)] = find(order[0][0])
            order[0] = order[0] + a_comp
    edges |= set(bridges)
    neigh = {cells[i]['n']: sorted(cells[j]['n'] for a, b in edges for i, j in ((a, b), (b, a)) if i == cells.index(cells[i]) and False) for i in range(len(cells))}
    # собираем аккуратно: номер клетки -> соседи
    by_index = {}
    for a, b in edges:
        by_index.setdefault(a, set()).add(b)
        by_index.setdefault(b, set()).add(a)
    neigh = {cells[i]['n']: sorted(cells[j]['n'] for j in by_index.get(i, ())) for i in range(len(cells))}
    json.dump({'note': 'Соседи клеток поля 1 по дорогам (построено tools/korona/roads.py).', 'neigh': neigh},
              open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    # картинка для проверки
    chk = small.copy()
    dr = ImageDraw.Draw(chk)
    for a, b in edges:
        dr.line([pts[a], pts[b]], fill=(255, 0, 0), width=2)
    for x, y in pts:
        dr.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(0, 90, 255), width=2)
    chk.save(CHECK, 'WEBP', quality=85, method=6)
    deg = [len(v) for v in neigh.values()]
    print('клеток %d | рёбер %d | мостов %d | степень: %.2f (мин %d, макс %d)' % (len(cells), len(edges), len(bridges), sum(deg) / len(deg), min(deg), max(deg)))
    print('записано:', OUT)


if __name__ == '__main__':
    main()
