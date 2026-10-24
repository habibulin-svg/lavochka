"""«Освоение галактики» (советский «Риск»): поле и рубашка карточек из скана пользователя (D:/temp/настолки/риск — личные материалы).
python tools/galaktika/cut.py [папка]  →  public/galaktika/map.webp (4000 px), map-small.webp, back.webp

Поле — 4 листа Поле.pdf (300 dpi), листы перекрываются на 43 px (найдено корреляцией границ), полосы обреза закрашены inpaint."""
import os, sys
import numpy as np, cv2, pymupdf

SRC = sys.argv[1] if len(sys.argv) > 1 else 'D:/temp/настолки/риск'
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'galaktika')
os.makedirs(OUT, exist_ok=True)

d = pymupdf.open(os.path.join(SRC, 'Поле.pdf'))
P = []
for p in d:
    big = max(p.get_image_info(xrefs=True), key=lambda x: x['width'] * x['height'])
    z = 300 / 72
    pix = p.get_pixmap(matrix=pymupdf.Matrix(z, z), clip=pymupdf.Rect(big['bbox']))
    a = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w, pix.n)[..., :3]
    P.append(cv2.cvtColor(a, cv2.COLOR_RGB2BGR))
pos = [(0, 0), (3276, 0), (0, 2248), (3276, 2248)]
W, H = 3276 + P[1].shape[1], 2248 + P[2].shape[0]
m = np.zeros((H, W, 3), np.uint8)
for k, ((x, y), p) in enumerate(zip(pos, P)):
    tx = 2 if k in (1, 3) else 0
    ty = 2 if k in (2, 3) else 0
    q = p[ty:p.shape[0] - 1, tx:p.shape[1] - 1]
    m[y + ty:y + ty + q.shape[0], x + tx:x + tx + q.shape[1]] = q
m = m[2:H - 2, 2:W - 2]
mask = np.zeros(m.shape[:2], np.uint8)
mask[:, 3270:3275] = 255
mask[2242:2248, :] = 255
m = cv2.inpaint(m, mask, 4, cv2.INPAINT_TELEA)
w = 4000
h = round(m.shape[0] * w / m.shape[1])
cv2.imwrite(os.path.join(OUT, 'map.webp'), cv2.resize(m, (w, h), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_WEBP_QUALITY, 80])
cv2.imwrite(os.path.join(OUT, 'map-small.webp'), cv2.resize(m, (300, round(300 * h / w)), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_WEBP_QUALITY, 60])
# рубашка карточки — с листа «Локации_3» (розовая, с космонавтом)
b = cv2.imdecode(np.fromfile(os.path.join(SRC, 'Локации_3.jpg'), np.uint8), cv2.IMREAD_COLOR)
cv2.imwrite(os.path.join(OUT, 'back.webp'), b[420:604, 612:900], [cv2.IMWRITE_WEBP_QUALITY, 85])
print('ok', w, h)
