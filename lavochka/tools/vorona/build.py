"""«Белая ворона» (ЦПР, Москва, ок. 1990; зелёное издание — конец 80-х): ассеты из сканов D:\temp\настолки\Белая ворона.

public/vorona/
  blue.webp, green.webp — поля-календари синего и зелёного издания
  biz-00..14.webp       — карточки «Бизнес» синего издания (лист 3×5, по порядку слева направо, сверху вниз)

Запуск из lavochka/:  python -I tools/vorona/build.py
"""
import os

from PIL import Image

SRC = r'D:\temp\настолки\Белая ворона'
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'vorona')
Q = 82


def main():
    os.makedirs(OUT, exist_ok=True)
    blue = Image.open(os.path.join(SRC, 'Белая Ворона Синяя', 'pole.jpg')).convert('RGB')
    blue.resize((1800, round(1800 * blue.height / blue.width)), Image.LANCZOS).save(os.path.join(OUT, 'blue.webp'), quality=Q, method=6)
    green = Image.open(os.path.join(SRC, 'Белая Ворона Зеленая', 'pole.jpg')).convert('RGB')
    green.save(os.path.join(OUT, 'green.webp'), quality=Q + 6, method=6)
    sheet = Image.open(os.path.join(SRC, 'Белая Ворона Синяя', 'business.jpg')).convert('RGB')
    xs = (87, 557, 1026)
    ys = (63, 406, 750, 1092, 1437)
    for r, y in enumerate(ys):
        for c, x in enumerate(xs):
            card = sheet.crop((x, y, x + 458, y + 327))
            card.thumbnail((400, 400), Image.LANCZOS)
            card.save(os.path.join(OUT, f'biz-{r * 3 + c:02d}.webp'), quality=Q, method=6)
    print('готово:', OUT)


if __name__ == '__main__':
    main()
