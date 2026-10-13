"""«Корона Эмбера» — выгрузка переходов поля 1 из отчёта разбора.

В отчёте (§3.3) таблицы переходов: 18 знаков «⇄», 14 стрелок, 4 cross-клетки и три Провала,
с координатами в точках PDF. Разбираем таблицы терпимо: берём из каждой строки текстовые
столбцы и все пары чисел вида «x, y» — по ним потом собрать `links.json`.

Пишем: lavochka/tools/korona/links-raw.json
Запуск из lavochka/:  python -I tools/korona/links.py
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
REPORT = os.path.join(ROOT, 'docs', 'analysis', 'korona-embera.md')
OUT = os.path.join(ROOT, 'lavochka', 'tools', 'korona', 'links-raw.json')
XY = re.compile(r'(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)')


def main():
    lines = open(REPORT, encoding='utf8').read().split('\n')
    start = next(i for i, l in enumerate(lines) if l.startswith('### 3.3'))
    end = next(i for i, l in enumerate(lines) if l.startswith('### 3.4'))
    rows = []
    for l in lines[start:end]:
        s = l.strip()
        if not s.startswith('|') or set(s) <= set('|-: '):
            continue
        cells = [c.strip() for c in s.strip('|').split('|')]
        xy = [[float(a), float(b)] for a, b in XY.findall(s)]
        text = [c for c in cells if c and not XY.fullmatch(c) and not re.fullmatch(r'[-: ]*', c)]
        if not text and not xy:
            continue
        rows.append({'text': text, 'xy': xy})
    json.dump({'src': 'docs/analysis/korona-embera.md §3.3', 'rows': rows},
              open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    with_xy = sum(1 for r in rows if r['xy'])
    print('строк: %d | с координатами: %d' % (len(rows), with_xy))
    if rows:
        print('пример xy:', rows[1]['xy'][:3] if len(rows) > 1 else rows[0]['xy'][:3])
    print('записано:', OUT)


if __name__ == '__main__':
    main()
