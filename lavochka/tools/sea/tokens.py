# Фишки из листа «Корабли.jpg» («Захват колоний»): цветной кораблик (половина развёртки) и десять флажков-кружков с названиями.
#   python tools/sea/tokens.py
import numpy as np
from PIL import Image, ImageFilter
SRC = "D:/temp/настолки/Настольная игра ''Захват колоний''/Корабли.jpg"
im = Image.open(SRC).convert('RGB')
# кораблик: левая половина цветной развёртки (до линии сгиба)
ship = im.crop((140, 90, 352, 350))
a = np.asarray(ship).astype(int)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
paper = (r > 200) & (g > 185) & (b > 140) & (abs(r - g) < 40) & (b < r + 5)
alpha = np.where(paper, 0, 255).astype(np.uint8)
al = Image.fromarray(alpha).filter(ImageFilter.MedianFilter(5))
ship = ship.convert('RGBA'); ship.putalpha(al)
bbox = ship.getbbox(); ship = ship.crop(bbox)
ship.save('public/sea/ship.webp', quality=90)
ship.transpose(Image.FLIP_LEFT_RIGHT).save('public/sea/ship-r.webp', quality=90)
print('ship', ship.size)
# флажки: кружки справа, центры сняты по профилю листа (белый «Гемма» — между «Вороном» и «Змеёй»)
from PIL import ImageDraw
CY = [217, 329, 435, 545, 650, 771, 880, 989, 1100, 1208]
CX, R = 734, 47
for k, cy in enumerate(CY):
    d = im.crop((CX - R, cy - R, CX + R, cy + R)).convert('RGBA')
    m = Image.new('L', d.size, 0)
    ImageDraw.Draw(m).ellipse((1, 1, 2 * R - 2, 2 * R - 2), fill=255)
    d.putalpha(m)
    d.save(f'public/sea/disc{k}.webp', quality=90)
print('discs ok')
