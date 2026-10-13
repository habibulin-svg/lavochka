# -*- coding: utf-8 -*-
"""Scan narrow gutters of board 1 for the double-arrow 'crossing of worlds' markers."""
import io, os
import numpy as np
from PIL import Image

TMP = r'D:\Claude\Shish\docs\analysis\_tmp_corona'
im = np.array(Image.open(os.path.join(TMP, 'png', 'pole1_z1.png')).convert('RGB')).astype(np.int16)
OUT = io.open(os.path.join(TMP, 'p1_crossings.txt'), 'w', encoding='utf-8')


def w(s=''):
    OUT.write(str(s) + '\n')


# grey arrow body ~ (150..205) with low saturation; orange core ~ (230,140,70)
def mask(strip):
    r, g, b = strip[:, :, 0], strip[:, :, 1], strip[:, :, 2]
    mx = strip.max(axis=2); mn = strip.min(axis=2)
    grey = (mx - mn < 26) & (mx > 120) & (mx < 215)
    orange = (r > 200) & (g > 90) & (g < 175) & (b < 110)
    return grey | orange


def groups(idx, gap=6):
    out = []
    cur = [idx[0]] if len(idx) else []
    for a in idx[1:]:
        if a - cur[-1] <= gap:
            cur.append(a)
        else:
            out.append((cur[0], cur[-1])); cur = [a]
    if cur:
        out.append((cur[0], cur[-1]))
    return out


VGUT = [(398.0, 417.9, 'c0|c1'), (639.0, 658.8, 'c1|c2'), (1543.2, 1582.9, 'c5|c6'),
        (2467.3, 2487.2, 'c9|c10'), (2708.3, 2728.1, 'c10|c11')]
HGUT = [(579.8, 599.7, 'r1|r2'), (1705.2, 1725.0, 'r6|r7'), (1946.1, 1966.0, 'r7|r8')]

w('=== VERTICAL gutters: markers (grey/orange arrow) ===')
for x0, x1, tag in VGUT:
    strip = im[:, int(x0) + 1:int(x1)]
    m = mask(strip)
    cnt = m.sum(axis=1)
    idx = np.where(cnt >= 4)[0]
    gs = groups(list(idx))
    w('%s  x=%.1f..%.1f' % (tag, x0, x1))
    for a, b in gs:
        if b - a >= 12:
            w('    y=%4d..%4d  (centre y=%d)' % (a, b, (a + b) // 2))

w('')
w('=== HORIZONTAL gutters: markers per column ===')
COLS = [176.9, 417.9, 658.8, 879.9, 1101.0, 1322.1, 1582.9, 1804.0, 2025.1, 2246.2, 2487.2, 2728.1]
for y0, y1, tag in HGUT:
    strip = im[int(y0) + 1:int(y1), :]
    m = mask(strip)
    cnt = m.sum(axis=0)
    idx = np.where(cnt >= 4)[0]
    gs = groups(list(idx))
    w('%s  y=%.1f..%.1f' % (tag, y0, y1))
    for a, b in gs:
        if b - a >= 12:
            nm = min(COLS, key=lambda c: abs(c + 110.5 - (a + b) / 2))
            w('    x=%4d..%4d (centre x=%d; column c%d)' % (a, b, (a + b) // 2, COLS.index(nm)))
OUT.close()
print('ok')
