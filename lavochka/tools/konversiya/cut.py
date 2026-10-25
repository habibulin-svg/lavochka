"""«Конверсия» — картинки из PnP-архива «Конверсия-1» (распакованные TIF) → public/konversiya/.

Запуск: python tools/konversiya/cut.py D:/temp/konv
Листы карточек — 4 × 4 карты по 284 × 414; листы «Событий в пути» поворачиваем на 90° (карта 414 × 284).
Жетоны — сетка 6 столбцов по ~149 px; заводы — 2 × 2."""
import os
import sys

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else 'D:/temp/konv'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'konversiya')
os.makedirs(os.path.join(OUT, 'cards'), exist_ok=True)


def sheet(n):
    return Image.open(os.path.join(SRC, f'conversion-cards-{n:02d}(x1).tif')).convert('RGB')


def cell(im, r, c, cw, ch, pad=6):
    return im.crop((c * cw + pad, r * ch + pad, (c + 1) * cw - pad, (r + 1) * ch - pad))


def save(im, name, w):
    im = im.copy()
    im.thumbnail((w, w * 2))
    im.save(os.path.join(OUT, name + '.webp'), quality=82, method=6)


CW, CH = 1137 / 4, 1657 / 4
# карточки собственности: (лист, ряд, столбец)
PROP = {'equipS': (1, 0, 0), 'truckS': (2, 1, 0), 'fleetS': (3, 2, 0), 'equipI': (5, 0, 0), 'fleetI': (6, 0, 0), 'truckI': (7, 1, 0)}
for key, (n, r, c) in PROP.items():
    save(cell(sheet(n), r, c, CW, CH), key, 140)

# события в пути: (лист, ряд, столбец) после поворота
EVENTS = {
    'nasa': (10, 0, 0), 'usd10': (10, 0, 1), 'usd1': (10, 0, 2), 'repair': (10, 0, 3), 'extra': (10, 2, 0), 'typhoon': (10, 2, 1), 'disaster': (10, 3, 0),
    'engine': (11, 0, 0), 'usd5': (11, 0, 1), 'maneuvers': (11, 2, 2), 'usd15': (11, 3, 1), 'strike': (11, 3, 2),
}
for key, (n, r, c) in EVENTS.items():
    im = sheet(n).rotate(90, expand=True)
    save(cell(im, r, c, 1657 / 4, 1137 / 4, 4), 'cards/' + key, 380)

# жетоны: станки советские (синие), европейские (жёлтые), компьютеры (серые)
t1 = Image.open(os.path.join(SRC, 'conversion-tokens1(x1).tif')).convert('RGB')
TW = t1.size[0] / 6
TH = t1.size[1] / 10
for key, col in (('machS', 0), ('machI', 2), ('comp', 4)):
    save(cell(t1, 0, col, TW, TH, 4), key, 110)
t2 = Image.open(os.path.join(SRC, 'conversion-tokens2(x1).tif')).convert('RGB')
TW2 = t2.size[0] / 6
TH2 = t2.size[1] / 10
save(cell(t2, 0, 0, TW2, TH2, 4), 'raw', 90)
save(cell(t2, 5, 0, TW2, TH2, 4), 'goods', 90)
pl = Image.open(os.path.join(SRC, 'conversion-plants(x2).tif')).convert('RGB')
save(cell(pl, 0, 0, pl.size[0] / 2, pl.size[1] / 2, 6), 'factory', 200)
print('ok')
