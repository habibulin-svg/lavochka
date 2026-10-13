"""«Корона Эмбера» — нарезка карт приключений (версия 2: заголовки по размеру шрифта).

В PDF карточки лежат по три в ряд, и «слепая» группировка по координатам путается: заголовок одной
карточки по вертикали попадает между строками соседней. Надёжнее признак — кегль: у заголовков
карточек он крупнее текста (тело ~7,5 pt, заголовки ~14–14,5 pt, крупнее — шапки страниц).
Карточка = «заголовок + строки под ним в той же колонке до следующего заголовка».

Пишем: lavochka/src/games/korona/cards.json, public/korona/cards/<n>.webp и монтаж для проверки глазами.
Запуск из lavochka/:  python -I tools/korona/cards-cut.py
"""
import json
import os
import re

import pymupdf
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
RAW = os.path.join(ROOT, 'lavochka', 'tools', 'korona', 'cards-raw.json')
OUT_JSON = os.path.join(ROOT, 'lavochka', 'src', 'games', 'korona', 'cards.json')
OUT_IMG = os.path.join(ROOT, 'lavochka', 'public', 'korona', 'cards')
MONTAGE = os.path.join(ROOT, 'lavochka', 'tools', 'korona', 'cards-check.png')
PDF_DIR = os.path.join('D:\\', 'temp', 'настолки', 'Корона Эмбера 1994 ги (Реставрация в векторе)', 'PDF')
DPI = 110
TITLE_MIN, TITLE_MAX = 12.5, 19.0
LINE_TOL = 4.0


def lines_of(page):
    """Строки страницы: текст, кегль, рамка (спаны собираем в строки по y)."""
    spans = []
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            for s in line['spans']:
                t = ' '.join(s['text'].split())
                if t:
                    spans.append({'text': t, 'size': round(s['size'], 1), 'x0': s['bbox'][0], 'y0': s['bbox'][1], 'x1': s['bbox'][2], 'y1': s['bbox'][3]})
    spans.sort(key=lambda s: (s['y0'], s['x0']))
    rows = []
    for s in spans:
        if rows and abs(s['y0'] - rows[-1]['y0']) <= LINE_TOL and not (s['x1'] < rows[-1]['x0'] - 6 or s['x0'] > rows[-1]['x1'] + 6):
            r = rows[-1]
            r['text'] += ' ' + s['text']
            r['size'] = max(r['size'], s['size'])
            r['x0'] = min(r['x0'], s['x0'])
            r['x1'] = max(r['x1'], s['x1'])
            r['y1'] = max(r['y1'], s['y1'])
        else:
            rows.append(dict(s))
    return rows


def is_title(row):
    return TITLE_MIN <= row['size'] <= TITLE_MAX


def main():
    raw = json.load(open(RAW, encoding='utf8'))
    doc = pymupdf.open(os.path.join(PDF_DIR, raw['src']))
    os.makedirs(OUT_IMG, exist_ok=True)
    cards, n = [], 0
    per_page = []
    for page_no in range(len(doc)):
        page = doc[page_no]
        rows = lines_of(page)
        titles = [r for r in rows if is_title(r)]
        if not titles:
            per_page.append(0)
            continue
        pix = page.get_pixmap(dpi=DPI)
        img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        k = DPI / 72
        made = 0
        for t in titles:
            below = [r for r in rows if r['y0'] > t['y1'] - 2 and not (r['x1'] < t['x0'] - 30 or r['x0'] > t['x1'] + 30)]
            nxt = min((r['y0'] for r in below if is_title(r)), default=None)
            body = [r for r in below if nxt is None or r['y0'] < nxt - 2]
            text = ' '.join([t['text']] + [r['text'] for r in body]).strip()
            if len(text) < 40:
                continue
            n += 1
            made += 1
            x0 = min([t['x0']] + [r['x0'] for r in body])
            x1 = max([t['x1']] + [r['x1'] for r in body])
            y0 = t['y0']
            y1 = max([t['y1']] + [r['y1'] for r in body])
            # номер карточки напечатан крупной цифрой чуть ниже имени: ищем такую строку рядом
            num_row = None
            for r in rows:
                if r['size'] >= 20 and re.fullmatch(r'\d{1,3}', r['text'].strip()) and t['y0'] - 6 <= r['y0'] <= t['y1'] + 22 and r['x0'] >= x0 - 90 and r['x1'] <= x1 + 90:
                    num_row = r
                    break
            num = int(num_row['text']) if num_row else None
            if num_row:
                y0 = min(y0, num_row['y0'])
                y1 = max(y1, num_row['y1'])
                x0 = min(x0, num_row['x0'])
                x1 = max(x1, num_row['x1'])
            name = 'card-%03d.webp' % n
            img.crop((max(0, int((x0 - 6) * k)), max(0, int((y0 - 6) * k)), min(img.width, int((x1 + 6) * k)), min(img.height, int((y1 + 6) * k)))).save(
                os.path.join(OUT_IMG, name), 'WEBP', quality=84, method=6
            )
            cards.append({'n': n, 'num': num, 'page': page_no + 1, 'x': round(x0, 1), 'y': round(y0, 1), 'text': text, 'img': '/korona/cards/' + name})
        per_page.append(made)
    doc.close()
    json.dump({'note': 'Карты приключений: заголовки найдены по кеглю (13,5–18 pt), текст собран из строк карточки.', 'cards': cards},
              open(OUT_JSON, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    files = sorted(os.listdir(OUT_IMG))[:12]
    if files:
        m = Image.new('RGB', (300 * 4, 210 * 3), (240, 236, 226))
        for i, f in enumerate(files):
            im = Image.open(os.path.join(OUT_IMG, f)).convert('RGB').resize((300, 210), Image.LANCZOS)
            m.paste(im, ((i % 4) * 300, (i // 4) * 210))
        m.save(MONTAGE)
    nums = sorted(c['num'] for c in cards if c['num'])
    print('карточек: %d | с номером: %d | номера от %s до %s' % (len(cards), len(nums), nums[0] if nums else '-', nums[-1] if nums else '-'))
    print('по страницам: %s' % per_page)
    print('записано:', OUT_JSON)


if __name__ == '__main__':
    main()
