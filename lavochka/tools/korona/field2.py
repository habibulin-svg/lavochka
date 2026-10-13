"""«Корона Эмбера» — выгрузка раздела о поле 2 (§3.4 отчёта) как сырьё для разметки.

Отчёт честно не посчитал граф дороги поля 2 и порядок ЧЕТ/НЕЧЁТ — их предстоит пройти
руками по рендеру public/korona/field2.webp. Здесь собираем то, что есть в тексте:
строки таблиц (координаты и описания) — чтобы разметку делать, не перечитывая отчёт.

Пишем: lavochka/tools/korona/field2-raw.json
Запуск из lavochka/:  python -I tools/korona/field2.py
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
REPORT = os.path.join(ROOT, 'docs', 'analysis', 'korona-embera.md')
OUT = os.path.join(ROOT, 'lavochka', 'tools', 'korona', 'field2-raw.json')
XY = re.compile(r'(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)')


def main():
    lines = open(REPORT, encoding='utf8').read().split('\n')
    start = next(i for i, l in enumerate(lines) if l.startswith('### 3.4'))
    end = next((i for i, l in enumerate(lines) if l.startswith('### 3.5')), len(lines))
    tables, prose = [], []
    row = []
    for l in lines[start:end]:
        s = l.strip()
        if s.startswith('|'):
            if set(s) <= set('|-: '):
                continue
            cells = [c.strip() for c in s.strip('|').split('|')]
            row.append({'text': cells, 'xy': [[float(a), float(b)] for a, b in XY.findall(s)]})
        else:
            if row:
                tables.append(row)
                row = []
            if s and not s.startswith('#'):
                prose.append(s)
    if row:
        tables.append(row)
    json.dump({'src': 'docs/analysis/korona-embera.md §3.4', 'tables': tables, 'prose': prose},
              open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print('tables: %d | rows: %d | prose: %d' % (len(tables), sum(len(t) for t in tables), len(prose)))
    print('s pisano:', OUT.encode('ascii', 'replace').decode())


if __name__ == '__main__':
    main()
