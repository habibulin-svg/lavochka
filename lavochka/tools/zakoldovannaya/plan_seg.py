"""Комнаты на плане замка: увеличить скан, тёмные линии — стены, связные серые области между ними — помещения.
Запуск: python -I plan_seg.py <план.png> <выход.json> <проверка.png>"""
import sys, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

src, out, check = sys.argv[1:4]
S = 4
im = Image.open(src).convert('L')
im = im.resize((im.width * S, im.height * S), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
a = np.asarray(im).astype(int)
dark = a < 128
dark = ndimage.binary_dilation(dark, iterations=1)
free = ~dark
lab, n = ndimage.label(free)
regions = []
for i, sl in enumerate(ndimage.find_objects(lab), 1):
    m = lab[sl] == i
    area = int(m.sum())
    if area < 40 * S * S: continue
    vals = a[sl][m]
    mean = float(vals.mean())
    if mean > 225: continue  # белый фон снаружи и мелкие белые пятна
    cy, cx = ndimage.center_of_mass(m)
    regions.append({'id': len(regions), 'label': i, 'x': round((sl[1].start + cx) / S, 1), 'y': round((sl[0].start + cy) / S, 1),
                    'bbox': [sl[1].start / S, sl[0].start / S, sl[1].stop / S, sl[0].stop / S], 'area': area // (S * S), 'mean': round(mean)})
print(src, 'regions', len(regions))
json.dump(regions, open(out, 'w'))
rgb = Image.merge('RGB', [im] * 3)
ov = np.asarray(rgb).copy()
rng = np.random.default_rng(1)
for r in regions:
    c = rng.integers(60, 255, 3)
    ov[lab == r['label']] = (ov[lab == r['label']] * 0.4 + c * 0.6).astype(np.uint8)
rgb = Image.fromarray(ov)
d = ImageDraw.Draw(rgb)
for r in regions:
    d.text((r['x'] * S - 12, r['y'] * S - 12), f"r{r['id']}", fill=(0, 0, 0), font_size=26)
rgb.save(check)
