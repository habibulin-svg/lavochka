"""Холдем 3D: отобранные картинки 01-art → lavochka/public/tex/holdem/gen/*.webp (собирает их lavochka/src/games/holdem/tex3d.ts).

G:/ai/venvs/3d/Scripts/python.exe studio/jobs/holdem/export_art.py
(venv с torch: вырезка BiRefNet — studio/runners/cutout.py, вызывается отсюда же.)

- сукно — лист целиком, 2048×1280 (одно полотно на весь стол, без повтора);
- фишки и фишка дилера — вырезка BiRefNet (тень на фоне уходит), по вырезке — круг: квадрат 256 с круглой маской;
  номиналы и «D / ДИЛЕР» печатает код (tex3d.ts);
- заставка загрузки — лист целиком, затемнение делает CSS.
"""
import pathlib
import subprocess
import sys

from PIL import Image, ImageDraw

HERE = pathlib.Path(__file__).resolve()
STUDIO = HERE.parents[2]
SRC = pathlib.Path('G:/temp/studio/out/holdem/01-art')
CUT = pathlib.Path('G:/temp/studio/out/holdem/cut')
DST = STUDIO.parent / 'lavochka/public/tex/holdem/gen'

# какой сид взят (смотрел листы глазами)
PICK = {
    'felt': 41,
    'chip-white': 42,
    'chip-red': 42,
    'chip-green': 42,
    'chip-black': 42,
    'chip-purple': 42,
    'button': 42,
    'loading': 41,
}
ROUND = ['chip-white', 'chip-red', 'chip-green', 'chip-black', 'chip-purple', 'button']


def src(name: str) -> pathlib.Path:
    return SRC / f'{name}-{PICK[name]}.png'


def disc(name: str, size: int = 256) -> Image.Image:
    """Вырезка → квадрат по кругу фишки → круглая маска (чуть внутрь края: без каймы фона)."""
    im = Image.open(CUT / f'{name}-{PICK[name]}.png').convert('RGBA')
    w, h = im.size
    d = min(w, h)
    im = im.crop(((w - d) // 2, (h - d) // 2, (w - d) // 2 + d, (h - d) // 2 + d)).resize((size * 2, size * 2), Image.LANCZOS)
    mask = Image.new('L', im.size, 0)
    inset = size * 2 * 0.012
    ImageDraw.Draw(mask).ellipse((inset, inset, size * 2 - inset, size * 2 - inset), fill=255)
    im.putalpha(mask)
    return im.resize((size, size), Image.LANCZOS)


def main():
    DST.mkdir(parents=True, exist_ok=True)
    need = [src(n) for n in ROUND if not (CUT / src(n).name).exists()]
    if need:
        subprocess.run([sys.executable, str(STUDIO / 'runners/cutout.py'), str(CUT), *map(str, need)], check=True)
    Image.open(src('felt')).convert('RGB').resize((2048, 1280), Image.LANCZOS).save(DST / 'felt.webp', quality=86)
    for n in ROUND:
        disc(n).save(DST / (n.replace('-', '_') + '.webp'), quality=92)
    Image.open(src('loading')).convert('RGB').resize((1536, 960), Image.LANCZOS).save(DST / 'loading.webp', quality=80)
    for f in sorted(DST.glob('*.webp')):
        print(f.name, f.stat().st_size // 1024, 'КБ')


if __name__ == '__main__':
    main()
