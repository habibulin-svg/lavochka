"""«Астронавты»: 40 двусторонних карточек из сканов «Астронавты.pdf» (страницы 3–12).

python tools/astro/cards.py <Астронавты.pdf> <public/astro/cards>
Листы идут парами: «А» — рисунки, «Б» — тексты, по 8 карточек (2×4) в чёрных рамках. Оборот зеркален по горизонтали
(двусторонняя печать): карточка «Б» в колонке col — оборот карточки «А» в колонке 1−col того же ряда. Номера —
с текстовой стороны (прочитаны глазами, NUM). Стоячие карточки (текст на листе повёрнут) поворачиваются: рисунок —
против часовой стрелки, текст — по часовой. Выход: <n>a.webp (рисунок) и <n>b.webp (текст), длинная сторона 720 px.
"""
import sys
import numpy as np, cv2, pymupdf
from PIL import Image

NUM = {  # страница текста (с 0) → номера карточек по рядам [левая, правая]; 0 — «Планета Земля»
    3: [[83, 92], [64, 131], [46, 52], [23, 79]],
    5: [[97, 127], [181, 69], [168, 72], [156, 100]],
    7: [[166, 101], [110, 5], [147, 76], [123, 90]],
    9: [[39, 159], [117, 95], [58, 137], [14, 42]],
    11: [[10, 174], [0, 19], [35, 29], [151, 143]],
}
TALL = {83, 92, 131, 79, 127, 168, 72, 156, 100, 166, 101, 5, 39, 137, 42, 10, 174, 29, 143}

doc = pymupdf.open(sys.argv[1])
out = sys.argv[2]


def page(i):
    pix = pymupdf.Pixmap(doc, doc[i].get_images(full=True)[0][0])
    return Image.frombytes('RGB', (pix.width, pix.height), pix.samples) if pix.n == 3 else Image.frombytes('RGB', (pix.width, pix.height), pymupdf.Pixmap(pymupdf.csRGB, pix).samples)


def frames(im):
    """Рамки карточек: (ряд, колонка) → прямоугольник (2481×3509, 300 dpi)."""
    g = cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2GRAY)
    cnts, _ = cv2.findContours((g < 80).astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    res = {}
    for c in cnts:
        x, y, w, h = cv2.boundingRect(c)
        if 900 < w < 1120 and 700 < h < 900:
            key = (round((y - 62) / 878), 0 if x < 600 else 1)
            if key not in res or w * h > res[key][2] * res[key][3]: res[key] = (x, y, w, h)
    assert len(res) == 8, res
    return res


for back, rows in NUM.items():
    fa, fb = page(back - 1), page(back)
    ra, rb = frames(fa), frames(fb)
    for row in range(4):
        for col in range(2):
            n = rows[row][col]
            for side, im, (x, y, w, h) in (('a', fa, ra[(row, 1 - col)]), ('b', fb, rb[(row, col)])):
                c = im.crop((x, y, x + w + 2, y + h + 2))
                if n in TALL: c = c.rotate(90 if side == 'a' else -90, expand=True)
                k = 720 / max(c.size)
                c.resize((round(c.size[0] * k), round(c.size[1] * k)), Image.LANCZOS).save(f'{out}/{n}{side}.webp', quality=82, method=6)
print('карточек:', sum(len(r) * 2 for rows in NUM.values() for r in rows) // 2)
