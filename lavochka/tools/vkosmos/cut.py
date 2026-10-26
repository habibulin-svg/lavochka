"""«В космос»: поле, вертушка и карточка «Топливо» с фото пользователя → public/vkosmos/.
python tools/vkosmos/cut.py

Поле — снимок post69-vehfgw5 (3374×2590, плакат целиком, сверху) → 2400 px; разметка — src/games/vkosmos/map.ts.
Вертушка — post69-7llnssn: голубой диск находится по цвету, вырезается кругом с прозрачным фоном (стрелка — в игре).
«Топливо» — первая карточка листа post69-3dy9m1b (9×2 одинаковых)."""
import os
import numpy as np, cv2

P = 'D:/temp/настолки/в космос/'
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'public', 'vkosmos')
os.makedirs(OUT, exist_ok=True)
rd = lambda f: cv2.imdecode(np.fromfile(P + f, np.uint8), cv2.IMREAD_COLOR)

f = rd('post69-vehfgw5.jpg')
cv2.imwrite(os.path.join(OUT, 'board.webp'), cv2.resize(f, (2400, 1842), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_WEBP_QUALITY, 82])

sp = rd('post69-7llnssn.jpg')
hsv = cv2.cvtColor(sp, cv2.COLOR_BGR2HSV)
m = ((hsv[..., 0] > 85) & (hsv[..., 0] < 115) & (hsv[..., 1] > 80)).astype(np.uint8) * 255
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((31, 31), np.uint8))
cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
(cx, cy), r = cv2.minEnclosingCircle(max(cs, key=cv2.contourArea))
cx, cy, r = int(cx), int(cy), int(r) + 6
crop = sp[cy - r : cy + r, cx - r : cx + r]
a = np.zeros(crop.shape[:2], np.uint8)
cv2.circle(a, (r, r), r - 2, 255, -1)
a = cv2.GaussianBlur(a, (5, 5), 0)
disc = cv2.resize(np.dstack([crop, a]), (700, 700), interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(OUT, 'spinner.webp'), disc, [cv2.IMWRITE_WEBP_QUALITY, 88])
print('spinner', cx, cy, r)

fu = rd('post69-3dy9m1b.jpg')
g = cv2.cvtColor(fu, cv2.COLOR_BGR2GRAY)
dark = (g < 70).astype(np.uint8) * 255
dark = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(dark)
boxes = sorted([st[i] for i in range(1, n) if st[i][4] > 50000], key=lambda b: (b[1] // 300, b[0]))
x, y, w, h, _ = boxes[0]
cv2.imwrite(os.path.join(OUT, 'fuel.webp'), cv2.resize(fu[y : y + h, x : x + w], (160, round(160 * h / w))), [cv2.IMWRITE_WEBP_QUALITY, 88])
print('fuel', len(boxes), w, h)
