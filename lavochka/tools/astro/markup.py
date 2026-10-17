"""«Астронавты»: разметка точек маршрута на карте звёздного неба.

python tools/astro/markup.py <page01.png> [check.png]
  page01.png — поле, страница 2 «Астронавты.pdf» в 250 dpi (4135×5512, как в materials/nastolki/astronavty/src).
Печатает POINTS для src/games/astro/data.ts (в пикселях public/astro/field.webp, 2316 по ширине) и рисует проверку.

Как: маска белого и красного, маленькие дыры (цифры в кружках) залиты, «открытием» диском 39 px убраны линии и стрелки —
остаются кружки ≈62 px; звёзды (жёлтые с красной каймой) отброшены по жёлтому внутри. Соседи — по белой линии между
кружками (отрезок не должен проходить через третий кружок). Обрывы цепочки (линию пересекает красная стрела)
сшиты вручную, точка 79 (её задевает стрела, кружок шире) вставлена вручную. Проверка: типы кружков совпадают
с правилами — красные точки = номера карточек, точки в красном кружке = маршрут второго варианта.
"""
import json, math, sys, collections
import numpy as np, cv2
from scipy import ndimage as ndi

src = sys.argv[1]
im = cv2.imread(src)
b, g, r = [im[:, :, i].astype(int) for i in range(3)]
white = (r > 190) & (g > 190) & (b > 190)
red = (r > 160) & (g < 100) & (b < 110)
yellow = (r > 200) & (g > 180) & (b < 100)
base = white | red
holes = ndi.binary_fill_holes(base) & ~base
hl, hn = ndi.label(holes)
sizes = ndi.sum(holes, hl, range(1, hn + 1))
m = (base | np.isin(hl, np.nonzero(sizes < 2500)[0] + 1)).astype(np.uint8) * 255
o = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (39, 39)))
n, lab, st, cen = cv2.connectedComponentsWithStats(o)
R = 28
yy, xx = np.ogrid[-R:R + 1, -R:R + 1]
disk = (xx * xx + yy * yy) <= R * R
C = []
for i in range(1, n):
    x, y, w, h, a = st[i]
    cx, cy = cen[i]
    if a < 1500 or not (59 <= (w + h) / 2 <= 66): continue
    if cy < R + 1 or cy > im.shape[0] - R - 2 or cx < R + 1 or cx > im.shape[1] - R - 2: continue
    X, Y = int(round(cx)), int(round(cy))
    frac = lambda mask: float(mask[Y - R:Y + R + 1, X - R:X + R + 1][disk].mean())
    if frac(yellow) >= 0.1: continue
    C.append(dict(x=X, y=Y, red=frac(red)))

wd = cv2.dilate(((r > 170) & (g > 170) & (b > 170)).astype(np.uint8), np.ones((9, 9), np.uint8))
rd = cv2.dilate(red.astype(np.uint8), np.ones((9, 9), np.uint8))


def score(a, c):
    dx, dy = c['x'] - a['x'], c['y'] - a['y']
    L = math.hypot(dx, dy)
    t0, t1 = 36 / L, 1 - 36 / L
    k = int(L / 4)
    ok = 0
    for i in range(k + 1):
        t = t0 + (t1 - t0) * i / k
        X, Y = int(a['x'] + dx * t), int(a['y'] + dy * t)
        ok += 1 if wd[Y, X] else 0.5 if rd[Y, X] else 0
    return ok / (k + 1)


E = collections.defaultdict(list)
for i, a in enumerate(C):
    for j in range(i + 1, len(C)):
        c = C[j]
        L = math.hypot(c['x'] - a['x'], c['y'] - a['y'])
        if L < 70 or L > 700: continue
        dx, dy = c['x'] - a['x'], c['y'] - a['y']
        blocked = False
        for k, d in enumerate(C):
            if k in (i, j): continue
            t = ((d['x'] - a['x']) * dx + (d['y'] - a['y']) * dy) / (L * L)
            if 0 < t < 1 and math.hypot(d['x'] - a['x'] - dx * t, d['y'] - a['y'] - dy * t) < 40: blocked = True; break
        if not blocked and score(a, c) > 0.93:
            E[i].append(j); E[j].append(i)

# концы цепочки, которые надо сшить: пары ближайших концов (линию пересекает стрела), и красная точка Земли
ends = [i for i in range(len(C)) if len(E[i]) == 1]
earth = max(ends, key=lambda i: C[i]['y'] if C[i]['red'] > 0.9 else -1)
loose = [i for i in ends if i != earth]
first = E[earth][0]
for i in loose:
    if len(E[i]) >= 2: continue
    cand = [j for j in loose if j != i and len(E[j]) < 2 and j not in E[i]]
    if not cand: continue
    best = min(cand, key=lambda j: math.hypot(C[i]['x'] - C[j]['x'], C[i]['y'] - C[j]['y']))
    if math.hypot(C[i]['x'] - C[best]['x'], C[i]['y'] - C[best]['y']) < 450:
        E[i].append(best); E[best].append(i)
order = [earth]
prev, cur = None, earth
while True:
    nx = [x for x in E[cur] if x != prev and x not in order]
    if not nx: break
    prev, cur = cur, nx[0]
    order.append(cur)
pts = [C[i] for i in order]
# точка 79 — на неё налезает красная стрела, кружок вышел шире фильтра
pts.insert(79, dict(x=2263, y=2700, red=0.88))
assert len(pts) == 191, len(pts)

cards = {5, 10, 14, 19, 23, 29, 35, 39, 42, 46, 52, 58, 64, 69, 72, 76, 79, 83, 90, 92, 95, 97, 100, 101, 110, 117, 123, 127, 131, 137, 143, 147, 151, 156, 159, 166, 168, 174, 181}
route = {3, 8, 17, 24, 28, 40, 44, 50, 62, 68, 74, 84, 87, 103, 108, 111, 119, 130, 133, 139, 146, 150, 161, 165, 172, 175, 179, 184}
bad = []
for i, p in enumerate(pts[1:], 1):
    kind = 'card' if p['red'] > 0.7 else 'ring' if p['red'] > 0.12 else 'plain'
    want = 'card' if i in cards else 'ring' if i in route else 'plain'
    if kind != want: bad.append((i, kind, want))
print('расхождений с правилами:', bad, file=sys.stderr)
k = 2316 / im.shape[1]
print(json.dumps([[round(p['x'] * k), round(p['y'] * k)] for p in pts], separators=(',', ':')))
if len(sys.argv) > 2:
    vis = cv2.resize(im, (im.shape[1] // 2, im.shape[0] // 2))
    for i, p in enumerate(pts):
        cv2.circle(vis, (p['x'] // 2, p['y'] // 2), 18, (0, 255, 0), 2)
        cv2.putText(vis, str(i), (p['x'] // 2 + 14, p['y'] // 2 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    cv2.imwrite(sys.argv[2], vis)
