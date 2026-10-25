"""«Сражение» (советский «Стратего», листы для печати jakobCIT): карта и лица фишек → public/srazhenie/.
python tools/srazhenie/cut.py   (srazhenie.rar распакован в D:/temp/review/srazhenie/)

Карта — «Карта сражение.pdf» целиком (с легендой рангов сверху и снизу), 1200 px в ширину.
Фишки — листы «Фишки З/С/С и З»: над белой лицевой частью с цифрой — цветная спинка (на сгибе — стойка).
Лица одинаковы у обоих цветов (кроме знамени), берём по одному: 1…10, мина, знамя зелёное и синее → faces.webp в ряд."""
import os
import numpy as np, cv2, pymupdf

SRC = 'D:/temp/review/srazhenie/'
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'public', 'srazhenie')
os.makedirs(OUT, exist_ok=True)


def page(name: str, dpi: int) -> np.ndarray:
    pix = pymupdf.open(SRC + name)[0].get_pixmap(dpi=dpi)
    a = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
    return cv2.cvtColor(a[..., :3], cv2.COLOR_RGB2BGR)


m = page('Карта сражение.pdf', 300)
W = 1200
H = round(m.shape[0] * W / m.shape[1])
cv2.imwrite(os.path.join(OUT, 'map.webp'), cv2.resize(m, (W, H), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_WEBP_QUALITY, 82])
print('map', W, H, 'source', m.shape[1], m.shape[0])

# лист 300 dpi: столбцы x 59…2420 (10 штук), лицевые ряды y 806…1100 / 1750…2045 / 2693…2989
X0, CW = 59, (2420 - 59) / 10
ROWS = [(806, 1100), (1751, 2045), (2694, 2989)]
INSET = 10
FW, FH = 160, 200


def face(sheet: np.ndarray, row: int, col: int) -> np.ndarray:
    y0, y1 = ROWS[row]
    x0 = round(X0 + col * CW)
    x1 = round(X0 + (col + 1) * CW)
    c = sheet[y0 + INSET : y1 - INSET, x0 + INSET : x1 - INSET]
    return cv2.resize(c, (FW, FH), interpolation=cv2.INTER_AREA)


z = page('Фишки З.pdf', 300)
sz = page('Фишки С и З.pdf', 300)
PICK = [
    (z, 0, 0), (z, 0, 1), (z, 0, 2), (z, 0, 4), (z, 0, 7),  # 1 2 3 4 5
    (z, 1, 1), (z, 1, 5), (z, 1, 9), (z, 2, 4),  # 6 7 8 9
    (sz, 0, 2), (sz, 0, 3), (sz, 0, 9), (sz, 1, 3),  # 10, мина, знамя зел., знамя син.
]
strip = np.concatenate([face(*p) for p in PICK], axis=1)
cv2.imwrite(os.path.join(OUT, 'faces.webp'), strip, [cv2.IMWRITE_WEBP_QUALITY, 88])
print('faces', strip.shape[1], strip.shape[0])
