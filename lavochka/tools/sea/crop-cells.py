# Фрагмент оригинала по клеткам: python crop-cells.py <оригинал> <ширина рабочей карты> <grid.json> <i0> <j0> <i1> <j1> <out.png>
import sys, json
from PIL import Image, ImageDraw, ImageFont
src, wbase, gj = sys.argv[1], float(sys.argv[2]), sys.argv[3]
i0, j0, i1, j1 = map(int, sys.argv[4:8]); out = sys.argv[8]
img = Image.open(src).convert('RGB'); k = img.width / wbase
d = json.load(open(gj)); xs = [x * k for x in d['xs']]; ys = [y * k for y in d['ys']]
im = img.crop((int(xs[i0]), int(ys[j0]), int(xs[i1 + 1]), int(ys[j1 + 1])))
dr = ImageDraw.Draw(im); f = ImageFont.truetype('arial.ttf', 13)
for i in range(i0, i1 + 2):
    x = xs[i] - xs[i0]; dr.line((x, 0, x, im.height), fill=(255, 0, 0), width=1)
for j in range(j0, j1 + 2):
    y = ys[j] - ys[j0]; dr.line((0, y, im.width, y), fill=(255, 0, 0), width=1)
for j in range(j0, j1 + 1):
    for i in range(i0, i1 + 1):
        dr.text((xs[i] - xs[i0] + 2, ys[j] - ys[j0] + 1), f'{i},{j}', fill=(230, 0, 0), font=f)
im.save(out)
