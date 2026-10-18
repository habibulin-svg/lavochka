"""Вырезает картинки географического лото «Вокруг света» из сканов больших карт.

python tools/loto/cut.py <папка со сканами> <выход: public/loto/world> [72|80]
  1980: python tools/loto/cut.py materials/loto/new/raw public/loto/world80 80
Сканы (samoe-vazhnoe.blogspot.com, materials/loto/raw) — листы 2×4 картинок в чёрной рамке.
Ищем рамки как крупные тёмные контуры, сортируем по строкам/столбцам, номер листа — из таблицы ниже.
Каждая картинка → p<номер>.webp 300×300 (рамка входит)."""
import sys, os
import cv2, numpy as np

# файл скана → номер первой картинки на листе
SHEETS = {'068': 1, '102': 9, '066': 17, '012': 25, '001': 33, '082': 41, '052': 49, '009': 57,
          '006': 65, '093': 73, '004': 81, '020': 89, '070': 97, '033': 105, '095': 113}

# издание 1980 (materials/loto/new/raw, файлы 008…027.img) — 20 полей по 6 картинок (3×2)
SHEETS80 = {'%03d' % (8 + i): 6 * i + 1 for i in range(20)}

def boxes(img, lo=0.17, hi=0.3):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    dark = (g < 90).astype(np.uint8) * 255
    dark = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    cnts, _ = cv2.findContours(dark, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h, w = g.shape
    out = []
    for c in cnts:
        x, y, bw, bh = cv2.boundingRect(c)
        if lo * w < bw < hi * w and 0.8 < bw / bh < 1.25:
            out.append((x, y, bw, bh))
    return out

def main(src, dst, ed='72'):
    os.makedirs(dst, exist_ok=True)
    sheets, ext, per, lo, hi = (SHEETS, '.jpg', 4, 0.17, 0.3) if ed == '72' else (SHEETS80, '.img', 3, 0.24, 0.38)
    for f, first in sheets.items():
        img = cv2.imdecode(np.fromfile(os.path.join(src, f + ext), np.uint8), cv2.IMREAD_COLOR)
        b = boxes(img, lo, hi)
        if len(b) != 2 * per:
            print(f, 'нашлось рамок:', len(b), b); continue
        b.sort(key=lambda r: r[1])
        rows = [sorted(b[:per]), sorted(b[per:])]
        for i, (x, y, bw, bh) in enumerate(rows[0] + rows[1]):
            s = min(bw, bh)  # подпись под рамкой иногда слипается с ней — режем по квадрату
            crop = img[y:y + s, x:x + s]
            crop = cv2.resize(crop, (300, 300), interpolation=cv2.INTER_AREA)
            cv2.imwrite(os.path.join(dst, 'p%d.webp' % (first + i)), crop, [cv2.IMWRITE_WEBP_QUALITY, 82])
        print(f, 'ок', first, '…', first + 2 * per - 1)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else '72')
