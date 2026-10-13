"""«Корона Эмбера» — сборка переходов поля 1 (`links.json`) из выгрузки отчёта.

В `links-raw.json` строка перехода описана словами «откуда → куда» и координатой знака.
Разбираем: делим текст по стрелке, названия клеток ищем среди имён из `data.json`
(сравнение по вхождению, регистр и лишние знаки не важны), координату переводим
в пиксели растра поля (150 dpi, то есть ×2,0833).

Пишем: lavochka/src/games/korona/links.json
Запуск из lavochka/:  python -I tools/korona/links-build.py
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
RAW = os.path.join(ROOT, 'lavochka', 'tools', 'korona', 'links-raw.json')
DATA = os.path.join(ROOT, 'lavochka', 'src', 'games', 'korona', 'data.json')
OUT = os.path.join(ROOT, 'lavochka', 'src', 'games', 'korona', 'links.json')
ARROW = re.compile(r'\s*(?:→|->|=>|—>|➔|➜|⇄|↔|<->|⇆)\s*')
SCALE = 150 / 72


def norm(s):
    return re.sub(r'[^А-ЯЁA-Z0-9]+', '', s.upper())


def main():
    raw = json.load(open(RAW, encoding='utf8'))
    data = json.load(open(DATA, encoding='utf8'))
    cells = data['cells']
    names = [(norm(c['name']), c) for c in cells]
    links, unresolved = [], []

    def find(text):
        key = norm(text)
        if not key:
            return None
        for n, c in names:
            if not n:
                continue
            if n in key or key in n:
                return c
        return None

    for row in raw['rows']:
        text = ' '.join(row['text'])
        text = re.sub(r'^\d+\s*', '', text).strip()
        parts = [p.strip(' .()') for p in ARROW.split(text) if p.strip(' .()')]
        if len(parts) < 2:
            # cross-клетки и Провалы: переход другого рода (бросок, уход в Эмбер) — сохраняем как есть
            unresolved.append({'text': text, 'x': round(row['xy'][0][0] * SCALE, 1) if row['xy'] else None, 'y': round(row['xy'][0][1] * SCALE, 1) if row['xy'] else None})
            continue
        a, b = find(parts[0]), find(parts[1])
        xy = row['xy'][0] if row['xy'] else None
        links.append({
            'from': a['n'] if a else None,
            'to': b['n'] if b else None,
            'fromName': parts[0],
            'toName': parts[1],
            'x': round(xy[0] * SCALE, 1) if xy else None,
            'y': round(xy[1] * SCALE, 1) if xy else None,
        })
    json.dump({'note': 'Переходы поля 1: «⇄» и стрелки между клетками, координаты знаков в пикселях растра.', 'links': links, 'special': unresolved},
              open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    both = sum(1 for l in links if l['from'] and l['to'])
    print('связей: %d | опознаны обе клетки: %d | особых строк: %d' % (len(links), both, len(unresolved)))
    for l in links[:3]:
        print('  пример: %s -> %s | xy %s,%s' % (l['from'], l['to'], l['x'], l['y']))
    print('записано:', OUT)


if __name__ == '__main__':
    main()
