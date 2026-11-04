"""Листы для отбора: варианты одного пункта рядом, подписи, страницы ≤1900×1900.

python studio/post/pick_sheets.py <папка партии> <папка вывода> [размер клетки]
Пишет <вывод>/<партия>-NN.jpg. Пункт — имя файла без -<сид>.png (как в manifest.json).
"""
import collections
import pathlib
import re
import sys

from PIL import Image, ImageDraw

src, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
C = int(sys.argv[3]) if len(sys.argv) > 3 else 186
dst.mkdir(parents=True, exist_ok=True)
items = collections.OrderedDict()
for f in sorted(src.glob('*.png')):
    m = re.match(r'(.+)-(\d+)\.png$', f.name)
    if m:
        items.setdefault(m[1], []).append((m[2], f))

per = max(len(v) for v in items.values())
cols = max(1, 1900 // (C * per))
rows = max(1, 1900 // (C + 16))
keys = list(items)
for p in range(0, len(keys), cols * rows):
    page = keys[p:p + cols * rows]
    nr = (len(page) + cols - 1) // cols
    sh = Image.new('RGB', (cols * C * per, nr * (C + 16)), (30, 26, 22))
    d = ImageDraw.Draw(sh)
    for k, name in enumerate(page):
        x, y = (k % cols) * C * per, (k // cols) * (C + 16)
        for j, (seed, f) in enumerate(items[name]):
            im = Image.open(f).convert('RGBA')
            im.thumbnail((C, C))
            bg = Image.new('RGBA', (C, C), (200, 200, 200, 255))
            bg.alpha_composite(im, ((C - im.width) // 2, (C - im.height) // 2))
            sh.paste(bg.convert('RGB'), (x + j * C, y + 16))
            d.text((x + j * C + 3, y + 2), f'{name} {seed}' if j == 0 else seed, fill=(232, 194, 122))
    sh.save(dst / f'{src.name}-{p // (cols * rows) + 1:02d}.jpg', quality=82)
print(src.name, len(items), 'пунктов')
