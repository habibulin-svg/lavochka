"""Корона Эмбера: проверочная картинка поля 2 — клетки дороги со стрелками переходов и места (столица, лабиринт, покои, трон).
Данные берутся из src/games/korona/data.ts через `npx tsx` (dump.json рядом), рисуются поверх public/korona/field2.webp.
Запуск из lavochka/: python tools/korona/field2-check.py <dump.json> <out.png>"""
import json, sys
from PIL import Image, ImageDraw, ImageFont

d = json.load(open(sys.argv[1], encoding='utf8'))
im = Image.open('public/korona/field2.webp').convert('RGB')
dr = ImageDraw.Draw(im)
f = ImageFont.truetype('arial.ttf', 26)
by = {n['id']: n for n in d['road']}
for n in d['road']:
    for k, col in (('next', (0, 90, 255)), ('even', (0, 170, 0)), ('odd', (220, 0, 0))):
        t = n.get(k)
        if t and t in by:
            m = by[t]
            dr.line([n['x'], n['y'], m['x'], m['y']], fill=col, width=5)
            dr.ellipse([m['x'] - 9, m['y'] - 9, m['x'] + 9, m['y'] + 9], fill=col)
for n in d['road']:
    dr.ellipse([n['x'] - 34, n['y'] - 34, n['x'] + 34, n['y'] + 34], outline=(255, 0, 255), width=5)
    lab = n['id'] + (f" {n['st']}{n['d']:+d}" if n.get('st') else '') + (' обм' if n.get('exchange') else '')
    dr.text((n['x'] - 40, n['y'] + 36), lab, fill=(160, 0, 160), font=f, stroke_width=3, stroke_fill='white')
for k, v in d['places'].items():
    for i, p in enumerate(v if isinstance(v, list) else [v]):
        dr.ellipse([p['x'] - 34, p['y'] - 34, p['x'] + 34, p['y'] + 34], outline=(255, 120, 0), width=6)
        dr.text((p['x'] - 30, p['y'] - 14), f'{k}{i}', fill=(200, 60, 0), font=f, stroke_width=3, stroke_fill='white')
im.save(sys.argv[2])
