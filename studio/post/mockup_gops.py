"""Макет игрового экрана ГОПС из ассетов студии (проверка стиля, не код игры).

python studio/post/mockup_gops.py <выход.png>
Берёт отобранное из G:/temp/studio/out/gops: 06-yard (фон, грунт, кромка, предметы), 05-sprites (бригады).
"""
import math
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1280, 720
OUT = sys.argv[1]
G = 'G:/temp/studio/out/gops'
YARD = f'{G}/06-yard'
FONT = ImageFont.truetype('arialbd.ttf', 13)
FONT_BIG = ImageFont.truetype('arialbd.ttf', 18)
random.seed(4)

# --- фон: двор, чуть приглушён и размыт (глубина) ---
bh = 680
bg = Image.open(f'{YARD}/bg-near-8.png').convert('RGB').resize((round(bh * 1792 / 768), bh), Image.LANCZOS)
bg = bg.crop(((bg.width - W) // 2, 0, (bg.width - W) // 2 + W, bh))
canvas = Image.new('RGBA', (W, H))
near = bg.filter(ImageFilter.GaussianBlur(1.2))
near = Image.blend(near, Image.new('RGB', near.size, (235, 190, 160)), 0.18)
canvas.paste(near, (0, 0))

# --- ландшафт: высоты по сумме синусов, провал между островами, воронка ---
xs = np.arange(W)
surf = 440 + 55 * np.sin(xs / 150) + 30 * np.sin(xs / 61 + 1.3) + 12 * np.sin(xs / 23)
gap = (xs > 590) & (xs < 690)
surf[gap] = 760
surf = np.convolve(surf, np.ones(9) / 9, mode='same')
yy = np.arange(H)[:, None]
mask = yy >= surf[None, :]
for cx, cy, r in ((930, None, 46), (300, None, 34)):
    cy = surf[cx] + 6
    mask &= (xs[None, :] - cx) ** 2 + (yy - cy) ** 2 > r * r
mask &= ~((xs[None, :] > 120) & (xs[None, :] < 330) & (abs(yy - 560) < 22))  # тоннель
mask_img = Image.fromarray((mask * 255).astype(np.uint8))
# выкопанное (воронки, тоннель) — тёмная задняя стенка, а не фон
cave = (yy >= surf[None, :] + 8) & ~mask
cave_img = Image.new('RGBA', (W, H), (52, 34, 24, 255))
cave_img.putalpha(Image.fromarray((cave * 255).astype(np.uint8)))

tile = Image.open(f'{YARD}/cut/ground-tile.png').convert('RGB')
fill = Image.new('RGB', (W, H))
for ty in range(0, H, tile.height):
    for tx in range(0, W, tile.width):
        fill.paste(tile, (tx, ty))
ground = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ground.paste(fill, (0, 0), mask_img)
# тёмная кайма по краю (как контур у персонажей)
edge = mask_img.filter(ImageFilter.MaxFilter(5))
rim = Image.new('RGBA', (W, H), (45, 28, 18, 255))
rim.putalpha(Image.fromarray(np.asarray(edge) - np.asarray(mask_img)))
canvas.alpha_composite(cave_img)
canvas.alpha_composite(rim)
canvas.alpha_composite(ground)

# кромка: асфальт с травой поверх верхней границы (только там, где сверху воздух)
crust = Image.open(f'{YARD}/crust-8.png').convert('RGB')
ca = np.asarray(crust).astype(int)
bgc = ca[2, 2]
diff = np.abs(ca - bgc).sum(axis=2)
rows = np.where(diff.mean(axis=1) > 25)[0]
band = crust.crop((0, rows[0], crust.width, rows[-1]))
alpha = Image.fromarray(((np.abs(np.asarray(band).astype(int) - bgc).sum(axis=2) > 30) * 255).astype(np.uint8))
band.putalpha(alpha)
band = band.resize((band.width * 44 // band.height, 44), Image.LANCZOS)
for x in range(W):
    col = np.where(mask[:, x])[0]
    if not len(col):
        continue
    top = col[0]
    if top < 5 or top > H - 80:
        continue
    strip = band.crop((x % band.width, 0, x % band.width + 1, band.height))
    canvas.alpha_composite(strip, (x, int(top) - 26))

# --- лужа внизу ---
water = Image.new('RGBA', (W, H), (0, 0, 0, 0))
dw = ImageDraw.Draw(water)
wl = 650
dw.rectangle((0, wl, W, H), fill=(70, 88, 92, 225))
for x in range(0, W, 2):
    y = wl + 3 * math.sin(x / 18)
    dw.line((x, y, x + 2, y), fill=(170, 190, 190, 255), width=2)
canvas.alpha_composite(water)


def place(img, x, h, flip=False, sink=4):
    """Поставить картинку высотой h на поверхность в точке x."""
    im = img.resize((round(img.width * h / img.height), h), Image.LANCZOS)
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    top = np.where(mask[:, x])[0][0]
    canvas.alpha_composite(im, (x - im.width // 2, int(top) - h + sink))
    return int(top) - h + sink


def prop(name, x, h, flip=False):
    place(Image.open(f'{YARD}/cut/{name}.png').convert('RGBA'), x, h, flip)


prop('prop-garage-8', 470, 105)
prop('prop-swing-8', 200, 92)
prop('prop-bench-8', 380, 40)
prop('prop-car-8', 1110, 58, flip=True)
prop('prop-bin-9', 800, 56)
prop('prop-tires-7', 1000, 22)


def gopnik(brigade, frame_row, col, x, name, hp, color, flip):
    a = Image.open(f'{G}/05-sprites/{brigade}-atlas.png').convert('RGBA')
    fr = a.crop((col * 192, frame_row * 192, col * 192 + 192, frame_row * 192 + 192))
    fr = fr.crop(fr.getbbox())
    top = place(fr, x, 50, flip, sink=3)
    d = ImageDraw.Draw(canvas)
    label = f'{name} {hp}'
    tw = d.textlength(label, font=FONT)
    lx, ly = x - tw / 2, top - 20
    d.rounded_rectangle((lx - 4, ly - 2, lx + tw + 4, ly + 15), 4, fill=(20, 20, 24, 200))
    d.text((lx, ly), label, font=FONT, fill=color)


TEAM_A, TEAM_B = (90, 220, 210), (255, 120, 110)
gopnik('zatulinka', 0, 0, 150, 'Сиплый', 100, TEAM_A, False)
gopnik('zatulinka', 0, 5, 330, 'Рыжий', 85, TEAM_A, False)
gopnik('zatulinka', 1, 3, 545, 'Пёс', 100, TEAM_A, False)
gopnik('rastochka', 0, 2, 760, 'Кабан', 100, TEAM_B, True)
gopnik('rastochka', 0, 8, 1010, 'Шнырь', 62, TEAM_B, True)
gopnik('rastochka', 0, 11, 1200, 'Лысый', 100, TEAM_B, True)

# --- интерфейс: таймер, ветер, полосы бригад ---
d = ImageDraw.Draw(canvas)
d.rounded_rectangle((16, H - 58, 72, H - 16), 8, fill=(20, 20, 24, 220), outline=(240, 200, 80, 255), width=2)
d.text((28, H - 49), '42', font=FONT_BIG, fill=(255, 230, 120))
d.rounded_rectangle((W - 196, H - 40, W - 16, H - 18), 6, fill=(20, 20, 24, 200))
d.text((W - 190, H - 38), 'ВЕТЕР', font=FONT, fill=(230, 230, 230))
for i in range(5):
    d.polygon([(W - 130 + i * 20, H - 36), (W - 116 + i * 20, H - 29), (W - 130 + i * 20, H - 22)], fill=(120, 210, 255) if i < 3 else (70, 70, 80))
for i, (team, col, hp) in enumerate((('Затулинка', TEAM_A, 285), ('Расточка', TEAM_B, 262))):
    y = H - 56 + i * 20
    d.text((W // 2 - 190, y), team, font=FONT, fill=col)
    d.rectangle((W // 2 - 100, y + 2, W // 2 - 100 + hp, y + 13), fill=col, outline=(20, 20, 24))
canvas.convert('RGB').save(OUT, quality=92)
print(OUT)
