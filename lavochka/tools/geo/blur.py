"""Размытие названий территорий на флагах и гербах «Географии».

Рамки — в tools/geo/blur.json: {"a/ago": [[x0, y0, x1, y1], …], "f/us-id": […]} — доли ширины и высоты картинки (0…1),
по рамке на надпись. Размываем только названия латиницей/кириллицей; девизы и нелатинское письмо не трогаем (решение пользователя).

Оригиналы хранятся в OUT_ORIG (вне git): размытие всегда делается с оригинала, поэтому прогон можно повторять сколько угодно,
а wiki.py после закачки новых картинок просто зовёт apply(). Запуск:
  python tools/geo/blur.py            — применить все рамки
  python tools/geo/blur.py a/ago      — только эти картинки
  python tools/geo/blur.py --grid a/ago   — картинка с координатной сеткой для разметки (D:/temp/geo-blur/grid)
  python tools/geo/blur.py --check a/ago  — «до | после» рядом (D:/temp/geo-blur/check)
  --boxes FILE.json — рамки из FILE поверх blur.json (для --check: разметка в своём файле, не трогая общий)
"""
import json
import os
import shutil
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
PUB = os.path.join(ROOT, 'public', 'geo')
BOXES = os.path.join(os.path.dirname(__file__), 'blur.json')
OUT_ORIG = os.environ.get('GEO_ORIG', 'D:/temp/geo-blur/orig')
WORK = 'D:/temp/geo-blur'


EXTRA = None  # --boxes FILE: рамки поверх blur.json


def load_boxes():
    boxes = {}
    for p in (BOXES, EXTRA):
        if p and os.path.exists(p):
            with open(p, encoding='utf-8') as f:
                boxes.update(json.load(f))
    return boxes


def original(key):
    """Путь к оригиналу картинки key («a/ago»); при первом обращении — копия из public."""
    src = os.path.join(PUB, key + '.webp')
    orig = os.path.join(OUT_ORIG, key + '.webp')
    if not os.path.exists(orig):
        os.makedirs(os.path.dirname(orig), exist_ok=True)
        shutil.copyfile(src, orig)
    return orig


def blurred(im, boxes):
    """Каждая рамка: сильное размытие с мягким краем; прозрачность сохраняется."""
    im = im.convert('RGBA')
    w, h = im.size
    out = im.copy()
    for x0, y0, x1, y1 in boxes:
        bx0, by0, bx1, by1 = int(x0 * w), int(y0 * h), int(x1 * w + 0.999), int(y1 * h + 0.999)
        bh = max(4, min(by1 - by0, bx1 - bx0))
        radius = max(2.0, bh * 0.28)
        feather = max(1, int(radius * 0.4))
        # область с запасом под мягкий край снаружи рамки
        cx0, cy0, cx1, cy1 = max(0, bx0 - feather * 2), max(0, by0 - feather * 2), min(w, bx1 + feather * 2), min(h, by1 + feather * 2)
        crop = im.crop((cx0, cy0, cx1, cy1))
        rgb = Image.new('RGBA', crop.size, (0, 0, 0, 0))
        rgb.alpha_composite(crop)
        # медиана стирает тонкие штрихи букв, сохраняя крупные формы и края ленты; затем лёгкое размытие поверх
        size = max(3, int(bh * 0.45) | 1)
        soft = rgb
        for _ in range(3):
            soft = soft.filter(ImageFilter.MedianFilter(min(size, 61)))
        soft = soft.filter(ImageFilter.GaussianBlur(max(1.0, radius * 0.35)))
        # внутри рамки — полная замена, мягкий переход только наружу
        box = [bx0 - cx0, by0 - cy0, bx1 - cx0, by1 - cy0]
        hard = Image.new('L', crop.size, 0)
        ImageDraw.Draw(hard).rectangle(box, fill=255)
        mask = ImageChops.lighter(hard.filter(ImageFilter.GaussianBlur(feather)).point(lambda v: min(255, v * 2)), hard)
        part = out.crop((cx0, cy0, cx1, cy1))
        part = Image.composite(soft, part, mask)
        out.paste(part, (cx0, cy0))
    return out


def apply(keys=None):
    boxes = load_boxes()
    done = 0
    for key, bs in boxes.items():
        if keys and key not in keys:
            continue
        if not os.path.exists(os.path.join(PUB, key + '.webp')) and not os.path.exists(os.path.join(OUT_ORIG, key + '.webp')):
            print('нет картинки:', key)
            continue
        im = Image.open(original(key))
        blurred(im, bs).save(os.path.join(PUB, key + '.webp'), 'WEBP', quality=86, method=6)
        done += 1
    return done


def grid(key):
    """Увеличенная картинка с сеткой через 0.05 и подписями — по ней размечают рамки в долях."""
    im = Image.open(original(key)).convert('RGBA')
    k = max(1, 900 // max(im.size))
    im = im.resize((im.width * k, im.height * k), Image.LANCZOS)
    M = 40
    can = Image.new('RGB', (im.width + M, im.height + M), (255, 255, 255))
    can.paste(im, (M, M), im)
    d = ImageDraw.Draw(can)
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 13)
    for i in range(21):
        f = i / 20
        x = M + f * im.width
        y = M + f * im.height
        major = i % 2 == 0
        col = (255, 0, 0) if major else (255, 160, 160)
        d.line([(x, M), (x, M + im.height)], fill=col, width=1)
        d.line([(M, y), (M + im.width, y)], fill=col, width=1)
        if major:
            d.text((x - 10, 4), f'{f:.1f}', fill=(200, 0, 0), font=font)
            d.text((2, y - 7), f'{f:.1f}', fill=(200, 0, 0), font=font)
    os.makedirs(os.path.join(WORK, 'grid'), exist_ok=True)
    p = os.path.join(WORK, 'grid', key.replace('/', '-') + '.png')
    can.save(p)
    return p


def check(key):
    """«До | после» рядом, увеличенно, на белом и на тёмном фоне."""
    a = Image.open(original(key)).convert('RGBA')
    b = blurred(a, load_boxes().get(key, []))
    k = max(1, 600 // max(a.size))
    a = a.resize((a.width * k, a.height * k), Image.LANCZOS)
    b = b.resize((b.width * k, b.height * k), Image.LANCZOS)
    can = Image.new('RGB', (a.width * 2 + 30, a.height + 20), (255, 255, 255))
    can.paste(a, (10, 10), a)
    can.paste(b, (a.width + 20, 10), b)
    os.makedirs(os.path.join(WORK, 'check'), exist_ok=True)
    p = os.path.join(WORK, 'check', key.replace('/', '-') + '.png')
    can.save(p)
    return p


if __name__ == '__main__':
    argv = sys.argv[1:]
    if '--boxes' in argv:
        i = argv.index('--boxes')
        EXTRA = argv[i + 1]
        del argv[i:i + 2]
    args = [a for a in argv if not a.startswith('--')]
    if '--grid' in sys.argv:
        for k in args:
            print(grid(k))
    elif '--check' in sys.argv:
        for k in args:
            print(check(k))
    else:
        print('размыто картинок:', apply(set(args) or None))
