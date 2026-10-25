"""«Идут танки»: поле и фигурки → public/tanki/.
python tools/tanki/cut.py   (tanki.zip распакован в D:/temp/review/tanki/)

Поле — плоский скан pole.jpg 1194×1522 как есть (разметка — src/games/tanki/map.ts). Фигурки — фото photo.jpg
на белой бумаге: вырезаются по насыщенности цвета, фон прозрачный; танк, самолёт, ракета красные и зелёные."""
import os
import numpy as np, cv2

SRC = 'D:/temp/настолки/идут танки/photo.jpg'
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'public', 'tanki')
os.makedirs(OUT, exist_ok=True)
pole = cv2.imread('D:/temp/review/tanki/pole.jpg')
cv2.imwrite(os.path.join(OUT, 'board.webp'), pole, [cv2.IMWRITE_WEBP_QUALITY, 84])

im = cv2.imdecode(np.fromfile(SRC, np.uint8), cv2.IMREAD_COLOR)
hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
BOX = {
    'tank-r': (745, 455, 1075, 660),
    'tank-g': (445, 655, 805, 825),
    'plane-r': (175, 470, 565, 675),
    'plane-g': (1175, 530, 1495, 795),
    'rocket-r': (510, 155, 685, 450),
    'rocket-g': (890, 185, 1070, 465),
}
for name, (x0, y0, x1, y1) in BOX.items():
    c = im[y0:y1, x0:x1]
    h = hsv[y0:y1, x0:x1]
    m = ((h[..., 1] > 70) & (h[..., 2] > 50)).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    keep = 1 + int(np.argmax(st[1:, 4]))
    m = np.where(lab == keep, 255, 0).astype(np.uint8)
    m = cv2.GaussianBlur(m, (3, 3), 0)
    ys, xs = np.nonzero(m > 20)
    c = c[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    a = m[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    rgba = np.dstack([c, a])
    cv2.imwrite(os.path.join(OUT, f'{name}.webp'), rgba, [cv2.IMWRITE_WEBP_QUALITY, 90])
    print(name, rgba.shape[1], rgba.shape[0])
