"""«Морская игра»: корабли — с фото комплекта (photo (3).jpg, красные корпуса двух рядов по четыре размера) → public/morskaya/.
python tools/morskaya/cut.py

Корпуса лежат боком на сером фоне — вырезаются по насыщенности. Зелёный флот — те же корпуса, перекрашенные (цвет как на
поле 1001.jpg). Поле рисуется кодом (src/games/morskaya/view.ts) — разрешение пользователя."""
import os
import numpy as np, cv2

SRC = 'D:/temp/настолки/морская игра/photo (3).jpg'
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'public', 'morskaya')
os.makedirs(OUT, exist_ok=True)
im = cv2.imdecode(np.fromfile(SRC, np.uint8), cv2.IMREAD_COLOR)
hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
# ряд, размер (1 — мелкий … 4 — крупный): рамки
BOX = {
    'a1': (160, 12, 285, 48), 'a2': (300, 15, 450, 52), 'a3': (475, 10, 640, 50), 'a4': (675, 5, 865, 48),
    'b1': (145, 90, 275, 125), 'b2': (295, 88, 445, 125), 'b3': (470, 78, 645, 118), 'b4': (685, 72, 875, 115),
}
for name, (x0, y0, x1, y1) in BOX.items():
    c = im[y0:y1, x0:x1].copy()
    h = hsv[y0:y1, x0:x1]
    m = ((h[..., 1] > 90) & (h[..., 2] > 60)).astype(np.uint8) * 255
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    keep = 1 + int(np.argmax(st[1:, 4]))
    m = np.where(lab == keep, 255, 0).astype(np.uint8)
    m = cv2.dilate(m, np.ones((2, 2), np.uint8))
    m = cv2.GaussianBlur(m, (3, 3), 0)
    ys, xs = np.nonzero(m > 20)
    c = c[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    a = m[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    red = np.dstack([c, a])
    cv2.imwrite(os.path.join(OUT, f'r-{name}.webp'), red, [cv2.IMWRITE_WEBP_QUALITY, 92])
    # зелёный: сдвиг оттенка красного (0) к зелёному (~70 из 180), чуть темнее
    hh = cv2.cvtColor(c, cv2.COLOR_BGR2HSV).astype(int)
    hh[..., 0] = (hh[..., 0] + 72) % 180
    hh[..., 2] = (hh[..., 2] * 0.8).astype(int)
    g = cv2.cvtColor(hh.astype(np.uint8), cv2.COLOR_HSV2BGR)
    cv2.imwrite(os.path.join(OUT, f'g-{name}.webp'), np.dstack([g, a]), [cv2.IMWRITE_WEBP_QUALITY, 92])
    print(name, c.shape[1], c.shape[0])
