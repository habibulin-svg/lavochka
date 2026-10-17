# Сетка с наклонными линиями: каждая линия ищется в полосах и аппроксимируется прямой.
# python grid-track.py <карта> <x0> <dx> <y0> <dy> <out.json> <check.png>
#   вертикальные: x = a + b*y; горизонтальные: y = c + d*x
import sys, json
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import uniform_filter1d
path, x0, dx, y0, dy, out, check = sys.argv[1], *map(float, sys.argv[2:6]), sys.argv[6], sys.argv[7]
img = Image.open(path).convert('RGB')
g = np.asarray(img.convert('L')).astype(float)
H, W = g.shape
dxp = np.clip(uniform_filter1d(g, 15, axis=1) - g, 0, None)
dyp = np.clip(uniform_filter1d(g, 15, axis=0) - g, 0, None)
BAND = 160
def track(prof_img, guess_lines, along, across_len, vertical):
    res = []
    for p0 in guess_lines:
        pts = []
        for s in range(0, along - BAND, BAND // 2):
            if vertical:
                prof = prof_img[s:s + BAND, :].mean(axis=0)
            else:
                prof = prof_img[:, s:s + BAND].mean(axis=1)
            lo, hi = int(p0 - 14), int(p0 + 15)
            if lo < 2 or hi > across_len - 2: continue
            seg = prof[lo:hi]
            k = int(np.argmax(seg))
            # пик должен выделяться
            if seg[k] > np.median(prof[max(0, lo - 40):hi + 40]) * 1.6:
                pts.append((s + BAND / 2, lo + k))
        if len(pts) >= 4:
            a = np.array(pts)
            # устойчивая прямая: два прохода с отбросом выбросов
            c = np.polyfit(a[:, 0], a[:, 1], 1)
            r = np.abs(np.polyval(c, a[:, 0]) - a[:, 1])
            keep = r < max(3, np.median(r) * 2.5)
            if keep.sum() >= 4: c = np.polyfit(a[keep, 0], a[keep, 1], 1)
            res.append([float(c[1]), float(c[0]), int(keep.sum())])
        else:
            res.append([float(p0), 0.0, 0])
    return res
gx = [x0 + i * dx for i in range(-int(x0 // dx), int((W - x0) // dx) + 1)]
gy = [y0 + j * dy for j in range(-int(y0 // dy), int((H - y0) // dy) + 1)]
vx = track(dxp, gx, H, W, True)
hy = track(dyp, gy, W, H, False)
json.dump({'v': vx, 'h': hy}, open(out, 'w'))
d = ImageDraw.Draw(img)
for a, b, n in vx: d.line((a, 0, a + b * H, H), fill=(255, 0, 0) if n >= 6 else (255, 200, 0), width=2)
for c, e, n in hy: d.line((0, c, W, c + e * W), fill=(255, 0, 0) if n >= 6 else (255, 200, 0), width=2)
img.save(check)
print(len(vx), len(hy))
print('v slopes', [round(b, 4) for a, b, n in vx])
print('h slopes', [round(e, 4) for c, e, n in hy])
print('v support', [n for a, b, n in vx]); print('h support', [n for c, e, n in hy])
