# -*- coding: utf-8 -*-
import io, re, json, os

TMP = r'D:\Claude\Shish\docs\analysis\_tmp_corona'
p = os.path.join(TMP, 'pole1_spans.txt')
rows = []
for ln in io.open(p, encoding='utf-8'):
    m = re.match(r'\s*([\d.]+)\s+([\d.]+) sz=\s*([\d.]+) f=(\S+) \| (.*)', ln)
    if m:
        rows.append([float(m.group(1)), float(m.group(2)), float(m.group(3)), m.group(5)])

COLS = [176.9, 417.9, 658.8, 879.9, 1101.0, 1322.1, 1582.9, 1804.0, 2025.1, 2246.2, 2487.2, 2728.1]
ROWS = [137.6, 358.7, 599.7, 820.8, 1041.9, 1263.0, 1484.1, 1725.0, 1966.0]
S = 221.1

# explicit merged cells: (col0, row0, colspan, rowspan)
MERGED = [
    (5, 2, 2, 1),   # ЛАЗАРЕТ  (c5+c6, r2)
    (5, 6, 2, 1),   # ЗАГОТКОНТОРА (c5+c6, r6)
    (3, 5, 2, 1),   # c3+c4 r5
    (7, 5, 2, 1),   # c7+c8 r5
    (3, 3, 2, 2),   # c3+c4 r3-r4 (2x2)
    (7, 3, 2, 2),   # c7+c8 r3-r4 (2x2)
    (10, 0, 1, 1),  # top-right ОБМЕННЫЙ ПУНКТ
]
GRID_GUTTER = 19.85


def cell_rect(ci, rj, cs=1, rs=1):
    x0 = COLS[ci]
    y0 = ROWS[rj]
    if cs == 1:
        w = S
    else:
        w = S * cs + GRID_GUTTER * (cs - 1)
    h = S * rs + GRID_GUTTER * (rs - 1)
    return x0, y0, x0 + w, y0 + h


titles = [r for r in rows if r[2] >= 16]
matched = {}
unmatched = []
for x, y, sz, txt in titles:
    best = None
    for ci in range(len(COLS)):
        for rj in range(len(ROWS)):
            for cs, rs in ((2, 2), (2, 1), (1, 2), (1, 1)):
                x0, y0, x1, y1 = cell_rect(ci, rj, cs, rs)
                if x0 - 6 <= x <= x1 and y0 - 30 <= y <= y1 + 4:
                    d = abs(x - (x0 + x1) / 2)
                    if best is None or d < best[0]:
                        best = (d, ci, rj, cs, rs)
    if best:
        matched.setdefault((best[1], best[2], best[3], best[4]), []).append((txt, round(x), round(y)))
    else:
        unmatched.append((txt, round(x), round(y)))

print('=== UNMATCHED TITLES ===')
for u in unmatched:
    print('   x=%4d y=%4d | %s' % (u[1], u[2], u[0]))
print()
print('=== MATCHED ===')
for k in sorted(matched, key=lambda k: (k[1], k[0])):
    print('c%-2d r%-2d cs%d rs%d : %s' % (k[0], k[1], k[2], k[3],
          ' + '.join('%s@%d,%d' % (n, x, y) for n, x, y in matched[k])))

json.dump({str(k): v for k, v in matched.items()},
          io.open(os.path.join(TMP, 'p1_matched.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
