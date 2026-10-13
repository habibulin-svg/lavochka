"""«Лукоморье» (серия «Приключенческий игровой сериал», 4 части, 1995) — поля карточки «Кинь-двинь».

Материалы: materials/nastolki/lukomorie/
  cells-N.json — узлы поля (номерные кружки и точки правил: n, x, y, kind);
  path-N.json  — весь путь по кружкам (его готовит агент: id, x, y, next) — без него поля не собрать;
  field-N.webp — скан поля.

Здесь лежат знаки пунктов (боны, предметы, развилки, условия, загадки) по правилам из info.md.
Ветки развилок (клетки дорог) берутся из path-N.json: у развилки несколько `next`, дороги сходятся
на общем узле — он и есть выход ветки.

Запуск из lavochka/:  python -I tools/hodilki/lukomorie.py [1 2 3 4]
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(ROOT, 'materials', 'nastolki', 'lukomorie')
OUT = os.path.join(ROOT, 'lavochka', 'src', 'games', 'hodilki', 'data')

# Знаки пунктов: id узла → (код разметки, текст для журнала).
# Коды: coins:N / coinsD:N (сумма N бросков) / coinsDiff (взять разницу «очки − кружки до пункта») /
#       lose:N / loseD:N+skip / loseDiff / extra:N / item:<предмет> /
#       takeItem:<предмет> / need:item=…,coins=…,yes=…,no=… / fork:… (ветки собирает конвертер) /
#       wait:N / pick:вопрос|ответы|клетки / field:<карта>:<клетка> / skip / start / jump:<id>
SIGNS = {
    1: {
        'болото-1': ('', 'болото: кружки 1–17 — часть пути, знаков нет'),
        'старт': ('', 'старт: пуговицы ставятся сюда'),
        '2': ('fork', 'Путеводный камень: разница 1–2 — прямо, 3–4 — вверх, 5–6 — вниз'),
        '3': ('', 'У Дуба ждёт Кот Учёный: вход в лабиринт по числу на кубике (лабиринт на скане — клубок белых дорог, кружков нет)'),
        '4': ('coinsD:2', 'Клад: бросай кубик два раза и возьми столько бон'),
        '5': ('extra:1', 'Выход из болота: дополнительный ход'),
        '6а': ('skip', 'Напал Леший: пропуск хода'),
        '6б': ('skip', 'Напала Шишига: пропуск хода'),
        '7a': ('coinsD:3', 'Огромный клад: кубик можно бросать три раза'),
        '7b': ('coinsD:3', 'Огромный клад: кубик можно бросать три раза'),
        '8': ('skip', 'Леший приглашает выпить чайку: пропуск хода'),
        '9a': ('loseD:1+1', 'Разбойники отнимают боны и ход'),
        '9b': ('loseD:1+1', 'Разбойники отнимают боны и ход'),
        '10': ('', 'Перекрёсток: выбор пути как у (2) — но на скане от него отходит одна дорога, развилки нет'),
        '11': ('', 'Гусь переносит по маршруту: рядом нарисован ряд номерных кружков 1–6, разметки нет'),
        '12': ('pick', 'Сколько действующих лиц в сказке о репке? Угаданное число — номер пункта'),
        '13': ('need', 'Избушка Бабы Яги: с 20 бонами продаёт Волшебный клубок, иначе — назад к Дубу'),
    },
}

# Развилки: id узла → (список названий дорог, «какая разница куда»).
# byDiff — шесть чисел: номер дороги для разницы 1…6 (по правилам info.md).
FORKS = {
    '2': {'roads': ['прямо', 'вверх', 'вниз'], 'byDiff': [0, 0, 1, 1, 2, 2]},
    '3': {'roads': ['1', '2', '3', '4', '5', '6'], 'byDiff': [0, 1, 2, 3, 4, 5]},
    '10': {'roads': ['прямо', 'вверх', 'вниз'], 'byDiff': [0, 0, 1, 1, 2, 2]},
    '11': {'roads': ['вниз', 'прямо', 'вверх'], 'byDiff': [0, 0, 1, 1, 2, 2]},
}

# Условия пунктов: id → (что проверяем, «да» — клетка или выигрыш, «нет» — клетка).
NEEDS = {
    '13': {'coins': 20, 'yes': 'win', 'no': '3'},
}


def load(part):
    cells = json.load(open(os.path.join(SRC, 'cells-%d.json' % part), encoding='utf8'))
    path_file = os.path.join(SRC, 'path-%d.json' % part)
    if not os.path.exists(path_file):
        return cells, None
    return cells, json.load(open(path_file, encoding='utf8'))


# Главный путь поля (по нему фишка идёт по умолчанию) и дороги развилок.
# Агент размечал пути по скану, поэтому порядок и развилки — оттуда (см. note в path-N.json).
MAIN = {
    1: ['старт', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', '2',
        'w30', 'w31b', 'w32b', 'w33b', 'w34b', 'w35b', 'w36b', '3',
        'w50', 'w54', 'w55', 'w56', 'w57', 'w53', '9б',
        'w58', 'w59', 'w60', 'w61', 'w62', 'w63', '10',
        'w64', 'w65', 'w66', 'w67', '12', 'w68', '11', 'w69', 'w70', 'w71', '13'],
}

# Развилки: id пункта → дороги в порядке номеров (0 — «прямо» = главный путь, значит пустая дорога).
BRANCHES = {
    1: {
        '2': [
            {'road': 'прямо', 'ids': [], 'exit': None},
            {'road': 'вверх', 'exit': '10', 'ids': [
                'w8', 'w9', 'w10', 'w11', 'w12', 'w13', 'w14', 'w15', 'w16', 'w17', '7а', 'w18', 'w19', 'w20',
                'w21', 'w22', 'w23', 'w24', '8', 'w25', 'w26', 'w27', '9а', 'w28', 'w29', 'w30b',
                'w31', 'w32', 'w33', 'w34', 'w35', 'w36', 'w37', '6б', 'w38', 'w39', 'w40b', 'w41', 'w42']},
            {'road': 'вниз', 'exit': '9б', 'ids': [
                'w40', 'w41b', 'w42b', 'w43b', 'w44b', 'w45b', 'w46b', '4', 'w47', 'w48', 'болото-1',
                'm1_1', 'm1_3', 'm1_5', 'm1_9', 'm1_10', 'm1_11', 'm1_12', 'm1_14', 'm1_15', 'm1_17',
                '5', 'w49', 'w50b', 'w51', 'w52', 'w53']},
        ],
    },
}

# Клетки, которые агент не привязал к пути: остаются на поле украшением (в путь не попадают).
LOOSE = {
    1: ['6а', '7б', 'm1_2', 'm1_4', 'm1_6', 'm1_7', 'm1_8', 'm1_13', 'm1_16',
        'm1_18', 'm1_19', 'm1_20', 'm1_21', 'm1_22', 'm1_23', 'm1_24'],
}


def norm(cid):
    """Идентификаторы в разметке писались то латиницей, то кириллицей (7a и 7а) — приводим к одному виду."""
    return str(cid).replace('a', 'а').replace('b', 'б')


def build(part=1):
    nodes, path = load(part)
    if not path:
        print('поле %d: путь не размечен (нет path-%d.json) — собирать нечего' % (part, part))
        return
    byid = {norm(c['id']): c for c in path['cells']}
    points = {norm(n['n']) for n in nodes.get('nodes', [])}
    table = {norm(k): v for k, v in SIGNS[part].items()}
    forks = {norm(k): v for k, v in FORKS.items()}
    needs = {norm(k): v for k, v in NEEDS.items()}

    cells, idx = [], {}

    def put(cid, off=False):
        cid = norm(cid)
        if cid in idx:
            return idx[cid]
        src = byid.get(cid)
        if src is None:
            raise SystemExit('в path-%d.json нет клетки «%s»' % (part, cid))
        cell = {'x': round(src['x']), 'y': round(src['y'])}
        if cid in points:
            cell['l'] = cid
        if off:
            cell['off'] = 1
        cells.append(cell)
        idx[cid] = len(cells) - 1
        return idx[cid]

    main = [put(c) for c in MAIN[part]]
    end = main[-1]
    # дороги развилок — клетками после главного пути
    roads = {}
    for fid, list_ in BRANCHES.get(part, {}).items():
        roads[norm(fid)] = [{'road': r['road'], 'ids': [put(c, off=True) for c in r['ids']],
                             'exit': put(r['exit']) if r.get('exit') else None} for r in list_]
    for cid in LOOSE.get(part, []):
        put(cid, off=True)
    # знаки пунктов
    for cid, i in list(idx.items()):
        code, text = table.get(cid, ('', ''))
        if not code:
            continue
        cell = cells[i]
        if code == 'fork':
            f = forks[cid]
            lists = [r['ids'] + ([r['exit']] if r['exit'] is not None else []) for r in roads[cid]]
            names = ';'.join(r['road'] for r in roads[cid])
            cell['s'] = 'fork:%s|%s|%s' % (''.join(str(x) for x in f['byDiff']), names,
                                           '|'.join(','.join(map(str, b)) for b in lists))
            cell['r'] = text
        elif code == 'need':
            nd = needs[cid]
            yes = nd['yes'] if nd['yes'] == 'win' else idx[norm(nd['yes'])]
            props = []
            if nd.get('item'):
                props.append('item=%s' % nd['item'])
            if nd.get('coins'):
                props.append('coins=%d' % nd['coins'])
            cell['s'] = 'need:%s,yes=%s,no=%d' % (','.join(props), yes, idx[norm(nd['no'])])
            cell['r'] = text
        elif code == 'pick':
            opts = [c for c in MAIN[part] if norm(c) in points and norm(c) != 'старт']
            cell['s'] = 'pick:%s|%s|%s' % (text, ','.join(norm(c) for c in opts),
                                           ','.join(str(idx[norm(c)]) for c in opts))
            cell['r'] = 'угаданное число — номер пункта'
        else:
            cell['s'] = code
            cell['r'] = text
    out = {'w': int(path['w']), 'h': int(path['h']), 'end': end, 'cells': cells}
    os.makedirs(OUT, exist_ok=True)
    name = os.path.join(OUT, 'luk%d.json' % part)
    with open(name, 'w', encoding='utf8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('поле %d: %d клеток пути, %d на дорогах, знаков %d -> %s'
          % (part, end + 1, len(cells) - end - 1, sum(1 for c in cells if 's' in c), os.path.basename(name)))


def check(part):
    """Сверка: у каждого узла поля есть знак или пометка «обычный», у каждой развилки — таблица."""
    cells, path = load(part)
    table = SIGNS.get(part)
    if table is None:
        print('поле %d: знаки ещё не расписаны' % part)
        return
    used = set()
    for node in cells.get('nodes', []):
        n = str(node['n'])
        if n in table:
            used.add(n)
            code, text = table[n]
            note = ''
            if code == 'fork':
                f = FORKS.get(n)
                note = ' дороги: %s' % ', '.join(f['roads']) if f else ' !! нет таблицы FORKS'
            elif code == 'need':
                nd = NEEDS.get(n)
                note = ' условие: %s -> %s, иначе %s' % (
                    ('есть ' + str(nd.get('item') or (str(nd.get('coins')) + ' бон'))) if nd else '?',
                    nd.get('yes') if nd else '?',
                    nd.get('no') if nd else '?',
                )
            print('  %-10s %-12s %s%s' % (n, code, text, note))
        else:
            print('  %-10s %-12s %s' % (n, '—', 'знака нет (обычный пункт?)'))
    for n in table:
        if n not in used:
            print('  !! знак для «%s» есть в таблице, но такого узла нет на поле' % n)
    print('поле %d: путь по кружкам %s' % (part, 'есть' if path else 'НЕ размечен (path-%d.json)' % part))


if __name__ == '__main__':
    args = sys.argv[1:]
    if 'build' in args:
        args.remove('build')
        for p in [int(x) for x in args] or sorted(MAIN):
            build(p)
    else:
        for p in [int(x) for x in args] or sorted(SIGNS):
            print('=== поле %d ===' % p)
            check(p)
