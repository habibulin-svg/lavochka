"""«Полёт» (настольная игра): поле, пульт и фишки с фото → public/polet/.
python tools/polet/cut.py

Поле — четыре снимка четвертей плаката 1920×1440 (сгибы крест-накрест): склейка по SIFT-совпадениям с общей подгонкой
гомографий (правая верхняя четверть — по левой верхней и правой нижней сразу), без смешивания — каждая точка берётся с того
снимка, где она дальше от края. Затем плакат выпрямляется по углам внутренней рамки → 2400×1920.
Пульт — фото photo (2).jpg: круг со стрелкой (центр оси — 472, 378), вырезается квадратом.
Фишки — красные самолётики со снимка CSAAAgPaZuA (повёрнуты носом вверх)."""
import os
import numpy as np, cv2

P = 'D:/temp/настолки/полет/'
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'public', 'polet')
os.makedirs(OUT, exist_ok=True)
rd = lambda f: cv2.imdecode(np.fromfile(P + f, np.uint8), cv2.IMREAD_COLOR)

names = {'TL': 'T-AAAgI6ZuA-1920.jpg', 'TR': 'cgAAAgE6ZuA-1920.jpg', 'BL': 'kBAAAgI6ZuA-1920.jpg', 'BR': 'jUAAAgE6ZuA-1920.jpg'}
im = {k: rd(v) for k, v in names.items()}
sift = cv2.SIFT_create(10000)
kp = {k: sift.detectAndCompute(cv2.cvtColor(v, cv2.COLOR_BGR2GRAY), None) for k, v in im.items()}


def pairs(a, b):
    ka, da = kp[a]
    kb, db = kp[b]
    good = [x for x, y in cv2.BFMatcher().knnMatch(da, db, k=2) if x.distance < 0.72 * y.distance]
    s = np.float32([ka[g.queryIdx].pt for g in good])
    d = np.float32([kb[g.trainIdx].pt for g in good])
    _, mask = cv2.findHomography(s, d, cv2.RANSAC, 5.0)
    mk = mask.ravel() == 1
    return s[mk], d[mk]


tf = lambda pts, h: cv2.perspectiveTransform(pts.reshape(-1, 1, 2), h).reshape(-1, 2)
H = {'BL': np.eye(3)}
s, d = pairs('TL', 'BL')
H['TL'], _ = cv2.findHomography(s, d, cv2.RANSAC, 5.0)
s1, d1 = pairs('BR', 'BL')
s2, d2 = pairs('TR', 'TL')
s3, d3 = pairs('TR', 'BR')
s4, d4 = pairs('BR', 'TR')
H['BR'], _ = cv2.findHomography(s1, d1, cv2.RANSAC, 5.0)
for _ in range(4):
    H['TR'], _ = cv2.findHomography(np.vstack([s2, s3]), np.vstack([tf(d2, H['TL']), tf(d3, H['BR'])]), 0)
    H['BR'], _ = cv2.findHomography(np.vstack([s1, s4]), np.vstack([d1, tf(d4, H['TR'])]), 0)
corners = np.concatenate([cv2.perspectiveTransform(np.float32([[0, 0], [1920, 0], [1920, 1440], [0, 1440]]).reshape(-1, 1, 2), h) for h in H.values()])
x0, y0 = corners.min((0, 1))
x1, y1 = corners.max((0, 1))
T = np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1]])
W, Hh = int(x1 - x0), int(y1 - y0)
best = np.zeros((Hh, W), np.float32)
pano = np.zeros((Hh, W, 3), np.uint8)
dist = cv2.distanceTransform(np.pad(np.ones((1438, 1918), np.uint8), 1), cv2.DIST_L2, 5).astype(np.float32)
for k, h in H.items():
    w = cv2.warpPerspective(im[k], T @ h, (W, Hh))
    wm = cv2.warpPerspective(dist, T @ h, (W, Hh))
    sel = wm > best
    pano[sel] = w[sel]
    best[sel] = wm[sel]
# углы внутренней рамки плаката на склейке (сняты по увеличенным углам)
src = np.float32([[118, 237], [3765, 148], [3777, 3125], [92, 3066]])
BW, BH = 3600, 2880
M = cv2.getPerspectiveTransform(src, np.float32([[40, 40], [BW - 40, 40], [BW - 40, BH - 40], [40, BH - 40]]))
rect = cv2.warpPerspective(pano, M, (BW, BH), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
cv2.imwrite(os.path.join(OUT, 'board.webp'), cv2.resize(rect, (2400, 1920), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_WEBP_QUALITY, 80])
print('поле', W, Hh)

# пульт
pu = rd('photo (2).jpg')
cx, cy, R = 472, 378, 285
dial = pu[cy - R : cy + R, cx - R : cx + R].copy()
# сфотографированная стрелка лежит поперёк — стереть: красное в полосе через центр
hv = cv2.cvtColor(dial, cv2.COLOR_BGR2HSV)
band = np.zeros(dial.shape[:2], np.uint8)
band[R - 14 : R + 12, R - 112 : R + 112] = 1
red = (((hv[..., 0] < 10) | (hv[..., 0] > 170)) & (hv[..., 1] > 100)).astype(np.uint8)
hole = cv2.dilate(red * band, np.ones((5, 5), np.uint8))
cv2.circle(hole, (R, R), 22, 1, -1)  # ось
dial = cv2.inpaint(dial, hole * 255, 6, cv2.INPAINT_TELEA)
cv2.imwrite(os.path.join(OUT, 'dial.webp'), dial, [cv2.IMWRITE_WEBP_QUALITY, 88])

# самолётик: самый крупный целый, носом вверх
pl = rd('CSAAAgPaZuA-1920.jpg')
hsv = cv2.cvtColor(pl, cv2.COLOR_BGR2HSV)
m = (((hsv[..., 0] < 12) | (hsv[..., 0] > 165)) & (hsv[..., 1] > 90) & (hsv[..., 2] > 80)).astype(np.uint8) * 255
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(m)
i = 1 + int(np.argmax(st[1:, 4]))
x, y, w, h, _ = st[i]
c = pl[y : y + h, x : x + w]
a = cv2.GaussianBlur(np.where(lab[y : y + h, x : x + w] == i, 255, 0).astype(np.uint8), (3, 3), 0)
rgba = np.dstack([c, a])
S = int(max(w, h) * 1.5)
pad = np.zeros((S, S, 4), np.uint8)
pad[(S - h) // 2 : (S - h) // 2 + h, (S - w) // 2 : (S - w) // 2 + w] = rgba
rot = cv2.warpAffine(pad, cv2.getRotationMatrix2D((S / 2, S / 2), -45, 1), (S, S))
ys, xs = np.nonzero(rot[..., 3] > 20)
rot = rot[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
cv2.imwrite(os.path.join(OUT, 'plane.webp'), cv2.resize(rot, (200, round(200 * rot.shape[0] / rot.shape[1]))), [cv2.IMWRITE_WEBP_QUALITY, 90])
print('готово')
