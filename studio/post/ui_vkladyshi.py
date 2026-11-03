"""Вкладыши: оформление стола из 04-art/04b-back → lavochka/public/vkladyshi/ui/*.webp.

Отобранные варианты (сид) — в PICK; предметы на сером фоне (обёртки, копейка) вырезаются BiRefNet (runners/cutout.py).
Запуск — питоном venv 3d (там torch и transformers):
  G:/ai/venvs/3d/Scripts/python.exe -X utf8 studio/post/ui_vkladyshi.py
"""
import pathlib
import subprocess
import sys

from PIL import Image

SRC = pathlib.Path('G:/temp/studio/out/vkladyshi')
CUT = pathlib.Path('G:/temp/studio/cut/vkladyshi')
DST = pathlib.Path(__file__).resolve().parents[2] / 'lavochka/public/vkladyshi/ui'
RUN = pathlib.Path(__file__).resolve().parents[1] / 'runners/cutout.py'

# имя → (партия, файл, длинная сторона, вырезать ли фон)
PICK = {
    'bench': ('04-art', 'bench-12.png', 1280, False),
    'asphalt': ('04-art', 'asphalt-13.png', 1280, False),
    'kiosk': ('04-art', 'kiosk-12.png', 1280, False),
    'album': ('04-art', 'album-13.png', 768, False),
    'card-back': ('04b-back', 'card-back-22.png', 384, False),
    'coin': ('04-art', 'coin-11.png', 128, True),
    'wrap-turbo': ('04-art', 'wrap-turbo-12.png', 420, True),
    'wrap-bomb': ('04-art', 'wrap-bomb-11.png', 420, True),
    'wrap-final': ('04-art', 'wrap-final-13.png', 420, True),
    'wrap-love': ('04-art', 'wrap-love-13.png', 420, True),
    'wrap-lazer': ('04-art', 'wrap-lazer-12.png', 420, True),
    'hero-boy': ('04-art', 'hero-boy-11.png', 160, False),
    'hero-girl': ('04-art', 'hero-girl-11.png', 160, False),
    'hero-boy2': ('04-art', 'hero-boy2-13.png', 160, False),
    'hero-girl2': ('04-art', 'hero-girl2-11.png', 160, False),
}


def main():
    only = set(sys.argv[1:])
    DST.mkdir(parents=True, exist_ok=True)
    todo = {k: v for k, v in PICK.items() if not only or k in only}
    cut = [SRC / b / f for b, f, _, c in todo.values() if c]
    if cut:
        subprocess.run([sys.executable, '-X', 'utf8', str(RUN), str(CUT), *map(str, cut)], check=True)
    for name, (batch, f, side, c) in todo.items():
        src = CUT / (pathlib.Path(f).stem + '.png') if c else SRC / batch / f
        im = Image.open(src)
        im = im.convert('RGBA' if c else 'RGB')
        im.thumbnail((side, side), Image.LANCZOS)
        out = DST / f'{name}.webp'
        im.save(out, 'WEBP', quality=82, method=6)
        print(f'{name}: {im.size[0]}×{im.size[1]} {out.stat().st_size // 1024} КБ')


if __name__ == '__main__':
    main()
