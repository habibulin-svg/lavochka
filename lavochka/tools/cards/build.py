#!/usr/bin/env python3
"""Сборка колод из сканов (нужны Pillow и numpy; шрифты — из C:/Windows/Fonts).

    python tools/cards/build.py ../materials/cards public/cards [atlas,slavic,russian] [pips]

Что делает с каждой колодой (atlas, slavic, russian). Рисунок колод — оригинальный, задача — читаемость
на телефоне при виде «как те самые колоды» (решения пользователя 2026-10-16):
  * тузы и фигуры — вырезка из скана, ровная бумага, плотнее краска, резкость; мелкий индекс скана стирается
    по его пикселям (на его место — цвет соседней бумаги), новый пишется крупнее рядом, не задевая рисунок и рамку;
  * индекс — гарнитурой, как на сканах колоды; один шрифт, одно ужатие, одна высота и одна маленькая масть на
    все 13 рангов; высота — наибольшая, при которой индекс встаёт на всех фигурах (место общее, сдвиг ≤ SHIFT);
  * числовые 2–10 — на чистой бумаге: значки масти из образца (или с туза), раскладка как на образцах, ряды
    и колонки одни на колоду; колонки отодвинуты, чтобы индекс на значки не наезжал;
  * без потёртостей и царапин; чёткий тёмный обрез по краю;
  * рубашка — та же «плетёнка» из cards/back.webp в оттенке колоды, только крупнее (линий меньше, они тоньше).
Выход: <out>/<колода>/<масть><ранг>.webp (S10, HA…) и back.webp, 480×744.
"""
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont

W, H = 480, 744  # выходной размер карты (58×90 мм)
RADIUS = 24
GAP = 9  # наименьший зазор между индексом и значком, px
SUITS = 'SCDH'
SCAN_SUIT = {'S': 's', 'C': 'c', 'D': 'd', 'H': 'h'}
SCAN_RANK = {11: 'J', 12: 'Q', 13: 'K', 14: 'A'}
SAMPLE = {'S': 10, 'H': 9, 'D': 8, 'C': 7}  # какая числовая карта масти есть в скане
LETTER = {11: 'В', 12: 'Д', 13: 'К', 14: 'Т'}
TEXTS = [str(r) for r in range(2, 11)] + list(LETTER.values())

FONTS = 'C:/Windows/Fonts/'
# Индекс — гарнитурой, как на сканах колоды (сверено бок о бок, решение пользователя 2026-10-16):
# одна гарнитура, одно ужатие (squeeze — ширина знаков как на скане) и одна жирность на цифры и буквы.
#   atlas   — узкий «чертёжный» гротеск с прямыми боками у 0, 8, 9 → Bahnschrift Bold Condensed (DIN);
#   slavic  — жирный узкий гротеск (В, Д, К, Т фигур) → Arial Narrow Bold;
#   russian — узкая антиква (Таймс-подобная, умеренный контраст) → Times New Roman, чуть ужирнённый обводкой.
# bold — обводка, доля высоты цифр: «чуть плотнее» оригинала, чтобы читалось мелко.
DECKS = {
    # paper — цвет бумаги после выравнивания; small — высота маленькой масти под цифрами (доля их высоты);
    # pips — откуда брать значок масти
    'atlas': {'paper': (250, 248, 240), 'font': 'bahnschrift.ttf|Bold Condensed', 'squeeze': 0.80, 'bold': 0.0, 'small': 0.44,
              'pips': 'sample', 'back': (186, 46, 38)},
    'slavic': {'paper': (250, 246, 232), 'font': 'ARIALNB.TTF', 'squeeze': 0.66, 'bold': 0.0, 'small': 0.62,
               'pips': 'ace', 'back': (150, 38, 48)},
    'russian': {'paper': (251, 249, 241), 'font': 'times.ttf', 'squeeze': 0.62, 'bold': 0.022, 'small': 0.62,
                'pips': 'sample', 'back': (160, 64, 34)},
}
XL_MAX = 0.315
PIP_Y = 0.165  # верхний ряд значков не выше этой доли высоты (не упираться в край)
INDEX_H = 0.105  # высота цифр индекса (желаемая), доля высоты карты; на всю колоду одна
K_MIN = 0.6  # меньше этой доли от INDEX_H индекс не уменьшаем
SMALL_GAP = 0.12  # зазор между цифрами (их выносными) и мастью — доля высоты цифр
EDGE = 10  # индекс не ближе к боковому обрезу, px
TOP = 22  # и к верхнему
MARGIN = 4  # и к рисунку и рамке фигур
SHIFT = 8  # насколько индекс фигуры можно сдвинуть с общего места, px
ACE_PIP = 0.23  # значок с туза (славянская колода): наибольший размер, доля ширины — как на её числовых
BACK_ZOOM = 1.7  # рубашка: тот же рисунок, крупнее — линий на карте меньше


# ---------------------------------------------------------------- вырезка и цвет

def crop_card(im: Image.Image) -> Image.Image:
    """Карта на тёмном фоне: строки и столбцы, где больше половины пикселей светлые."""
    L = im.convert('L').point(lambda v: 255 if v > 110 else 0)
    w, h = L.size
    cols = list(L.resize((w, 1), Image.BOX).get_flattened_data())
    rows = list(L.resize((1, h), Image.BOX).get_flattened_data())
    xs = [i for i, v in enumerate(cols) if v > 128]
    ys = [i for i, v in enumerate(rows) if v > 128]
    x0, x1, y0, y1 = xs[0], xs[-1], ys[0], ys[-1]
    ins = 2
    return im.crop((x0 + ins, y0 + ins, x1 - ins + 1, y1 - ins + 1))


def paper_of(im: Image.Image):
    """Цвет бумаги: медиана самых светлых пикселей."""
    small = im.convert('RGB').resize((80, 124))
    px = [p for p in small.get_flattened_data() if sum(p) > 560]
    if len(px) < 50:
        px = sorted(small.get_flattened_data(), key=sum)[-400:]
    return tuple(sorted(c[i] for c in px)[len(px) // 2] for i in range(3))


def balance(im: Image.Image, target) -> Image.Image:
    src = paper_of(im)
    bands = im.convert('RGB').split()
    out = [b.point(lambda v, k=target[i] / max(1, src[i]): min(255, int(v * k + 0.5))) for i, b in enumerate(bands)]
    return Image.merge('RGB', out)


def load_scan(deck_dir: Path, name: str, paper) -> Image.Image:
    im = Image.open(deck_dir / f'{name}.jpg').convert('RGB')
    im = balance(fit(crop_card(im)), paper)
    # краска плотнее (тёмное — к чёрному), цвет сочнее, резче — рисунок тот же
    im = im.point(lambda v: max(0, min(255, int((v - 14) * 255 / 241))))
    im = balance(im, paper)
    im = ImageEnhance.Color(im).enhance(1.15)
    im = ImageEnhance.Contrast(im).enhance(1.06)
    return im.filter(ImageFilter.UnsharpMask(radius=1.8, percent=120, threshold=2))


def fit(im: Image.Image) -> Image.Image:
    """Равномерный масштаб под W×H без растяжения: лишние пиксели поля срезаются поровну с краёв."""
    k = max(W / im.size[0], H / im.size[1])
    w, h = round(im.size[0] * k), round(im.size[1] * k)
    im = im.resize((w, h), Image.LANCZOS)
    x, y = (w - W) // 2, (h - H) // 2
    return im.crop((x, y, x + W, y + H))


# ---------------------------------------------------------------- значки с образцов

def ink_map(im: Image.Image, paper):
    """Сколько «краски» в пикселе: 0 — бумага, 255 — плотная краска."""
    pr, pg, pb = paper
    r, g, b = im.split()
    d = ImageChops.add(ImageChops.add(
        r.point(lambda v: max(0, pr - v)), g.point(lambda v: max(0, pg - v))), b.point(lambda v: max(0, pb - v)))
    d = d.point(lambda v: min(255, int(v * 255 / 180)))
    # за скруглёнными углами — фон скана, не краска
    inside = Image.new('L', im.size, 0)
    ImageDraw.Draw(inside).rounded_rectangle((3, 3, im.size[0] - 4, im.size[1] - 4), RADIUS + 4, fill=255)
    return ImageChops.multiply(d, inside)


def components(mask: Image.Image, thr=90, min_area=6):
    """Связные области краски (BFS). Возвращает список (x0, y0, x1, y1, area, точки)."""
    w, h = mask.size
    px = mask.load()
    seen = bytearray(w * h)
    out = []
    for y in range(h):
        for x in range(w):
            if seen[y * w + x] or px[x, y] < thr:
                continue
            q = deque([(x, y)])
            seen[y * w + x] = 1
            x0 = x1 = x
            y0 = y1 = y
            area = 0
            pts = []
            while q:
                cx, cy = q.popleft()
                area += 1
                pts.append((cx, cy))
                x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and px[nx, ny] >= thr:
                        seen[ny * w + nx] = 1
                        q.append((nx, ny))
            if area >= min_area:
                out.append((x0, y0, x1 + 1, y1 + 1, area, pts))
    return out


def solid_color(im: Image.Image, mask: Image.Image, box):
    """Цвет краски внутри области: медиана плотных пикселей."""
    box = box[:4]
    c = im.crop(box)
    m = mask.crop(box)
    px = [p for p, a in zip(c.get_flattened_data(), m.get_flattened_data()) if a > 200]
    if not px:
        px = list(c.get_flattened_data())
    return tuple(sorted(p[i] for p in px)[len(px) // 2] for i in range(3))


def glyph(im: Image.Image, mask: Image.Image, box, pad=2) -> Image.Image:
    """Чистый значок: сплошной цвет краски, прозрачность — по количеству краски, только в пределах самой области."""
    x0, y0, x1, y1 = box[:4]
    comp = box[5] if len(box) > 5 else None
    box = (max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad))
    color = solid_color(im, mask, box)
    a = mask.crop(box).point(lambda v: 0 if v < 25 else min(255, int((v - 25) * 255 / 150)))
    if comp:
        own = Image.new('L', a.size, 0)
        op = own.load()
        for (x, y) in comp:
            op[x - box[0], y - box[1]] = 255
        own = own.filter(ImageFilter.MaxFilter(3))  # край значка (полутона) — тоже его
        a = ImageChops.multiply(a, own)
    g = Image.new('RGBA', a.size, color + (255,))
    g.putalpha(a)
    return g


class Sample:
    """Разобранная числовая карта-образец: значок масти, раскладка, индекс (цифры и маленькая масть)."""

    def __init__(self, im: Image.Image, paper, rank: int):
        self.im = im
        self.rank = rank
        self.mask = ink_map(im, paper)
        comps = components(self.mask, thr=70, min_area=4)
        big = max(c[4] for c in comps)
        self.pips = [c for c in comps if c[4] > big * 0.45]
        upright = [c for c in self.pips if (c[1] + c[3]) / 2 < H / 2 and (c[0] + c[2]) / 2 > W / 2]
        top = min(upright, key=lambda c: c[1])
        self.pip_box = top
        self.pip = glyph(im, self.mask, top)
        cx = sorted((c[0] + c[2]) / 2 / W for c in self.pips)
        cy = sorted((c[1] + c[3]) / 2 / H for c in self.pips)
        self.xl, self.xr = cx[0], cx[-1]
        self.y0, self.y1 = cy[0], cy[-1]
        # индекс: в левом верхнем углу, не значки, не мусор и не полосы у обреза
        tl = [c for c in comps if c[4] <= big * 0.45 and c[4] >= 30 and c[0] > 6 and c[1] > 6 and c[2] < W * 0.2 and c[3] < H * 0.3 and c[3] - c[1] < H * 0.15]
        digits = [c for c in tl if c[1] < H * 0.1]
        dtop = min(c[1] for c in digits)
        dbot = max(c[3] for c in digits)
        self.digit_box = (min(c[0] for c in digits), dtop, max(c[2] for c in digits), dbot)
        under = [c for c in tl if c[1] >= dbot - 2]
        self.small_comp = min(under, key=lambda c: c[1])
        self.small_box = self.small_comp[:4]
        self.small = glyph(im, self.mask, self.small_comp, pad=1)


def ace_pip(ace: Image.Image, paper, size) -> Image.Image:
    """Большая масть в центре туза — уменьшенная до размера значка."""
    mask = ink_map(ace, paper)
    comps = components(mask)
    mid = [c for c in comps if c[0] < W / 2 < c[2] and c[1] < H / 2 < c[3]]
    box = max(mid, key=lambda c: c[4])
    g = glyph(ace, mask, box, pad=3)
    k = size / max(g.size)
    return g.resize((max(1, round(g.size[0] * k)), max(1, round(g.size[1] * k))), Image.LANCZOS)


# ---------------------------------------------------------------- числовые карты

def layout(n: int, xl: float, xr: float, y0: float, y1: float):
    xc = 0.5
    mid = (y0 + y1) / 2
    r4 = [y0 + (y1 - y0) * k / 3 for k in range(4)]
    L = lambda ys: [(xl, y) for y in ys] + [(xr, y) for y in ys]
    return {
        2: [(xc, y0), (xc, y1)],
        3: [(xc, y0), (xc, mid), (xc, y1)],
        4: L([y0, y1]),
        5: L([y0, y1]) + [(xc, mid)],
        6: L([y0, mid, y1]),
        7: L([y0, mid, y1]) + [(xc, (y0 + mid) / 2)],
        8: L([y0, mid, y1]) + [(xc, (y0 + mid) / 2), (xc, (mid + y1) / 2)],
        9: L(r4) + [(xc, mid)],
        10: L(r4) + [(xc, (r4[0] + r4[1]) / 2), (xc, (r4[2] + r4[3]) / 2)],
    }[n]


def paste_center(layer: Image.Image, g: Image.Image, cx: float, cy: float, flip=False):
    if flip:
        g = g.rotate(180)
    layer.alpha_composite(g, (round(cx - g.size[0] / 2), round(cy - g.size[1] / 2)))


class IndexFont:
    """Гарнитура индекса колоды: одна высота (по «0»), одно ужатие по ширине и одна жирность — для цифр
    и букв всех тринадцати рангов. Рисуется вчетверо крупнее и уменьшается — края чистые."""
    S = 4

    def __init__(self, spec: str, cap: int, squeeze: float, bold: float):
        S = self.S
        path, _, var = spec.partition('|')

        def font(size):
            f = ImageFont.truetype(FONTS + path, size)
            if var:
                f.set_variation_by_name(var)
            return f

        self.stroke = round(bold * cap * S)
        size = cap * S
        f = font(size)
        while True:
            bb = f.getbbox('0', stroke_width=self.stroke)
            if bb[3] - bb[1] >= cap * S:
                break
            size += 1
            f = font(size)
        self.f, self.cap, self.sq = f, cap, squeeze
        self.top = bb[1]
        # нижний край — общий для всех знаков (у «Д» выносные): масть под ним стоит на одной высоте
        self.bottom = max(f.getbbox(t, stroke_width=self.stroke)[3] for t in TEXTS)
        self.desc = max(0, round((self.bottom - bb[3]) / S))

    def image(self, text: str, color) -> Image.Image:
        """Знак индекса; верх картинки — верх цифр (с полем в 1 px)."""
        S = self.S
        bb = self.f.getbbox(text, stroke_width=self.stroke)
        a = Image.new('L', (bb[2] - bb[0] + 2 * S, self.bottom - self.top + 2 * S), 0)
        ImageDraw.Draw(a).text((S - bb[0], S - self.top), text, font=self.f, fill=255,
                               stroke_width=self.stroke, stroke_fill=255)
        a = a.resize((max(1, round(a.size[0] * self.sq / S)), round(a.size[1] / S)), Image.LANCZOS)
        out = Image.new('RGBA', a.size, color + (255,))
        out.putalpha(a)
        return out


def index_block(font: IndexFont, text: str, pip: Image.Image, color, small: float) -> Image.Image:
    """Индекс целиком: знак и маленькая масть под ним, оба по одной середине. Размеры и зазоры —
    общие на колоду, поэтому у всех карт масть стоит на одной высоте."""
    t = font.image(text, color)
    g = small_of(pip, font.cap * small)
    gy = 1 + font.cap + font.desc + round(font.cap * SMALL_GAP)
    w = max(t.size[0], g.size[0])
    blk = Image.new('RGBA', (w, gy + g.size[1] + 1), (0, 0, 0, 0))
    blk.alpha_composite(t, ((w - t.size[0]) // 2, 0))
    blk.alpha_composite(g, ((w - g.size[0]) // 2, gy))
    return blk


def block_mask(blk: Image.Image):
    return np.asarray(blk.getchannel('A')) > 30


def index_geometry(samples: dict, blocks: dict, pips: dict, dcx=None) -> dict:
    """Место индекса числовых карт (одно на колоду) и колонки значков, не задевающие самый широкий индекс."""
    med = lambda xs: sorted(xs)[len(xs) // 2]
    wmax = max(b.size[0] for b in blocks.values())
    if dcx is None:
        dcx = max(med([(sm.digit_box[0] + sm.digit_box[2]) / 2 for sm in samples.values()]), EDGE + wmax / 2)
    dtop = max(med([sm.digit_box[1] for sm in samples.values()]), TOP)
    wnum = max(blocks[str(r)].size[0] for r in range(2, 11))
    pw = max(p.size[0] for p in pips.values())
    need = (dcx + wnum / 2 + GAP + pw / 2) / W
    xl = max(med([sm.xl for sm in samples.values()]), need)
    # колонки не дальше XL_MAX от края — иначе значки сбиваются к середине; лишнее — уменьшаем значки
    pip_k = 1.0
    if xl > XL_MAX:
        pip_k = max(0.6, 2 * (XL_MAX * W - dcx - wnum / 2 - GAP) / pw)
        xl = XL_MAX
    # ряды — одни на колоду (медиана образцов), верхний и нижний не ближе PIP_Y к обрезу
    y0 = max(med([sm.y0 for sm in samples.values()]), PIP_Y)
    y1 = min(med([sm.y1 for sm in samples.values()]), 1 - PIP_Y)
    return {'pip_k': pip_k, 'xl': xl, 'y0': y0, 'y1': y1, 'dcx': round(dcx), 'dtop': round(dtop)}


def paste_index(layer: Image.Image, blk: Image.Image, cx: float, top: float):
    """Индекс в левый верхний угол и его же, повёрнутый, — в правый нижний."""
    x, y = round(cx - blk.size[0] / 2), round(top)
    layer.alpha_composite(blk, (x, y))
    layer.alpha_composite(blk.rotate(180), (W - x - blk.size[0], H - y - blk.size[1]))


def pip_card(rank: int, pip: Image.Image, blk: Image.Image, paper, geo: dict) -> Image.Image:
    """Числовая карта: значки в колонках и рядах колоды (geo), индекс — общий на колоду."""
    card = Image.new('RGBA', (W, H), paper + (255,))
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for (fx, fy) in layout(rank, geo['xl'], 1 - geo['xl'], geo['y0'], geo['y1']):
        paste_center(layer, pip, fx * W, fy * H, flip=fy > 0.5 + 1e-6)
    paste_index(layer, blk, geo['dcx'], geo['dtop'])
    card.alpha_composite(layer)
    return card.convert('RGB')


def small_of(pip: Image.Image, height: float) -> Image.Image:
    """Маленькая масть индекса — уменьшенный большой значок той же колоды (чётче, чем растянутый мелкий)."""
    k = height / pip.size[1]
    return pip.resize((max(1, round(pip.size[0] * k)), max(1, round(height))), Image.LANCZOS)


def color_ink(card: Image.Image, color) -> Image.Image:
    """Пиксели краски индекса (чёрной или красной): серая лента, цветной орнамент и бумага — не она."""
    a = np.asarray(card.convert('RGB')).astype(np.int32)
    if max(color) < 90:  # чёрная: тёмное и почти без цвета
        m = (a.sum(2) < 3 * 125) & (a.max(2) - a.min(2) < 70)
    else:
        m = ((a - np.array(color)) ** 2).sum(2) < 120 ** 2
    return Image.fromarray((m * 255).astype(np.uint8))


def erase_corner(card: Image.Image, paper, color) -> Image.Image:
    """Туз/фигура: мелкий индекс скана (буква и масть под ней в левом верхнем углу) стираем по его же
    пикселям — рисунок и рамку не трогаем."""
    mask = color_ink(card, color)
    comps = [c for c in components(mask, thr=128, min_area=4) if c[2] < W * 0.2 and c[3] < H * 0.3 and c[0] > 3 and c[1] > 3]
    letters = [c for c in comps if c[1] < H * 0.12 and c[3] - c[1] > H * 0.035 and c[2] - c[0] < W * 0.12]
    if not letters:
        return card
    letter = max(letters, key=lambda c: c[3] - c[1])
    top, lh = letter[1], letter[3] - letter[1]
    lcx = (letter[0] + letter[2]) / 2
    # части буквы (у «Д», «К» бывают отдельные штрихи) и масть под ней
    parts = [c for c in comps if c[1] >= top - 3 and c[3] <= top + lh + 3 and abs((c[0] + c[2]) / 2 - lcx) < W * 0.06]
    below = [c for c in comps if c[1] > top + lh - 2 and c[4] > 20 and abs((c[0] + c[2]) / 2 - lcx) < W * 0.06 and c[1] < top + lh + H * 0.08]
    suit = min(below, key=lambda c: c[1]) if below else None
    er = Image.new('L', (W, H), 0)
    ep = er.load()
    for c in parts + ([suit] if suit else []):
        for (x, y) in c[5]:
            ep[x, y] = 255
    # с ореолом скана (полутона и обводка от резкости) — иначе остаётся тень старой буквы
    er = er.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(1.0))
    return Image.composite(paper_fill(card, paper, er), card.convert('RGB'), er)


def paper_fill(card: Image.Image, paper, hole: Image.Image) -> Image.Image:
    """Бумага вместо стёртого: цвет соседней чистой бумаги (она на сканах неровная — плоская заливка
    оставила бы светлую «тень» буквы)."""
    a = np.asarray(card.convert('RGB')).astype(np.float32)
    keep = (np.asarray(hole) < 10) & (np.asarray(ink_map(card, paper)) < 30)
    acc = np.zeros_like(a)
    wsum = np.zeros(keep.shape, np.float32)
    for r in (6, 14, 30):  # чем дальше от края дыры, тем шире берём
        k = Image.fromarray((keep * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(r))
        kw = np.asarray(k).astype(np.float32) / 255
        ch = [np.asarray(Image.fromarray((a[..., i] * keep).astype(np.uint8)).filter(ImageFilter.BoxBlur(r))).astype(np.float32) for i in range(3)]
        avg = np.stack(ch, -1) / np.maximum(kw, 1e-3)[..., None]
        use = (wsum < 0.5) & (kw > 0.15)
        acc[use] = avg[use]
        wsum[use] = 1
    acc[wsum == 0] = paper
    return Image.fromarray(np.clip(acc, 0, 255).astype(np.uint8))


def busy_map(card: Image.Image, paper):
    """Где индексу нельзя: краска рисунка и рамки (с запасом MARGIN), обрез и скруглённый угол."""
    ink = ink_map(card, paper).point(lambda v: 255 if v > 40 else 0)
    # соринки скана (точки в пару пикселей) — не рисунок: размыкание, потом запас вокруг
    ink = ink.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MaxFilter(2 * MARGIN + 1))
    busy = np.asarray(ink) > 0
    yy, xx = np.mgrid[0:H, 0:W]
    r = RADIUS + EDGE
    corner = (xx < r) & (yy < r) & ((r - xx) ** 2 + (r - yy) ** 2 > (r - EDGE) ** 2)
    return busy | corner | (xx < EDGE) | (yy < TOP - 8)


def find_spot(busy, m, cx: float, top: float, shift: int):
    """Ближайшее к (cx, top) место, где индекс ничего не задевает: (цена сдвига, cx, top) или None."""
    h, w = m.shape
    best = None
    for dy in range(-shift, shift + 1, 2):
        for dx in range(-shift, shift + 1, 2):
            cost = abs(dx) * 1.5 + abs(dy)
            if best and cost >= best[0]:
                continue
            x, y = round(cx - w / 2) + dx, round(top) + dy
            if x < 0 or y < 0 or x + w > W or y + h > H:
                continue
            if not (busy[y:y + h, x:x + w] & m).any():
                best = (cost, x + w / 2, y)
    return best


def place_index(busy: dict, masks: dict, wmax: int, hint):
    """Одно место индекса на колоду: такое, где он встаёт на всех фигурах с наименьшими сдвигами
    (не больше SHIFT px). Возвращает (cx, top, {угол фигуры: (cx, top)}) или (None, список неудач)."""
    best, worst = None, None
    for top in range(TOP, TOP + 61, 3):
        for cx in range(EDGE + (wmax + 1) // 2, EDGE + wmax // 2 + 25, 3):
            total, spots, miss = abs(top - hint[1]) * 0.05 + abs(cx - hint[0]) * 0.05, {}, []
            for key, b in busy.items():
                spot = find_spot(b, masks[key], cx, top, SHIFT)
                if spot is None:
                    miss.append(key)
                    if worst and len(miss) >= len(worst):
                        break
                    continue
                total += spot[0]
                spots[key] = spot[1:]
                if best and total >= best[0]:
                    break
            if miss:
                if worst is None or len(miss) < len(worst):
                    worst = miss
            elif best is None or total < best[0]:
                best = (total, cx, top, spots)
    return best[1:] if best else (None, worst)


def finish(card: Image.Image) -> Image.Image:
    """Скруглённые углы и чёткий тёмный обрез — вместо потёртостей (решение пользователя 2026-10-16)."""
    S = 3
    big = Image.new('L', (W * S, H * S), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, W * S - 1, H * S - 1), RADIUS * S, fill=255)
    alpha = big.resize((W, H), Image.LANCZOS)
    line = Image.new('L', (W * S, H * S), 0)
    ImageDraw.Draw(line).rounded_rectangle((0, 0, W * S - 1, H * S - 1), RADIUS * S, outline=255, width=7)
    line = line.resize((W, H), Image.LANCZOS)
    out = Image.composite(Image.new('RGB', (W, H), (70, 60, 50)), card.convert('RGB'), line).convert('RGBA')
    out.putalpha(alpha)
    return out


# ---------------------------------------------------------------- рубашка

def back(src: Path, color, paper, seed: str) -> Image.Image:
    im = crop_card(Image.open(src).convert('RGB'))
    # тот же рисунок, но крупнее: берём середину и растягиваем — линий на карте меньше
    w, h = im.size
    cw, ch = round(w / BACK_ZOOM), round(h / BACK_ZOOM)
    im = im.crop(((w - cw) // 2, (h - ch) // 2, (w - cw) // 2 + cw, (h - ch) // 2 + ch))
    im = fit(im)
    p = paper_of(im)
    ink = ink_map(im, p)
    card = Image.new('RGB', (W, H), paper)
    # контур линий резче, а сами линии тоньше: растянутый скан мягкий и при увеличении линии толстеют —
    # берём только плотную середину линии и круто поднимаем край
    ink = ink.filter(ImageFilter.GaussianBlur(0.8)).point(lambda v: max(0, min(255, int((v - 170) * 4))))
    # соринки скана (отдельные точки) — не рисунок
    specks = Image.new('L', (W, H), 0)
    sp = specks.load()
    for c in components(ink, thr=60, min_area=1):
        if c[4] < 60:
            for (x, y) in c[5]:
                sp[x, y] = 255
    ink = ImageChops.subtract(ink, specks.filter(ImageFilter.MaxFilter(3)))
    card = Image.composite(Image.new('RGB', (W, H), color), card, ink)
    return finish(card)


def recolor(g: Image.Image, color) -> Image.Image:
    """Значок одним цветом краски (прозрачность — его же), край чуть плотнее."""
    a = g.getchannel('A').point(lambda v: min(255, int(v * 1.15)))
    out = Image.new('RGBA', g.size, color + (255,))
    out.putalpha(a)
    return out


def save(im: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, 'WEBP', quality=88, method=5)


def build(src: Path, out: Path, only=None, pips_only=False):
    for deck, cfg in DECKS.items():
        if only and deck not in only:
            continue
        ddir = src / deck
        paper = cfg['paper']
        aces = {s: load_scan(ddir, f'{SCAN_SUIT[s]}A', paper) for s in SUITS}
        samples = {s: Sample(load_scan(ddir, f'{SCAN_SUIT[s]}{SAMPLE[s]}', paper), paper, SAMPLE[s]) for s in SUITS}
        colors, pips = {}, {}
        for s in SUITS:
            sm = samples[s]
            color = solid_color(sm.im, sm.mask, sm.pip_box)
            if max(color) - min(color) < 50:  # чёрная краска — гуще
                color = tuple(int(v * 0.35) for v in color)
            pip = sm.pip
            if cfg['pips'] == 'ace':  # образцы мелкие и мутные — значки берём с туза той же колоды
                pip = ace_pip(aces[s], paper, round(ACE_PIP * W))
            colors[s], pips[s] = color, recolor(pip, color)
        # тузы и фигуры: старый индекс стёрт в обоих углах; где индексу нельзя — для каждого угла
        faces, busy = {}, {}
        for s in SUITS:
            for r in (11, 12, 13, 14):
                im = aces[s] if r == 14 else load_scan(ddir, f'{SCAN_SUIT[s]}{SCAN_RANK[r]}', paper)
                im = erase_corner(erase_corner(im, paper, colors[s]).rotate(180), paper, colors[s]).rotate(180)
                faces[s, r] = im
                busy[s, r, 0] = busy_map(im, paper)
                busy[s, r, 1] = busy_map(im.rotate(180), paper)
        # одна высота индекса на всю колоду — наибольшая, при которой он встаёт на всех фигурах, не задевая
        # рисунок и рамку (место — как у числовых, допускается небольшой сдвиг)
        k = 1.0
        while True:
            font = IndexFont(cfg['font'], round(INDEX_H * H * k), cfg['squeeze'], cfg['bold'])
            blocks = {(s, t): index_block(font, t, pips[s], colors[s], cfg['small']) for s in SUITS for t in TEXTS}
            widest = {t: max((blocks[s, t] for s in SUITS), key=lambda b: b.size[0]) for t in TEXTS}
            geo = index_geometry(samples, widest, pips)
            masks = {(s, r, c): block_mask(blocks[s, LETTER[r]]) for (s, r, c) in busy}
            wmax = max(b.size[0] for b in widest.values())
            cx, top, *rest = place_index(busy, masks, wmax, (geo['dcx'], geo['dtop'])) + (None,)
            if cx is not None:
                spots = rest[0]
                geo = index_geometry(samples, widest, pips, cx)
                geo['dtop'] = top
                break
            print(f'  {deck}: высота {font.cap}px не встаёт на', ' '.join(f'{s}{r}/{c}' for s, r, c in top))
            if k <= K_MIN:
                raise SystemExit(f'{deck}: индекс не помещается')
            k -= 0.02
        print(deck, 'индекс', font.cap, 'px', geo, 'сдвиги:',
              {f'{s}{r}/{c}': (round(v[0] - geo['dcx']), v[1] - geo['dtop']) for (s, r, c), v in spots.items() if round(v[0]) != geo['dcx'] or v[1] != geo['dtop']})
        for s in SUITS:
            sm = samples[s]
            pip = pips[s]
            if geo['pip_k'] < 1:
                pip = pip.resize((round(pip.size[0] * geo['pip_k']), round(pip.size[1] * geo['pip_k'])), Image.LANCZOS)
            for r in (() if pips_only else (11, 12, 13, 14)):
                im = faces[s, r].convert('RGBA')
                blk = blocks[s, LETTER[r]]
                for c in (0, 1):
                    cx, top = spots[s, r, c]
                    im.alpha_composite(blk, (round(cx - blk.size[0] / 2), round(top)))
                    im = im.rotate(180)
                save(finish(im), out / deck / f'{s}{r}.webp')
            for r in range(2, 11):
                im = pip_card(r, pip, blocks[s, str(r)], paper, geo)
                save(finish(im), out / deck / f'{s}{r}.webp')
        if not pips_only:
            save(back(src / 'back.webp', cfg['back'], paper, deck + 'back'), out / deck / 'back.webp')


if __name__ == '__main__':
    # необязательно: список колод через запятую и «pips» — пересобрать только числовые
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    only = sys.argv[3].split(',') if len(sys.argv) > 3 and sys.argv[3] != 'all' else None
    build(Path(sys.argv[1]), Path(sys.argv[2]), only, 'pips' in sys.argv[4:])
