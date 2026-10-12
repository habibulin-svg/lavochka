"""«Бизнес» (советская экономическая игра начала 90-х): ассеты из materials/nastolki/biznes/ (сканы, нарезка агентов).

public/manager/
  biznes.webp        — поле без боковых полос с надписью «БИЗНЕС» (так оно квадратное), 2000×2000, «Старт» внизу справа
  biznes-shans.webp, biznes-loto.webp — рубашки колод: наклейки «Шанс» и «Лотерея» из середины поля
  biznes-face.webp   — лицевая сторона карточки: чистый кусок картона со скана карточки
  brub-<номинал>.webp, busd-<номинал>.webp — купюры, повёрнуты горизонтально

Запуск из lavochka/:  python -I tools/manager/biznes.py
"""
import os

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(ROOT, 'materials', 'nastolki', 'biznes')
OUT = os.path.join(ROOT, 'lavochka', 'public', 'manager')
Q = 82


def main():
    im = Image.open(os.path.join(SRC, 'field.webp')).convert('RGB')
    w, h = im.size
    # кольцо клеток — от x≈242 до x≈5544 (полосы «БИЗНЕС» слева и справа — за ним), по высоте — всё поле
    x0 = 242
    side = h
    # «Старт» на скане — вверху справа; у менеджеров он всегда внизу справа (решение пользователя) — поворот по часовой
    board = im.crop((x0, 0, x0 + side, side)).resize((2000, 2000), Image.LANCZOS).rotate(-90)
    board.save(os.path.join(OUT, 'biznes.webp'), quality=Q, method=6)
    for name, box in (('biznes-loto', (1283, 1041, 2203, 1816)), ('biznes-shans', (1428, 3317, 2179, 4019))):
        c = im.crop(box)
        c.thumbnail((480, 480), Image.LANCZOS)
        c.save(os.path.join(OUT, name + '.webp'), quality=Q, method=6)
    card = Image.open(os.path.join(SRC, 'cards', 'shans-01.webp')).convert('RGB')
    cw, ch = card.size
    face = card.crop((20, 20, cw - 40, int(ch * 0.38))).resize((800, 430), Image.LANCZOS)
    face.save(os.path.join(OUT, 'biznes-face.webp'), quality=Q, method=6)
    money = os.path.join(SRC, 'parts', 'money')
    for f in sorted(os.listdir(money)):
        kind, v = f[:-5].split('-')
        n = Image.open(os.path.join(money, f)).convert('RGB').rotate(90, expand=True)
        n.thumbnail((240, 240), Image.LANCZOS)
        n.save(os.path.join(OUT, f'b{kind}-{v}.webp'), quality=Q, method=6)
    print('готово:', OUT)


if __name__ == '__main__':
    main()
