"""Наложение разметки плана на скан: узлы (кружки с id) и связи (цвет по виду). Запуск: python -I plan_check.py <plans dir> <N> <out.png>"""
import sys, json
from PIL import Image, ImageDraw
d, n, out = sys.argv[1:4]
P = json.load(open(f'{d}/{n}.json', encoding='utf-8'))
imgs = P['image'] if isinstance(P['image'], list) else [P['image']]
S = 3
ims = [Image.open(f'{d}/{f}').convert('RGB') for f in imgs]
ims = [im.resize((im.width * S, im.height * S), Image.LANCZOS) for im in ims]
W = sum(im.width for im in ims) + 20 * (len(ims) - 1); H = max(im.height for im in ims)
sheet = Image.new('RGB', (W, H), 'white'); offs = []
x = 0
for im in ims:
    sheet.paste(im, (x, 0)); offs.append(x); x += im.width + 20
dr = ImageDraw.Draw(sheet, 'RGBA')
rooms = {r['id']: r for r in P['rooms']}
def pos(r): return (offs[r.get('img', 0)] + r['x'] * S, r['y'] * S)
COL = {'door': (0, 160, 0, 220), 'secret': (230, 0, 200, 230), 'open': (0, 120, 255, 200), 'up': (255, 140, 0, 230), 'down': (200, 0, 0, 230), 'gate': (0, 0, 0, 230)}
for l in P['links']:
    a, b = rooms.get(l['a']), rooms.get(l['b'])
    if not a or not b: continue
    dr.line([pos(a), pos(b)], fill=COL.get(l['kind'], (90, 90, 90, 200)), width=5)
for r in P['rooms']:
    x, y = pos(r); rr = 15
    dr.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(255, 255, 200, 230), outline=(0, 0, 0, 255), width=2)
    dr.text((x - 12, y - 10), r['id'], fill=(180, 0, 0, 255), font_size=18)
for e in P.get('entry', []):
    if e in rooms:
        x, y = pos(rooms[e]); dr.ellipse([x - 22, y - 22, x + 22, y + 22], outline=(0, 0, 255, 255), width=4)
sheet.save(out)
print(n, len(P['rooms']), 'rooms', len(P['links']), 'links')
