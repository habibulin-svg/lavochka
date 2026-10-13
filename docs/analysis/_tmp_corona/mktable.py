# -*- coding: utf-8 -*-
"""Produce markdown tables for the report from the extracted board-1 data."""
import io, os, re, json

TMP = r'D:\Claude\Shish\docs\analysis\_tmp_corona'
S = 221.1
COLS = [176.9, 417.9, 658.8, 879.9, 1101.0, 1322.1, 1582.9, 1804.0, 2025.1, 2246.2, 2487.2, 2728.1]
ROWS = [137.6, 358.7, 599.7, 820.8, 1041.9, 1263.0, 1484.1, 1725.0, 1966.0]

# world reference colours measured on the z1 raster (3119x2268, 1 px = 1 pt)
WORLD = {
    'blue': 'Мир Магии',
    'red': 'Мир Силы',
    'olive': 'Мир Ума',
    'gold': 'Мир Золота',
    'neutral': 'межмировое / нейтральное',
    'art': '—',
}


def classify(rgb):
    r, g, b = rgb
    if abs(r - 247) < 12 and abs(g - 167) < 14 and abs(b - 98) < 14:
        return 'neutral'
    if r > 240 and g > 195 and b < 140:
        return 'gold'
    if r > 195 and 185 < g < 220 and 90 < b < 145:
        return 'olive'
    if r < 185 and g < 180 and b > 165:
        return 'blue'
    if r > 180 and g < 170 and b < 140:
        return 'red'
    return '?'


cells = []  # rect -> title/body
cur = None
for ln in io.open(os.path.join(TMP, 'p1_cells.txt'), encoding='utf-8'):
    m = re.match(r'--- rect x=([\d.]+) y=([\d.]+) w=([\d.]+) h=([\d.]+)', ln)
    if m:
        cur = {'x': float(m.group(1)), 'y': float(m.group(2)), 'w': float(m.group(3)), 'h': float(m.group(4)),
               'title': '', 'body': ''}
        cells.append(cur)
    elif cur is not None and ln.startswith('TITLE: '):
        cur['title'] = ln[7:].strip()
    elif cur is not None and ln.startswith('BODY: '):
        cur['body'] = ln[6:].strip()

worlds = []
for ln in io.open(os.path.join(TMP, 'p1_worlds.txt'), encoding='utf-8'):
    m = re.match(r'x=\s*([\d.]+) y=\s*([\d.]+).*rgb=\((\d+), (\d+), (\d+)\)', ln)
    if m:
        worlds.append((float(m.group(1)), float(m.group(2)), (int(m.group(3)), int(m.group(4)), int(m.group(5)))))

out = io.open(os.path.join(TMP, 'p1_table.md'), 'w', encoding='utf-8')
out.write('| № | Клетка | Мир | Сетка (кол,ряд) | x0,y0 | w×h | Центр (x,y) |\n')
out.write('|---|---|---|---|---|---|---|\n')

n = 0
rows_csv = []
for c in sorted(cells, key=lambda c: (round(c['y'] / 100), c['x'])):
    title = c['title']
    if title == '(no 17pt title)':
        if abs(c['x'] - 879.9) < 1 and abs(c['y'] - 820.8) < 1:
            title = 'ПОДПОЛЕ «ХРАМ БААЛЯ» (8 секторов)'
        elif abs(c['x'] - 1804.0) < 1 and abs(c['y'] - 820.8) < 1:
            title = 'ПОДПОЛЕ «ПЕРЕВАЛ» (8 секторов)'
        elif abs(c['x'] - 2770.6) < 1:
            title = 'ПАНЕЛЬ «НЕКОТОРЫЕ ПРАВИЛА ИГРЫ»'
        elif abs(c['x'] - 879.9) < 1 or abs(c['x'] - 1804.0) < 1:
            title = 'декоративная панель'
    rgb = None
    for (x, y, col) in worlds:
        if abs(x - c['x']) < 1.6 and abs(y - c['y']) < 1.6:
            rgb = col; break
    wkey = classify(rgb) if rgb else '?'
    if 'панель' in title or 'ПАНЕЛЬ' in title:
        wkey = 'art'
    ci = min(range(len(COLS)), key=lambda i: abs(COLS[i] - c['x'])) if any(abs(cc - c['x']) < 1.6 for cc in COLS) else -1
    rj = min(range(len(ROWS)), key=lambda i: abs(ROWS[i] - c['y'])) if any(abs(rr - c['y']) < 1.6 for rr in ROWS) else -1
    n += 1
    grid = ('%d,%d' % (ci, rj)) if ci >= 0 and rj >= 0 else '—'
    out.write('| %d | %s | %s | %s | %d,%d | %d×%d | %d,%d |\n' % (
        n, title, WORLD.get(wkey, wkey), grid, round(c['x']), round(c['y']),
        round(c['w']), round(c['h']), round(c['x'] + c['w'] / 2), round(c['y'] + c['h'] / 2)))
    rows_csv.append((n, title, WORLD.get(wkey, wkey),
                     round(c['x'] + c['w'] / 2), round(c['y'] + c['h'] / 2),
                     round(c['w']), round(c['h']), grid, c['body']))
out.close()

csv = io.open(os.path.join(TMP, 'p1_table.csv'), 'w', encoding='utf-8')
csv.write('n;name;world;cx;cy;w;h;grid;body\n')
for r in rows_csv:
    csv.write('%d;%s;%s;%d;%d;%d;%d;%s;%s\n' % (r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8].replace(';', ',')))
csv.close()
print('rows', n)
