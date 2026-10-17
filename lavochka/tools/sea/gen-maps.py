# Генератор src/games/sea/maps-data.ts: маски клеток, геометрия сеток (в пикселях карты 3200 px), течения.
#   python tools/sea/gen-maps.py
import json, re
OUT = 'src/games/sea/maps-data.ts'

def mask(path):
    return [l.rstrip('\n')[4:] for l in open(path, encoding='utf-8') if re.match(r'^\s*\d+ ', l)]

pg = json.load(open('tools/sea/piraty-grid.json'))
kg = json.load(open('tools/sea/kolonii-grid.json'))
pv = [[round(x, 2), 0] for x in pg['xs']]
ph = [[round(y, 2), 0] for y in pg['ys']]
kv = [[round(a, 2), round(b, 5)] for a, b, n in kg['v']]
kh = [[round(c, 2), round(d, 5)] for c, d, n in kg['h']]

# Течения «Пиратов», снятые с карты глазами: клетка хвоста стрелки и куда она смотрит.
P_CUR = '''
24,4 SW; 21,5 SW; 18,6 SW; 16,7 SW;
13,11 NE; 14,12 NE; 15,12 NE; 17,9 NE; 18,10 NE; 19,8 E; 21,9 E; 23,8 E; 24,7 E; 26,6 E; 26,8 E; 28,7 E; 29,5 NE;
30,6 E; 31,7 E; 29,3 NE; 28,5 NE; 32,5 NE; 33,3 NE; 33,6 NE; 39,5 E; 40,4 E;
5,14 E; 7,14 SE; 6,15 E; 3,15 N; 3,14 NE; 6,18 W; 4,19 NW;
11,13 N; 12,12 N; 13,14 NE; 15,17 NW;
11,23 W; 15,23 W; 8,22 NW; 10,21 NW;
25,22 W; 28,22 W; 24,24 W; 18,23 W; 22,24 NW; 30,22 SW; 31,24 SW; 16,18 NW; 19,19 NW; 17,20 NW; 20,24 NW;
42,9 S; 45,10 S; 44,11 S; 41,13 SW; 43,14 SW; 39,15 SW; 40,16 SW; 39,16 SW; 36,18 SW; 37,18 SW; 38,18 SW; 34,20 SW;
33,19 SW; 40,18 S; 35,19 SW; 36,19 SW; 33,20 SW; 34,21 SW; 36,22 SW; 31,23 SW
'''
# «Захват колоний»: экваториальное противотечение на восток, южное экваториальное — на запад.
K_CUR = '''
2,16 E; 6,16 E; 11,16 E; 4,17 E; 9,16 E;
5,20 W; 8,20 W; 3,21 W; 11,21 W; 15,21 W; 1,22 W; 5,22 W; 9,22 W; 13,22 W
'''

def cur(text, rows):
    out = []
    for part in re.split(r'[;\n]+', text):
        part = part.strip()
        if not part: continue
        xy, d = part.split()
        i, j = map(int, xy.split(','))
        if rows[j][i] != '.':
            print('течение не на море:', i, j, rows[j][i]); continue
        out.append([i, j, d])
    return out

pr, kr = mask('tools/sea/piraty-mask.txt'), mask('tools/sea/kolonii-mask.txt')
data = {
    'piraty': {'rows': pr, 'v': pv, 'h': ph, 'cur': cur(P_CUR, pr)},
    'kolonii': {'rows': kr, 'v': kv, 'h': kh, 'cur': cur(K_CUR, kr)},
}
with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
    f.write('/* Сгенерировано tools/sea/gen-maps.py — не править руками. Маски клеток (. море, # суша, P/S/N порты, H старт),\n')
    f.write(' * линии сетки на карте 3200 px (вертикали x = a + b·y, горизонтали y = c + d·x) и течения [i, j, румб]. */\n')
    for k, v in data.items():
        f.write(f'export const {k.upper()} = {{\n')
        f.write('  rows: [\n' + ''.join(f"    '{r}',\n" for r in v['rows']) + '  ],\n')
        f.write('  v: ' + json.dumps(v['v'], separators=(',', ':')) + ' as [number, number][],\n')
        f.write('  h: ' + json.dumps(v['h'], separators=(',', ':')) + ' as [number, number][],\n')
        f.write('  cur: ' + json.dumps(v['cur'], separators=(',', ':')) + ' as [number, number, string][],\n')
        f.write('};\n')
print('ok', len(pr), len(pr[0]), len(kr), len(kr[0]), len(data['piraty']['cur']), len(data['kolonii']['cur']))
