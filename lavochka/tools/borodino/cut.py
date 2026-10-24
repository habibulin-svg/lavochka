"""«Бородино» (Инфобанк, 1991): карта и фишки из сканов пользователя → public/borodino/, разметка → src/games/borodino/terrain.ts.
python tools/borodino/cut.py   (сначала tools/borodino/terrain.py — D:/temp/bor/terrain.json)

Карта map.jpg 9685×6418: поле с гексами — x 0…7560, уменьшается до 4200. Фишки — лист fishki.jpg: цветные квадраты 142 px,
лицевая сторона над оборотной; порядок — SHEET (как на листе)."""
import json, os
import numpy as np, cv2

SRC = 'D:/temp/настолки/Бородино (1991)/'
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'public', 'borodino')
os.makedirs(OUT, exist_ok=True)
rd = lambda f: cv2.imdecode(np.fromfile(SRC + f, np.uint8), cv2.IMREAD_COLOR)

CROP = 7560
W = 4200
m = rd('map.jpg')[:, :CROP]
K = W / CROP
H = round(m.shape[0] * K)
cv2.imwrite(os.path.join(OUT, 'map.webp'), cv2.resize(m, (W, H), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_WEBP_QUALITY, 74])
cv2.imwrite(os.path.join(OUT, 'map-small.webp'), cv2.resize(m, (300, round(300 * m.shape[0] / CROP)), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_WEBP_QUALITY, 60])

# фишки: ряды лицевых сторон (оборот — следующий ряд), идентификаторы — как в units.ts
SHEET = [
    'Davout I2 I4 I5 Ic Ia I1 I3 Ney III10 III11 III25 IIIc IIIa',
    'Eugene - - IV13 IV14 ItG IVc IVa Grouchy C3L C6T Latour C4L C7T CIVa',
    'Poniatowski V16 V18 Vc Va Junot VIII23 VIII24 VIIIc VIIIa Nansouty C1L C1K C5K CIa',
    'Mortier StG SrG MG LV Gc Ga Montbrun C2L C2K C4K CIIa Murat',
    'Barclay Miloradovich Smo Baggovut r4 r17 rIIa Osterman r11 r23 rIVa Konstantin Gv SG1',
    'Dokhturov r7 r24 rVIa K1 Pla K1c K2c K3c A1Ed A1f12 A1f6 A1Kon',
    'Bagration Gorchakov Mos Tuchkov Gr1 r3 rIIIa Borozdin Gr2 r27 SG7 rVIIIa',
    'Raevsky r12 r26 rVIIa K2 Kar K4c A2f12 A2f6 A2Ed A2Kon',
]
f = rd('fishki.jpg')
hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)
col = cv2.morphologyEx((hsv[..., 1] > 60).astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(col)
bx = sorted([tuple(int(v) for v in st[i][:4]) for i in range(1, n) if st[i, 4] > 3000], key=lambda b: b[1])
rows = []
for b in bx:
    for r in rows:
        if abs(r[0] - b[1]) < 20:
            r[1].append(b)
            break
    else:
        rows.append([b[1], [b]])
for r in rows:
    r[1].sort()
assert len(rows) == 16, len(rows)
C = 96
ids = []
faces = []
for k, line in enumerate(SHEET):
    names = line.split()
    front, back = rows[2 * k][1], rows[2 * k + 1][1]
    assert len(front) == len(names), (k, len(front), len(names))
    for j, nm in enumerate(names):
        if nm == '-':
            continue
        x, y, w, h = front[j]
        a = cv2.resize(f[y:y + 142, x:x + 142], (C, C), interpolation=cv2.INTER_AREA)
        bb = back[j]
        b = cv2.resize(f[bb[1]:bb[1] + 142, bb[0]:bb[0] + 142], (C, C), interpolation=cv2.INTER_AREA)
        ids.append(nm)
        faces.append((a, b))
COLS = 16
R = (len(faces) + COLS - 1) // COLS
sprite = np.full((R * 2 * C, COLS * C, 3), 255, np.uint8)
for i, (a, b) in enumerate(faces):
    r, c = divmod(i, COLS)
    sprite[r * 2 * C:r * 2 * C + C, c * C:c * C + C] = a
    sprite[r * 2 * C + C:r * 2 * C + 2 * C, c * C:c * C + C] = b
cv2.imwrite(os.path.join(OUT, 'counters.webp'), sprite, [cv2.IMWRITE_WEBP_QUALITY, 86])

# разметка
t = json.load(open('D:/temp/bor/terrain.json', encoding='utf-8'))
g = t['grid']
hexes = t['hexes']
L = []
T = []
TC = {'clear': 0, 'forest': 1, 'shrub': 2, 'village': 3}
for c in range(1, 41):
    for r in range(1, 31):
        k = f'{c:02d}{r:02d}'
        h = hexes.get(k)
        L.append(-1 if h is None else h['L'])
        T.append(0 if h is None else TC[h['t']])
def hid(k):
    return (int(k[:2]) - 1) * 30 + int(k[2:]) - 1
lines = ['/* «Бородино» — разметка карты (генерирует tools/borodino/cut.py, руками не править). Клетка n = (столбец−1)·30 + (ряд−1);',
         ' * номер на карте — ССРР. Координаты — в пикселях public/borodino/map.webp. */',
         f'export const MAP_W = {W};', f'export const MAP_H = {H};',
         f'/** Центр клетки (1,1), шаг по столбцам и рядам (нечётные столбцы выше на полряда). */',
         f'export const GRID = {{ x0: {round(g["x0"] * K, 2)}, y0: {round(g["y0"] * K, 2)}, dx: {round(g["dx"] * K, 3)}, dy: {round(g["dy"] * K, 3)} }};',
         '/** Уровень: −1 — клетки нет, 0 — низина, 1 — средний, 2 — возвышенность. */',
         'export const LEVEL = [' + ','.join(map(str, L)) + '];',
         '/** Местность: 0 — чистая, 1 — лес, 2 — кустарник, 3 — деревня. */',
         'export const TERR = [' + ','.join(map(str, T)) + '];',
         'export const ROAD: [number, number][] = [' + ','.join(f'[{hid(e[:4])},{hid(e[5:])}]' for e in t['road']) + '];',
         'export const RIVER: [number, number][] = [' + ','.join(f'[{hid(e[:4])},{hid(e[5:])}]' for e in t['river']) + '];',
         'export const VILLAGES: Record<string, number[]> = {' + ', '.join(f"'{n}': [{', '.join(str(hid(k)) for k in ks)}]" for n, ks in t['villages'].items()) + '};',
         'export const REDOUBTS: Record<number, string> = {' + ', '.join(f"{hid(k)}: '{n}'" for k, n in t['redoubts'].items()) + '};',
         f"/** Фишки в public/borodino/counters.webp: {COLS} в ряд, клетка {C} px, лицо над оборотом. */",
         f'export const SPRITE = {{ cols: {COLS}, cell: {C}, rows: {R} }};',
         'export const SPRITE_IDS = [' + ', '.join(f"'{i}'" for i in ids) + '];']
open(os.path.join(ROOT, 'src', 'games', 'borodino', 'terrain.ts'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
print('ok', W, H, len(ids))
