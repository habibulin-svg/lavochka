"""«Наша игротека» — поля из сканов издания (Эйдельс, Давыдов) → public/igroteka/<поле>.webp, 900 px в ширину.

Запуск: python tools/igroteka/cut.py "D:/temp/настолки/Наша игротека" [--check]
С --check рядом кладутся D:/temp/igr/check-<поле>.jpg — точки движка поверх скана (координаты берёт из
src/games/igroteka/boards.json, который пишет этот же скрипт), чтобы глазами сверить, что точки легли на кружки и пересечения.

Координаты точек — в пикселях картинки 900 px; сетки и линии измерены по сканам (тёмные пиксели, max канала < 70),
треугольники «Леопардов» — по пересечениям линий вручную."""
import json
import os
import sys

from PIL import Image, ImageDraw

W = 900
SRC = sys.argv[1] if len(sys.argv) > 1 else 'D:/temp/настолки/Наша игротека'
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'igroteka')
JSON = os.path.join(ROOT, 'src', 'games', 'igroteka', 'boards.json')


def grid(xs, ys):
    """Узлы сетки: xs — столбцы слева направо, ys — ряды сверху вниз; точка = ряд * len(xs) + столбец."""
    return [[x, y] for y in ys for x in xs]


def cells(xs, ys):
    """Центры клеток между линиями сетки."""
    cx = [(xs[i] + xs[i + 1]) / 2 for i in range(len(xs) - 1)]
    cy = [(ys[i] + ys[i + 1]) / 2 for i in range(len(ys) - 1)]
    return grid(cx, cy)


def lerp(a, b, n):
    return [a + (b - a) * i / (n - 1) for i in range(n)]


BOARDS = {
    # волк и овцы: тёмные поля 8×8, ряд r — столбцы той же чётности, что r + 1 (как на скане: верхний ряд — 1, 3, 5, 7)
    'sheep': {'file': 'sheep', 'pts': grid(lerp(128.5, 771.6, 8), lerp(347.8, 984.3, 8))},
    'tickle': {'file': 'tickle', 'pts': cells([105.5, 277.5, 451.0, 621.0, 792.0], [319.5, 488.0, 659.0, 830.5, 1001.5])},
    'sidja': {'file': 'sidjah', 'pts': cells([100.0, 241.5, 379.5, 517.5, 655.5, 791.0], [324.5, 459.5, 597.0, 734.0, 871.0, 1007.5])},
    # крест 7×7 без углов 2×2; точки без креста отбрасывает движок
    'fox': {'file': 'fox', 'pts': grid([140.5, 240.5, 342.5, 442.0, 541.0, 639.5, 740.0], [365.0, 462.0, 561.5, 663.0, 762.0, 860.5, 957.0])},
    # квадрат 5×5 (25) + треугольники: верх, низ, лево, право — по 6 точек (средняя линия 3, внешняя 3)
    'leopards': {
        'file': 'leopards',
        'pts': grid([217.0, 333.5, 448.5, 561.5, 676.5], [431.0, 545.5, 661.0, 777.0, 890.0])
        + [[357.5, 364.9], [448.4, 364.9], [544.1, 364.9], [279.8, 309.3], [448.4, 309.3], [625.9, 309.3]]
        + [[360.0, 955.7], [448.4, 955.7], [536.0, 955.7], [279.8, 1011.3], [448.4, 1011.3], [613.7, 1011.3]]
        + [[148.9, 567.0], [148.9, 661.1], [148.9, 751.0], [94.9, 489.3], [94.9, 661.1], [94.9, 827.2]]
        + [[742.1, 575.2], [742.1, 663.6], [742.1, 751.1], [797.7, 501.6], [797.7, 663.6], [797.7, 828.9]],
    },
    # мельница: сетка 7×7, движок берёт 24 точки трёх квадратов
    'mill': {'file': 'mill', 'pts': grid([137.5, 241.0, 345.5, 444.0, 544.5, 647.5, 748.5], [347.0, 450.0, 554.5, 652.5, 753.0, 855.5, 959.0])},
    'bolotudu': {'file': 'bolotudu', 'pts': cells([105.0, 219.0, 334.0, 449.0, 564.0, 677.5, 789.5], [375.0, 490.0, 605.0, 719.0, 833.0, 947.0])},
    'alquerque': {'file': 'alquerque', 'pts': grid([129.0, 289.0, 451.0, 611.0, 773.0], [342.0, 500.5, 662.0, 822.5, 981.5])},
    'hasami': {'file': 'hasami', 'pts': cells([103.0, 179.0, 255.5, 332.5, 408.5, 483.5, 560.5, 636.5, 713.0, 788.5], [309.0, 385.5, 462.5, 537.5, 613.5, 690.0, 766.5, 842.0, 917.0, 992.5])},
    'turk': {'file': 'turk', 'pts': cells([110.5, 194.5, 278.5, 361.5, 445.5, 529.0, 615.0, 698.0, 782.0], [328.5, 410.5, 495.0, 577.5, 661.5, 744.5, 826.5, 910.0, 995.0])},
}


def main():
    check = '--check' in sys.argv
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    for key, b in BOARDS.items():
        im = Image.open(os.path.join(SRC, b['file'] + '.jpg')).convert('RGB')
        w, h = im.size
        im = im.resize((W, round(h * W / w)), Image.LANCZOS)
        im.save(os.path.join(OUT, key + '.webp'), quality=80, method=6)
        pts = [[round(x, 1), round(y, 1)] for x, y in b['pts']]
        meta[key] = {'w': im.size[0], 'h': im.size[1], 'pts': pts}
        if check:
            d = ImageDraw.Draw(im)
            for i, (x, y) in enumerate(pts):
                d.ellipse((x - 6, y - 6, x + 6, y + 6), outline=(255, 0, 255), width=3)
                d.text((x + 7, y - 14), str(i), fill=(255, 0, 255))
            os.makedirs('D:/temp/igr', exist_ok=True)
            im.save(f'D:/temp/igr/check-{key}.jpg', quality=80)
    with open(JSON, 'w', encoding='utf-8') as f:
        json.dump(meta, f, separators=(',', ':'))
    print('ok', ', '.join(f'{k}: {len(v["pts"])}' for k, v in meta.items()))


if __name__ == '__main__':
    main()
