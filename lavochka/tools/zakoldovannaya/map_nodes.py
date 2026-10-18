"""Узлы карты «Заколдованной страны»: белые кружки (дорога) и розовые (места замков).
Запуск: python -I map_nodes.py <карта.jpg> <выход.json> <проверка.jpg>"""
import sys, json
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
src, out, check = sys.argv[1:4]
im = Image.open(src).convert('RGB')
a = ndimage.uniform_filter(np.asarray(im).astype(float), size=(9, 9, 1))
r, g, b = a[..., 0], a[..., 1], a[..., 2]
white = (r > 195) & (g > 180) & (b > 115) & (b < g + 10) & (abs(r - g) < 45)
pink = (r > 200) & (g < 120) & (b > 55) & (b < 150)

def disk(rad):
    y, x = np.ogrid[-rad:rad + 1, -rad:rad + 1]
    return x * x + y * y <= rad * rad

def blobs(mask, minr, maxr):
    mask = ndimage.binary_closing(mask, structure=disk(4))
    mask = ndimage.binary_opening(mask, structure=disk(int(minr * 0.8)))
    lab, n = ndimage.label(mask)
    res = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        area = (lab[sl] == i).sum()
        rr = (w + h) / 4
        if minr <= rr <= maxr and 0.75 < w / h < 1.33 and area > 0.55 * np.pi * rr * rr:
            cy, cx = ndimage.center_of_mass(lab[sl] == i)
            res.append((round(sl[1].start + cx), round(sl[0].start + cy), round(rr)))
    return res

W = im.size[0]
wn = blobs(white, W * 0.0055, W * 0.0105)
pn = blobs(pink, W * 0.009, W * 0.02)
print('white', len(wn), 'pink', len(pn))
radii = sorted(x[2] for x in wn)
print('white r', radii[:5], radii[len(radii)//2], radii[-5:])
print('pink r', sorted(x[2] for x in pn))
json.dump({'size': im.size, 'white': wn, 'pink': pn}, open(out, 'w'))
d = ImageDraw.Draw(im)
for i, (x, y, rr) in enumerate(wn):
    d.ellipse([x - rr, y - rr, x + rr, y + rr], outline=(255, 0, 0), width=6)
    d.text((x - 10, y - 8), str(i), fill=(0, 0, 0))
for i, (x, y, rr) in enumerate(pn):
    d.ellipse([x - rr, y - rr, x + rr, y + rr], outline=(0, 0, 255), width=8)
im.thumbnail((2400, 2400))
im.save(check, quality=80)
