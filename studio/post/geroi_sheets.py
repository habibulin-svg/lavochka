"""Герои: листы для отбора существ — по листу анимаций на существо и общий обзор (эталон + первый кадр idle).

python studio/post/geroi_sheets.py <папка 20-creature-3d> <папка 10-creatures>
Пишет <существо>/anim.jpg и <папка 20>/overview.jpg.
"""
import glob
import pathlib
import sys

from PIL import Image, ImageDraw

D3, REF = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
ROWS = ['idle', 'move', 'shoot', 'hit', 'defend', 'death']
S = 128
BG = (214, 220, 196, 255)

done = sorted(p.parent for p in D3.glob('*/frames/meta.json'))
for fr in done:
    sheet = Image.new('RGBA', (S * 10, S * len(ROWS)), BG)
    for r, n in enumerate(ROWS):
        for i, f in enumerate(sorted(glob.glob(str(fr / f'{n}_*.png')))[:10]):
            sheet.alpha_composite(Image.open(f).convert('RGBA').resize((S, S)), (i * S, r * S))
    sheet.convert('RGB').save(fr.parent / 'anim.jpg', quality=85)

cols = 6
cell = 220
ov = Image.new('RGB', (cols * cell * 2, ((len(done) + cols - 1) // cols) * (cell + 24)), (30, 26, 22))
d = ImageDraw.Draw(ov)
for k, fr in enumerate(done):
    name = fr.parent.name
    x, y = (k % cols) * cell * 2, (k // cols) * (cell + 24)
    ref = sorted(REF.glob(f'{name}-*.png'))
    if ref:
        ov.paste(Image.open(ref[0]).convert('RGB').resize((cell, cell)), (x, y + 24))
    sp = Image.new('RGBA', (cell, cell), BG)
    sp.alpha_composite(Image.open(fr / 'idle_00.png').convert('RGBA').resize((cell, cell)))
    ov.paste(sp.convert('RGB'), (x + cell, y + 24))
    d.text((x + 4, y + 4), name, fill=(232, 194, 122))
ov.save(D3 / 'overview.jpg', quality=85)
print('листы:', len(done))
