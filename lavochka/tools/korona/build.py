"""«Корона Эмбера» — данные полей из отчёта разбора (docs/analysis/korona-embera.md).

В PDF клетки полей не выделяются (там тысячи мелких картинок-украшений), зато в отчёте есть готовая
таблица §3.2: номер, имя, мир, столбец/ряд и точные x0,y0,w×h в точках PDF. Оттуда и собираем данные.

Пишем: lavochka/src/games/korona/data.json
Запуск из lavochka/:  python -I tools/korona/build.py
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
REPORT = os.path.join(ROOT, 'docs', 'analysis', 'korona-embera.md')
OUT = os.path.join(ROOT, 'lavochka', 'src', 'games', 'korona', 'data.json')

ROW = re.compile(r'^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*'
                 r'([0-9.]+)\s*,\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*[×x]\s*([0-9.]+)\s*\|')


def main():
    lines = open(REPORT, encoding='utf8').read().split('\n')
    start = next(i for i, l in enumerate(lines) if l.startswith('### 3.2'))
    end = next(i for i, l in enumerate(lines) if l.startswith('### 3.3'))
    cells = []
    for l in lines[start:end]:
        m = ROW.match(l.strip())
        if not m:
            continue
        n, name, world, cr, x0, y0, w, h = m.groups()
        cr = cr.strip()
        col, row = (int(cr.split(',')[0]), int(cr.split(',')[1])) if ',' in cr else (None, None)
        cells.append({
            'n': int(n),
            'name': name.strip(),
            'world': world.strip(),
            **({'col': col, 'row': row} if col is not None else {}),
            'x': float(x0),
            'y': float(y0),
            'w': float(w),
            'h': float(h),
            # внеигровые панели и подполя отмечаем: у них размер не 222×222
            **({'panel': True} if 'панель' in name else {}),
            **({'subfield': True} if '8 секторов' in name else {}),
        })
    worlds = {}
    for c in cells:
        worlds[c['world']] = worlds.get(c['world'], 0) + 1
    data = {
        'note': 'Разметка поля 1 «Мир Приключений» из отчёта docs/analysis/korona-embera.md (§3.2). '
                'Координаты в точках PDF; растр поля — public/korona/field1.webp (150 dpi, то есть ×2.0833).',
        'field': {'img': '/korona/field1.webp', 'pt': [3118.1, 2267.7], 'scale': 150 / 72},
        'cells': cells,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(data, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print('клеток: %d | миры: %s' % (len(cells), worlds))
    print('записано:', OUT)


if __name__ == '__main__':
    main()
