# Фрагмент оригинала с наклонной сеткой (v/h из grid-track.py) и подписями клеток.
# python crop-orig.py <оригинал> <ширина рабочей карты> <grid.json> <i0> <j0> <i1> <j1> <out.png>
import sys, json
from PIL import Image, ImageDraw, ImageFont
Image.MAX_IMAGE_PIXELS = None
src, wbase, gj = sys.argv[1], float(sys.argv[2]), sys.argv[3]
i0, j0, i1, j1 = map(int, sys.argv[4:8]); out = sys.argv[8]
img = Image.open(src).convert('RGB'); k = img.width / wbase
d = json.load(open(gj)); V = d['v']; Hh = d['h']
def corner(i, j):
    a, b = V[i][0], V[i][1]; c, e = Hh[j][0], Hh[j][1]; y = (c + e * a) / (1 - e * b); return (a + b * y) * k, y * k
x0, y0 = corner(i0, j0); x1, y1 = corner(i1 + 1, j1 + 1)
ox, oy = int(x0) - 6, int(y0) - 6
im = img.crop((ox, oy, int(x1) + 6, int(y1) + 6))
dr = ImageDraw.Draw(im); f = ImageFont.truetype('arial.ttf', 14)
for i in range(i0, i1 + 2):
    a, b = corner(i, j0), corner(i, j1 + 1); dr.line((a[0] - ox, a[1] - oy, b[0] - ox, b[1] - oy), fill=(255, 0, 0), width=1)
for j in range(j0, j1 + 2):
    a, b = corner(i0, j), corner(i1 + 1, j); dr.line((a[0] - ox, a[1] - oy, b[0] - ox, b[1] - oy), fill=(255, 0, 0), width=1)
for j in range(j0, j1 + 1):
    for i in range(i0, i1 + 1):
        p = corner(i, j); dr.text((p[0] - ox + 2, p[1] - oy + 1), f'{i},{j}', fill=(230, 0, 0), font=f)
im.save(out)
