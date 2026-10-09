#!/usr/bin/env python3
"""Сборка колод из сканов (нужен только Pillow).

    python tools/cards/build.py ../materials/cards public/cards

Что делает с каждой колодой (atlas, slavic, russian):
  * тузы и фигуры — вырезает карту из скана по светлой области, выравнивает цвет бумаги, скругляет углы;
  * числовые 2–10 — собирает на чистой бумаге: значки масти и маленький значок индекса вырезаны из образца
    той же масти (или из туза), цифры — шрифтом, похожим на колодный; раскладка значков снята с образцов;
  * поверх всех карт — «картон»: лёгкое зерно, неровность тона, чуть потёртые края и углы, редкие царапины
    и залом (у каждой карты свои — случай от её имени);
  * рубашка — решётка из cards/back.webp, перекрашенная в оттенок колоды.
Выход: <out>/<колода>/<масть><ранг>.webp (S10, HA…) и back.webp.
"""
import random
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

W, H = 320, 496  # выходной размер карты (58×90 мм)
RADIUS = 16
GAP = 6  # наименьший зазор между индексом и значком, px
SUITS = 'SCDH'
SCAN_SUIT = {'S': 's', 'C': 'c', 'D': 'd', 'H': 'h'}
SCAN_RANK = {11: 'J', 12: 'Q', 13: 'K', 14: 'A'}
SAMPLE = {'S': 10, 'H': 9, 'D': 8, 'C': 7}  # какая числовая карта масти есть в скане

FONTS = 'C:/Windows/Fonts/'
DECKS = {
    # paper — цвет бумаги после выравнивания; font — шрифт цифр индекса; pips — откуда брать значок масти
    'atlas': {'paper': (247, 244, 233), 'font': 'ARIALN.TTF', 'pips': 'sample', 'back': (186, 46, 38)},
    'slavic': {'paper': (247, 242, 226), 'font': 'BOD_CB.TTF', 'pips': 'ace', 'back': (150, 38, 48)},
    'russian': {'paper': (248, 246, 236), 'font': 'BOD_CR.TTF', 'pips': 'sample', 'back': (160, 64, 34)},
}


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
    return balance(fit(crop_card(im)), paper)


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


class Index:
    """Индекс туза в левом верхнем углу: буква «Т» (по ней — высота и место цифр) и маленькая масть под ней."""

    def __init__(self, ace: Image.Image, paper, fallback: 'Index | None' = None):
        mask = ink_map(ace, paper)
        comps = [c for c in components(mask, thr=70, min_area=4) if c[2] < W * 0.2 and c[3] < H * 0.3 and c[0] > 3 and c[1] > 3]
        letters = [c for c in comps if c[1] < H * 0.12 and c[3] - c[1] > H * 0.04]
        if letters:
            letter = max(letters, key=lambda c: c[3] - c[1])
            self.top, self.height = letter[1], letter[3] - letter[1]
            self.cx = (letter[0] + letter[2]) / 2
            self.color = solid_color(ace, mask, letter)
        elif fallback:  # буква слилась с орнаментом — берём место цифр с другого туза колоды
            self.top, self.height, self.cx = fallback.top, fallback.height, fallback.cx
        else:
            raise ValueError('не нашёл букву индекса на тузе')
        bottom = self.top + self.height
        below = [c for c in comps if c[1] > bottom - 2 and c[4] > 30]
        suit = min(below, key=lambda c: abs((c[0] + c[2]) / 2 - self.cx) + (c[1] - bottom) * 0.5)
        self.suit_c = ((suit[0] + suit[2]) / 2, (suit[1] + suit[3]) / 2)
        self.suit = glyph(ace, mask, suit, pad=1)


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


def digits_image(text: str, font_path: str, height: int, squeeze: float, color) -> Image.Image:
    """Цифры заданной высоты (по «0»), ужатые по ширине в squeeze раз."""
    size = height
    font = ImageFont.truetype(font_path, size)
    for _ in range(60):
        bb = font.getbbox('0')
        if bb[3] - bb[1] >= height:
            break
        size += 1
        font = ImageFont.truetype(font_path, size)
    bb = font.getbbox(text)
    img = Image.new('RGBA', (bb[2] - bb[0] + 2, bb[3] - bb[1] + 2), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((1 - bb[0], 1 - bb[1]), text, font=font, fill=color + (255,))
    return img.resize((max(1, round(img.size[0] * squeeze)), height), Image.LANCZOS)


def index_geometry(samples: dict, font_path: str) -> dict:
    """Один индекс на всю колоду: медианы по образцам всех мастей (высота цифр, ширина-ужатие, место)."""
    med = lambda xs: sorted(xs)[len(xs) // 2]
    dh = med([sm.digit_box[3] - sm.digit_box[1] for sm in samples.values()])
    def squeeze(sm):
        x0, _, x1, _ = sm.digit_box
        return (x1 - x0) / digits_image(str(sm.rank), font_path, dh, 1.0, (0, 0, 0)).size[0]

    # «10» — по настоящей десятке (пики), одиночные цифры — по девятке, восьмёрке и семёрке
    ten = [squeeze(sm) for sm in samples.values() if sm.rank == 10]
    one = [squeeze(sm) for sm in samples.values() if sm.rank != 10]
    sq1 = med(one)
    sq10 = med(ten) if ten else sq1
    # колонки значков — одни на колоду: как на образцах, но не ближе GAP к самой широкой «10»
    dcx = med([(sm.digit_box[0] + sm.digit_box[2]) / 2 for sm in samples.values()])
    w10 = digits_image('10', font_path, dh, sq10, (0, 0, 0)).size[0]
    need = max((dcx + w10 / 2 + GAP + sm.pip.size[0] / 2) / W for sm in samples.values())
    xl = max(med([sm.xl for sm in samples.values()]), need)
    return {
        'xl': xl,
        'dh': dh,
        'squeeze': sq1,
        'squeeze10': sq10,
        'dtop': med([sm.digit_box[1] for sm in samples.values()]),
        'dcx': med([(sm.digit_box[0] + sm.digit_box[2]) / 2 for sm in samples.values()]),
        'scx': med([(sm.small_box[0] + sm.small_box[2]) / 2 for sm in samples.values()]),
        'scy': med([(sm.small_box[1] + sm.small_box[3]) / 2 for sm in samples.values()]),
    }


def pip_card(rank: int, sm: Sample, pip: Image.Image, small: Image.Image, color, font_path: str, paper, geo: dict) -> Image.Image:
    """Числовая карта в масштабах образца: значки того же размера и в тех же колонках и рядах;
    индекс (высота, ширина и место цифр, место маленькой масти) — общий на всю колоду (geo)."""
    card = Image.new('RGBA', (W, H), paper + (255,))
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for (fx, fy) in layout(rank, geo['xl'], 1 - geo['xl'], sm.y0, sm.y1):
        paste_center(layer, pip, fx * W, fy * H, flip=fy > 0.5 + 1e-6)
    idx = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    t = digits_image(str(rank), font_path, geo['dh'], geo['squeeze10' if rank == 10 else 'squeeze'], color)
    idx.alpha_composite(t, (round(geo['dcx'] - t.size[0] / 2), geo['dtop']))
    sb = sm.small_box
    g = small.resize((sb[2] - sb[0] + 2, sb[3] - sb[1] + 2), Image.LANCZOS) if small.size != (sb[2] - sb[0] + 2, sb[3] - sb[1] + 2) else small
    paste_center(idx, g, geo['scx'], geo['scy'])
    layer.alpha_composite(idx)
    layer.alpha_composite(idx.rotate(180))
    card.alpha_composite(layer)
    return card.convert('RGB')


# ---------------------------------------------------------------- картон и потёртости

_NOISE = {}


def noise(size, sigma, seed):
    """Шум с нужным разбросом: кусок общей текстуры со сдвигом от seed (быстро и повторяемо)."""
    key = sigma
    if key not in _NOISE:
        rnd = random.Random(sigma)
        tw, th = 1024, 1024
        tex = Image.new('L', (tw, th))
        tex.putdata([max(0, min(255, int(rnd.gauss(128, sigma)))) for _ in range(tw * th)])
        _NOISE[key] = tex
    tex = _NOISE[key]
    w, h = size
    rnd = random.Random(seed)
    x, y = rnd.randint(0, tex.size[0] - w), rnd.randint(0, tex.size[1] - h)
    return tex.crop((x, y, x + w, y + h))


def wear(card: Image.Image, seed: str) -> Image.Image:
    rnd = random.Random(seed)
    card = card.convert('RGB')
    # зерно картона
    grain = noise((W, H), 9, seed + 'g').filter(ImageFilter.GaussianBlur(0.6))
    card = Image.blend(card, ImageChops.overlay(card, Image.merge('RGB', [grain] * 3)), 0.35)
    # неровность тона — крупные пятна в пару процентов
    mott = noise((10, 15), 30, seed + 'm').resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(18))
    shade = mott.point(lambda v: int(255 - max(0, 128 - v) * 0.10))
    card = ImageChops.multiply(card, Image.merge('RGB', [shade] * 3))
    # края: чуть темнее у обреза, углы потёрты (светлее, как стёртая краска)
    edge = Image.new('L', (W, H), 255)
    ed = ImageDraw.Draw(edge)
    ed.rounded_rectangle((0, 0, W - 1, H - 1), RADIUS, outline=232, width=2)
    ed.rounded_rectangle((2, 2, W - 3, H - 3), RADIUS - 2, outline=246, width=2)
    card = ImageChops.multiply(card, Image.merge('RGB', [edge.filter(ImageFilter.GaussianBlur(1))] * 3))
    rub = Image.new('L', (W, H), 0)
    rd = ImageDraw.Draw(rub)
    for (cx, cy) in ((0, 0), (W, 0), (0, H), (W, H)):
        for _ in range(rnd.randint(2, 5)):
            r = rnd.uniform(2, 7)
            x = cx + (rnd.uniform(3, 14) if cx == 0 else -rnd.uniform(3, 14))
            y = cy + (rnd.uniform(3, 14) if cy == 0 else -rnd.uniform(3, 14))
            rd.ellipse((x - r, y - r, x + r, y + r), fill=rnd.randint(20, 55))
    for _ in range(rnd.randint(3, 8)):  # мелкие сколы по обрезу
        side = rnd.randint(0, 3)
        t = rnd.uniform(0.1, 0.9)
        x, y = [(t * W, 1), (t * W, H - 2), (1, t * H), (W - 2, t * H)][side]
        r = rnd.uniform(1, 3)
        rd.ellipse((x - r, y - r, x + r, y + r), fill=rnd.randint(25, 60))
    rub = rub.filter(ImageFilter.GaussianBlur(1.6))
    card = Image.composite(Image.new('RGB', (W, H), (238, 234, 222)), card, rub)
    # царапины и залом — редко и очень бледно
    marks = Image.new('L', (W, H), 0)
    md = ImageDraw.Draw(marks)
    for _ in range(rnd.choice([0, 0, 1, 1, 2])):
        x, y = rnd.uniform(30, W - 30), rnd.uniform(40, H - 40)
        dx, dy = rnd.uniform(-60, 60), rnd.uniform(-25, 25)
        md.line((x, y, x + dx, y + dy), fill=rnd.randint(18, 30), width=1)
    if rnd.random() < 0.18:
        y = rnd.uniform(H * 0.25, H * 0.75)
        tilt = rnd.uniform(-30, 30)
        md.line((0, y, W, y + tilt), fill=26, width=2)
    marks = marks.filter(ImageFilter.GaussianBlur(0.7))
    card = Image.composite(Image.new('RGB', (W, H), (255, 255, 250)), card, marks)
    # скруглённые углы (сглаживание — рисуем вчетверо крупнее)
    big = Image.new('L', (W * 4, H * 4), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, W * 4 - 1, H * 4 - 1), RADIUS * 4, fill=255)
    out = card.convert('RGBA')
    out.putalpha(big.resize((W, H), Image.LANCZOS))
    return out


# ---------------------------------------------------------------- рубашка

def back(src: Path, color, paper, seed: str) -> Image.Image:
    im = Image.open(src).convert('RGB')
    im = fit(crop_card(im))
    p = paper_of(im)
    ink = ink_map(im, p)
    card = Image.new('RGB', (W, H), paper)
    card = Image.composite(Image.new('RGB', (W, H), color), card, ink.point(lambda v: min(255, int(v * 1.25))))
    return wear(card, seed)


def save(im: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, 'WEBP', quality=84, method=4)


def build(src: Path, out: Path, only=None, pips_only=False):
    for deck, cfg in DECKS.items():
        if only and deck not in only:
            continue
        ddir = src / deck
        paper = cfg['paper']
        aces = {s: load_scan(ddir, f'{SCAN_SUIT[s]}A', paper) for s in SUITS}
        samples = {s: Sample(load_scan(ddir, f'{SCAN_SUIT[s]}{SAMPLE[s]}', paper), paper, SAMPLE[s]) for s in SUITS}
        geo = index_geometry(samples, FONTS + cfg['font'])
        print(deck, 'индекс', geo)
        for s in SUITS:
            for r in (() if pips_only else (11, 12, 13, 14)):
                im = aces[s] if r == 14 else load_scan(ddir, f'{SCAN_SUIT[s]}{SCAN_RANK[r]}', paper)
                save(wear(im, f'{deck}{s}{r}'), out / deck / f'{s}{r}.webp')
            sm = samples[s]
            color = solid_color(sm.im, sm.mask, sm.pip_box)
            pip, small = sm.pip, sm.small
            if cfg['pips'] == 'ace':  # образцы мелкие и мутные — значки берём с туза той же колоды
                pip = ace_pip(aces[s], paper, max(sm.pip.size))
                small = Index(aces[s], paper, Index(aces['S'], paper)).suit
            for r in range(2, 11):
                im = pip_card(r, sm, pip, small, color, FONTS + cfg['font'], paper, geo)
                save(wear(im, f'{deck}{s}{r}'), out / deck / f'{s}{r}.webp')
        if not pips_only:
            save(back(src / 'back.webp', cfg['back'], paper, deck + 'back'), out / deck / 'back.webp')


if __name__ == '__main__':
    # необязательно: список колод через запятую и «pips» — пересобрать только числовые
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    only = sys.argv[3].split(',') if len(sys.argv) > 3 and sys.argv[3] != 'all' else None
    build(Path(sys.argv[1]), Path(sys.argv[2]), only, 'pips' in sys.argv[4:])
