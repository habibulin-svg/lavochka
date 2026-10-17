# Стрелки течений: тёмные вытянутые компоненты (линии сетки вырезаны), голова — по ширине у конца.
# python arrows2.py <оригинал> <ширина рабочей карты> <grid v/h json> <mask.txt> <out.json> <check.png> [порог]
import sys, json, math
import numpy as np, cv2
from PIL import Image
src, wbase, gj, maskf, out, check = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6]
thr = float(sys.argv[7]) if len(sys.argv) > 7 else 9
img = cv2.cvtColor(np.asarray(Image.open(src).convert('RGB')), cv2.COLOR_RGB2BGR)
k = img.shape[1] / wbase
d = json.load(open(gj)); V = [(a * k, b) for a, b, *_ in d['v']]; Hh = [(c * k, e) for c, e, *_ in d['h']]
H, W = img.shape[:2]
mask = [l.rstrip('\n')[4:] for l in open(maskf, encoding='utf-8') if l[:3].strip().isdigit()]
g = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (3, 3), 0).astype(float)
B, G, R = [img[..., c].astype(int) for c in range(3)]
m = (((cv2.blur(g, (21, 21)) - g) > thr) & ~((B > R + 25) & (B > G + 30)) & ~((R > G + 50) & (R > B + 20))).astype(np.uint8)
yy, xx = np.mgrid[0:H, 0:W]
band = int(5 * k)
for a, b in V:
    xl = a + b * np.arange(H)
    for y in range(H):
        x0 = int(xl[y]); m[y, max(0, x0 - band):x0 + band + 1] = 0
for c, e in Hh:
    yl = c + e * np.arange(W)
    for x in range(W):
        y0 = int(yl[x]); m[max(0, y0 - band):y0 + band + 1, x] = 0
def corner(i, j):
    a, b = V[i]; c, e = Hh[j]; y = (c + e * a) / (1 - e * b); return a + b * y, y
def cell_of(x, y):
    for j in range(len(Hh) - 1):
        for i in range(len(V) - 1):
            x0, y0 = corner(i, j); x1, y1 = corner(i + 1, j + 1)
            if x0 <= x < x1 and y0 <= y < y1: return i, j
    return None
n, lab, st, cen = cv2.connectedComponentsWithStats(m, 8)
res = []
for q in range(1, n):
    x, y, w, h, area = st[q]
    L0 = math.hypot(w, h)
    if area < 20 * k or L0 < 26 * k or max(w, h) > 120 * k: continue
    pts = np.argwhere(lab[y:y + h, x:x + w] == q).astype(float); pts[:, 0] += y; pts[:, 1] += x
    c = pts.mean(axis=0); u, s, vt = np.linalg.svd(pts - c, full_matrices=False); v = vt[0]
    pr = (pts - c) @ v; L = pr.max() - pr.min()
    pp = np.abs((pts - c) @ np.array([-v[1], v[0]]))
    if L < 26 * k or np.median(pp) > 2.5 * k or area / L > 6 * k: continue
    hi = pp[pr > pr.max() - L * 0.22].mean(); lo = pp[pr < pr.min() + L * 0.22].mean()
    tipEnd = pr.max() if hi > lo else pr.min()
    tailEnd = pr.min() if hi > lo else pr.max()
    tip = c + v * tipEnd; tail = c + v * tailEnd
    cc = cell_of(c[1], c[0])
    if not cc: continue
    i, j = cc
    if j >= len(mask) or mask[j][i] == '#': continue
    ang = math.degrees(math.atan2(tip[0] - tail[0], tip[1] - tail[1]))  # 0 — восток, 90 — юг
    res.append({'cell': [i, j], 'tail': [round(tail[1] / k), round(tail[0] / k)], 'tip': [round(tip[1] / k), round(tip[0] / k)], 'ang': round(ang), 'head': round(abs(hi - lo), 1), 'L': round(L / k)})
json.dump(res, open(out, 'w'))
vis = cv2.resize(img, (int(wbase), int(H / k)))
for r in res:
    col = (0, 0, 255) if r['head'] > 1.2 else (0, 180, 255)
    cv2.arrowedLine(vis, tuple(r['tail']), tuple(r['tip']), col, 3, tipLength=0.35)
cv2.imwrite(check, vis)
print(len(res))
