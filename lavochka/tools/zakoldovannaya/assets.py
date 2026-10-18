"""Графика «Заколдованной страны» для сайта (из materials/zakoldovannaya → public/zakoldovannaya).
Запуск из lavochka/: python -I tools/zakoldovannaya/assets.py <materials/zakoldovannaya> <public/zakoldovannaya>"""
import sys, os
import numpy as np
import pymupdf
from PIL import Image, ImageFilter
Image.MAX_IMAGE_PIXELS = None
src, out = sys.argv[1:3]
J = lambda *p: os.path.join(*p)

def webp(im, path, q=82):
    im.save(path, 'WEBP', quality=q, method=6)

# карта: 3200 px по ширине и уменьшенная 1600 для телефонов
m = Image.open(J(src, 'ZS_igrovoye_pole_karta.jpg')).convert('RGB')
for w, name in ((3200, 'map.webp'), (1600, 'map-small.webp')):
    k = m.resize((w, round(m.height * w / m.width)), Image.LANCZOS)
    webp(k, J(out, name), 80)

# обложка коробки
c = Image.open(J(src, 'ZS_kryshka_korobki.jpg')).convert('RGB')
webp(c, J(out, 'art', 'cover.webp'), 85)

# карточки замков: страница → поиск прямоугольников карточек по не-белым областям
d = pymupdf.open(J(src, 'ZS_zamki.pdf'))
pix = d[0].get_pixmap(dpi=220)
page = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
a = np.asarray(page.convert('L'))
ink = a < 235
cols = ink.mean(axis=0) > 0.15
rows = ink.mean(axis=1) > 0.15
def runs(mask):
    out, start = [], None
    for i, v in enumerate(mask):
        if v and start is None: start = i
        if not v and start is not None:
            if i - start > 80: out.append((start, i))
            start = None
    if start is not None and len(mask) - start > 80: out.append((start, len(mask)))
    return out
xs, ys = runs(cols), runs(rows)
print('cards grid', len(xs), 'x', len(ys))
n = 0
for y0, y1 in ys:
    for x0, x1 in xs:
        crop = page.crop((x0, y0, x1, y1))
        if np.asarray(crop.convert('L')).mean() > 230: continue
        n += 1
        if n > 15: break
        crop = crop.resize((300, round(crop.height * 300 / crop.width)), Image.LANCZOS)
        webp(crop, J(out, 'castles', f'{n}.webp'), 85)
print('castle cards', n)

# планы замков: ×3, чуть резче
for f in sorted(os.listdir(J(src, 'plans'))):
    if not f.endswith('.png'): continue
    im = Image.open(J(src, 'plans', f)).convert('L')
    im = im.resize((im.width * 3, im.height * 3), Image.LANCZOS).filter(ImageFilter.UnsharpMask(2, 80, 2))
    webp(im, J(out, 'plans', f.replace('.png', '.webp')), 85)

# портреты опасностей (ч/б, 360×512)
import json
mons = json.load(open(J(os.path.dirname(__file__), '..', '..', 'src', 'games', 'zakoldovannaya', 'data', 'monsters.json'), encoding='utf-8'))
for mo in mons:
    im = Image.open(J(src, 'portraits', f"{mo['card']:03d}.png")).convert('L')
    if im.width > 400: im = im.resize((400, round(im.height * 400 / im.width)), Image.LANCZOS)
    webp(im, J(out, 'monsters', f"{mo['id']}.webp"), 78)

# иллюстрации инструкции: герои 5 классов, доспехи, оружие, вещи
d = pymupdf.open(J(src, 'ZS_instrukciya_igroka.pdf'))
art = {5: 'voin', 6: 'elf', 7: 'mag', 8: 'kron', 9: 'gnom', 12: 'armor', 13: 'weapons', 15: 'things', 3: 'intro'}
for pg, name in art.items():
    x = d[pg].get_images()[0]
    p = pymupdf.Pixmap(d, x[0])
    if p.alpha: p = pymupdf.Pixmap(p, 0)
    im = Image.frombytes('RGB' if p.n == 3 else 'L', (p.width, p.height), p.samples)
    webp(im, J(out, 'art', f'{name}.webp'), 82)
print('done')
