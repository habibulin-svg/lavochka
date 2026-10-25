"""«Конверсия» — картинки из PnP-архива «Конверсия-1» (распакованные TIF) → public/konversiya/.

Запуск: python tools/konversiya/cut.py D:/temp/konv
Листы карточек — 4 × 4 карты по 284 × 414; листы «Событий в пути» поворачиваем на 90° (карта 414 × 284).
Жетоны — сетка 6 столбцов по ~149 px (фон убирается); заводы — 2 × 2; деньги: рубли 2 × 6, доллары и кредиты — столбцом по 4."""
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
    save(cell(sheet(n), r, c, CW, CH), key, 220)

# события в пути: (лист, ряд, столбец) после поворота
EVENTS = {
    'nasa': (10, 0, 0), 'usd10': (10, 0, 1), 'usd1': (10, 0, 2), 'repair': (10, 0, 3), 'extra': (10, 2, 0), 'typhoon': (10, 2, 1), 'disaster': (10, 3, 0),
    'engine': (11, 0, 0), 'usd5': (11, 0, 1), 'maneuvers': (11, 2, 2), 'usd15': (11, 3, 1), 'strike': (11, 3, 2),
}
for key, (n, r, c) in EVENTS.items():
    im = sheet(n).rotate(90, expand=True)
    save(cell(im, r, c, 1657 / 4, 1137 / 4, 4), 'cards/' + key, 380)

# жетоны и планка завода — фото на белом: фон убираем заливкой от краёв (белое, связанное с краем), край чуть растушёван
import numpy as np
from scipy import ndimage as ndi


def cutout(im, tol=34):
    a = np.asarray(im.convert('RGB')).astype(np.int16)
    white = (255 - a).max(2) < tol
    lab, _ = ndi.label(white)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge))
    alpha = (~bg).astype(np.float32)
    alpha = ndi.gaussian_filter(alpha, 0.8)
    alpha[bg & (alpha < 0.5)] = 0
    out = np.dstack([a.astype(np.uint8), (np.clip(alpha, 0, 1) * 255).astype(np.uint8)])
    img = Image.fromarray(out, 'RGBA')
    box = img.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    return img.crop(box) if box else img


def save_rgba(im, name, w):
    im = im.copy()
    im.thumbnail((w, w * 2), Image.LANCZOS)
    im.save(os.path.join(OUT, name + '.webp'), quality=88, method=6)


t1 = Image.open(os.path.join(SRC, 'conversion-tokens1(x1).tif')).convert('RGB')
TW, TH = t1.size[0] / 6, t1.size[1] / 10
# станки советские (синие), европейские (жёлтые), компьютеры (серые)
for key, col in (('machS', 0), ('machI', 2), ('comp', 4)):
    save_rgba(cutout(cell(t1, 0, col, TW, TH, 3)), key, 120)
# жетоны сырья и товара: 1 — второй лист, 5 и 10 — третий
t2 = Image.open(os.path.join(SRC, 'conversion-tokens2(x1).tif')).convert('RGB')
t3 = Image.open(os.path.join(SRC, 'conversion-tokens3(x1).tif')).convert('RGB')
T3H = t3.size[1] / 8
for key, im, r in (('raw', t2, 0), ('goods', t2, 5), ('goods5', t3, 0), ('raw5', t3, 2), ('goods10', t3, 4), ('raw10', t3, 6)):
    save_rgba(cutout(cell(im, r, 0, TW, TH if im is t2 else T3H, 3)), key, 110)
pl = Image.open(os.path.join(SRC, 'conversion-plants(x2).tif')).convert('RGB')
save_rgba(cutout(cell(pl, 0, 0, pl.size[0] / 2, pl.size[1] / 2, 4)), 'factory', 420)

# деньги и кредитное обязательство — «банковские чеки» АСК-ГЕЙМ
ru = Image.open(os.path.join(SRC, 'conversion-money-roubles(x15).tif')).convert('RGB')
for i, v in enumerate((1, 5, 10, 20, 50, 100)):
    save(cell(ru, i, 0, ru.size[0] / 2, ru.size[1] / 6, 4), f'rub{v}', 300)
us = Image.open(os.path.join(SRC, 'conversion-money-dollars(x20).tif')).convert('RGB')
for i, v in enumerate((1, 5, 10, 20)):
    save(cell(us, i, 0, us.size[0], us.size[1] / 4, 4), f'usd{v}', 300)
cr = Image.open(os.path.join(SRC, 'conversion-money-credits(x2).tif')).convert('RGB')
save(cell(cr, 0, 0, cr.size[0], cr.size[1] / 4, 6), 'credit', 360)
print('ok')
