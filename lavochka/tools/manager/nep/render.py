# Поле «НЭП» 2000×2000: зелёная рамка, кольцо из 40 клеток (по часовой от «Начала» в левом нижнем углу), центр — склейка с фото.
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

S, M = 2000, 34                      # сторона, ширина зелёной рамки
P = S - 2 * M
C = round(0.139 * P)                 # угловая клетка
W = (P - 2 * C) / 9
INK = (27, 26, 26)
PAPER = (246, 243, 234)
LINE = 4
FB = 'C:/Windows/Fonts/arialbd.ttf'
ICONS = 'D:/temp/nep/icons'
GROUPS = {
    'pink': (226, 72, 140), 'yellow': (226, 222, 16), 'teal': (34, 150, 140), 'purple': (48, 40, 124),
    'blue': (52, 156, 200), 'green': (84, 172, 96), 'red': (224, 64, 64), 'black': (24, 22, 22),
}
CELLS = {
    1: ('lot',), 2: ('prop', ['СЕРЕБРО', '60'], 'pink'), 3: ('txt', ['ПЛАТИ', 'НАЛОГ', '200']), 4: ('prop', ['ФАРФОР', '60'], 'pink'),
    5: ('shans',), 6: ('prop', ['ЯР', '100'], 'yellow'), 7: ('prop', ['МЕТРОПОЛЬ', '100'], 'yellow'), 8: ('txt', ['ПОРТ', 'ЮГ', '200']),
    9: ('prop', ['АСТОРИЯ', '120'], 'yellow'),
    11: ('prop', ['ТРЕЛЬЯЖ', '140'], 'teal'), 12: ('prop', ['КОМОД', '140'], 'teal'), 13: ('shans',), 14: ('prop', ['КРЕСЛО', '160'], 'teal'),
    15: ('txt', ['ЭНЕРГИЯ', '150']), 16: ('prop', ['КОЛБАСА', '180'], 'purple'), 17: ('prop', ['АНАНАСЫ', '180'], 'purple'),
    18: ('txt', ['ПОРТ', 'ЗАПАД', '200']), 19: ('prop', ['СЕВРЮГА', '200'], 'purple'),
    21: ('prop', ['ПРЯНИК', '220'], 'blue'), 22: ('prop', ['БУЛКА', '220'], 'blue'), 23: ('txt', ['ВОДА', '150']), 24: ('prop', ['ТОРТ', '240'], 'blue'),
    25: ('lot',), 26: ('prop', ['МАНТО', '260'], 'green'), 27: ('prop', ['ШУБА', '260'], 'green'), 28: ('txt', ['ПОРТ', 'СЕВЕР', '200']),
    29: ('prop', ['МЕХА', '280'], 'green'),
    31: ('prop', ['ДОНСКАЯ', '300'], 'red'), 32: ('prop', ['ОРЛОВСКАЯ', '300'], 'red'), 33: ('lot',), 34: ('prop', ['АРАБСКАЯ', '320'], 'red'),
    35: ('shans',), 36: ('txt', ['ПЛАТИ', 'НАЛОГ', '100']), 37: ('prop', ['ЖЕМЧУГ', '350'], 'black'), 38: ('txt', ['ПОРТ', 'ВОСТОК', '200']),
    39: ('prop', ['КОЛЬЦО', '400'], 'black'),
}


def font(px):
    return ImageFont.truetype(FB, px)


def fit(text, px, maxw):
    while px > 12 and font(px).getlength(text) > maxw:
        px -= 1
    return font(px)


def crisp(im):
    r, g, b, a = im.split()
    rgb = Image.merge('RGB', (r, g, b)).filter(ImageFilter.UnsharpMask(1.6, 70, 2))
    rgb = ImageEnhance.Color(rgb).enhance(1.12)
    return Image.merge('RGBA', (*rgb.split(), a))


def bar(w, h, col):
    """полоса отрасли: густой цвет у внутреннего края, к наружному и вбок — светлее"""
    y = np.linspace(0, 1, h)[:, None]
    x = np.linspace(0, 1, w)[None, :]
    t = np.clip(0.55 * y + 0.45 * x, 0, 1)[..., None] * 0.62
    c = np.array(col, np.float32) * (1 - t) + np.array(PAPER, np.float32) * t
    return Image.fromarray(c.astype(np.uint8)).convert('RGBA')


def text_lines(d, lines, w, y, px, gap):
    for s in lines:
        f = fit(s, px, w - 14)
        d.text(((w - f.getlength(s)) / 2, y), s, font=f, fill=INK)
        y += gap
    return y


def tile(i, w, h):
    t = Image.new('RGBA', (w, h), PAPER + (255,))
    d = ImageDraw.Draw(t)
    spec = CELLS[i]
    kind = spec[0]
    px, gap = 25, 29
    if kind == 'prop':
        bh = round(0.19 * h)
        t.alpha_composite(bar(w, bh, GROUPS[spec[2]]), (0, 0))
        d.rectangle([0, bh - LINE // 2, w, bh + LINE // 2 - 1], fill=INK)
        y = text_lines(d, spec[1], w, bh + 16, px, gap)
        top = max(y + 6, round(0.5 * h))
    elif kind == 'txt':
        top = text_lines(d, spec[1], w, round(0.07 * h), px, gap) + 8
    else:
        top = text_lines(d, ['ШАНС' if kind == 'shans' else 'ЛОТЕРЕЯ'], w, round(0.07 * h), px, gap) + 8
    ic = crisp(Image.open(f'{ICONS}/{i:02d}.png').convert('RGBA'))
    box_w, box_h = w - 18, h - 14 - top
    k = min(C / 277, box_w / ic.width, box_h / ic.height)
    ic = ic.resize((max(1, round(ic.width * k)), max(1, round(ic.height * k))), Image.LANCZOS)
    t.alpha_composite(ic, ((w - ic.width) // 2, top + (box_h - ic.height) // 2))
    return t


rs = np.random.RandomState(5)
green = np.array([31, 122, 69], np.int16)[None, None, :] + (rs.randn(S, S, 1) * 5).astype(np.int16)
board = Image.fromarray(np.clip(green, 0, 255).astype(np.uint8)).convert('RGBA')
d = ImageDraw.Draw(board)
d.rectangle([M, M, S - M - 1, S - M - 1], fill=PAPER + (255,))

lo, hi = M + C, S - M - C
xs = [round(lo + k * W) for k in range(10)]          # границы клеток вдоль стороны (от угла lo)
for i in range(40):
    side, k = divmod(i, 10)
    if k == 0:
        continue
    a, b = xs[k - 1], xs[k]
    t = tile(i, b - a, C)
    if side == 0:    # левый столбец, снизу вверх: k-я клетка над нижним углом
        board.alpha_composite(t.rotate(-90, expand=True), (M, S - b))
    elif side == 1:  # верхний ряд, слева направо
        board.alpha_composite(t.rotate(180, expand=True), (a, M))
    elif side == 2:  # правый столбец, сверху вниз
        board.alpha_composite(t.rotate(90, expand=True), (S - M - C, a))
    else:            # нижний ряд, справа налево
        board.alpha_composite(t, (S - b, S - M - C))

d = ImageDraw.Draw(board)
d.rectangle([M - 2, M - 2, S - M + 1, S - M + 1], outline=INK, width=5)
d.rectangle([lo - LINE // 2, lo - LINE // 2, hi + LINE // 2 - 1, hi + LINE // 2 - 1], outline=INK, width=LINE)
for x in xs + [S - v for v in xs]:
    h2 = LINE // 2
    d.rectangle([x - h2, M, x + h2 - 1, lo], fill=INK)
    d.rectangle([x - h2, hi, x + h2 - 1, S - M], fill=INK)
    d.rectangle([M, x - h2, lo, x + h2 - 1], fill=INK)
    d.rectangle([hi, x - h2, S - M, x + h2 - 1], fill=INK)


def corner_icon(name, cx, cy):
    ic = crisp(Image.open(f'{ICONS}/c_{name}.png').convert('RGBA'))
    k = C / 277
    ic = ic.resize((round(ic.width * k), round(ic.height * k)), Image.LANCZOS)
    board.alpha_composite(ic, (round(cx - ic.width / 2), round(cy - ic.height / 2)))


def rtext(lines, cx, cy, ang, px, fill=INK, gap=1.05):
    f = font(px)
    wmax = max(f.getlength(s) for s in lines)
    im = Image.new('RGBA', (int(wmax) + 20, round(px * gap * len(lines)) + 14), (0, 0, 0, 0))
    dd = ImageDraw.Draw(im)
    for n, s in enumerate(lines):
        dd.text(((im.width - f.getlength(s)) / 2, 4 + n * px * gap), s, font=f, fill=fill)
    im = im.rotate(ang, expand=True, resample=Image.BICUBIC)
    board.alpha_composite(im, (round(cx - im.width / 2), round(cy - im.height / 2)))


k = C / 277
corner_icon('tl', M + 142 * k, M + 150 * k)
rtext(['ТЕАТР'], M + 100 * k, M + 102 * k, 225, 40)
corner_icon('tr', S - M - C + 80 * k, M + 193 * k)
rtext(['ТАМОЖНЯ'], S - M - C + 150 * k, M + 128 * k, 135, 38)
corner_icon('tl', S - M - C + 120 * k, S - M - C + 121 * k)
rtext(['ПОСЕТИТЕ', 'ТЕАТР'], S - M - C + 170 * k, S - M - C + 168 * k, 45, 36, fill=(70, 70, 70))
corner_icon('bl', M + 123 * k, S - M - C + 104 * k)
rtext(['НАЧАЛО'], M + C / 2, S - M - C + 214 * k, 0, 40)

cen = Image.open('D:/temp/nep/center.png').convert('RGBA').resize((hi - lo - LINE, hi - lo - LINE), Image.LANCZOS)
board.alpha_composite(cen, (lo + LINE // 2, lo + LINE // 2))
board = board.convert('RGB')
board.save('D:/temp/nep/nep_board.png')
board.resize((1000, 1000), Image.LANCZOS).save('D:/temp/nep/nep_board_s.png')
