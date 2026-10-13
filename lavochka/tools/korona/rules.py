"""«Корона Эмбера» — выгрузка текста правил из PDF (спецификация для движка).

Правила лежат в векторных PDF, текст машинный: вынимаем по страницам с координатами блоков,
складываем в tools/korona/rules-raw.json. По нему собирать характеристики (ПС/ПУ/ПМ/ПО),
талеры, предметы, бои и коронацию — без ручного набора.

Пишем: lavochka/tools/korona/rules-raw.json
Запуск из lavochka/:  python -I tools/korona/rules.py
"""
import json
import os

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
PDF_DIR = os.path.join('D:\\', 'temp', 'настолки', 'Корона Эмбера 1994 ги (Реставрация в векторе)', 'PDF')
OUT = os.path.join(ROOT, 'lavochka', 'tools', 'korona', 'rules-raw.json')


def main():
    # отбираем по содержанию, а не по имени: правила — это текстовые PDF, а поля почти без текста;
    # карточки приключений уже разобраны отдельно (их имя лежит в cards-raw.json)
    already = set()
    cards_raw = os.path.join(ROOT, 'lavochka', 'tools', 'korona', 'cards-raw.json')
    if os.path.exists(cards_raw):
        already.add(json.load(open(cards_raw, encoding='utf8'))['src'])
    files = []
    for f in sorted(os.listdir(PDF_DIR)):
        if not f.lower().endswith('.pdf') or f in already:
            continue
        doc = pymupdf.open(os.path.join(PDF_DIR, f))
        chars = sum(len(p.get_text()) for p in doc)
        doc.close()
        if chars > 200:
            files.append(f)
    out = []
    for name in files:
        doc = pymupdf.open(os.path.join(PDF_DIR, name))
        pages = []
        for page in doc:
            blocks = []
            for b in page.get_text('blocks'):
                t = ' '.join(b[4].split())
                if t:
                    blocks.append({'x': round(b[0], 1), 'y': round(b[1], 1), 'text': t})
            pages.append(blocks)
        out.append({'file': name, 'pages': pages})
        doc.close()
    json.dump({'src': 'PDF с правилами «Короны Эмбера»', 'files': out}, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    zn = sum(len(b['text']) for f in out for p in f['pages'] for b in p)
    print('fajlov: %d | stranic: %d | znakov: %d' % (len(out), sum(len(f['pages']) for f in out), zn))
    print('pisano:', OUT.encode('ascii', 'replace').decode())


if __name__ == '__main__':
    main()
