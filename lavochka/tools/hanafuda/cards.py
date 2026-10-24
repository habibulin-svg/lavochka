"""Колода ханафуды: SVG Louie Mantia (Wikimedia Commons, CC BY-SA 4.0) → public/hanafuda/<набор>/<id>.webp и back.webp.

  python tools/hanafuda/cards.py D:/temp/hanafuda

В папке — подпапки alt (традиционные цвета, чёрная рамка: файлы «Hanafuda <Месяц> <Вид> Alt.svg»), alt2 (красная рамка, «… Alt2.svg»)
и green (зелёные растения, «… .svg»), файлы переименованы в <Месяц>_<Вид>[_<n>].svg (пробелы → «_», без «Hanafuda » и «Alt»).
Каждую карту безголовый Chrome рисует без бумажных полей (у рисунка 16 px отступа), сетка снимается одним скриншотом
и режется на карты 300×498. id карты = месяц × 4 + место в месяце — тот же порядок, что в src/games/hanafuda/cards.ts.
"""
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image

CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
ROOT = Path(__file__).resolve().parents[2]
TMP = Path('D:/temp/hanafuda-build')
W, H = 300, 498
COLS = 10

MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
# виды карт месяца по порядку (как в cards.ts)
KINDS = [
    ['Hikari', 'Tanzaku', 'Kasu_1', 'Kasu_2'],
    ['Tane', 'Tanzaku', 'Kasu_1', 'Kasu_2'],
    ['Hikari', 'Tanzaku', 'Kasu_1', 'Kasu_2'],
    ['Tane', 'Tanzaku', 'Kasu_1', 'Kasu_2'],
    ['Tane', 'Tanzaku', 'Kasu_1', 'Kasu_2'],
    ['Tane', 'Tanzaku', 'Kasu_1', 'Kasu_2'],
    ['Tane', 'Tanzaku', 'Kasu_1', 'Kasu_2'],
    ['Hikari', 'Tane', 'Kasu_1', 'Kasu_2'],
    ['Tane', 'Tanzaku', 'Kasu_1', 'Kasu_2'],
    ['Tane', 'Tanzaku', 'Kasu_1', 'Kasu_2'],
    ['Hikari', 'Tane', 'Tanzaku', 'Kasu'],
    ['Hikari', 'Kasu_1', 'Kasu_2', 'Kasu_3'],
]


def files():
    out = [f'{MONTHS[m]}_{k}.svg' for m in range(12) for k in KINDS[m]]
    return out + ['card_back.svg']


def build(src: Path, name: str):
    names = files()
    rows = (len(names) + COLS - 1) // COLS
    k = W / 944
    cells = ''.join(
        f'<div style="position:absolute;left:{(i % COLS) * W}px;top:{(i // COLS) * H}px;width:{W}px;height:{H}px;overflow:hidden">'
        f'<img src="{(src / f).as_uri()}" style="position:absolute;left:{-16 * k}px;top:{-16 * k}px;width:{976 * k}px;height:{1600 * k}px"></div>'
        for i, f in enumerate(names)
    )
    TMP.mkdir(parents=True, exist_ok=True)
    page = TMP / f'{name}.html'
    page.write_text(f'<!doctype html><html><body style="margin:0;background:#000">{cells}</body></html>', encoding='utf-8')
    shot = TMP / f'{name}.png'
    env = dict(os.environ, TEMP=str(TMP), TMP=str(TMP))
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                    f'--window-size={COLS * W},{rows * H}', f'--screenshot={shot}', '--allow-file-access-from-files',
                    f'--user-data-dir={TMP / "chrome"}', page.as_uri()], check=True, env=env, timeout=120)
    img = Image.open(shot).convert('RGB')
    dst = ROOT / 'public' / 'hanafuda' / name
    dst.mkdir(parents=True, exist_ok=True)
    for i, f in enumerate(names):
        x, y = (i % COLS) * W, (i // COLS) * H
        card = img.crop((x, y, x + W, y + H))
        card.save(dst / ('back.webp' if f == 'card_back.svg' else f'{i}.webp'), 'WEBP', quality=78, method=6)
    print(name, 'готово:', dst)


if __name__ == '__main__':
    base = Path(sys.argv[1])
    for name in ['alt', 'alt2', 'green']:
        build(base / name, name)
