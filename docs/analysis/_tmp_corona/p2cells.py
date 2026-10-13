# -*- coding: utf-8 -*-
"""Board 2 (Королевство Эмбер): locate yellow road cells and black road tiles."""
import io, os
import numpy as np
import pymupdf
from PIL import Image

BASE = r'D:\temp\настолки\Корона Эмбера 1994 ги (Реставрация в векторе)\PDF'
TMP = r'D:\Claude\Shish\docs\analysis\_tmp_corona'
OUT = io.open(os.path.join(TMP, 'p2_cells.txt'), 'w', encoding='utf-8')


def w(s=''):
    OUT.write(str(s) + '\n')


d = pymupdf.open(os.path.join(BASE, 'печать корона эмбера ПОЛЕ 2.pdf'))
p = d[0]
pix = p.get_pixmap(matrix=pymupdf.Matrix(1, 1))
img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
img.save(os.path.join(TMP, 'png', 'pole2_z1.png'))
a = np.array(img).astype(np.int16)
H, W, _ = a.shape
w('board2 raster zoom=1.0 -> %dx%d px  (1 px = 1 pt)' % (W, H))
w('page rect = %.2f x %.2f pt' % (p.rect.width, p.rect.height))

r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
yellow = (r > 225) & (g > 185) & (g < 235) & (b > 60) & (b < 150)
w('yellow px: %d' % yellow.sum())


def runs(row):
    idx = np.where(row)[0]
    out = []
    if not len(idx):
        return out
    s = idx[0]; prev = idx[0]
    for x in idx[1:]:
        if x - prev > 2:
            out.append((s, prev)); s = x
        prev = x
    out.append((s, prev))
    return out


# collect runs of cell-ish width, then merge vertically into rectangles
recs = []
active = []  # (x0,x1,y0,y1)
for y in range(H):
    rr = [t for t in runs(yellow[y]) if 30 <= t[1] - t[0] <= 90]
    newactive = []
    used = [False] * len(rr)
    for (x0, x1, y0, y1) in active:
        best = None
        for i, (a0, a1) in enumerate(rr):
            if used[i]:
                continue
            ov = min(x1, a1) - max(x0, a0)
            if ov > 0.6 * min(x1 - x0, a1 - a0):
                best = i; break
        if best is None:
            recs.append((x0, y0, x1, y1))
        else:
            used[best] = True
            a0, a1 = rr[best]
            newactive.append((min(x0, a0), max(x1, a1), y0, y1))
    for i, (a0, a1) in enumerate(rr):
        if not used[i]:
            newactive.append((a0, a1, y, y))
    active = newactive
recs.extend(active)

cells = []
for (x0, y0, x1, y1) in recs:
    ww, hh = x1 - x0 + 1, y1 - y0 + 1
    if 30 <= ww <= 95 and 30 <= hh <= 95:
        cells.append((x0, y0, ww, hh, (x0 + x1) / 2, (y0 + y1) / 2))
w('')
w('=== road cells (yellow), %d ===' % len(cells))
for c in sorted(cells, key=lambda c: (round(c[5] / 60), c[4])):
    w('  x=%5d y=%5d w=%3d h=%3d centre=(%6.1f,%6.1f)' % (c[0], c[1], c[2], c[3], c[4], c[5]))
OUT.close()
print('ok', len(cells))
