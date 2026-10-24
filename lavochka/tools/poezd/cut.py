"""«Поездом по СССР»: картинки из фанатского PnP (ticketrideussr0.pdf, карта СССР к Ticket to Ride, 2011, printgames.ru).
Материалы Days of Wonder не используются: поле, карты вагонов, маршрутов и бонусов — из этого pdf.
python tools/poezd/cut.py <папка с ticketrideussr0.pdf>  →  public/poezd/…  и  src/games/poezd/board.ts (из tools/poezd/map.json).

map.json — разметка поля (города, пути, середины и углы вагончиков) в пикселях склеенной карты 6188×4125:
стр. 1–4 pdf встык (2×2), города и вагончики найдены по цвету и ровной заливке (OpenCV), пути собраны по routes_src.py
(список путей по карте: города, цвет, длина, паром/тоннель/двойной) и проверены глазами наложением."""
import json, sys, os
import numpy as np, cv2, pymupdf

SRC = sys.argv[1] if len(sys.argv) > 1 else 'D:/temp/настолки/тикет ту райд'
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'public', 'poezd')
W = 4200  # ширина поля на сайте

def pages():
    d = pymupdf.open(os.path.join(SRC, 'ticketrideussr0.pdf'))
    out = []
    for p in d:
        x = p.get_images()[0][0]
        pix = pymupdf.Pixmap(d, x)
        if pix.n - pix.alpha > 3: pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        a = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w, pix.n)[..., :3]
        out.append(cv2.cvtColor(a, cv2.COLOR_RGB2BGR))
    return out

def webp(path, img, q=80):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cv2.imwrite(path, img, [cv2.IMWRITE_WEBP_QUALITY, q])

def cards(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    m = cv2.morphologyEx((g < 235).astype(np.uint8), cv2.MORPH_OPEN, np.ones((15, 15), np.uint8))
    n, lab, st, cen = cv2.connectedComponentsWithStats(m)
    boxes = sorted([st[i] for i in range(1, n) if st[i, 2] > 300 and st[i, 3] > 200], key=lambda b: (b[1] // 100, b[0]))
    return [img[y + 6:y + h - 6, x + 6:x + w - 6] for x, y, w, h, a in boxes]

def card(img, w=360):
    return cv2.resize(img, (w, round(img.shape[0] * w / img.shape[1])), interpolation=cv2.INTER_AREA)

P = pages()
# поле
full = np.vstack([np.hstack([P[0], P[1][:, :, :]]), np.hstack([P[2], P[3]])]) if P[0].shape[0] == P[1].shape[0] else None
top = np.hstack([P[0], P[1]]); bot = np.hstack([P[2], P[3]])
full = np.vstack([top[:, :min(top.shape[1], bot.shape[1])], bot[:, :min(top.shape[1], bot.shape[1])]])
k = W / full.shape[1]
H = round(full.shape[0] * k)
webp(os.path.join(OUT, 'map.webp'), cv2.resize(full, (W, H), interpolation=cv2.INTER_AREA), 78)
webp(os.path.join(OUT, 'map-small.webp'), cv2.resize(full, (300, round(300 * full.shape[0] / full.shape[1])), interpolation=cv2.INTER_AREA), 60)
# карты вагонов: стр. 16 — 8 цветов и локомотив, стр. 17 — контролёр; рубашка — стр. 8
c16 = cards(P[15]); c17 = cards(P[16]); c8 = cards(P[7])
for name, im in zip(['black', 'blue', 'green', 'orange', 'red', 'purple', 'white', 'yellow', 'loco'], c16):
    webp(os.path.join(OUT, 'cards', name + '.webp'), card(im))
webp(os.path.join(OUT, 'cards', 'ctrl.webp'), card(c17[0]))
webp(os.path.join(OUT, 'cards', 'back.webp'), card(c8[0]))
# маршруты: стр. 9–10 — длинные (12) и бонусы (4), стр. 11–15 — короткие (45); рубашки — стр. 5 (короткие) и 7 (длинные)
t = cards(P[8]) + cards(P[9])[:3]
for i in range(11, 16): t += cards(P[i - 1])
for i, im in enumerate(t):
    webp(os.path.join(OUT, 'tickets', f'{i}.webp'), card(im, 400))
for name, im in zip(['rail', 'path', 'ferry', 'tunnel'], cards(P[9])[3:7]):
    webp(os.path.join(OUT, 'bonus', name + '.webp'), card(im, 400))
webp(os.path.join(OUT, 'tickets', 'back-short.webp'), card(cards(P[4])[0], 400))
webp(os.path.join(OUT, 'tickets', 'back-long.webp'), card(cards(P[6])[0], 400))

# разметка → board.ts (координаты — в пикселях map.webp)
m = json.load(open(os.path.join(os.path.dirname(__file__), 'map.json'), encoding='utf-8'))
s = W / m['w']
names = list(m['cities'].keys())
lines = ['/* «Поездом по СССР» — разметка поля (генерирует tools/poezd/cut.py из tools/poezd/map.json, руками не править).',
         ' * Координаты — в пикселях public/poezd/map.webp. */',
         f'export const MAP_W = {W};', f'export const MAP_H = {H};',
         'export const CITIES: { name: string; x: number; y: number }[] = [']
for n in names:
    x, y = m['cities'][n]
    lines.append(f"  {{ name: '{n}', x: {round(x * s, 1)}, y: {round(y * s, 1)} }},")
lines.append('];')
lines.append('/** Пути: города (номера), цвет, длина, тоннель, паровозов парома; cars — середины вагончиков [x, y, угол°]. */')
lines.append("export type Color = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'black' | 'white' | 'gray';")
lines.append('export const ROUTES: { a: number; b: number; color: Color; len: number; tunnel: boolean; ferry: number; cars: [number, number, number][] }[] = [')
for r in m['routes']:
    cs = ', '.join(f'[{round(c[0] * s, 1)}, {round(c[1] * s, 1)}, {c[2]}]' for c in r['cars'])
    lines.append(f"  {{ a: {names.index(r['a'])}, b: {names.index(r['b'])}, color: '{r['color']}', len: {r['len']}, tunnel: {str(r['tunnel']).lower()}, ferry: {r['ferry']}, cars: [{cs}] }},")
lines.append('];')
# счётчик очков: клетки 0…99 (0 = 100) по краю поля
track = {}
H0 = 4125
for i in range(29): track[21 + i] = (339 + 196.5 * i, 69)
for i in range(19): track[51 + i] = (6126, 292 + 193.5 * i)
for i in range(29): track[99 - i] = (337 + 198.25 * i, H0 - 62)
for i in range(19): track[19 - i] = (60, 297 + 195.25 * i)
track[20] = (105, 111); track[50] = (6071, 99); track[70] = (6066, 4017); track[0] = (110, 4010)
lines.append('/** Счётчик очков по краю поля: клетка n (0…99; 100 — та же, что 0). */')
lines.append('export const TRACK: [number, number][] = [' + ', '.join(f'[{round(track[i][0] * s, 1)}, {round(track[i][1] * s, 1)}]' for i in range(100)) + '];')
open(os.path.join(ROOT, 'src', 'games', 'poezd', 'board.ts'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
print('ok', W, H)
