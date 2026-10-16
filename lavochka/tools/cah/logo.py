"""Логотип «Cards Against Humanity» с карточки PDF — растром высокой чёткости с прозрачностью
(белый — для чёрных карт, чёрный — для белых). Яркость пикселя → непрозрачность.

    python -I tools/cah/logo.py D:/temp/cah/dl/cah-ru.pdf public/cah
"""
import sys

import pymupdf
from PIL import Image

X0, Y1 = 19.9, 18.3 + 143.2  # левая верхняя карта: левый край и низ
CLIP = pymupdf.Rect(X0 + 8.4, Y1 - 21.2, X0 + 84.6, Y1 - 8.4)


def cut(d, page, out, white):
    pix = d[page].get_pixmap(dpi=500, clip=CLIP, colorspace=pymupdf.csGRAY)
    g = Image.frombytes('L', (pix.width, pix.height), pix.samples)
    alpha = g.point(lambda v: max(0, (v - 35) * 255 // 220)) if white else g.point(lambda v: 255 - v)  # фон чёрной карты — #231f20
    img = Image.new('LA', g.size, 255 if white else 0)
    img.putalpha(alpha)
    img.convert('RGBA').save(out, 'WEBP', lossless=True)
    print(out, img.size)


d = pymupdf.open(sys.argv[1])
cut(d, 1, sys.argv[2] + '/logo-black.webp', False)
cut(d, 27, sys.argv[2] + '/logo-white.webp', True)
