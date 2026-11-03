"""Герои, этап 1: макет боя — фон поля + сетка гексов 15×11 + отряды из кадров существа + плашки с числом.

python studio/post/mockup_geroi.py <фон.png> <папка кадров существа> <выход.png> [кадр=idle_00]

Проверка масштаба и читаемости существа на поле до кода боя (урок ГОПС: сверять масштаб с жанром на первом экране).
Сетка — как в жанре: 15 столбцов × 11 рядов, нечётные ряды сдвинуты на полгекса, поле занимает низ экрана в ¾.
Свои отряды слева смотрят вправо, чужие справа — зеркально.
"""
import json
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

BG, FRAMES, OUT = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3]
FRAME = sys.argv[4] if len(sys.argv) > 4 else 'idle_00'
W, H = 1920, 1080
COLS, ROWS = 15, 11
LEFT, TOP, RIGHT, BOTTOM = 150, 300, 1770, 1000  # поле на экране
HW = (RIGHT - LEFT) / (COLS + 0.5)  # ширина гекса
VH = (BOTTOM - TOP) / ROWS  # шаг ряда (гекс сплющен перспективой)

bg = Image.open(BG).convert('RGB').resize((W, H), Image.LANCZOS)
img = bg.convert('RGBA')
grid = Image.new('RGBA', (W, H))
g = ImageDraw.Draw(grid)


def center(c, r):
    return LEFT + HW * (c + 0.5 + (0.5 if r % 2 else 0)), TOP + VH * (r + 0.5)


def hexagon(c, r):
    x, y = center(c, r)
    a, b = HW / 2, VH * 0.66
    return [(x, y - b), (x + a, y - b / 2), (x + a, y + b / 2), (x, y + b), (x - a, y + b / 2), (x - a, y - b / 2)]


for r in range(ROWS):
    for c in range(COLS):
        g.polygon(hexagon(c, r), outline=(255, 255, 240, 70))
img = Image.alpha_composite(img, grid)

meta = json.loads((FRAMES / 'meta.json').read_text(encoding='utf-8'))
spr = Image.open(FRAMES / f'{FRAME}.png').convert('RGBA')
ox, oy = meta['origin']
# высота существа 2-й ступени — примерно 1,6 гекса по ширине (как стрелки в жанре)
top_y = meta['top'][1]
scale = (HW * 1.6) / max(1, oy - top_y)
spr_s = spr.resize((round(spr.width * scale), round(spr.height * scale)), Image.LANCZOS)
try:
    font = ImageFont.truetype('C:/Windows/Fonts/georgiab.ttf', 22)
except OSError:
    font = ImageFont.load_default()

units = [(1, 1, 37, False), (0, 4, 52, False), (1, 7, 18, False), (13, 2, 41, True), (14, 5, 29, True), (13, 9, 64, True)]
for c, r, n, enemy in sorted(units, key=lambda u: u[1]):
    x, y = center(c, r)
    s = spr_s.transpose(Image.FLIP_LEFT_RIGHT) if enemy else spr_s
    sx = (s.width - ox * scale) if enemy else ox * scale
    # тень
    sh = Image.new('RGBA', (W, H))
    ImageDraw.Draw(sh).ellipse((x - HW * 0.45, y - VH * 0.18, x + HW * 0.45, y + VH * 0.22), fill=(0, 0, 0, 70))
    img = Image.alpha_composite(img, sh)
    img.alpha_composite(s, (round(x - sx), round(y - oy * scale)))
    d = ImageDraw.Draw(img)
    bx, by = x + (-HW * 0.55 if enemy else HW * 0.15), y + VH * 0.05
    d.rectangle((bx, by, bx + 46, by + 26), fill=(110, 40, 30, 235) if enemy else (30, 70, 110, 235), outline=(232, 194, 122, 255))
    d.text((bx + 23, by + 13), str(n), font=font, fill=(255, 245, 225, 255), anchor='mm')

img.convert('RGB').save(OUT, quality=92)
print('макет →', OUT)
