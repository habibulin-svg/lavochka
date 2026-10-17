"""«Магия»: склейка поля из PDF (D:\temp\настолки\Магия.pdf) и вырезка жетонов в public/magic/.

Страницы 3–11 PDF — поле: на каждой одна картинка 2480×3307 (300 dpi) с белым отступом сверху;
плитки ложатся 3×3 встык (в ориентации страницы [[8,7,2],[9,6,3],[10,5,4]] — номера страниц с нуля),
затем поле поворачивается на 90° против часовой (надписи «Начало пути», духи читаются прямо).
Координаты клеток в src/games/magiya/data.ts — в пикселях field.webp (4960×3720, половина 300 dpi).

Запуск: python tools/magiya/stitch.py [папка-для-промежуточного]
"""
import sys, os
import pymupdf
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
PDF = r'D:\temp\настолки\Магия.pdf'
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'magic')
TMP = sys.argv[1] if len(sys.argv) > 1 else r'D:\Claude\Shish\materials\nastolki\magiya\raw'
os.makedirs(TMP, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

# 1. Картинки страниц как есть (JPEG из PDF)
doc = pymupdf.open(PDF)
pages = {}
for i, p in enumerate(doc):
    x = p.get_images(full=True)[0][0]
    path = os.path.join(TMP, f'p{i:02d}.jpeg')
    if not os.path.exists(path):
        open(path, 'wb').write(doc.extract_image(x)['image'])
    pages[i] = path

# 2. Поле: плитки встык
TOP = {8: 0, 9: 100, 10: 0, 7: 201, 6: 96, 5: 0, 2: 201, 3: 112, 4: 0}
GRID = [[8, 7, 2], [9, 6, 3], [10, 5, 4]]
TW, TH = 2480, 3307
canvas = Image.new('RGB', (3 * TW, 3 * TH), (255, 255, 255))
for r in range(3):
    for c in range(3):
        p = GRID[r][c]
        canvas.paste(Image.open(pages[p]).crop((0, TOP[p], TW, TOP[p] + TH)), (c * TW, r * TH))
land = canvas.transpose(Image.Transpose.ROTATE_90)  # 9921×7440
half = land.resize((land.width // 2, land.height // 2), Image.LANCZOS)  # 4960×3720
half.save(os.path.join(OUT, 'field.webp'), quality=78, method=6)
half.resize((80, 60), Image.LANCZOS).save(os.path.join(OUT, 'field-small.webp'), quality=60)


# 3. Жетоны
def save(im, name, w=None):
    if w and im.width > w:
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(os.path.join(OUT, name), quality=86, method=6)


def disc(im, cx, cy, r):
    c = im.crop((cx - r, cy - r, cx + r, cy + r)).convert('RGBA')
    m = Image.new('L', c.size, 0)
    ImageDraw.Draw(m).ellipse((2, 2, 2 * r - 2, 2 * r - 2), fill=255)
    c.putalpha(m)
    return c


p11 = Image.open(pages[11]).convert('RGB')
p12 = Image.open(pages[12]).convert('RGB')
p13 = Image.open(pages[13]).convert('RGB')
p14 = Image.open(pages[14]).convert('RGB')

# герои: на листе пятеро (рыцаря нет — его портрет берём с поля, угол ряда D)
HEROES = ['monk', 'master', 'princess', 'robber', 'hunter']
for k, h in enumerate(HEROES):
    x0 = 75 + 225 * k
    # у монаха на нижнем ряду спина — лицевая сторона в верхнем ряду, перевёрнута
    fig = p11.crop((x0 + 6, 204, x0 + 219, 660)).rotate(180) if h == 'monk' else p11.crop((x0 + 6, 654, x0 + 219, 1110))
    save(fig, f'hero-{h}.webp', 180)
    save(disc(p11, 192 + 228 * k, 1388, 96), f'port-{h}.webp', 160)
# рыцарь: портрет из клетки поля (половинный масштаб: 560-745 × 2710-2945)
kn = half.crop((585, 2735, 735, 2925)).convert('RGBA')
save(kn, 'hero-knight.webp', 180)
save(disc(half, 655, 2828, 70), 'port-knight.webp', 160)

save(p11.crop((75, 1515, 585, 2295)), 'mag.webp', 260)

# талисманы власти (стр. 12): анх, круги, пламя, свеча
for name, (y0, y1) in zip(['ankh', 'circles', 'flame', 'candle'], [(120, 705), (705, 1290), (1290, 1899), (1899, 2490)]):
    save(p12.crop((124, y0 + 4, 371, y1 - 4)), f'power-{name}.webp', 120)

# талисманы защиты (стр. 13–14)
ROWS = [(120, 939), (939, 1764), (1764, 2586), (2586, 3420)]
for page, names in ((p13, ['vampire', 'witch', 'leshy', 'night']), (p14, ['ghost', 'death', 'dragon', 'koldun'])):
    for name, (y0, y1) in zip(names, ROWS):
        save(page.crop((122, y0 + 2, 457, y1 - 2)), f'prot-{name}.webp', 150)

# красный талисман-треугольник (стр. 12, без пунктира)
tri = p11.crop((343, 2498, 578, 2704)).convert('RGBA')
m = Image.new('L', tri.size, 0)
ImageDraw.Draw(m).polygon([(117, 16), (12, 196), (223, 196)], fill=255)
tri.putalpha(m)
save(tri.crop((8, 10, 228, 200)), 'tri.webp', 90)
print('ok', half.size)
