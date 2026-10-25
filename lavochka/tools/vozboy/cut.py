"""«Воздушный бой»: поля обеих версий → public/vozboy/, узлы сетки → src/games/vozboy/grid.ts.
python tools/vozboy/cut.py

Версия А («Игрушка», ЛПО «Игрушка»): три листа-скана 849×1200 — синий photo (2), середина photo (1), красный photo (3)
(повёрнут на 180°). Сетка красная, по 10 вертикальных и 14 горизонтальных линий на лист. Сканы обрезаны впритык:
на стыках шаг сетки меньше 84 px — полоса у края листа растягивается до нужного шага.
Версия Б («Аэрофото», vb_pole.jpg из vozdushniyboi.zip): одно поле 1173×2037, белая сетка 14×24."""
import os
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter1d

SRC = 'D:/temp/настолки/воздушный бой/'
ZIP = 'D:/temp/review/vozboy/'
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'public', 'vozboy')
os.makedirs(OUT, exist_ok=True)
STEP = 84


def peaks(v, th, md=50):
    return [i for i in range(3, len(v) - 3) if v[i] > th and v[i] == max(v[max(0, i - md // 2) : i + md // 2 + 1])]


def profiles(im: Image.Image):
    a = np.asarray(im).astype(float)
    red = a[..., 0] - (a[..., 1] + a[..., 2]) / 2
    cx = red.mean(axis=0)
    cy = red.mean(axis=1)
    return cx - uniform_filter1d(cx, 25), cy - uniform_filter1d(cy, 25)


def snap(v, start: int, n: int) -> list:
    """n линий: каждая — самый сильный пик в ±18 px от ожидаемой (предыдущая + шаг)."""
    out = []
    want = start
    for _ in range(n):
        lo, hi = max(0, want - 18), min(len(v), want + 19)
        x = lo + int(np.argmax(v[lo:hi]))
        out.append(x)
        want = x + STEP
    return out


sheets = [Image.open(SRC + 'photo (2).jpg').convert('RGB'), Image.open(SRC + 'photo (1).jpg').convert('RGB'), Image.open(SRC + 'photo (3).jpg').convert('RGB').rotate(180)]
# первая вертикальная линия каждого листа (по просмотру): синий 71, середина 55, красный 20; горизонтальная — ~62
X_START = [71, 55, 20]
xs_all, ys_all = [], []
for i, im in enumerate(sheets):
    px, py = profiles(im)
    xs = snap(px, X_START[i], 10)
    ys = snap(py, 62, 14)
    print('лист', xs, ys)
    xs_all.append(xs)
    ys_all.append(ys)
assert all(len(x) == 10 for x in xs_all), xs_all
assert all(len(y) == 14 for y in ys_all), ys_all

# склейка: перед первой линией листа и после последней — ровно полшага (растянуть/сжать край)
H = 1200
parts = []
nodes_x = []
x0 = 0
for i, im in enumerate(sheets):
    xs = xs_all[i]
    left = im.crop((0, 0, xs[0], H)).resize((STEP // 2 if i else xs[0], H))
    mid = im.crop((xs[0], 0, xs[-1], H))
    right = im.crop((xs[-1], 0, im.width, H)).resize((STEP // 2 if i < 2 else im.width - xs[-1], H))
    for p in (left, mid, right):
        parts.append((x0, p))
        if p is mid:
            nodes_x += [x0 + x - xs[0] for x in xs]
        x0 += p.width
W = x0
board = Image.new('RGB', (W, H))
for x, p in parts:
    board.paste(p, (x, 0))
ys = [round(sum(c) / 3) for c in zip(*ys_all)]
K = 0.75
board.resize((round(W * K), round(H * K)), Image.LANCZOS).save(os.path.join(OUT, 'igrushka.webp'), quality=80)
ax = [round(x * K, 1) for x in nodes_x]
ay = [round(y * K, 1) for y in ys]
print('А:', round(W * K), round(H * K), len(ax), 'x', len(ay))

# версия Б: белая сетка
b = Image.open(ZIP + 'vb_pole.jpg').convert('RGB')
a = np.asarray(b).astype(float).min(axis=2)
cx = a.mean(axis=0)
cy = a.mean(axis=1)
bx = [x for x in peaks(cx - uniform_filter1d(cx, 31), 6, 30) if 30 < x < b.width - 30]
by = [y for y in peaks(cy - uniform_filter1d(cy, 31), 6, 30) if 30 < y < b.height - 30]
by = [y for i, y in enumerate(by) if not (i and y - by[i - 1] < 50)]
assert len(bx) == 14 and len(by) == 24, (bx, by)
b.save(os.path.join(OUT, 'aerofoto.webp'), quality=80)
print('Б:', b.width, b.height)

with open(os.path.join(ROOT, 'src', 'games', 'vozboy', 'grid.ts'), 'w', encoding='utf-8') as f:
    f.write('/* Узлы сеток полей (в пикселях картинок public/vozboy/) — tools/vozboy/cut.py. */\n')
    f.write(f'export const IGRUSHKA = {{ w: {round(W * K)}, h: {round(H * K)}, xs: {ax}, ys: {ay} }};\n')
    f.write(f'export const AEROFOTO = {{ w: {b.width}, h: {b.height}, xs: {bx}, ys: {by} }};\n')
