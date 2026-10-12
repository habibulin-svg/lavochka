"""Кинь-двинь: разметка полей из materials/nastolki/<поле>/ (cells.json + info.md, их готовили агенты) → данные игры
src/games/hodilki/data/<id>.json и строка для tiles.py.

Формат данных: {"w", "h", "end", "cells": [{"x", "y", "l"?: подпись, "s"?: знак, "t"?: текст}]}.
Знаки: skip / skipN — пропуск хода (N ходов); again; start; to:N — на клетку с индексом N (skip+to — с пропуском);
route:a,b,c — ветка: следующими бросками по клеткам с индексами a, b, c (последняя — куда выходим).
Клетки веток (off) идут в списке после основного пути.

Поправки, проверенные глазами по полю (агенты ошибались или не размечали), — в FIX ниже.
Запуск из lavochka/:  python -I tools/hodilki/import.py [поле ...]
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(ROOT, 'materials', 'nastolki')
OUT = os.path.join(ROOT, 'lavochka', 'src', 'games', 'hodilki', 'data')

# поле → папка в materials/nastolki, файл разметки
BOARDS = {
    'zatmir': ('zateryanniy-mir', 'cells.json'),
    'planeta': ('neukrotimaya-planeta', 'cells.json'),
    'varvary': ('konnye-varvary', 'cells.json'),
    'podveski': ('podveski-korolevy', 'cells.json'),
    'mepl': ('mepl-white', 'cells.json'),
    'sutra': ('s-utra-do-vechera', 'cells-1.json'),
}

# ветки: точки (x, y) по порядку от клетки входа; back — вернуться той же дорогой на клетку входа, exit — номер клетки выхода
BRANCHES = {
    'podveski': {
        8: {'pts': [(3146, 4844), (3226, 4784), (3311, 4724), (3391, 4659), (3471, 4599), (3551, 4534), (3626, 4474), (3731, 4319)], 'back': True, 'label': 'Крей'},
        40: {'pts': [(3318, 2534), (3243, 2559), (3158, 2584), (3078, 2614)], 'back': True, 'label': 'Булонь'},
        129: {'pts': [(2011, 4197), (2096, 4197), (2186, 4197), (2266, 4197), (2346, 4197), (2431, 4197), (2521, 4172)], 'back': True, 'label': 'Корней'},
        # к Фекану по пунктиру и назад другой дорогой — на основной путь у 116 (111–115 — в обход)
        110: {'pts': [(1919, 3170), (1824, 3305), (1724, 3440), (1619, 3585), (1490, 3770), (1674, 3640), (1829, 3540), (2004, 3470), (2174, 3420), (2364, 3405), (2574, 3430)], 'exit': 116, 'label': 'Фекан'},
    },
    'planeta': {
        41: {'pts': [(205, 1047), (265, 1022), (325, 1007), (390, 992), (450, 987), (520, 985), (585, 992)], 'back': True, 'label': 'тупик'},
    },
    'varvary': {
        # жёлтое кольцо 1–12 вокруг картинки: «кружным путём через ущелье», выход на 90
        91: {'pts': [(2403, 3130), (2232, 3239), (2075, 3278), 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12'], 'exit': 90, 'label': 'ущелье'},
    },
    'mepl': {
        # жёлтая петля 1–11 вокруг динозавра: с 27 в обход, выход на 29
        27: {'pts': ['A%d' % i for i in range(1, 12)], 'exit': 29, 'label': 'обход'},
    },
}

# знаки, исправленные по полю: номер клетки → код (None — обычная клетка)
FIX = {
    'sutra': {44: 'goto:21', 45: None},
    'mepl': {27: None},
    'varvary': {91: None},
}

ROUTE_TEXT = {
    'podveski': {8: 'скачет в Крей и обратно', 40: 'скачет в Булонь и обратно', 129: 'скачет в Корней и обратно', 110: 'заходит в порт Фекан'},
    'planeta': {41: 'идёт до тупика и обратно'},
    'varvary': {91: 'идёт кружным путём через ущелье'},
    'mepl': {27: 'сбивается с пути и идёт в обход'},
}


def texts(folder):
    """Тексты клеток из info.md: строки «- **16.** Текст. **На 9.**» или таблица «| 16 (…) | … | «текст» |»."""
    out = {}
    path = os.path.join(SRC, folder, 'info.md')
    for line in open(path, encoding='utf8'):
        m = re.match(r'\s*[-*] \*\*(\d+)\.\*\*\s*(.+)', line)
        if m:
            t = re.sub(r'\*\*[^*]*\*\*\.?\s*$', '', m.group(2)).replace('**', '').strip()
            t = re.sub(r'\s*\((Ветка|Пропустить|Фишка|ветка)[^)]*\)\s*$', '', t).strip()
            if t:
                out[int(m.group(1))] = t
            continue
        m = re.match(r'\|\s*(\d+)\b[^|]*\|[^|]*\|\s*«(.+)»', line)
        if m:
            out[int(m.group(1))] = m.group(2).replace('…', '').strip(' .') + '.'
    return out


def build(bid):
    folder, fname = BOARDS[bid]
    d = json.load(open(os.path.join(SRC, folder, fname), encoding='utf8'))
    raw = d['cells']
    # подписи: номер на поле; индекс в списке — порядок хода
    nums = [c.get('n') for c in raw]
    idx = {n: i for i, n in enumerate(nums)}
    tx = texts(folder)
    fix = FIX.get(bid, {})
    cells = []
    for c in raw:
        n = c.get('n')
        code = fix[n] if n in fix else c.get('sign')
        cell = {'x': round(c['x']), 'y': round(c['y'])}
        if isinstance(n, int):
            cell['l'] = str(n)
        s = None
        if code in ('skip', 'again'):
            s = code
        elif code in ('skip2', 'skip3'):
            s = code
        elif code in ('restart',):
            s = 'start'
        elif code and code.startswith(('goto:', 'jump:')):
            s = 'to:%d' % idx[int(code.split(':')[1])]
        elif code and code.startswith('skip_then_goto:'):
            s = 'skip+to:%d' % idx[int(code.split(':')[1])]
        if s:
            cell['s'] = s
            if isinstance(n, int) and n in tx:
                cell['t'] = tx[n]
        cells.append(cell)
    end = len(cells) - 1
    # ветки — после основного пути
    extra = {e['n']: e for e in (d.get('loop_yellow') or []) + ((d.get('branch') or {}).get('cells') or [])}
    for n, br in BRANCHES.get(bid, {}).items():
        ids = []
        for p in br['pts']:
            if isinstance(p, str):
                p = (extra[p]['x'], extra[p]['y'])
            cells.append({'x': round(p[0]), 'y': round(p[1]), 'off': 1})
            ids.append(len(cells) - 1)
        cells[ids[-1]]['l'] = br['label']
        route = ids + (ids[-2::-1] + [idx[n]] if br.get('back') else [idx[br['exit']]])
        i = idx[n]
        cells[i]['s'] = 'route:' + ','.join(map(str, route))
        cells[i]['r'] = ROUTE_TEXT[bid][n]
        if n in tx:
            cells[i]['t'] = tx[n]
    # старт «Париж» у «Подвесок»: клетка 150 — и старт, и финиш; фишки стоят у неё до первого хода
    if bid == 'podveski':
        p = cells[end]
        cells.insert(0, {'x': p['x'] - 60, 'y': p['y'] + 40, 'l': 'НАЧАЛО'})

        def shift(s):
            return re.sub(r'\d+', lambda m: str(int(m.group()) + 1), s)

        for c in cells:
            if 's' in c and (c['s'].startswith(('to:', 'skip+to:', 'route:'))):
                c['s'] = shift(c['s'])
        end += 1
    out = {'w': int(d['w']), 'h': int(d['h']), 'end': end, 'cells': cells}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, bid + '.json'), 'w', encoding='utf8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    signs = sum(1 for c in cells if 's' in c)
    print(f'{bid}: {end + 1} клеток пути, {len(cells) - end - 1} на ветках, знаков {signs}, текстов {sum(1 for c in cells if "t" in c)}')


if __name__ == '__main__':
    for b in sys.argv[1:] or BOARDS:
        build(b)
