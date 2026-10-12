"""Менеджер / Космос 2000: ассеты из print'n'play-сканов printgames.ru (materials/manager, materials/kosmos2000).

Перед запуском картинки из PDF вынуть в папки рядом с PDF (materials/<игра>/<pdf без расширения>/p<стр>_x<xref>.<ext>) —
это делает extract() ниже (нужен pymupdf). Запуск из lavochka/:  python tools/manager/build.py

public/manager/
  manager.webp      — поле «Менеджера», сшитое из четырёх четвертинок polemanager.pdf (страница 0–3)
  kosmos.webp       — поле «Космоса 2000» (вариант 2, pole2k.pdf), повёрнуто на 180°: «Старт» внизу справа, как в «Менеджере» и «Монополии»
  surpriz.webp, izveschenie.webp, fortuna.webp, astrolog.webp — рубашки карточек
  fortuna-face.webp, astrolog-face.webp — фон лицевой стороны (размытая рубашка, как на сканах)
  chip-0…3.webp, chip-bank.webp — жетоны «Космоса» (красный, фиолетовый, зелёный, жёлтый, банк)
  rub-<номинал>.webp, dub-<номинал>.webp — купюры
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageOps

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
MAT = os.path.join(ROOT, 'materials')
OUT = os.path.join(ROOT, 'lavochka', 'public', 'manager')
BOARD = 2000
Q = 82


def extract():
    import pymupdf
    for game in ('manager', 'kosmos2000'):
        d = os.path.join(MAT, game)
        for f in os.listdir(d):
            if not f.endswith('.pdf'):
                continue
            base = os.path.join(d, f[:-4])
            if os.path.isdir(base):
                continue
            os.makedirs(base)
            doc = pymupdf.open(os.path.join(d, f))
            for pi, page in enumerate(doc):
                for x in page.get_images(full=True):
                    info = doc.extract_image(x[0])
                    open(f"{base}/p{pi}_x{x[0]}.{info['ext']}", 'wb').write(info['image'])


def first(d, page=0):
    d = os.path.join(MAT, d)
    fs = sorted(f for f in os.listdir(d) if f.startswith(f'p{page}_'))
    return Image.open(os.path.join(d, fs[0])).convert('RGB')


def trim(im, thr=235, pad=0):
    g = ImageOps.invert(im.convert('L')).point(lambda v: 255 if v > 255 - thr else 0)
    box = g.getbbox()
    if not box:
        return im
    l, t, r, b = box
    return im.crop((max(0, l - pad), max(0, t - pad), min(im.width, r + pad), min(im.height, b + pad)))


def save(im, name, q=Q):
    im.save(os.path.join(OUT, name), 'WEBP', quality=q, method=6)
    print(name, im.size)


def boards():
    # «Менеджер»: четвертинки абсолютно стыкуются (рамки найдены по тёмным пикселям)
    d = os.path.join(MAT, 'manager', 'polemanager')
    fs = sorted(os.listdir(d), key=lambda f: int(f[1:f.index('_')]))
    boxes = [(354, 98, 2570, 2711), (155, 98, 2767, 2711), (354, 959, 2570, 3175), (155, 959, 2767, 3175)]
    q = [Image.open(os.path.join(d, f)).convert('RGB').crop(b) for f, b in zip(fs, boxes)]
    full = Image.new('RGB', (q[0].width + q[1].width, q[0].height + q[2].height))
    full.paste(q[0], (0, 0))
    full.paste(q[1], (q[0].width, 0))
    full.paste(q[2], (0, q[0].height))
    full.paste(q[3], (q[0].width, q[0].height))
    save(full.resize((BOARD, BOARD), Image.LANCZOS), 'manager.webp')

    # «Космос 2000», вариант 2: четыре листа встык; поворот на 180° — «Старт» внизу справа, ход влево по нижнему ряду (решение пользователя)
    d = os.path.join(MAT, 'kosmos2000', 'pole2k')
    fs = sorted(os.listdir(d), key=lambda f: int(f[1:f.index('_')]))
    q = [Image.open(os.path.join(d, f)).convert('RGB') for f in fs]
    w0, h0 = q[0].size
    full = Image.new('RGB', (w0 + q[1].width, h0 + q[2].height))
    full.paste(q[0], (0, 0))
    full.paste(q[1], (w0, 0))
    full.paste(q[2], (0, h0))
    full.paste(q[3], (w0, h0))
    full = full.rotate(180)
    save(full.resize((BOARD, BOARD), Image.LANCZOS), 'kosmos.webp')


def card_back(pdf, name):
    """Рубашка — левая верхняя карточка листа рубашек (первая страница PDF), рендер с рамкой из PDF."""
    import io
    import pymupdf
    page = pymupdf.open(os.path.join(MAT, pdf))[0]
    pm = page.get_pixmap(dpi=300, clip=pymupdf.Rect(40, 50, 175, 240))
    card = trim(Image.open(io.BytesIO(pm.tobytes('png'))).convert('RGB'), 120)
    save(card.resize((240, int(240 * card.height / card.width)), Image.LANCZOS), name)


def kosmos_cards():
    for src, name in (('fortunalico', 'fortuna'), ('astrologlico', 'astrolog')):
        im = first(os.path.join('kosmos2000', src))
        im = im.resize((300, int(300 * im.height / im.width)), Image.LANCZOS)
        save(im, f'{name}.webp')
        face = im.filter(ImageFilter.GaussianBlur(9))
        if name == 'fortuna':
            face = ImageOps.colorize(face.convert('L'), '#6a4a2a', '#fffaf2')
        face = Image.blend(face, Image.new('RGB', face.size, 'white'), 0.35 if name == 'fortuna' else 0.2)
        save(face, f'{name}-face.webp', 70)


def chips():
    d = os.path.join(MAT, 'kosmos2000', 'fishki')
    order = [('p0_x7', 'chip-0'), ('p0_x8', 'chip-1'), ('p0_x9', 'chip-2'), ('p1_x65', 'chip-3'), ('p1_x66', 'chip-bank')]
    for src, name in order:
        f = next(x for x in os.listdir(d) if x.startswith(src + '.'))
        im = Image.open(os.path.join(d, f)).convert('RGB')
        s = min(im.size)
        im = im.crop((0, 0, s, s)).resize((128, 128), Image.LANCZOS).convert('RGBA')
        mask = Image.new('L', (512, 512), 0)
        ImageDraw.Draw(mask).ellipse((10, 10, 502, 502), fill=255)
        im.putalpha(mask.resize((128, 128), Image.LANCZOS))
        save(im, f'{name}.webp', 85)


def notes():
    # «Менеджер»: на листе 5×4 одинаковых купюр — берём левую верхнюю
    for pdf, value in zip((5, 6, 7, 8, 9, 10, 11), (100, 500, 1000, 2000, 5000, 10000, 50000)):
        page = first(os.path.join('manager', str(pdf)))
        w, h = page.size
        note = trim(page.crop((int(w * 0.03), int(h * 0.04), int(w * 0.215), int(h * 0.285))), 225)
        save(note.resize((120, int(120 * note.height / note.width)), Image.LANCZOS), f'rub-{value}.webp')
    # «Космос 2000»: горизонтальная купюра с корешком, корешок отрезаем
    for page, value in zip(range(4), (500, 100, 50, 10)):
        d = os.path.join(MAT, 'kosmos2000', 'dengi')
        f = next(x for x in sorted(os.listdir(d)) if x.startswith(f'p{page}_') and Image.open(os.path.join(d, x)).width > 1000)
        im = Image.open(os.path.join(d, f)).convert('RGB')
        im = im.crop((0, 0, int(im.width * 0.775), im.height))
        save(im.resize((240, int(240 * im.height / im.width)), Image.LANCZOS), f'dub-{value}.webp')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    extract()
    what = sys.argv[1:] or ['boards', 'backs', 'kosmos', 'chips', 'notes']
    if 'boards' in what:
        boards()
    if 'backs' in what:
        card_back(os.path.join('manager', 'surpriz.pdf'), 'surpriz.webp')
        card_back(os.path.join('manager', 'izveschenie.pdf'), 'izveschenie.webp')
    if 'kosmos' in what:
        kosmos_cards()
    if 'chips' in what:
        chips()
    if 'notes' in what:
        notes()
