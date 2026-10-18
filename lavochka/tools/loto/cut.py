"""Вырезает картинки географического лото «Вокруг света» из сканов больших карт.

python tools/loto/cut.py <папка со сканами> <выход: public/loto/world>
Сканы (samoe-vazhnoe.blogspot.com, materials/loto/raw) — листы 2×4 картинок в чёрной рамке.
Ищем рамки как крупные тёмные контуры, сортируем по строкам/столбцам, номер листа — из таблицы ниже.
Каждая картинка → p<номер>.webp 300×300 (рамка входит)."""
import sys, os
import cv2, numpy as np

# файл скана → номер первой картинки на листе
SHEETS = {'068': 1, '102': 9, '066': 17, '012': 25, '001': 33, '082': 41, '052': 49, '009': 57,
          '006': 65, '093': 73, '004': 81, '020': 89, '070': 97, '033': 105, '095': 113}

def boxes(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    dark = (g < 90).astype(np.uint8) * 255
    dark = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    cnts, _ = cv2.findContours(dark, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h, w = g.shape
    out = []
    for c in cnts:
        x, y, bw, bh = cv2.boundingRect(c)
        if 0.17 * w < bw < 0.3 * w and 0.8 < bw / bh < 1.25:
            out.append((x, y, bw, bh))
    return out

def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    for f, first in SHEETS.items():
        img = cv2.imread(os.path.join(src, f + '.jpg'))
        b = boxes(img)
        if len(b) != 8:
            print(f, 'нашлось рамок:', len(b), b); continue
        b.sort(key=lambda r: r[1])
        rows = [sorted(b[:4]), sorted(b[4:])]
        for i, (x, y, bw, bh) in enumerate(rows[0] + rows[1]):
            crop = img[y:y + bh, x:x + bw]
            crop = cv2.resize(crop, (300, 300), interpolation=cv2.INTER_AREA)
            cv2.imwrite(os.path.join(dst, 'p%d.webp' % (first + i)), crop, [cv2.IMWRITE_WEBP_QUALITY, 82])
        print(f, 'ок', first, '…', first + 7)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
