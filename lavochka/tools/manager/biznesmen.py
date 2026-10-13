"""«Бизнесмен» (МТО «Парадокс», Ростов-на-Дону, 1990): ассеты из materials/nastolki/biznesmen/ (сканы, нарезка агентов).

public/manager/
  biznesmen.webp        — поле 2000×2000, «Старт» и так внизу справа
  bm-surpriz.webp, bm-izv.webp — рубашки колод: клетки «Сюрприз» и «Извещение» с поля
  bm-rub-<номинал>.webp — купюра (первая на листе распечатки)
  bm-share-<цвет>.webp  — акция четырёх цветов табло (жёлтая, красная, бирюзовая, белая)

Запуск из lavochka/:  python -I tools/manager/biznesmen.py
"""
import os

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(ROOT, 'materials', 'nastolki', 'biznesmen')
OUT = os.path.join(ROOT, 'lavochka', 'public', 'manager')
Q = 82


def note(path, name):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    # на листе распечатки купюры по 2×3 и одна повёрнутая; первая — левая верхняя
    c = im.crop((4, 4, int(w * 0.385), int(h * 0.32)))
    c.thumbnail((240, 240), Image.LANCZOS)
    c.save(os.path.join(OUT, name), quality=Q, method=6)


def main():
    im = Image.open(os.path.join(SRC, 'field.webp')).convert('RGB')
    im.resize((2000, 2000), Image.LANCZOS).save(os.path.join(OUT, 'biznesmen.webp'), quality=Q, method=6)
    # клетки 7 «Сюрприз» и 4 «Извещение» нижнего ряда (картинка с надписью)
    for name, box in (('bm-surpriz', (1810, 4990, 2250, 5560)), ('bm-izv', (3160, 4990, 3600, 5560))):
        c = im.crop(box)
        c.thumbnail((360, 360), Image.LANCZOS)
        c.save(os.path.join(OUT, name + '.webp'), quality=Q, method=6)
    parts = os.path.join(SRC, 'parts')
    for v in (100, 500, 1000, 5000, 10000, 50000):
        note(os.path.join(parts, f'money-{v}.webp'), f'bm-rub-{v}.webp')
    for c in ('yellow', 'red', 'blue', 'white'):
        note(os.path.join(parts, f'share-{c}.webp'), f'bm-share-{c}.webp')
    print('готово:', OUT)


if __name__ == '__main__':
    main()
