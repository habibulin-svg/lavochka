"""«Корона Эмбера» — соседи клеток поля 1.

Смотрел поле глазами (вырезка верхнего ряда): клетки — это прямоугольные панели в сетке,
никаких нарисованных дорог между ними нет. Значит, движение идёт между соседями по сетке
(столбец/ряд из data.json), а связи миров и знаки «⇄»/«↕» добавляются из links.json.

Пишем: lavochka/src/games/korona/roads.json
Запуск из lavochka/:  python -I tools/korona/neigh.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DATA = os.path.join(ROOT, 'lavochka', 'src', 'games', 'korona', 'data.json')
LINKS = os.path.join(ROOT, 'lavochka', 'src', 'games', 'korona', 'links.json')
OUT = os.path.join(ROOT, 'lavochka', 'src', 'games', 'korona', 'roads.json')


def main():
    data = json.load(open(DATA, encoding='utf8'))
    links = json.load(open(LINKS, encoding='utf8'))
    grid = {}
    for c in data['cells']:
        if c.get('panel') or 'col' not in c:
            continue
        # подполя занимают 2x2 клетки сетки
        span = 2 if c.get('subfield') else 1
        for dx in range(span):
            for dy in range(span):
                grid[(c['col'] + dx, c['row'] + dy)] = c['n']
    neigh = {n: set() for n in grid.values()}
    for (col, row), n in grid.items():
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            m = grid.get((col + dc, row + dr))
            if m and m != n:
                neigh[n].add(m)
    # знаки «⇄» и стрелки «↕» из links.json — это связь миров, её тоже учитываем
    extra = 0
    for l in links.get('links', []):
        a, b = l.get('from'), l.get('to')
        if a in neigh and b in neigh:
            if b not in neigh[a]:
                extra += 1
            neigh[a].add(b)
            neigh[b].add(a)
    out = {str(n): sorted(v) for n, v in neigh.items()}
    json.dump({'note': 'Соседи клеток поля 1: по сетке (клетки — панели, дорог нет) плюс знаки из links.json.', 'neigh': out},
              open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    deg = [len(v) for v in out.values()]
    print('kletok: %d | svyazey: %d | znakov dobavleno: %d | stepen: %.2f (min %d, max %d)' % (
        len(out), sum(deg) // 2, extra, sum(deg) / len(deg), min(deg), max(deg)))


if __name__ == '__main__':
    main()
