"""Кинь-двинь: нарезка полей из исходных сканов (materials/) в пирамиду тайлов для зума.

public/hodilki/<id>/
  tiny.webp      — 64 px, проявляется размытой сразу
  view.webp      — общая карта (PREVIEW px по ширине)
  <lv>/<c>_<r>.webp — тайлы TILE×TILE (+1 px нахлёста справа и снизу, чтобы не было швов); lv 0 — полный размер скана,
                     каждый следующий вдвое меньше, пока уровень крупнее общей карты.

Запуск из lavochka/:  python tools/hodilki/tiles.py
Число уровней печатается — его же надо прописать в разметке поля (`levels` в kosmos.ts / krugosvet.ts / put.ts).
"""
import math
import os
import shutil
import sys

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = {
    'kosmos': 'materials/kosmos/kosmosput.jpg',
    'krugosvet': 'materials/krug/krugput.jpg',
    'put': 'materials/put/put.jpg',
}
TILE = 512
PREVIEW = 1600
Q = 80


def build(id_, path):
    out = os.path.join(ROOT, 'lavochka', 'public', 'hodilki', id_)
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    im = Image.open(os.path.join(ROOT, path)).convert('RGB')
    w, h = im.size
    im.resize((64, round(64 * h / w)), Image.LANCZOS).save(os.path.join(out, 'tiny.webp'), quality=60)
    im.resize((PREVIEW, round(PREVIEW * h / w)), Image.LANCZOS).save(os.path.join(out, 'view.webp'), quality=Q, method=6)
    lv = 0
    cur = im
    while cur.size[0] > PREVIEW:
        d = os.path.join(out, str(lv))
        os.makedirs(d)
        cw, ch = cur.size
        for r in range(math.ceil(ch / TILE)):
            for c in range(math.ceil(cw / TILE)):
                box = (c * TILE, r * TILE, min(cw, (c + 1) * TILE + 1), min(ch, (r + 1) * TILE + 1))
                cur.crop(box).save(os.path.join(d, f'{c}_{r}.webp'), quality=Q, method=6)
        lv += 1
        cur = im.resize((math.ceil(w / 2**lv), math.ceil(h / 2**lv)), Image.LANCZOS)
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out) for f in fs)
    print(f'{id_}: {w}x{h}, уровней {lv}, {size / 1e6:.1f} МБ')


if __name__ == '__main__':
    for id_, path in SRC.items():
        if len(sys.argv) < 2 or id_ in sys.argv[1:]:
            build(id_, path)
