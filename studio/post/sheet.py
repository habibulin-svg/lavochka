"""Лист для выбора: все картинки партии сеткой, по строке на позицию, с подписями «имя-сид».

python studio/post/sheet.py G:/temp/studio/out/gops/01-concepts [--cell 320]
Пишет <партия>/sheet.jpg.
"""
import argparse
import json
import pathlib

from PIL import Image, ImageDraw, ImageFont


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dir')
    ap.add_argument('--cell', type=int, default=320, help='высота ячейки, px')
    a = ap.parse_args()
    d = pathlib.Path(a.dir)
    manifest = json.loads((d / 'manifest.json').read_text(encoding='utf-8'))
    rows: dict[str, list] = {}
    for m in manifest:
        rows.setdefault(m['item'], []).append(m)

    h = a.cell
    label = 28
    widths = []
    for items in rows.values():
        w0, h0 = items[0]['size']
        widths.append(len(items) * round(h * w0 / h0))
    sheet = Image.new('RGB', (max(widths), len(rows) * (h + label)), 'white')
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('arial.ttf', 20)
    except OSError:
        font = ImageFont.load_default()
    for r, items in enumerate(rows.values()):
        x = 0
        y = r * (h + label)
        for m in items:
            im = Image.open(d / m['file'])
            im = im.resize((round(h * im.width / im.height), h))
            sheet.paste(im, (x, y + label))
            draw.text((x + 6, y + 4), m['file'].removesuffix('.png'), fill='black', font=font)
            x += im.width
    sheet.save(d / 'sheet.jpg', quality=85)
    print(d / 'sheet.jpg')


if __name__ == '__main__':
    main()
