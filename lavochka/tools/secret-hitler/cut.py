"""Тайный Гитлер: нарезка графики из русского цветного PnP (CC BY-NC-SA 4.0) в public/secret-hitler/.

  python -I tools/secret-hitler/cut.py probe <pnp.pdf>          — найти карточки на страницах (рамки в пикселях 300 dpi)
  python -I tools/secret-hitler/cut.py cut <pnp.pdf> <out-dir>  — нарезать всё по списку ниже в webp

PnP: Secret_Hitler_Print_and_Play_Color_A4_Scaled_RUS_with_covers.pdf (12 страниц A4 альбомом).
Карточки находятся сами (связные области не-белого после размыкания тонких линий реза), а какую взять — номер в списке страницы.
"""
import sys
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image
from scipy import ndimage

DPI = 300


def page_image(doc, i):
    pix = doc[i].get_pixmap(dpi=DPI)
    return Image.frombytes('RGB', (pix.width, pix.height), pix.samples)


def boxes(im, min_area=150 * 150):
    a = np.asarray(im).astype(np.int16)
    mx, mn = a.max(axis=2), a.min(axis=2)
    ink = (mn < 215) | ((mx - mn) > 40)
    # тонкие линии реза — убрать, крупное — склеить
    ink = ndimage.binary_opening(ink, structure=np.ones((7, 7)))
    ink = ndimage.binary_closing(ink, structure=np.ones((25, 25)))
    lab, n = ndimage.label(ink)
    out = []
    for sl in ndimage.find_objects(lab):
        y, x = sl
        w, h = x.stop - x.start, y.stop - y.start
        if w * h >= min_area:
            out.append((x.start, y.start, x.stop, y.stop))
    # по строкам сверху вниз, в строке слева направо
    out.sort(key=lambda b: (round(b[1] / 200), b[0]))
    return out


# страница → [(имя файла, номер найденной карточки, поворот, ширина)]
# поворот: градусы против часовой (PIL rotate), ширина — итоговая в пикселях
PLAN = {
    0: [('board-fascist', 0, 0, 1800), ('board-liberal', 1, 0, 1800)],
    1: [('placard-chancellor', 1, -90, 600), ('placard-president', 3, -90, 600)],
    2: [('policy-fascist', 0, -90, 300), ('policy-liberal', 'L', -90, 300)],
    3: [('role-liberal-1', 0, 0, 360), ('role-liberal-2', 1, 0, 360), ('role-liberal-3', 2, 0, 360), ('role-hitler', 3, 0, 360), ('role-fascist-1', 4, 0, 360),
        ('role-liberal-4', 5, 0, 360), ('role-liberal-5', 6, 0, 360), ('role-liberal-6', 7, 0, 360), ('role-fascist-2', 8, 0, 360), ('role-fascist-3', 9, 0, 360)],
    # у карты партии нет рамки — режем клетку целиком
    4: [('party-liberal', (230, 400, 787, 1205), 0, 300), ('party-fascist', (857, 400, 1414, 1205), 0, 300)],
    5: [('ja', 0, -90, 300)],
    6: [('nein', 0, -90, 300)],
    7: [('role-back', 0, 0, 360)],
    8: [('party-back', 0, 0, 300)],
    9: [('ballot-back', 0, -90, 300)],
    10: [('policy-back', 0, -90, 300)],
    11: [('placard-ex-chancellor', 0, -90, 600), ('placard-ex-president', 1, -90, 600), ('bullet', 2, 0, 120)],
}


def cut(pdf, out):
    out.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf)
    for page, items in PLAN.items():
        im = page_image(doc, page)
        bs = boxes(im)
        for name, k, rot, width in items:
            if k == 'L':  # первый синий (либеральный) закон
                b = next(b for b in bs if np.asarray(im.crop(b)).reshape(-1, 3).mean(axis=0)[2] > np.asarray(im.crop(b)).reshape(-1, 3).mean(axis=0)[0])
            elif isinstance(k, tuple):
                b = k
            else:
                b = bs[k]
            c = im.crop(b)
            if rot:
                c = c.rotate(rot, expand=True)
            c = c.resize((width, round(c.height * width / c.width)), Image.LANCZOS)
            c.save(out / f'{name}.webp', quality=86, method=6)
            print(name, b, c.size)


if __name__ == '__main__':
    cmd, pdf = sys.argv[1], sys.argv[2]
    if cmd == 'probe':
        doc = pymupdf.open(pdf)
        for i in range(doc.page_count):
            bs = boxes(page_image(doc, i))
            print(i, len(bs), bs)
    else:
        cut(pdf, Path(sys.argv[3]))
