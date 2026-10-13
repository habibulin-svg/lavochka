# -*- coding: utf-8 -*-
"""Classify each board-1 cell by dominant background colour (world)."""
import io, os, re, colorsys
import numpy as np
from PIL import Image

TMP = r'D:\Claude\Shish\docs\analysis\_tmp_corona'
OUT = io.open(os.path.join(TMP, 'p1_worlds.txt'), 'w', encoding='utf-8')


def w(s=''):
    OUT.write(str(s) + '\n')


im = np.array(Image.open(os.path.join(TMP, 'png', 'pole1_z1.png')).convert('RGB')).astype(np.float32)
H, W, _ = im.shape

# parse cell rects from p1_cells.txt header
cells = []
for ln in io.open(os.path.join(TMP, 'p1_cells.txt'), encoding='utf-8'):
    m = re.match(r'\s*x=\s*([\d.]+) y=\s*([\d.]+) w=\s*([\d.]+) h=\s*([\d.]+)', ln)
    if m:
        cells.append([float(m.group(i)) for i in range(1, 5)])
print('cells', len(cells))


def dom_colour(x0, y0, x1, y1):
    x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
    x0 = max(x0, 0); y0 = max(y0, 0); x1 = min(x1, W); y1 = min(y1, H)
    patch = im[y0:y1, x0:x1].reshape(-1, 3)
    # drop near-black (line art) and near-white (paper)
    mx = patch.max(axis=1); mn = patch.min(axis=1)
    keep = (mx > 80) & (mx < 250)
    p = patch[keep]
    if len(p) < 50:
        return (0, 0, 0), 0
    # quantise hue, take modal bucket
    hsv = np.array([colorsys.rgb_to_hsv(*(c / 255.0)) for c in p[:: max(1, len(p) // 4000)]])
    hs = np.round(hsv[:, 0] * 36).astype(int) % 36
    vals, cnts = np.unique(hs, return_counts=True)
    hb = vals[cnts.argmax()]
    sel = hsv[hs == hb]
    med = np.median(sel, axis=0)
    r, g, b = colorsys.hsv_to_rgb(med[0], med[1], med[2])
    return (int(r * 255), int(g * 255), int(b * 255)), float(cnts.max() / len(hs))


NAMES = {
    'blue': (0, 0, 255), 'green': (0, 128, 0), 'red': (255, 0, 0),
    'orange': (255, 165, 0), 'tan': (210, 180, 140), 'grey': (128, 128, 128),
}


def label(rgb):
    r, g, b = [v / 255.0 for v in rgb]
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    hd = h * 360
    if s < 0.12:
        return 'grey'
    if hd < 20 or hd >= 330:
        return 'red'
    if hd < 45:
        return 'orange'
    if hd < 70:
        return 'yellow'
    if hd < 165:
        return 'green'
    if hd < 260:
        return 'blue'
    return 'violet'


for c in sorted(cells, key=lambda c: (round(c[1] / 100), c[0])):
    x0, y0, ww, hh = c
    rgb, conf = dom_colour(x0 + 8, y0 + 8, x0 + ww - 8, y0 + hh - 8)
    w('x=%7.1f y=%7.1f w=%6.1f h=%6.1f centre=(%7.1f,%7.1f)  rgb=%s  %-6s conf=%.2f' %
      (x0, y0, ww, hh, x0 + ww / 2, y0 + hh / 2, rgb, label(rgb), conf))
OUT.close()
print('ok')
