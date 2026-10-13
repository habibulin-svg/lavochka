"""«Корона Эмбера» — выгрузка карт приключений из векторного PDF.

В PDF 14 страниц A3, на каждой — россыпь карточек с текстом. Текст векторный, поэтому его можно
вынуть машинно (без ручного набора): берём все текстовые блоки с координатами и складываем по страницам.
Разбор блоков на отдельные карточки и нарезка картинок — следующий шаг (`cards-cut.py`).

Пишем: lavochka/tools/korona/cards-raw.json
Запуск из lavochka/:  python -I tools/korona/cards.py
"""
import json
import os

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(os.path.dirname(os.path.dirname(ROOT)), 'temp', 'настолки')
OUT = os.path.join(ROOT, 'lavochka', 'tools', 'korona', 'cards-raw.json')


def find_pdf():
    base = os.path.join('D:\\', 'temp', 'настолки', 'Корона Эмбера 1994 ги (Реставрация в векторе)', 'PDF')
    for name in sorted(os.listdir(base)):
        if 'приключений' in name and 'кривые' not in name:
            return os.path.join(base, name)
    raise SystemExit('PDF с карточками приключений не найден')


def main():
    path = find_pdf()
    doc = pymupdf.open(path)
    pages = []
    for i, page in enumerate(doc):
        blocks = []
        for b in page.get_text('blocks'):
            x0, y0, x1, y1, text = b[0], b[1], b[2], b[3], b[4]
            text = ' '.join(text.split())
            if not text:
                continue
            blocks.append({'x': round(x0, 1), 'y': round(y0, 1), 'w': round(x1 - x0, 1), 'h': round(y1 - y0, 1), 'text': text})
        pages.append({'page': i + 1, 'w': round(page.rect.width, 1), 'h': round(page.rect.height, 1), 'blocks': blocks})
    doc.close()
    data = {'src': os.path.basename(path), 'pages': pages}
    json.dump(data, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    chars = sum(len(b['text']) for p in pages for b in p['blocks'])
    print('страниц %d, блоков %d, знаков %d' % (len(pages), sum(len(p['blocks']) for p in pages), chars))
    print('записано:', OUT)


if __name__ == '__main__':
    main()
