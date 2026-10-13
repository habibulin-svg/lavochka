"""«Корона Эмбера» — нарезка карт приключений из выгрузки текстовых блоков.

Блоки со страниц PDF группируем в карточки: сначала в строки (близкие по y и перекрывающиеся по x),
потом строки — в карточку (по вертикальному разрыву). Каждой карточке режем картинку из рендера
страницы и пишем текст в порядке чтения.

Пишем: lavochka/src/games/korona/cards.json и public/korona/cards/<n>.webp
Запуск из lavochka/:  python -I tools/korona/cards-cut.py
"""
import json
import os

import pymupdf
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
RAW = os.path.join(ROOT, 'lavochka', 'tools', 'korona', 'cards-raw.json')
OUT_JSON = os.path.join(ROOT, 'lavochka', 'src', 'games', 'korona', 'cards.json')
OUT_IMG = os.path.join(ROOT, 'lavochka', 'public', 'korona', 'cards')
DPI = 110
ROW_GAP = 12.0      # блоки ближе этого по вертикали — одна строка
CARD_GAP = 30.0     # разрыв больше этого — новая карточка


def lines_of(blocks):
    """Собрать блоки в строки: близкие по y и перекрывающиеся по x."""
    rows = []
    for b in sorted(blocks, key=lambda b: (round(b['y'] / 6), b['x'])):
        placed = False
        for row in rows:
            r = row['rect']
            if abs(b['y'] - r[1]) <= ROW_GAP and not (b['x'] + b['w'] < r[0] - 4 or b['x'] > r[2] + 4):
                row['blocks'].append(b)
                row['rect'] = (min(r[0], b['x']), min(r[1], b['y']), max(r[2], b['x'] + b['w']), max(r[3], b['y'] + b['h']))
                placed = True
                break
        if not placed:
            rows.append({'blocks': [b], 'rect': (b['x'], b['y'], b['x'] + b['w'], b['y'] + b['h'])})
    rows.sort(key=lambda r: r['rect'][1])
    for row in rows:
        row['blocks'].sort(key=lambda b: b['x'])
    return rows


def columns_of(rows, gap=40.0):
    """Разбить строки на колонки карточек: страница A3 держит три карточки в ряд."""
    cols = []
    for row in sorted(rows, key=lambda r: r['rect'][0]):
        x0, _, x1, _ = row['rect']
        placed = False
        for col in cols:
            c = col['rect']
            if x0 <= c[2] + gap and x1 >= c[0] - gap:
                col['rows'].append(row)
                col['rect'] = (min(c[0], x0), min(c[1], row['rect'][1]), max(c[2], x1), max(c[3], row['rect'][3]))
                placed = True
                break
        if not placed:
            cols.append({'rows': [row], 'rect': (x0, row['rect'][1], x1, row['rect'][3])})
    return cols


def cards_of(cols):
    """В каждой колонке собрать строки в карточки по вертикальному разрыву."""
    cards = []
    for col in cols:
        stack = []
        for row in sorted(col['rows'], key=lambda r: r['rect'][1]):
            if stack and row['rect'][1] - stack[-1]['rect'][3] <= CARD_GAP:
                last = stack[-1]
                last['rows'].append(row)
                last['rect'] = (min(last['rect'][0], row['rect'][0]), last['rect'][1], max(last['rect'][2], row['rect'][2]), max(last['rect'][3], row['rect'][3]))
            else:
                stack.append({'rows': [row], 'rect': row['rect']})
        cards.extend(stack)
    return cards


def main():
    raw = json.load(open(RAW, encoding='utf8'))
    src = os.path.join('D:\\', 'temp', 'настолки', 'Корона Эмбера 1994 ги (Реставрация в векторе)', 'PDF', raw['src'])
    doc = pymupdf.open(src)
    os.makedirs(OUT_IMG, exist_ok=True)
    cards = []
    n = 0
    for page_info in raw['pages']:
        page = doc[page_info['page'] - 1]
        pix = page.get_pixmap(dpi=DPI)
        img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        k = DPI / 72
        for card in cards_of(columns_of(lines_of(page_info['blocks']))):
            text = ' '.join(' '.join(b['text'] for b in row['blocks']) for row in card['rows']).strip()
            if len(text) < 60:
                continue  # подписи-обрывки не считаем карточкой
            n += 1
            x0, y0, x1, y1 = card['rect']
            pad = 6
            box = (max(0, int((x0 - pad) * k)), max(0, int((y0 - pad) * k)), min(img.width, int((x1 + pad) * k)), min(img.height, int((y1 + pad) * k)))
            name = 'card-%03d.webp' % n
            img.crop(box).save(os.path.join(OUT_IMG, name), 'WEBP', quality=84, method=6)
            cards.append({'n': n, 'page': page_info['page'], 'x': round(x0, 1), 'y': round(y0, 1), 'text': text, 'img': '/korona/cards/' + name})
    doc.close()
    json.dump({'note': 'Карты приключений: текст вынут из векторного PDF, картинки нарезаны по блокам.', 'cards': cards},
              open(OUT_JSON, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print('карточек: %d | в среднем знаков: %d' % (len(cards), sum(len(c['text']) for c in cards) // max(1, len(cards))))
    print('записано:', OUT_JSON)


if __name__ == '__main__':
    main()
