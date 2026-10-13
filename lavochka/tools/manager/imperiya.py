"""«Империя» (P&P-релиз 2012 г. советской экономической игры): ассеты из materials/nastolki/imperiya-pp/ (поле склеено агентом из 4 листов PDF).

public/manager/
  imperiya.webp      — поле 2000×2000 (космодром в центре, внешний круг по часовой)
  imp-<номинал>.webp — купюры (лист 9 PDF), повёрнуты горизонтально

Запуск из lavochka/:  python -I tools/manager/imperiya.py
"""
import os

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(ROOT, 'materials', 'nastolki', 'imperiya-pp')
OUT = os.path.join(ROOT, 'lavochka', 'public', 'manager')
Q = 82
# левый верхний угол купюры на странице 1654×2339 (лист 9): номинал → (x, y); купюра 330×664
NOTES = {100: (40, 40), 500: (870, 40), 20: (40, 790), 50: (870, 790), 5: (40, 1540), 10: (870, 1540)}


def main():
    im = Image.open(os.path.join(SRC, 'field.webp')).convert('RGB')
    im.resize((2000, 2000), Image.LANCZOS).save(os.path.join(OUT, 'imperiya.webp'), quality=Q, method=6)
    page = Image.open(os.path.join(SRC, 'src', 'page08.png')).convert('RGB')
    for v, (x, y) in NOTES.items():
        n = page.crop((x, y, x + 330, y + 664)).rotate(-90, expand=True)
        n.thumbnail((240, 240), Image.LANCZOS)
        n.save(os.path.join(OUT, f'imp-{v}.webp'), quality=Q, method=6)
    print('готово:', OUT)


if __name__ == '__main__':
    main()
