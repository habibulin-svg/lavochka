# Превью карточки «Морских стратегий»: кусок карты «Пиратов» с кораблями-кружками в позиции def.showcase().
#   python tools/sea/thumb.py  →  public/thumbs/sea.webp (480×300)
import json
from PIL import Image, ImageDraw
g = json.load(open('tools/sea/piraty-grid.json'))
xs, ys = g['xs'], g['ys']
cell = lambda i, j: ((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2)
COL = ['#d8241c', '#2060d0', '#2a9a3a', '#e8b020']
# корабль: (диск, x, y, владелец) — как в showcase: места 0 и 2 — испанцы? нет: 4 игрока → 1 испанец (3 галиона), 3 пирата по 2 бригантины
ships = [(0, 22, 15, 0), (1, 26, 13, 0), (2, 27, 15, 0), (3, 28, 12, 1), (4, 29, 14, 1), (5, 24, 17, 2), (6, 33, 9, 2), (7, 18, 18, 3), (8, 40, 6, 3)]
x0, y0, W = 940, 380, 1500
H = W * 300 // 480
im = Image.open('public/piraty/field.webp').convert('RGBA').crop((x0, y0, x0 + W, y0 + H))
d = ImageDraw.Draw(im)
R = 30
for disc, i, j, own in ships:
    cx, cy = cell(i, j); cx -= x0; cy -= y0
    d.ellipse((cx - R - 9, cy - R - 9, cx + R + 9, cy + R + 9), fill='#111')
    d.ellipse((cx - R - 6, cy - R - 6, cx + R + 6, cy + R + 6), fill=COL[own])
    t = Image.open(f'public/sea/disc{disc}.webp').convert('RGBA').resize((2 * R, 2 * R), Image.LANCZOS)
    im.alpha_composite(t, (int(cx - R), int(cy - R)))
    if disc == 1:
        d.ellipse((cx - R - 13, cy - R - 13, cx + R + 13, cy + R + 13), outline='#ffd23a', width=5)
im = im.resize((480, 300), Image.LANCZOS).convert('RGB')
im.save('public/thumbs/sea.webp', quality=86)
print('ok')
