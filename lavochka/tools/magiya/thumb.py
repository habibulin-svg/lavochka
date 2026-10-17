"""Превью карточки «Магии»: поле + фишки-портреты в позиции showcase (как их рисует вид).
npx tsx tools/magiya/showcase.ts > showcase.json && python tools/magiya/thumb.py showcase.json"""
import json, os, sys
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'public')
COLORS = ['#2c6fd1', '#c0392b', '#5b4636', '#2f9e5f', '#c9a227', '#8e44ad']
R = 56
pieces = json.load(open(sys.argv[1], encoding='utf-8-sig'))
field = Image.open(os.path.join(ROOT, 'magic', 'field.webp')).convert('RGBA')
for p in pieces:
    ring = R + 7 + (5 if p['on'] else 0)
    sh = Image.new('RGBA', field.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(sh)
    d.ellipse((p['x'] - ring + 6, p['y'] - ring + 10, p['x'] + ring + 6, p['y'] + ring + 10), fill=(0, 0, 0, 110))
    field.alpha_composite(sh)
    d = ImageDraw.Draw(field)
    d.ellipse((p['x'] - ring, p['y'] - ring, p['x'] + ring, p['y'] + ring), fill=COLORS[p['seat']], outline='#ffd764' if p['on'] else '#fff8e6', width=9 if p['on'] else 5)
    port = Image.open(os.path.join(ROOT, 'magic', f"port-{p['hero']}.webp")).convert('RGBA').resize((2 * R, 2 * R), Image.LANCZOS)
    field.alpha_composite(port, (p['x'] - R, p['y'] - R))
x0, y0, w = 1450, 1100, 1920
crop = field.crop((x0, y0, x0 + w, y0 + w * 300 // 480)).convert('RGB').resize((480, 300), Image.LANCZOS)
crop.save(os.path.join(ROOT, 'thumbs', 'magiya.webp'), quality=82)
print('ok')
