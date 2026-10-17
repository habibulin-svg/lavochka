# Подгонка ровной сетки и разметка клеток по наличию линий на рёбрах.
# python grid-fit.py <карта> <x0> <dx> <y0> <dy> <out.json> <check.png>
import sys, json
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import uniform_filter

path, x0, dx, y0, dy, out, check = sys.argv[1], *map(float, sys.argv[2:6]), sys.argv[6], sys.argv[7]
img = Image.open(path).convert('RGB')
g = np.asarray(img.convert('L')).astype(float)
H, W = g.shape
bg = uniform_filter(g, 13)
dark = np.clip(bg - g, 0, None)  # тёмная тонкая линия ярче фона

# уточнение положения каждой линии (по локальному максимуму профиля ±6px)
def refine(axis, start, step, n_max):
    lines = []
    i0 = -int(start // step)
    for i in range(i0, n_max):
        p = start + i * step
        if p < 3 or p > (W if axis == 'x' else H) - 3:
            continue
        lines.append(p)
    return lines

xs = refine('x', x0, dx, 200)
ys = refine('y', y0, dy, 200)

def edge_score(xa, ya, xb, yb):
    # средняя «темнота» вдоль отрезка, лучшая из сдвигов ±4px поперёк
    best = 0
    n = 40
    for off in range(-4, 5):
        s = 0
        for t in np.linspace(0.15, 0.85, n):
            x = xa + (xb - xa) * t + (off if xa == xb else 0)
            y = ya + (yb - ya) * t + (off if ya == yb else 0)
            xi, yi = int(round(x)), int(round(y))
            if 0 <= xi < W and 0 <= yi < H:
                s += dark[yi, xi] > 6
        best = max(best, s / n)
    return best

cells = {}
for j in range(len(ys) - 1):
    for i in range(len(xs) - 1):
        xa, xb, ya, yb = xs[i], xs[i + 1], ys[j], ys[j + 1]
        e = [edge_score(xa, ya, xb, ya), edge_score(xa, yb, xb, yb), edge_score(xa, ya, xa, yb), edge_score(xb, ya, xb, yb)]
        cells[f'{i},{j}'] = {'edges': [round(v, 2) for v in e], 'rgb': [int(v) for v in np.asarray(img.crop((int(xa)+8, int(ya)+8, int(xb)-8, int(yb)-8))).reshape(-1, 3).mean(axis=0)]}

json.dump({'xs': xs, 'ys': ys, 'cells': cells}, open(out, 'w'))
d = ImageDraw.Draw(img)
for k, c in cells.items():
    i, j = map(int, k.split(','))
    good = sum(v > 0.5 for v in c['edges'])
    col = (0, 200, 0) if good >= 3 else (255, 160, 0) if good == 2 else None
    if col:
        d.rectangle((xs[i] + 4, ys[j] + 4, xs[i + 1] - 4, ys[j + 1] - 4), outline=col, width=3)
img.save(check)
print(len(xs), len(ys))
