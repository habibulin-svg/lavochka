"""Brick Game E-23 Plus Mark II «96 in 1»: прошивка HT1190, мелодии и экран из MAME (materials/brick/rom) → public/brick/.

  python tools/brick/build.py
"""
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'elektronika'))
from build import ROOT, clean_svg  # noqa: E402

SRC = os.path.join(ROOT, 'materials', 'brick', 'rom')
OUT = os.path.join(ROOT, 'lavochka', 'public', 'brick')

os.makedirs(OUT, exist_ok=True)
shutil.copy(os.path.join(SRC, 'brke23p2.bin'), os.path.join(OUT, 'rom.bin'))
shutil.copy(os.path.join(SRC, 'e23plusmarkii96in1.srom'), os.path.join(OUT, 'melody.bin'))
svg, names = clean_svg(os.path.join(SRC, 'brke23p2.svg'))
open(os.path.join(OUT, 'screen.svg'), 'w', encoding='utf8').write(svg)
print(len(names), 'сегментов', {f: os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)})
