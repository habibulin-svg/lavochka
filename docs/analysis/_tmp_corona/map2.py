# -*- coding: utf-8 -*-
"""Build definitive cell map for board 1 from PDF image placements + text."""
import io, re, os, json

TMP = r'D:\Claude\Shish\docs\analysis\_tmp_corona'
OUT = io.open(os.path.join(TMP, 'p1_cells.txt'), 'w', encoding='utf-8')


def w(s=''):
    OUT.write(str(s) + '\n')


# --- 1. cells = image placements of cell size -------------------------------
cells = []
seen = set()
for ln in io.open(os.path.join(TMP, 'pole1_imgrects.txt'), encoding='utf-8'):
    parts = ln.split()
    y = float(parts[0]); x = float(parts[1])
    ww = float(ln.split('w=')[1].split()[0]); hh = float(ln.split('h=')[1].split()[0])
    if 200 <= ww <= 520 and 200 <= hh <= 520:
        k = (round(x, 0), round(y, 0), round(ww, 0), round(hh, 0))
        if k in seen:
            continue
        seen.add(k)
        cells.append([x, y, ww, hh])

# drop cells fully inside a larger cell
cells.sort(key=lambda c: (-(c[2] * c[3])))
kept = []
for c in cells:
    inside = False
    for k in kept:
        if (c[0] >= k[0] - 1 and c[1] >= k[1] - 1 and
                c[0] + c[2] <= k[0] + k[2] + 1 and c[1] + c[3] <= k[1] + k[3] + 1):
            inside = True
            break
    if not inside:
        kept.append(c)
kept.sort(key=lambda c: (round(c[1] / 100), c[0]))

w('cells: %d' % len(kept))
for c in kept:
    w('  x=%7.1f y=%7.1f w=%6.1f h=%6.1f  centre=(%7.1f,%7.1f)' %
      (c[0], c[1], c[2], c[3], c[0] + c[2] / 2, c[1] + c[3] / 2))

# --- 2. spans ---------------------------------------------------------------
spans = []
for ln in io.open(os.path.join(TMP, 'pole1_spans.txt'), encoding='utf-8'):
    m = re.match(r'\s*([\d.]+)\s+([\d.]+) sz=\s*([\d.]+) f=(\S+) \| (.*)', ln)
    if m:
        spans.append([float(m.group(1)), float(m.group(2)), float(m.group(3)), m.group(4), m.group(5)])

# --- 3. assign title + body text to each cell -------------------------------
w('')
w('=== CELL TEXT ===')
for c in kept:
    x0, y0, ww, hh = c
    x1, y1 = x0 + ww, y0 + hh
    inside = [s for s in spans if x0 - 3 <= s[0] <= x1 + 3 and y0 - 6 <= s[1] <= y1 - 2]
    inside.sort(key=lambda s: (round(s[1] / 6), s[0]))
    title = ' '.join(s[4] for s in inside if s[2] >= 16)
    if not title:
        title = '(no 17pt title)'
    body = [s[4] for s in inside if s[2] < 16]
    w('')
    w('--- rect x=%.1f y=%.1f w=%.1f h=%.1f  centre=(%.1f,%.1f)' % (x0, y0, ww, hh, x0 + ww / 2, y0 + hh / 2))
    w('TITLE: %s' % title)
    w('BODY: %s' % ' '.join(body))
OUT.close()
print('ok')
