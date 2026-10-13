"""«Звезда Африки» — карта-граф (30 жетонов, 192 путевые точки, Танжер и Каир) → данные игры.

Материалы: materials/nastolki/zvezda-afriki/
  path.json  — граф: клетки {id, x, y, kind, sign?, text?, next, kinds, air} (рёбра симметричные);
  field.webp — карта Африки; parts/token-*.webp, money-*.webp — жетоны и купюры.

Пишем: lavochka/src/games/star/data.json и картинки в lavochka/public/star/.

Запуск из lavochka/:  python -I tools/hodilki/star.py
"""
import json
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(ROOT, 'materials', 'nastolki', 'zvezda-afriki')
OUT = os.path.join(ROOT, 'lavochka', 'src', 'games', 'star')
ASSETS = os.path.join(ROOT, 'lavochka', 'public', 'star')

# сколько жетонов каждого вида в наборе (info.md)
TOKENS = [('diamond', 1), ('ruby', 2), ('emerald', 3), ('topaz', 4), ('horse', 6), ('robber', 5), ('empty', 9)]
# клетки-города: старт и финиш
START = 'Tg'
FINISH = ['Tg', 'K']
# золотой берег: камень там платится вдвое
GOLD = '14'
# невольничий берег: разбойник отправляет в рабство (три хода)
SLAVE = '15'
# Кейптаун: первый пришедший получает 500
CAPE = '30'
# Поправка по скану: угол карты у Драконовых гор (28, b108, b110, b114) в разметке агента оказался
# оторван от графа — дороги от него к берегу не проследили. Дорога b108 → b104 (суша, ~97 px) видна
# на скане, ею угол и соединяется с остальной картой.
FIX_EDGES = [('b108', 'b104', 'land')]


def main():
    d = json.load(open(os.path.join(SRC, 'path.json'), encoding='utf8'))
    cells = d['cells']
    byid = {c['id']: c for c in cells}
    for a, b, kind in FIX_EDGES:
        for x, y in ((a, b), (b, a)):
            byid[x].setdefault('next', [])
            byid[x].setdefault('kinds', {})
            if y not in byid[x]['next']:
                byid[x]['next'].append(y)
                byid[x]['kinds'][y] = kind
    # Острова: куски карты, с которых по суше не уйти (Канары, Св. Елена, Мадагаскар). Игрок,
    # оставшийся там без денег и подков, пропускает три хода (правила, «Разбойник»).
    # Юг материка (Кейптаун, Уолфиш-Бей, Драконовы горы) в разметке тоже оторван от севера по суше —
    # дорога там идёт через море, но это материк, поэтому островом он не считается.
    ISLAND_SEEDS = ('2', '23', '26')
    land = {c['id']: [n for n in c.get('next', []) if (c.get('kinds') or {}).get(n, 'land') == 'land'] for c in cells}
    comp, groups = {}, 0
    for c in cells:
        if c['id'] in comp:
            continue
        groups += 1
        stack, group = [c['id']], []
        while stack:
            x = stack.pop()
            if x in comp:
                continue
            comp[x] = groups
            group.append(x)
            stack.extend(land[x])
    island = {x for x in comp if any(comp[x] == comp[s] for s in ISLAND_SEEDS)}
    ids = {c['id'] for c in cells}
    for c in cells:
        for n in c.get('next', []):
            if n not in ids:
                raise SystemExit('ребро в никуда: %s -> %s' % (c['id'], n))
        for a in c.get('air', []):
            if a not in ids:
                raise SystemExit('авиалиния в никуда: %s -> %s' % (c['id'], a))
        kinds = c.get('kinds') or {}
        for n in c.get('next', []):
            if n not in kinds:
                raise SystemExit('у ребра %s -> %s не указан вид пути' % (c['id'], n))
    out = {
        'w': int(d['w']),
        'h': int(d['h']),
        'start': START,
        'finish': FINISH,
        'gold': GOLD,
        'slave': SLAVE,
        'cape': CAPE,
        'tokens': TOKENS,
        'cells': [
            {
                'id': c['id'],
                'x': round(c['x']),
                'y': round(c['y']),
                'kind': c['kind'],
                **({'t': c['text']} if c.get('text') else {}),
                'next': c.get('next', []),
                **({'kinds': c['kinds']} if c.get('kinds') else {}),
                **({'air': c['air']} if c.get('air') else {}),
                **({'sign': c['sign']} if c.get('sign') else {}),
                **({'island': 1} if c['id'] in island else {}),
            }
            for c in cells
        ],
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'data.json'), 'w', encoding='utf8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    os.makedirs(ASSETS, exist_ok=True)
    shutil.copyfile(os.path.join(SRC, 'field.webp'), os.path.join(ASSETS, 'field.webp'))
    for name in os.listdir(os.path.join(SRC, 'parts')):
        if name.endswith('.webp'):
            shutil.copyfile(os.path.join(SRC, 'parts', name), os.path.join(ASSETS, name))
    tok = sum(n for _, n in TOKENS)
    print('звезда: клеток %d (жетонов %d, городов %d), жетонов в наборе %d, рёбер %d, авиалиний %d, островных клеток %d, обведённых кружков %d'
          % (len(cells), sum(1 for c in cells if c['kind'] == 'token'), sum(1 for c in cells if c['kind'] == 'city'),
             tok, sum(len(c.get('next', [])) for c in cells) // 2, sum(len(c.get('air', [])) for c in cells) // 2,
             len(island), sum(1 for c in cells if c.get('sign') == 'skip')))
    size = sum(os.path.getsize(os.path.join(ASSETS, f)) for f in os.listdir(ASSETS))
    print('картинки в public/star: %.1f МБ' % (size / 1e6))


if __name__ == '__main__':
    main()
