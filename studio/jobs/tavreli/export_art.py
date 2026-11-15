"""Таврели: отобранные шайбы 01-pieces → lavochka/public/chess/tavreli/{light,dark}.webp (раскладывает их
lavochka/src/games/chess/tavreli/view.ts, знак фигуры рисуется там же поверх верхней грани).

G:/ai/venvs/3d/Scripts/python.exe studio/jobs/tavreli/export_art.py
(вырезка BiRefNet — studio/runners/cutout.py; видеокарта одна — ComfyUI перед этим выгрузить.)
"""
import pathlib
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = pathlib.Path(__file__).resolve()
STUDIO = HERE.parents[2]
SRC = pathlib.Path('G:/temp/studio/out/tavreli/02-pieces-3q')
CUT = pathlib.Path('G:/temp/studio/out/tavreli/cut')
DST = STUDIO.parent / 'lavochka/public/chess/tavreli'

# какой сид взят (смотрел лист глазами): восьмигранник, как у настоящих таврелей, вид 3/4 — передняя грань
# смотрит прямо, на ней знак (пользователь: знаки и на боковых гранях — видно, кто в башне)
PICK = {'light': 'oct-light-43', 'dark': 'oct-dark-43'}
SIDE = 256
# обе шайбы — одного размера (вид раскладывает их по одной геометрии верхней грани и стенки)
HEIGHT = 228


def clean_alpha(im: Image.Image, lo: int = 40) -> Image.Image:
    a = np.asarray(im.split()[-1]).astype(np.float32)
    a = np.clip((a - lo) * 255 / (255 - lo), 0, 255).astype(np.uint8)
    out = im.copy()
    out.putalpha(Image.fromarray(a))
    bbox = out.split()[-1].point(lambda v: 255 if v > 16 else 0).getbbox()
    return out.crop(bbox) if bbox else out


def main():
    files = [SRC / f'{n}.png' for n in PICK.values()]
    need = [f for f in files if not (CUT / f.name).exists()]
    if need:
        subprocess.run([sys.executable, str(STUDIO / 'runners/cutout.py'), str(CUT), *map(str, need)], check=True)
    DST.mkdir(parents=True, exist_ok=True)
    for name, src in PICK.items():
        im = clean_alpha(Image.open(CUT / f'{src}.png').convert('RGBA'))
        im = im.resize((SIDE, HEIGHT), Image.LANCZOS)
        im.save(DST / f'{name}.webp', 'WEBP', quality=88, method=6)
        print(name, im.size, f'aspect {im.size[1] / im.size[0]:.3f}')


if __name__ == '__main__':
    main()
