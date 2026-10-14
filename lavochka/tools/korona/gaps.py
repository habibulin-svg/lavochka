"""Корона Эмбера: соседние клетки поля 1 и щели между ними (контрольный лист для разметки переходов).
Для каждой пары соседних по сетке клеток: зазор между краями в pt и вырезка середины общей границы."""
import json, sys
from PIL import Image, ImageDraw, ImageFont
ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
d = json.load(open(f'{ROOT}/src/games/korona/data.json', encoding='utf8'))
S = 150 / 72
cells = [c for c in d['cells'] if not c.get('panel')]
pairs = []
for a in cells:
    for b in cells:
        if a['n'] >= b['n']:
            continue
        # по горизонтали: b справа от a (или наоборот), перекрытие по вертикали
        for p, q in ((a, b), (b, a)):
            gx = q['x'] - (p['x'] + p['w'])
            ov = min(p['y'] + p['h'], q['y'] + q['h']) - max(p['y'], q['y'])
            if -5 <= gx <= 40 and ov > 60:
                y0 = max(p['y'], q['y']); y1 = min(p['y'] + p['h'], q['y'] + q['h'])
                pairs.append((p['n'], q['n'], 'h', round(gx), (p['x'] + p['w'] + gx / 2, (y0 + y1) / 2)))
            gy = q['y'] - (p['y'] + p['h'])
            ov = min(p['x'] + p['w'], q['x'] + q['w']) - max(p['x'], q['x'])
            if -5 <= gy <= 40 and ov > 60:
                x0 = max(p['x'], q['x']); x1 = min(p['x'] + p['w'], q['x'] + q['w'])
                pairs.append((p['n'], q['n'], 'v', round(gy), ((x0 + x1) / 2, p['y'] + p['h'] + gy / 2)))
im = Image.open(f'{ROOT}/public/korona/field1.webp').convert('RGB')
T = 150
cols = 12
rows = (len(pairs) + cols - 1) // cols
sheet = Image.new('RGB', (cols * T, rows * (T + 22)), 'white')
dr = ImageDraw.Draw(sheet)
f = ImageFont.truetype('arial.ttf', 16)
for i, (a, b, k, g, (x, y)) in enumerate(pairs):
    px, py = x * S, y * S
    c = im.crop((int(px - 110), int(py - 110), int(px + 110), int(py + 110))).resize((T, T))
    sx, sy = (i % cols) * T, (i // cols) * (T + 22)
    sheet.paste(c, (sx, sy + 22))
    dr.text((sx + 4, sy + 2), f'{i}: {a}-{b} {k} g{g}', fill='black', font=f)
sheet.save(sys.argv[2])
json.dump([{'i': i, 'a': a, 'b': b, 'k': k, 'gap': g, 'x': x, 'y': y} for i, (a, b, k, g, (x, y)) in enumerate(pairs)], open(sys.argv[3], 'w'), indent=0)
print(len(pairs))
