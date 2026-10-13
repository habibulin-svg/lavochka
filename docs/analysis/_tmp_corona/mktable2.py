# -*- coding: utf-8 -*-
"""Final markdown cell table for board 1 with hand-verified world assignment."""
import io, os, re

TMP = r'D:\Claude\Shish\docs\analysis\_tmp_corona'

MAGIC = ['ПОСТОЯЛЫЙ ДВОР', 'ВЕДЬМИН ЛУГ', 'СВЯЩЕННАЯ РОЩА', 'СКАЛЫ', 'ЗЛОВЕЩИЙ ЛЕС',
         'ДРЕВНИЙ ТРАКТ', 'МАГШОП', 'БАШНЯ ВЛАДЫКИ МИРА МАГИИ', 'КЛАДБИЩЕ',
         'ЗАЧАРОВАННАЯ ДЕРЕВНЯ', 'ТОПЬ', 'ПУСТОШЬ', 'ГАРЬ', 'ПОКИНУТЫЙ ДОМ',
         'ХРАМ БААЛЯ', 'ЛЫСАЯ ГОРА', 'ПОЛЫЕ ХОЛМЫ']
MIND = ['ЛИЦЕЙ', 'РАВНИНА', 'БРОД', 'СТЕПЬ', 'КАНЬОН', 'ЗОНА МУТАЦИЙ', 'ЭПИЦЕНТР',
        'ВЫЖЖЕНАЯ ЗЕМЛЯ', 'ДРЕВО ПОЗНАНИЯ', 'ДВОРЕЦ ВЛАДЫКИ МИРА УМА',
        'ЗАБРОШЕННОЕ ШОССЕ', 'РЕЧКА', 'ПЕЩЕРА МУДРЕЦА', 'ПИК «ОЛИМП»',
        'ОБСЕРВАТОРИЯ', 'КНИЖНЫЙ МАГАЗИН', 'МАКОВЫЕ ЗАРОСЛИ']
STRENGTH = ['КАРАВАН-САРАЙ', 'ПРЕРИЯ', 'САЛУН', 'РАНЧО', 'ЗАРОСЛИ КАКТУСОВ',
            'ПУСТЫНЯ', 'ОАЗИС', 'ЗАМОК ВЛАДЫКИ МИРА СИЛЫ', 'ДЖУНГЛИ',
            'КАМЕННАЯ ГРЯДА', 'САВАННА', 'КОННЫЕ ВАРВАРЫ', 'ОРУЖЕНАЯ ЛАВКА',
            'ПЕРЕВАЛ', 'КРЕПОСТЬ']
GOLD = ['ЗАСТАВА', 'КОНТРАБАНДИСТЫ', 'ИНОСТРАННЫЙ ЛЕГИОН', 'ЗОЛОТАЯ ШАХТА', 'КАБАК',
        'ТАРАКАНЬИ БЕГА', 'КАРТЕЖНИКИ', 'ПЕЩЕРА СОКРОВИЩ', 'ЧЕРНАЯ КАССА МАФИИ',
        'ДЕТЕКТИВНОЕ БЮРО', 'АЭРОПОРТ', 'КАЗИНО', 'ОТЕЛЬ', 'ПОЛИЦЕЙСКИЙ УЧАСТОК',
        'БАНК', 'РОСТОВЩИК', 'БИРЖА', 'ИГРОВЫЕ АВТОМАТЫ']
NEUTRAL = ['ОБМЕННЫЙ ПУНКТ', 'ЛАЗАРЕТ', 'ЗАГОТКОНТОРА', 'ПРОВАЛ МИРА УМА',
           'ПРОВАЛ МИРА МАГИИ', 'ПРОВАЛ МИРА СИЛЫ', 'ПОДПОЛЕ «ХРАМ БААЛЯ» (8 секторов)',
           'ПОДПОЛЕ «ПЕРЕВАЛ» (8 секторов)']
WMAP = {}
for n in MAGIC:
    WMAP[n] = 'Мир Магии'
for n in MIND:
    WMAP[n] = 'Мир Ума'
for n in STRENGTH:
    WMAP[n] = 'Мир Силы'
for n in GOLD:
    WMAP[n] = 'Мир Золота'
for n in NEUTRAL:
    WMAP[n] = 'межмировое пространство'

# grid coordinates
GX = {177: 0, 418: 1, 659: 2, 880: 3, 1101: 4, 1322: 5, 1583: 6, 1804: 7, 2025: 8, 2246: 9, 2487: 10, 2728: 11}
GY = {138: 0, 359: 1, 600: 2, 821: 3, 1042: 4, 1263: 5, 1484: 6, 1725: 7, 1946: 7, 1966: 8}

cells = []
cur = None
for ln in io.open(os.path.join(TMP, 'p1_cells.txt'), encoding='utf-8'):
    m = re.match(r'--- rect x=([\d.]+) y=([\d.]+) w=([\d.]+) h=([\d.]+)', ln)
    if m:
        cur = {'x': float(m.group(1)), 'y': float(m.group(2)), 'w': float(m.group(3)), 'h': float(m.group(4)),
               'title': '', 'body': ''}
        cells.append(cur)
    elif cur is not None and ln.startswith('TITLE: '):
        cur['title'] = ln[7:].strip()
    elif cur is not None and ln.startswith('BODY: '):
        cur['body'] = ln[6:].strip()

out = io.open(os.path.join(TMP, 'p1_table.md'), 'w', encoding='utf-8')
out.write('| № | Клетка | Мир | Кол,ряд | x0,y0 (лв.верх) | w×h | Центр (x,y) |\n')
out.write('|---:|---|---|---|---|---|---|\n')
rows = []
n = 0
for c in sorted(cells, key=lambda c: (round(c['y'] / 100), c['x'])):
    t = c['title']
    if t == '(no 17pt title)':
        if abs(c['x'] - 879.9) < 1 and abs(c['y'] - 820.8) < 1:
            t = 'ПОДПОЛЕ «ХРАМ БААЛЯ» (8 секторов)'
        elif abs(c['x'] - 1804.0) < 1 and abs(c['y'] - 820.8) < 1:
            t = 'ПОДПОЛЕ «ПЕРЕВАЛ» (8 секторов)'
        elif abs(c['x'] - 2770.6) < 1:
            t = 'внеигровая панель «НЕКОТОРЫЕ ПРАВИЛА ИГРЫ»'
        else:
            t = 'внеигровая панель (арт, условий нет)'
    if t.startswith('внеигровая'):
        world = '—'
    else:
        world = WMAP.get(t, '?')
    n += 1
    gx = GX.get(int(round(c['x'] / 1) // 1) if False else int(round(c['x']))) 
    gx = GX.get(int(round(c['x'])), None)
    gy = GY.get(int(round(c['y'])), None)
    grid = ('%d,%d' % (gx, gy)) if gx is not None and gy is not None else '—'
    out.write('| %d | %s | %s | %s | %d, %d | %d×%d | %d, %d |\n' % (
        n, t, world, grid, round(c['x']), round(c['y']), round(c['w']), round(c['h']),
        round(c['x'] + c['w'] / 2), round(c['y'] + c['h'] / 2)))
    rows.append((n, t, world, round(c['x'] + c['w'] / 2), round(c['y'] + c['h'] / 2), c['body']))
out.close()

csv = io.open(os.path.join(TMP, 'p1_table.csv'), 'w', encoding='utf-8')
csv.write('n;name;world;cx;cy;body\n')
for r in rows:
    csv.write('%d;%s;%s;%d;%d;%s\n' % (r[0], r[1], r[2], r[3], r[4], r[5].replace(';', ',')))
csv.close()
print('rows', n)
