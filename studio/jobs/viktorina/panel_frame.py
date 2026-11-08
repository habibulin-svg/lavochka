"""Табло вопроса без швов: у panel.webp свет по рамке неровный, и при повторе краёв (border-image: round)
на стыках виден перепад. Берём по одному периоду лампочек из середины каждой стороны и раскладываем его
на всю сторону — края становятся одинаковыми по свету, повтор не даёт шва. Углы — как в оригинале,
стекло внутри рамки залито ровным #1c284e.
Срезы (px исходника) должны совпадать с border-image в viktorina.css: 78 136 107 121."""
from PIL import Image
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'lavochka/public/viktorina/art/panel.webp'
DST = sys.argv[2] if len(sys.argv) > 2 else 'lavochka/public/viktorina/art/panel-frame.webp'
T, R, B, L = 78, 136, 107, 121
PX, PY = 62.87, 55.18  # шаг лампочек по горизонтали и вертикали

im = Image.open(SRC).convert('RGBA')
W, H = im.size
out = im.copy()
x0, x1 = L, W - R
y0, y1 = T, H - B
n = round((x1 - x0) / PX)
m = round((y1 - y0) / PY)
# период из середины: верх/низ — полоса во всю высоту края, бока — во всю ширину
k = n // 2
px0 = round(x0 + k * PX)
pw = round(PX)
for band in ((0, T), (H - B, H)):
    piece = im.crop((px0, band[0], px0 + pw, band[1]))
    for i in range(n + 1):
        out.paste(piece, (round(x0 + i * PX), band[0]))
k = m // 2
py0 = round(y0 + k * PY)
ph = round(PY)
for band in ((0, L), (W - R, W)):
    piece = im.crop((band[0], py0, band[1], py0 + ph))
    for i in range(m + 1):
        out.paste(piece, (band[0], round(y0 + i * PY)))
# углы — обратно из оригинала (вставки краёв могли залезть)
for box in ((0, 0, L, T), (W - R, 0, W, T), (0, H - B, L, H), (W - R, H - B, W, H)):
    out.paste(im.crop(box), box[:2])
# стекло внутри серебряной рамки — ровный синий: тот же цвет даёт CSS-фон табло (--panel-glass), стыков не видно
from PIL import ImageDraw
ImageDraw.Draw(out).rectangle((79, 73, 1120, 688), fill=(28, 40, 78, 255))
out.save(DST, 'WEBP', quality=90)
print(DST, n, m)
