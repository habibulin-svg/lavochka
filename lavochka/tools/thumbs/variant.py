"""Снимок страницы варианта: public/thumbs/v/<адрес через дефис>.webp (480×300).

Нужен запущенный `npm run dev` (:5173). Снимает /?thumb=<игра>&preset=<вариант> безголовым Chrome
квадратом 800×800 и вырезает полосу 800×500 (по умолчанию — по центру), затем уменьшает до 480×300.

  python tools/thumbs/variant.py nardy/dlinnye nardy long [--steps 20] [--n 2] [--seed 7] [--top 150] [--size 800] [--wait 8000]

Полный снимок кладётся рядом в D:/temp/vthumbs/<имя>.png — посмотреть и подобрать --top/--steps.

Превью карточки игры (def.showcase(), без пресета): --main → public/thumbs/<игра>.webp
  python tools/thumbs/variant.py manager manager - --main
"""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
ROOT = Path(__file__).resolve().parents[2]
TMP = Path('D:/temp/vthumbs')

ap = argparse.ArgumentParser()
ap.add_argument('path')
ap.add_argument('game')
ap.add_argument('preset')
ap.add_argument('--steps', type=int, default=20)
ap.add_argument('--n', type=int)
ap.add_argument('--seed', type=int, default=7)
ap.add_argument('--top', type=int, help='верх вырезаемой полосы, px от верха квадрата')
ap.add_argument('--size', type=int, default=800, help='сторона квадрата снимка')
ap.add_argument('--wait', type=int, default=8000, help='сколько мс дать странице дорисоваться')
ap.add_argument('--main', action='store_true', help='превью карточки: позиция def.showcase(), файл public/thumbs/<игра>.webp')
a = ap.parse_args()

name = a.path.replace('/', '-')
TMP.mkdir(parents=True, exist_ok=True)
png = TMP / f'{name}.png'
url = f'http://localhost:5173/?thumb={a.game}' if a.main else f'http://localhost:5173/?thumb={a.game}&preset={a.preset}&steps={a.steps}&seed={a.seed}' + (f'&n={a.n}' if a.n else '')
# профиль Chrome — на D (на C места нет), после снимка удаляется
profile = TMP / '_chrome'
env = {**os.environ, 'TEMP': str(TMP), 'TMP': str(TMP)}
subprocess.run(
    [CHROME, '--headless=new', f'--user-data-dir={profile}', '--disk-cache-size=1', '--disable-gpu', '--hide-scrollbars', '--mute-audio', f'--window-size={a.size},{a.size}',
     f'--virtual-time-budget={a.wait}', f'--screenshot={png}', url],
    check=True, capture_output=True, env=env,
)
shutil.rmtree(profile, ignore_errors=True)
img = Image.open(png).convert('RGB')
w = img.width
h = round(w * 300 / 480)
top = a.top if a.top is not None else (img.height - h) // 2
top = max(0, min(top, img.height - h))
out = ROOT / 'public' / 'thumbs' / f'{a.game}.webp' if a.main else ROOT / 'public' / 'thumbs' / 'v' / f'{name}.webp'
out.parent.mkdir(parents=True, exist_ok=True)
img.crop((0, top, w, top + h)).resize((480, 300), Image.LANCZOS).save(out, 'WEBP', quality=82, method=6)
print(f'{url}\n  снимок: {png}\n  превью: {out}', file=sys.stdout)
