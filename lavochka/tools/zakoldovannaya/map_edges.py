"""Дороги карты: пара узлов соединена, если отрезок между ними почти весь светлый (белая линия дороги или мост).
Запуск: python -I map_edges.py <карта.jpg> <nodes.json> <выход.json> <проверка.jpg>"""
import sys, json, math
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
src, nodes_p, out, check = sys.argv[1:5]
im = Image.open(src).convert('RGB')
a = np.asarray(im).astype(int)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
light = (r > 185) & (g > 170) & (b > 110) & (abs(r - g) < 55)
light = ndimage.binary_dilation(light, iterations=4)
nd = json.load(open(nodes_p))
nodes = [dict(x=x, y=y, r=rr, kind='road') for x, y, rr in nd['white']] + [dict(x=x, y=y, r=rr, kind='castle') for x, y, rr in nd['pink']]

def frac(p, q):
    d = math.dist((p['x'], p['y']), (q['x'], q['y']))
    t0, t1 = (p['r'] + 6) / d, 1 - (q['r'] + 6) / d
    if t1 <= t0: return 1.0, 0
    n = max(10, int((t1 - t0) * d / 4))
    ok = 0
    for i in range(n):
        t = t0 + (t1 - t0) * i / (n - 1)
        x = int(p['x'] + (q['x'] - p['x']) * t); y = int(p['y'] + (q['y'] - p['y']) * t)
        ok += light[y, x]
    return ok / n, (t1 - t0) * d

edges = []
for i in range(len(nodes)):
    for j in range(i + 1, len(nodes)):
        p, q = nodes[i], nodes[j]
        d = math.dist((p['x'], p['y']), (q['x'], q['y']))
        if d > 1100: continue
        # другой узел на пути — не прямая дорога
        blocked = False
        for k, o in enumerate(nodes):
            if k in (i, j): continue
            vx, vy = q['x'] - p['x'], q['y'] - p['y']
            t = ((o['x'] - p['x']) * vx + (o['y'] - p['y']) * vy) / (d * d)
            if 0 < t < 1:
                px, py = p['x'] + vx * t, p['y'] + vy * t
                if math.dist((px, py), (o['x'], o['y'])) < o['r'] * 0.9: blocked = True; break
        if blocked: continue
        f, L = frac(p, q)
        if f > 0.9: edges.append((i, j, round(f, 3), round(L)))
print('nodes', len(nodes), 'edges', len(edges))
deg = [0] * len(nodes)
for i, j, *_ in edges: deg[i] += 1; deg[j] += 1
print('degree hist', {k: deg.count(k) for k in sorted(set(deg))})
print('deg0/1', [(i, nodes[i]['kind'], nodes[i]['x'], nodes[i]['y'], deg[i]) for i in range(len(nodes)) if deg[i] < 2])
json.dump({'size': nd['size'], 'nodes': nodes, 'edges': edges}, open(out, 'w'))
d = ImageDraw.Draw(im)
for i, j, f, L in edges:
    p, q = nodes[i], nodes[j]
    d.line([(p['x'], p['y']), (q['x'], q['y'])], fill=(255, 0, 255) if f < 0.97 else (0, 255, 0), width=12)
for i, n in enumerate(nodes):
    d.text((n['x'] - 20, n['y'] - 20), str(i), fill=(0, 0, 0), font_size=44)
im.thumbnail((2400, 2400)); im.save(check, quality=80)
