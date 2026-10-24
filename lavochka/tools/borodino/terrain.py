"""«Бородино»: разметка поля для игры (src/games/borodino/terrain.ts) по карте пользователя map.jpg (9685×6418) и признакам клеток.
Решётка гексов (D:/temp/bor/grid.json) подогнана к линиям сетки; уровень местности — по цвету клетки (белый — низина, жёлтый — средний,
оранжевый — возвышенность), лес — по зелёному, реки — по синему на сторонах; дороги, деревни, редуты — terrain_src.py."""
import json, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from terrain_src import ROADS, VILLAGES, REDOUBTS, SHRUB
W = 'D:/temp/bor/'
d = json.load(open(W + 'hexraw.json')); sd = json.load(open(W + 'sides.json')); g = json.load(open(W + 'grid.json'))
def nb(c, r):
    out = [(c, r - 1), (c, r + 1)]
    out += [(c - 1, r - 1), (c - 1, r), (c + 1, r - 1), (c + 1, r)] if c % 2 == 1 else [(c - 1, r), (c - 1, r + 1), (c + 1, r), (c + 1, r + 1)]
    return [f'{a:02d}{b:02d}' for a, b in out]
road = set(); bad = []
for line in ROADS:
    hs = line.split()
    for a, b in zip(hs, hs[1:]):
        if b not in nb(int(a[:2]), int(a[2:])): bad.append((a, b))
        road.add(tuple(sorted((a, b))))
if bad: print('не соседи:', bad)
river = set(tuple(k.split('-')) for k, v in sd.items() if v['river'] > 0.04)
c0, r0, c1, r1 = SHRUB
hexes = {}
for k, v in d.items():
    c, r = v['c'], v['r']
    t = 'clear'
    if v['F']: t = 'shrub' if c0 <= c <= c1 and r0 <= r <= r1 else 'forest'
    for n, ks in VILLAGES.items():
        if k in ks: t = 'village'
    hexes[k] = dict(L=v['L'], t=t)
out = dict(grid=g, hexes=hexes, road=sorted('-'.join(p) for p in road), river=sorted('-'.join(p) for p in river), villages=VILLAGES, redoubts=REDOUBTS)
json.dump(out, open(W + 'terrain.json', 'w'), ensure_ascii=False)
print(len(hexes), 'клеток,', len(road), 'дорог,', len(river), 'рек')
