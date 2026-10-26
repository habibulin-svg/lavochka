"""Карта асальто «Jeu du siège de Sébastopol» (Эпиналь, XIX век, общественное достояние) → public/foxgeese/sebastopol.webp.

Исходник — фото листа под углом (1280×1280 JPEG, дал пользователь):
https://optim.tildacdn.com/stor6436-6239-4039-a538-313638343036/-/format/webp/73821708.jpg.webp
Выпрямляем по четырём углам листа (масштаб по вертикали подобран так, чтобы клетки доски были квадратными, шаг ~135 px),
обрезаем текст правил внизу. Пункты доски на готовой картинке — MAP_XY в src/games/foxgeese/view.ts
(найдены по цвету: синие ромбы и жёлтые кружки с номерами).

    python -I tools/foxgeese/sebastopol.py <фото.jpg> public/foxgeese/sebastopol.webp
"""
import sys

import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
W, H = 1200, 1505
# углы листа на фото: левый верхний, правый верхний, правый нижний, левый нижний
Q = [(234, 76), (1051, 74), (1166, 1181), (124, 1180)]
D = [(0, 0), (W, 0), (W, H), (0, H)]
A, B = [], []
for (x, y), (u, v) in zip(D, Q):
    A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
    B.append(u)
    A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    B.append(v)
c = np.linalg.solve(np.array(A, float), np.array(B, float))
im = Image.open(src).convert('RGB').transform((W, H), Image.PERSPECTIVE, tuple(c), Image.BICUBIC)
im = im.crop((8, 14, 1192, 1320)).resize((1100, 1213), Image.LANCZOS)
im.save(out, quality=76, method=6)
