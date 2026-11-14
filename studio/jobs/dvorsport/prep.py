"""Дворовый спорт: текстуры площадок из выхода 01-places → папка текстур Blender (та же, что у двора городков)
и задники → public/dvorsport/.

G:/ai/ComfyUI/venv/Scripts/python.exe -X utf8 studio/jobs/dvorsport/prep.py
Потом вырезки (стог, сосна — BiRefNet): G:/ai/venvs/3d/Scripts/python.exe studio/runners/cutout.py G:/temp/gk3d/tex-cut <выход>/stog-NN.png <выход>/pine-tree-NN.png
и ещё раз этот скрипт (подхватит вырезки).
"""
import pathlib
import subprocess
import sys

import numpy as np
from PIL import Image

SRC = pathlib.Path('G:/temp/studio/out/dvorsport/01-places')
TEX = pathlib.Path('G:/temp/gk3d/tex')
CUT = pathlib.Path('G:/temp/gk3d/tex-cut')
PUB = pathlib.Path(__file__).resolve().parents[3] / 'lavochka/public/dvorsport'
SEAMLESS = pathlib.Path(__file__).resolve().parents[2] / 'post/seamless.py'

# отбор (сид) и что делать: seamless — бесшовная земля; raw — фасад как есть (швы плитки = швы панелей)
PICK = {
    'turf': (11, 'seamless'), 'cinder': (12, 'cinder'), 'asphalt': (12, 'seamless'), 'sand': (11, 'seamless'),
    'path': (11, 'seamless'), 'lawn': (11, 'seamless'), 'shingle': (11, 'seamless'), 'brick-red': (12, 'seamless'),
    'school-wall': (12, 'raw'), 'fence-concrete': (11, 'raw'), 'panel-wall': (11, 'panel'), 'log-wall': (12, 'raw'),
    'picket': (11, 'whitekey'),
}
CUTS = {'stog': 11, 'pine-tree': 12}
BACK = {'backdrop-school': 11, 'backdrop-dvor': 12, 'backdrop-village': 11}


def seamless(src, dst):
    subprocess.run([sys.executable, '-X', 'utf8', str(SEAMLESS), str(src), str(dst), '1024'], check=True)


for name, (seed, how) in PICK.items():
    src = SRC / f'{name}-{seed}.png'
    dst = TEX / f'{"meadow" if name == "lawn" else name}.png'
    if not src.exists():
        print('нет', src.name)
        continue
    im = Image.open(src).convert('RGB')
    if how == 'seamless':
        seamless(src, dst)
    elif how == 'cinder':
        # на гаревой дорожке модель нарисовала белую линию — берём кусок без неё
        w, h = im.size
        tmp = TEX / '_cinder.png'
        im.crop((0, int(h * 0.3), int(w * 0.7), h)).resize((1024, 1024), Image.LANCZOS).save(tmp)
        seamless(tmp, dst)
        tmp.unlink()
    elif how == 'panel':
        # на плитке 6 этажей — дому нужно 5: пять рядов окон между швами панелей (плитка 17,5 × 14 м)
        w, h = im.size
        im.crop((0, round(h * 40 / 1024), w, round(h * 860 / 1024))).save(dst)
    elif how == 'whitekey':
        a = np.asarray(im).astype(np.int16)
        white = (a.min(axis=2) > 232) & ((a.max(axis=2) - a.min(axis=2)) < 14)
        alpha = np.where(white, 0, 255).astype(np.uint8)
        rgba = np.dstack([a.astype(np.uint8), alpha])
        out = Image.fromarray(rgba, 'RGBA')
        box = Image.fromarray(alpha).getbbox()
        out = out.crop((0, box[1], out.width, box[3]))
        out.save(dst)
    else:
        im.save(dst)
    print('текстура', dst.name, Image.open(dst).size)

for name, seed in CUTS.items():
    p = CUT / f'{name}-{seed}.png'
    if p.exists():
        Image.open(p).save(TEX / f'{name}.png')
        print('вырезка', name, Image.open(p).size)
    else:
        print('нет вырезки', p.name)

PUB.mkdir(parents=True, exist_ok=True)
for name, seed in BACK.items():
    src = SRC / f'{name}-{seed}.png'
    if not src.exists():
        print('нет', src.name)
        continue
    Image.open(src).convert('RGB').save(PUB / f'{name}.webp', quality=86, method=6)
    print('задник', name)
