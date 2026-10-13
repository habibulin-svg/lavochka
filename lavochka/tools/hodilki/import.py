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
    'vput': ('v-put-druzya', 'cells.json'),
}

# «В путь, друзья!»: серые дороги (остановился на сером делении — идёшь по дороге своими бросками
# до её конца), красные полоски-ловушки (спираль у 13 и колонка у 115) и красные петли на дорогах.
# Точки — по черновику разметки (path.json), сверены по скану; 'again'/'skip'/'strip'/'square' — знаки
# на самом делении дороги. exit — номер клетки ленты, на которую дорога выходит.
VPUT_ROADS = {
    8: {'pts': [(1150, 2060), (1250, 1990), (1350, 1950), (1500, 1930), (1700, 1920), (1850, 1930)], 'exit': 30, 'text': 'идёт по серой дороге вперёд'},
    33: {'pts': [(1900, 2385), (1800, 2380), (1700, 2385), (1605, 2390, 'again'), (1500, 2380), (1400, 2370)], 'exit': 11, 'text': 'уходит по серой дороге назад'},
    41: {'pts': [(3020, 2780), (3100, 2830), (3200, 2890), (3280, 2950), (3330, 3020), (3405, 3040, 'square'),
                 (3500, 3080), (3620, 3050), (3750, 3010), (3850, 3000), (3910, 3055, 'again'),
                 (4000, 2960), (4100, 2880), (4200, 2830)], 'exit': 57, 'text': 'идёт по серой дороге вперёд'},
    45: {'pts': [(3110, 2170), (3000, 2210), (2880, 2240), (2750, 2250), (2620, 2240)], 'exit': 26, 'text': 'уходит по серой дороге назад'},
    53: {'pts': [(3750, 2300), (3600, 2400), (3400, 2470), (3250, 2490)], 'exit': 43, 'text': 'уходит по серой дороге назад'},
    57: {'pts': None, 'from': 41, 'exit': 41, 'text': 'возвращается по серой дороге назад'},
    79: {'pts': [(4370, 1000), (4340, 1080), (4325, 1170, 'skip'), (4290, 1260), (4250, 1330),
                 (4240, 1345, 'strip'), (4230, 1600), (4100, 1590)], 'exit': 66, 'text': 'спускается по серой дороге'},
    87: {'pts': [(3750, 600), (3740, 550), (3600, 520), (3400, 550), (3250, 630), (3160, 720), (3090, 850)], 'exit': 92, 'text': 'идёт по серой дороге вперёд'},
    92: {'pts': [(3060, 890), (3000, 930)], 'exit': 107, 'text': 'сворачивает на серую дорогу и перескакивает по треугольнику'},
    97: {'pts': [(2580, 470), (2475, 480), (2375, 540), (2257, 560, 'again'), (2175, 480), (1975, 420),
                 (1805, 380), (1600, 430), (1500, 520, 'strip'), (1560, 600), (1610, 720)],
         'exit': 113, 'text': 'идёт по серой дороге вперёд'},
    130: {'pts': [(640, 1330), (560, 1380), (470, 1420), (430, 1520), (420, 1640), (460, 1760),
                  (560, 1850), (620, 1900, 'again'), (680, 1880), (790, 1840)], 'exit': 127, 'text': 'уходит по серой дороге назад'},
}

# красные полоски ленты: фишка сразу идёт на красный кружок (спираль) или квадрат (колонка) и
# выбирается по стрелке назад — всё это она проходит своими бросками
VPUT_RED = {
    13: {'pts': [(1200, 2555), (1200, 2445), (1100, 2410), (990, 2470), (960, 2600), (1020, 2720),
                 (1150, 2770), (1300, 2780), (1400, 2770)], 'text': 'проваливается в красную спираль и выбирается из неё'},
    115: {'pts': [(1797, 1007), (1797, 940), (1797, 850), (1797, 715)], 'text': 'падает в красный квадрат и поднимается по колонке'},
}

# красная петля, в которую уводит полоска: клетки петли и её шаги (по ним фишка возвращается к полоске)
VPUT_LOOPS = {
    'p97': {'pts': [(1240, 700), (1120, 690), (1010, 640), (980, 540), (1020, 430), (1120, 370), (1260, 370), (1390, 410), (1460, 470)]},
    'p79': {'pts': [(4340, 1520), (4260, 1450), (4190, 1400), (4140, 1370)]},
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


def build_vput():
    """«В путь, друзья!»: лента 1–135 со знаками + серые дороги, красные полоски и петли.

    Дорога и петля — ветки (клетки off): фишка идёт по ним своими бросками, знаки на их делениях
    работают (зелёный кружок — ещё ход, оранжевый квадрат — пропуск). Красная полоска ленты уводит
    фишку на красный кружок/квадрат, откуда она возвращается по стрелке; полоска на серой дороге
    уводит в красную петлю и возвращает на ту же дорогу.
    """
    folder, fname = BOARDS['vput']
    d = json.load(open(os.path.join(SRC, folder, fname), encoding='utf8'))
    raw = d['cells']
    idx = {c['n']: i for i, c in enumerate(raw)}
    cells = []
    for c in raw:
        cell = {'x': round(c['x']), 'y': round(c['y']), 'l': str(c['n'])}
        sign = c.get('sign')
        if sign in ('start', 'again', 'skip'):
            cell['s'] = sign
        elif sign == 'restart':
            cell['s'] = 'start'
        elif sign and sign.startswith('jump:'):
            cell['s'] = 'to:%d' % idx[int(sign.split(':')[1])]
        cells.append(cell)
    end = len(cells) - 1
    # спираль 13 и колонка 115
    red_ids = {}
    for n, r in VPUT_RED.items():
        ids = []
        for x, y in r['pts']:
            cells.append({'x': x, 'y': y, 'off': 1})
            ids.append(len(cells) - 1)
        red_ids[n] = ids
    # красные петли на дорогах
    loop_ids = {}
    for name, lp in VPUT_LOOPS.items():
        ids = []
        for x, y in lp['pts']:
            cells.append({'x': x, 'y': y, 'off': 1})
            ids.append(len(cells) - 1)
        loop_ids[name] = ids
    # серые дороги
    road_ids, road_pts = {}, {}
    for n, r in VPUT_ROADS.items():
        pts = r['pts'] if r['pts'] else list(reversed(VPUT_ROADS[r['from']]['pts']))
        ids = []
        for p in pts:
            cell = {'x': p[0], 'y': p[1], 'off': 1}
            if len(p) > 2 and p[2] in ('again', 'skip'):
                cell['s'] = p[2]
            cells.append(cell)
            ids.append(len(cells) - 1)
        road_ids[n], road_pts[n] = ids, pts
    loop_of = {97: 'p97', 79: 'p79'}
    for n, r in VPUT_ROADS.items():
        ids, pts = road_ids[n], road_pts[n]
        strip = next((i for i, p in enumerate(pts) if len(p) > 2 and p[2] == 'strip'), None)
        if strip is not None:
            tail = ids[strip + 1:] + [idx[r['exit']]]
            cells[ids[strip]]['s'] = 'route:' + ','.join(map(str, loop_ids[loop_of[n]] + [ids[strip]] + tail))
            cells[ids[strip]]['r'] = ('попадает на красную полоску: идёт к красному кружку и возвращается по красной петле'
                                      if n == 79 else
                                      'попадает на красную полоску: идёт к красному квадрату и возвращается по красной петле')
        cells[idx[n]]['s'] = 'route:' + ','.join(map(str, ids + [idx[r['exit']]]))
        cells[idx[n]]['r'] = r['text']
    for n, r in VPUT_RED.items():
        cells[idx[n]]['s'] = 'route:' + ','.join(map(str, red_ids[n] + [idx[n]]))
        cells[idx[n]]['r'] = r['text']
    out = {'w': int(d['w']), 'h': int(d['h']), 'end': end, 'cells': cells}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'vput.json'), 'w', encoding='utf8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('vput: %d клеток ленты, %d на дорогах и в петлях, знаков %d'
          % (end + 1, len(cells) - end - 1, sum(1 for c in cells if 's' in c)))


if __name__ == '__main__':
    for b in sys.argv[1:] or BOARDS:
        build_vput() if b == 'vput' else build(b)
