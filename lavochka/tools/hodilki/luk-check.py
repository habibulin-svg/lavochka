"""Проверочная картинка поля кинь-двиня: номера клеток (индексы в data/<id>.json), главный путь,
дороги развилок (свой цвет у каждой) и переходы (to/field/need/pick — пунктиром).
Запуск из lavochka/:  python -I tools/hodilki/luk-check.py <id> <out.png> [масштаб] [x0 y0 x1 y1]"""
import json, sys, os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mid, out = sys.argv[1], sys.argv[2]
k = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
box = list(map(int, sys.argv[4:8])) if len(sys.argv) > 7 else None
raw = json.load(open(os.path.join(ROOT, 'src/games/hodilki/data/%s.json' % mid), encoding='utf8'))
W, H = raw['w'], raw['h']
src = None
fld = {'luk1': 1, 'luk2': 2, 'luk3': 3, 'luk4': 4}.get(mid)
if fld:
    src = os.path.join(ROOT, '..', 'materials/nastolki/lukomorie/field-%d.webp' % fld)
if not src or not os.path.exists(src):
    src = os.path.join(ROOT, 'public/hodilki/%s/view.webp' % mid)
im = Image.open(src).convert('RGB').resize((int(W * k), int(H * k)))
d = ImageDraw.Draw(im, 'RGBA')
try:
    font = ImageFont.truetype('arial.ttf', max(12, int(44 * k)))
except Exception:
    font = ImageFont.load_default()
cells = [] if os.environ.get('ONLYC') else raw['cells']
end = raw['end'] if cells else -1
LABELS = bool(os.environ.get('LABELS'))  # только номера клеток, без дорог — сверять стрелки со сканом
P = lambda i: (cells[i]['x'] * k, cells[i]['y'] * k)
def arrow(a, b, col, w=3, dash=False):
    (x0, y0), (x1, y1) = a, b
    if dash:
        n = max(1, int(((x1 - x0) ** 2 + (y1 - y0) ** 2) ** .5 / 12))
        for t in range(0, n, 2):
            d.line([(x0 + (x1 - x0) * t / n, y0 + (y1 - y0) * t / n), (x0 + (x1 - x0) * (t + 1) / n, y0 + (y1 - y0) * (t + 1) / n)], fill=col, width=w)
    else:
        d.line([a, b], fill=col, width=w)
    import math
    ang = math.atan2(y1 - y0, x1 - x0)
    L = 14
    for s in (2.6, -2.6):
        d.line([b, (x1 + L * math.cos(ang + s), y1 + L * math.sin(ang + s))], fill=col, width=w)
for i, c in enumerate([] if LABELS else cells):
    j = c.get('n', i + 1 if i < end else -1)
    if j >= 0:
        arrow(P(i), P(j), (0, 90, 255, 220) if not c.get('off') else (0, 170, 255, 220), 4)
COLS = [(255, 0, 200, 230), (0, 200, 0, 230), (255, 140, 0, 230), (0, 220, 220, 230), (150, 0, 255, 230), (120, 80, 0, 230)]
for i, c in enumerate([] if LABELS else cells):
    s = c.get('s', '')
    if s.startswith('fork:') or s.startswith('fork~'):
        parts = s.split(':', 1)[1].split('|')
        for bi, br in enumerate(parts[2:]):
            seq = [i] + [int(x) for x in br.split(',') if x]
            for a, b in zip(seq, seq[1:]):
                arrow(P(a), P(b), COLS[bi % 6], 3)
            # номер грани/дороги — у кружка, откуда выходит стрелка
            if len(seq) > 1:
                (x0, y0), (x1, y1) = P(seq[0]), P(seq[1])
                t = 0.32 if (x1 - x0) ** 2 + (y1 - y0) ** 2 > 400 else 0.5
                d.text((x0 + (x1 - x0) * t - 6, y0 + (y1 - y0) * t - 10), str(bi + 1), fill=COLS[bi % 6][:3], font=font,
                       stroke_width=3, stroke_fill=(255, 255, 255))
    elif s.split(':')[0].split('+')[-1] in ('to', 'fwd', 'back'):
        arrow(P(i), P(int(s.split(':')[-1])), (255, 0, 0, 255), 5, True)
    elif '>' in s:
        arrow(P(i), P(int(s.split('>')[-1])), (255, 0, 0, 255), 5, True)
    elif s.startswith('need:'):
        for kv in s[5:].split(','):
            kk, v = kv.split('=')
            if kk in ('yes', 'no') and v.isdigit():
                arrow(P(i), P(int(v)), (255, 0, 0, 255) if kk == 'no' else (0, 160, 0, 255), 5, True)
    elif s.startswith('pick:'):
        for v in s.split('|')[2].split(','):
            if v.isdigit():
                arrow(P(i), P(int(v)), (200, 0, 0, 160), 2, True)
for i, c in enumerate(cells):
    x, y = P(i)
    r = 9 if not LABELS else 5
    col = (255, 255, 0) if not c.get('off') else (0, 255, 255)
    if c.get('s'):
        col = (255, 60, 60)
    d.ellipse([x - r, y - r, x + r, y + r], fill=col, outline=(0, 0, 0))
    t = str(i) + ('[' + c['l'] + ']' if c.get('l') else '')
    d.text((x + 10, y - 12), t, fill=(0, 0, 0), font=font, stroke_width=3, stroke_fill=(255, 255, 255))
circ = os.environ.get('CIRCLES')
if circ:
    for j, c in enumerate(json.load(open(circ))):
        x, y, r = c['x'] * k, c['y'] * k, c['r'] * k
        d.ellipse([x - r, y - r, x + r, y + r], outline=(0, 160, 0, 255), width=3)
        d.text((x - r, y + r - 14), 'c%d' % j, fill=(0, 110, 0), font=font, stroke_width=2, stroke_fill=(255, 255, 255))
if box:
    im = im.crop([int(v * k) for v in box])
im.save(out)
print(out, im.size)
