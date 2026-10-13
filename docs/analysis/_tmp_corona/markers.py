# -*- coding: utf-8 -*-
"""Find repeated small graphics that sit on cell borders = world-crossing markers."""
import pymupdf, os, io, collections

base = r'D:\temp\настолки\Корона Эмбера 1994 ги (Реставрация в векторе)\PDF'
TMP = r'D:\Claude\Shish\docs\analysis\_tmp_corona'
OUT = io.open(os.path.join(TMP, 'p1_markers.txt'), 'w', encoding='utf-8')


def w(s=''):
    OUT.write(str(s) + '\n')


COLS = [176.9, 417.9, 658.8, 879.9, 1101.0, 1322.1, 1582.9, 1804.0, 2025.1, 2246.2, 2487.2, 2728.1]
ROWS = [137.6, 358.7, 599.7, 820.8, 1041.9, 1263.0, 1484.1, 1725.0, 1966.0]
S = 221.1
BORD_X = [c + S for c in COLS] + [c - 19.85 for c in COLS if c != 176.9] + [417.9 - 19.85, 658.8 - 19.85]
BORD_Y = [r + S for r in ROWS] + [599.7 - 19.9, 1725.0 - 19.8, 1966.0 - 19.8]

d = pymupdf.open(os.path.join(base, 'печать корона эмбера ПОЛЕ 1.pdf'))
p = d[0]

recs = collections.defaultdict(list)
for im in p.get_images(full=True):
    xref = im[0]
    for r in p.get_image_rects(xref):
        if 18 <= r.width <= 80 and 18 <= r.height <= 80:
            recs[xref].append((round(r.x0, 1), round(r.y0, 1), round(r.width, 1), round(r.height, 1)))

w('small image xrefs, count, size:')
for xref, rs in sorted(recs.items(), key=lambda kv: -len(kv[1])):
    sizes = collections.Counter((a[2], a[3]) for a in rs)
    w('  xref %-5d n=%-3d sizes=%s' % (xref, len(rs), sizes.most_common(3)))

w('')
w('=== placements on grid borders (candidate transition arrows) ===')
for xref, rs in sorted(recs.items(), key=lambda kv: -len(kv[1])):
    if len(rs) < 2:
        continue
    onb = []
    for (x, y, ww, hh) in rs:
        cx, cy = x + ww / 2, y + hh / 2
        bx = min(BORD_X, key=lambda b: abs(b - cx))
        by = min(BORD_Y, key=lambda b: abs(b - cy))
        if abs(bx - cx) < 3 or abs(by - cy) < 3:
            onb.append((x, y, ww, hh, round(cx, 1), round(cy, 1),
                        'V x=%.1f' % bx if abs(bx - cx) < 3 else 'H y=%.1f' % by))
    if onb:
        w(' xref %d  (%d of %d on borders)' % (xref, len(onb), len(rs)))
        for o in sorted(onb, key=lambda o: (round(o[5] / 60), o[4])):
            w('    x=%7.1f y=%7.1f w=%5.1f h=%5.1f centre=(%7.1f,%7.1f) %s' % o)
OUT.close()
print('ok')
