"""Генератор ландшафтов уровней ГОПС (разрушаемая маска, как в Worms) + превью с текстурами темы.

python studio/post/terrain.py                       — все архетипы × сиды 1, 2 → G:/temp/studio/out/gops/27-terrain
python studio/post/terrain.py --arch hills,pit --seeds 5,6
python studio/post/terrain.py --recipe '{"archetype":"bridge","seed":7,"water":0.3,"props":0.6}' --theme garages --time night
python studio/post/terrain.py --missions docs/gops/levels/missions.json   — превью уровней → 27-terrain/levels/<id>.png

Выход на рецепт: <архетип>-<сид>-mask.png (1920×704, 0/255), <...>.json (точки высадки, места предметов), <...>.png (превью).

АЛГОРИТМ (для переноса на TypeScript 1:1)
=========================================
Карта W×H = 1920×704 логических px. Земля — где поле f(x, y) > 0.

1. ГПСЧ — mulberry32 (32-битный, Math.imul в TS). Сид рецепта смешивается с FNV-1a от имени архетипа:
   s = fnv1a(archetype) ^ (seed · 0x9E3779B1 mod 2³²). Порядок вызовов rng важен: архетип → шум кромки → высадка.
2. Шумы свои: noise1(period) — значения в узлах через period px, интерполяция smoothstep; fbm1 — сумма
   нескольких noise1 с амплитудами. noise2(cell) — то же на сетке cell×cell (узлы строками сверху вниз).
3. Поле строится из фигур со «знаковым расстоянием» (> 0 внутри): полоса-рельеф (y − h(x), обрезанная по x),
   прямоугольник со скруглением, круг, эллипс, капсула (отрезок с радиусом, радиус может меняться вдоль),
   выпуклый многоугольник. Операции: add = max(f, фигура), carve = min(f, −фигура). Каждая фигура считается
   только в своём окне (рамка + 16 px) — за окном её значение заведомо < −16, шум кромки этого не перекрывает.
   Слоёв два: F — «природный» (шум кромки ±amp, 6–8 px), C — «рукотворный» (шум ±1.2 px: мосты, дома, машины).
   add пишет в выбранный слой, carve режет оба. Итог: f = max(F + amp·N, C + 1.2·Nc), N = 0.65·noise2(40) + 0.35·noise2(11).
4. Архетип = набор фигур, параметры из rng (см. функции a_* ниже). Уровень жидкости wl = H − 20 − water·300;
   архетипы ставят дно ям/островов относительно wl, чтобы жидкость была видна и смертельна.
5. Чистка маски: верхние 6 строк — воздух (у открытых карт), у карт со стенами/потолком — рамка 14 px земли;
   связные куски земли < 500 px — убрать (мусор); воздух делим на 4-связные компоненты, оставляем самую большую,
   остальные (запертые карманы) заливаем землёй → вся игровая зона связна по воздуху.
6. Точки высадки: up[y][x] — сколько подряд воздуха над пикселем (включая его). Кандидат (x кратно 3) —
   пиксель поверхности (земля, сверху воздух), где на ±8 px по x от высоты y−6 вверх ≥ 26 px воздуха
   (голова бойца, склон до ~37°), в столбцах x±6 есть
   земля в пределах 8 px ниже (не край обрыва), 36 < y < wl − 6. Из кандидатов — «дальняя точка» (FPS):
   первая — случайная, дальше каждый раз кандидат с наибольшим расстоянием до уже выбранных, пока оно ≥ 40 px
   (не больше 48 точек); если вышло < 36 — повтор с шагом 32, затем 26 (с тем же состоянием rng). Список упорядочен: любые первые N точек разнесены — игра берёт бригады × бойцов
   и раздаёт по кругу (deal_spawns). Запасной путь — rng-перемешивание внутри первых N.
7. Места под предметы: те же кандидаты, но над ними ≥ 70 px воздуха на ±20 px и поверхность ровная (±4 px
   на ±24 px); ширина — пока ровно, до 200 px. Число = round(density·30), FPS с шагом ≥ 70 px,
   не ближе 30 px к первым 24 точкам высадки.

Python ↔ TS не обязаны совпадать до бита (sin/exp могут отличаться в последнем знаке), важно TS ↔ TS:
у всех клиентов один и тот же код. Метка связности здесь — scipy.ndimage.label (4-связность), в TS —
построчная заливка (scanline flood fill), результат тот же.
"""
import argparse
import glob
import json
import math
import os
import pathlib
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage

W, H = 1920, 704
PAD = 16
M32 = 0xFFFFFFFF
G = 'G:/temp/studio/out/gops'
THEMES_DIR = f'{G}/21-themes'
YARD = f'{G}/06-yard'
OUT_DIR = f'{G}/27-terrain'

ARCHETYPES = ['hills', 'islands', 'cavern', 'bridge', 'towers', 'pit', 'fortress', 'staircase',
              'floating', 'valley', 'cliff', 'maze', 'arena', 'objects']
# вода по умолчанию для прогона
WATER = dict(hills=.15, islands=.3, cavern=.1, bridge=.25, towers=.1, pit=.2, fortress=.15, staircase=.15,
             floating=.2, valley=.2, cliff=.15, maze=0, arena=.12, objects=.1)
# темы и время суток (как в studio/jobs/gops/make_jobs.py) — для превью по кругу
THEME_TIMES = {'yard': ['night', 'grey'], 'garages': ['evening', 'day', 'night'], 'construction': ['day', 'evening', 'grey'],
               'dump': ['grey', 'evening'], 'factory': ['grey', 'night', 'evening'], 'market': ['day', 'evening'],
               'depot': ['evening', 'grey', 'night'], 'dacha': ['day', 'evening'], 'winter': ['winter', 'night'],
               'heating': ['night', 'grey'], 'school': ['day', 'evening'], 'beach': ['day', 'evening']}
UNDERGROUND = {'cavern', 'maze'}       # фон — задняя стенка из грунта, а не небо
WALLED = {'cavern', 'maze'}            # рамка из земли по краям и сверху


# ------------------------------------------------------------------ ГПСЧ и шумы
def imul(a, b):
    return (a * b) & M32


def fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for ch in s.encode('utf-8'):
        h = imul(h ^ ch, 0x01000193)
    return h


class Rng:
    """mulberry32 — тот же код в TS через Math.imul и >>> 0."""

    def __init__(self, seed):
        self.s = seed & M32

    def u32(self):
        self.s = (self.s + 0x6D2B79F5) & M32
        t = self.s
        t = imul(t ^ (t >> 15), t | 1)
        t ^= (t + imul(t ^ (t >> 7), t | 61)) & M32
        return (t ^ (t >> 14)) & M32

    def f(self):
        return self.u32() / 4294967296

    def range(self, a, b):
        return a + (b - a) * self.f()

    def int(self, a, b):  # включительно
        return a + int(self.f() * (b - a + 1))

    def chance(self, p):
        return self.f() < p

    def shuffle(self, lst):  # Фишер — Йейтс с конца
        for i in range(len(lst) - 1, 0, -1):
            j = self.int(0, i)
            lst[i], lst[j] = lst[j], lst[i]
        return lst


def mn(*a):
    """Поэлементный минимум нескольких полей (с broadcasting)."""
    out = a[0]
    for b in a[1:]:
        out = np.minimum(out, b)
    return out


def smooth(t):
    return t * t * (3 - 2 * t)


def noise1(rng, period, n=W):
    """Value-noise по одной оси: значения −1..1 в узлах через period px."""
    k = n // period + 3
    v = np.array([rng.f() * 2 - 1 for _ in range(k)])
    x = np.arange(n) / period
    i = np.floor(x).astype(int)
    t = smooth(x - i)
    return v[i] * (1 - t) + v[i + 1] * t


def fbm1(rng, octs, n=W):
    out = np.zeros(n)
    for period, amp in octs:
        out += amp * noise1(rng, period, n)
    return out


def noise2(rng, cell):
    gw, gh = W // cell + 2, H // cell + 2
    g = np.array([rng.f() * 2 - 1 for _ in range(gw * gh)]).reshape(gh, gw)
    x = np.arange(W) / cell
    y = np.arange(H) / cell
    ix, iy = np.floor(x).astype(int), np.floor(y).astype(int)
    tx, ty = smooth(x - ix)[None, :], smooth(y - iy)[:, None]
    a = g[iy][:, ix] * (1 - tx) + g[iy][:, ix + 1] * tx
    b = g[iy + 1][:, ix] * (1 - tx) + g[iy + 1][:, ix + 1] * tx
    return (a * (1 - ty) + b * ty).astype(np.float32)


# ------------------------------------------------------------------ фигуры (поле > 0 внутри) и холст
class Shape:
    def __init__(self, box, fn):
        x0, y0, x1, y1 = box
        self.box = (max(0, int(math.floor(x0 - PAD))), max(0, int(math.floor(y0 - PAD))),
                    min(W, int(math.ceil(x1 + PAD)) + 1), min(H, int(math.ceil(y1 + PAD)) + 1))
        self.fn = fn


def rect(x0, y0, x1, y1, r=0.0):
    cx, cy, hx, hy = (x0 + x1) / 2, (y0 + y1) / 2, abs(x1 - x0) / 2, abs(y1 - y0) / 2
    r = min(r, hx, hy)

    def fn(X, Y):
        qx = np.abs(X - cx) - (hx - r)
        qy = np.abs(Y - cy) - (hy - r)
        out = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0) - r
        return -out
    return Shape((min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)), fn)


def circle(cx, cy, r):
    return Shape((cx - r, cy - r, cx + r, cy + r), lambda X, Y: r - np.sqrt((X - cx) ** 2 + (Y - cy) ** 2))


def ellipse(cx, cy, rx, ry):
    k = max(rx, ry) / min(rx, ry)  # окно шире, чтобы за ним поле было < −PAD
    return Shape((cx - rx - PAD * k, cy - ry - PAD * k, cx + rx + PAD * k, cy + ry + PAD * k),
                 lambda X, Y: (1 - np.sqrt(((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2)) * min(rx, ry))


def capsule(x0, y0, x1, y1, r0, r1=None):
    r1 = r0 if r1 is None else r1
    dx, dy = x1 - x0, y1 - y0
    ll = dx * dx + dy * dy or 1e-9
    rm = max(r0, r1)

    def fn(X, Y):
        t = np.clip(((X - x0) * dx + (Y - y0) * dy) / ll, 0, 1)
        d = np.sqrt((X - x0 - t * dx) ** 2 + (Y - y0 - t * dy) ** 2)
        return r0 + (r1 - r0) * t - d
    return Shape((min(x0, x1) - rm, min(y0, y1) - rm, max(x0, x1) + rm, max(y0, y1) + rm), fn)


def poly(pts):
    """Выпуклый многоугольник (любой обход): минимум знаковых расстояний до сторон."""
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    edges = []
    for i in range(len(pts)):
        (ax, ay), (bx, by) = pts[i], pts[(i + 1) % len(pts)]
        nx, ny = by - ay, -(bx - ax)
        ln = math.hypot(nx, ny) or 1
        nx, ny = nx / ln, ny / ln
        if (cx - ax) * nx + (cy - ay) * ny < 0:
            nx, ny = -nx, -ny
        edges.append((ax, ay, nx, ny))

    def fn(X, Y):
        out = None
        for ax, ay, nx, ny in edges:
            d = (X - ax) * nx + (Y - ay) * ny
            out = d if out is None else np.minimum(out, d)
        return out
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return Shape((min(xs), min(ys), max(xs), max(ys)), fn)


def band(h, xa=0, xb=W, bottom=H + 40):
    """Рельеф: земля ниже h(x) на отрезке [xa, xb]."""
    xa, xb = max(-PAD, xa), min(W + PAD, xb)
    i0, i1 = max(0, int(xa) - PAD), min(W, int(xb) + PAD + 1)

    def fn(X, Y):
        xi = np.clip(X.astype(int), 0, W - 1)
        return mn(Y - h[xi], X - xa, xb - X, bottom - Y)
    return Shape((xa, float(np.min(h[i0:i1])), xb, bottom), fn)


def platform(x0, x1, y, thick, depth, nz=None, p=0.7):
    """Парящая плита: ровный верх, снизу — свисающая «скала» глубиной depth."""
    def fn(X, Y):
        t = np.clip((X - x0) / max(1, x1 - x0), 0, 1)
        bot = y + thick + depth * np.maximum(0, np.sin(np.pi * t)) ** p
        if nz is not None:
            bot = bot + nz[np.clip(X.astype(int), 0, W - 1)] * min(1, depth / 40)
        return mn(Y - y, bot - Y, X - x0, x1 - X)
    return Shape((x0, y, x1, y + thick + depth + 12), fn)


class Canvas:
    """Два слоя поля: F — природный (шумная кромка), C — рукотворный (ровная)."""

    def __init__(self):
        self.F = np.full((H, W), -100, np.float32)
        self.C = np.full((H, W), -100, np.float32)

    def _apply(self, layer, s, carve):
        x0, y0, x1, y1 = s.box
        if x1 <= x0 or y1 <= y0:
            return
        X = np.arange(x0, x1, dtype=np.float32)[None, :]
        Y = np.arange(y0, y1, dtype=np.float32)[:, None]
        v = s.fn(X, Y).astype(np.float32)
        win = layer[y0:y1, x0:x1]
        np.minimum(win, -v, out=win) if carve else np.maximum(win, v, out=win)

    def add(self, s, crisp=False):
        self._apply(self.C if crisp else self.F, s, False)

    def carve(self, s):
        self._apply(self.F, s, True)
        self._apply(self.C, s, True)

    def fill(self):
        self.F[:] = 100


def surf_y(mask, x, y_from=0):
    """Первая земля в столбце x ниже y_from (или H)."""
    col = np.where(mask[int(max(0, y_from)):, int(x)])[0]
    return int(col[0] + max(0, y_from)) if len(col) else H


# ------------------------------------------------------------------ архетипы
def a_hills(T, r, wl, meta):
    base = min(400, wl - 220)
    xs = np.arange(W)
    h = base + fbm1(r, [(560, 140), (230, 55), (90, 18), (34, 5)])
    cx, amp, s = r.range(400, 1500), r.range(60, 150), r.range(120, 220)
    h -= amp * np.exp(-((xs - cx) / s) ** 2)
    h = np.clip(h, 110, H)
    T.add(band(h, r.range(30, 90), W - r.range(30, 90)))
    # пещеры с выходом наверх
    nc = r.int(2, 3)
    for c in range(nc):  # каждая пещера — в своей доле ширины, чтобы не сливались
        seg0, seg1 = 120 + (W - 240) * c / nc, 120 + (W - 240) * (c + 1) / nc
        x0 = r.range(seg0, seg1 - 330)
        x1 = x0 + r.range(160, 300)
        rad = r.range(22, 30)
        y0 = h[int(x0)] + r.range(90, 150)
        y1 = max(h[int(x1)] + 90, y0 + r.range(-30, 30))
        T.carve(capsule(x0, y0, x1, y1, rad, rad * r.range(0.8, 1.3)))
        xm = min(W - 40, x1 + r.range(10, 30))  # выход — колодец почти отвесно вверх
        T.carve(capsule(x1, y1, xm, h[int(xm)] - 6, rad * 0.75))
    # нависающий уступ над самым крутым склоном
    d = h[120:] - h[:-120]
    for sgn in (1, -1):
        i = int(np.argmax(d * sgn))
        if abs(d[i]) > 60:
            x, xe = (i, i + r.range(70, 110)) if sgn > 0 else (i + 120, i + 120 - r.range(70, 110))
            T.add(capsule(x, h[int(x)] + 12, xe, h[int(x)] + 18, r.range(10, 14)))


def a_islands(T, r, wl, meta):
    n = r.int(3, 4)
    m = 30
    gaps = [r.range(60, 140) for _ in range(n - 1)]
    wts = [r.range(0.7, 1.3) for _ in range(n)]
    span = W - 2 * m - sum(gaps)
    nz = fbm1(r, [(180, 30), (60, 10), (24, 3)])
    x = m
    for i in range(n):
        a, b = x, x + span * wts[i] / sum(wts)
        top = max(130, wl - r.range(90, 300))
        depth = r.range(70, 170)
        k = r.range(1.05, 1.8)  # чем больше, тем шире ровная макушка
        asym = r.range(0.65, 1.5)  # перекос: пологий берег с одной стороны, крутой с другой
        xs = np.arange(W)
        t = np.clip((xs - a) / (b - a), 0, 1) ** asym
        s = np.sin(np.pi * t)
        plateau = smooth(np.clip(s * k, 0, 1))
        hump = r.range(-60, 50) * np.sin(np.pi * t * r.int(1, 2))  # макушка не плоская: горб или седло
        htop = top + (wl + 30 - top) * (1 - plateau) + nz + hump * plateau
        hbot = wl + 10 + depth * s ** 0.5

        def fn(X, Y, a=a, b=b, htop=htop, hbot=hbot):
            xi = np.clip(X.astype(int), 0, W - 1)
            return mn(Y - htop[xi], hbot[xi] - Y, X - a, b - X)
        T.add(Shape((a, float(htop[int(a):int(b)].min()), b, H), fn))
        cx = (a + b) / 2
        if r.chance(0.55) and wl - top > 140:  # пещера с выходом в бок острова
            side = -1 if r.chance(0.5) else 1
            edge = a if side < 0 else b
            yc = (top + wl) / 2 + r.range(0, 30)
            T.carve(capsule(edge - side * 30, yc, edge + side * -(b - a) * r.range(0.25, 0.4), yc + r.range(-15, 15), r.range(20, 28)))
        if r.chance(0.45):  # скала-шпиль
            sx = cx + r.range(-0.25, 0.25) * (b - a)
            T.add(capsule(sx, htop[int(sx)] + 20, sx + r.range(-25, 25), htop[int(sx)] - r.range(70, 140), r.range(16, 24), r.range(7, 11)))
        x = b + (gaps[i] if i < n - 1 else 0)
        if i < n - 1 and r.chance(0.5):  # камень над проливом
            gx, gw = b + gaps[i] / 2, r.range(60, 110)
            T.add(platform(gx - gw / 2, gx + gw / 2, top - r.range(40, 90), 14, r.range(20, 45), nz))


def a_cavern(T, r, wl, meta):
    T.fill()
    nz = noise1(r, 260)
    k = 11
    pts = []
    for i in range(k):
        x = 70 + (W - 140) * i / (k - 1)
        y = 300 + nz[int(min(x, W - 1))] * 110 + r.range(-25, 25)
        pts.append((x, y, r.range(55, 90)))
    for (x0, y0, r0), (x1, y1, r1) in zip(pts, pts[1:]):
        T.carve(capsule(x0, y0, x1, y1, r0, r1))
    # верхняя и нижняя галереи
    yu, yl = r.range(110, 150), min(wl - 85, 560)
    u0 = r.range(60, 500)
    gal_u = (u0, u0 + r.range(700, 1100))
    l0 = r.range(300, 900)
    gal_l = (l0, min(W - 60, l0 + r.range(600, 1000)))
    for (g0, g1), gy, gr in ((gal_u, yu, r.range(40, 55)), (gal_l, yl, r.range(45, 60))):
        steps = 6
        prev = None
        for j in range(steps + 1):
            x = g0 + (g1 - g0) * j / steps
            y = gy + r.range(-30, 30)
            if prev:
                T.carve(capsule(prev[0], prev[1], x, y, gr))
            prev = (x, y)
    # шахты между ярусами
    main_y = lambda x: np.interp(x, [p[0] for p in pts], [p[1] for p in pts])
    for g0, g1 in (gal_u, gal_l):
        for _ in range(2):
            x = r.range(g0 + 40, g1 - 40)
            gy = yu if (g0, g1) == gal_u else yl
            T.carve(capsule(x, gy, x + r.range(-60, 60), main_y(x), r.range(28, 38)))
    # залы, сталактиты/сталагмиты
    for _ in range(r.int(2, 3)):
        p = pts[r.int(1, k - 2)]
        R = r.range(95, 135)
        T.carve(circle(p[0], p[1], R))
        if r.chance(0.7):
            sx = p[0] + r.range(-R * 0.4, R * 0.4)
            T.add(capsule(sx, p[1] - R - 10, sx + r.range(-10, 10), p[1] - R * r.range(0.2, 0.45), r.range(14, 20), 3))
        if r.chance(0.6):
            sx = p[0] + r.range(-R * 0.5, R * 0.5)
            T.add(capsule(sx, p[1] + R + 10, sx, p[1] + R * r.range(0.35, 0.6), r.range(16, 24), 5))
    # колодцы в жидкость
    for _ in range(r.int(1, 2)):
        x = r.range(gal_l[0] + 40, gal_l[1] - 40)
        T.carve(capsule(x, yl, x + r.range(-30, 30), H + 60, r.range(38, 52)))


def a_bridge(T, r, wl, meta):
    xa, xb = r.range(560, 720), W - r.range(560, 720)
    hl, hr = r.range(250, 340), r.range(250, 340)
    xs = np.arange(W)
    h = np.where(xs < W / 2, hl, hr) + fbm1(r, [(300, 45), (100, 15), (35, 4)])
    # склоны к краям карты
    h += np.maximum(0, 140 - xs) ** 2 / 140 * 0.5 + np.maximum(0, xs - (W - 140)) ** 2 / 140 * 0.5
    ha, hb = h[int(xa)], h[int(xb)]
    lean_l, lean_r = r.range(0.15, 0.4), r.range(0.15, 0.4)
    ml, mr = r.range(20, 60), r.range(20, 60)

    def left(X, Y):
        xi = np.clip(X.astype(int), 0, W - 1)
        return mn(Y - h[xi], (xa - lean_l * np.maximum(0, Y - ha)) - X, X - ml)

    def right(X, Y):
        xi = np.clip(X.astype(int), 0, W - 1)
        return mn(Y - h[xi], X - (xb + lean_r * np.maximum(0, Y - hb)), W - mr - X)
    T.add(Shape((0, float(h[:int(xa)].min()), xa, H), left))
    T.add(Shape((xb, float(h[int(xb):].min()), W, H), right))
    # пещеры в берегах — выход на обрыв
    for edge, sg, he in ((xa, -1, ha), (xb, 1, hb)):
        y = he + r.range(70, 140)
        x_face = edge - sg * (-(lean_l if sg < 0 else lean_r) * (y - he))
        T.carve(capsule(x_face + sg * 30, y, x_face + sg * r.range(180, 260), y - r.range(10, 50), r.range(24, 30)))
    # мост: провисающая плита
    sag = r.range(0, 40)
    th = r.range(7, 9)
    x0, y0, x1, y1 = xa - 30, ha + 4, xb + 30, hb + 4
    prev = None
    for j in range(17):
        t = j / 16
        p = (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + sag * math.sin(math.pi * t))
        if prev:
            T.add(capsule(prev[0], prev[1], p[0], p[1], th), crisp=True)
        prev = p
    mid_y = (y0 + y1) / 2 + sag
    if r.chance(0.6):
        for j in range(r.int(1, 2)):
            px = (xa + xb) / 2 + (r.range(-40, 40) if j == 0 else r.range(-200, 200))
            T.add(rect(px - 16, mid_y, px + 16, H + 20), crisp=True)
    for _ in range(r.int(0, 2)):  # камни в жидкости
        cx = r.range(xa + 90, xb - 90)
        T.add(ellipse(cx, wl + 25, r.range(45, 90), r.range(40, 60)))


def a_towers(T, r, wl, meta):
    base = min(560, wl - 70)
    hb = base + fbm1(r, [(300, 20), (80, 6)])
    m = r.range(30, 70)
    T.add(band(hb, m, W - m))
    n = r.int(5, 7)
    tw = []
    for i in range(n):
        cx = m + (i + 0.5) * (W - 2 * m) / n + r.range(-40, 40)
        w = r.range(70, 140)
        top = r.range(110, 330)
        kind = r.int(0, 2)
        tw.append((cx, w, top))
        gy = float(hb[int(np.clip(cx, 0, W - 1))])
        if kind == 2:  # скальный столб
            T.add(capsule(cx, gy + 20, cx + r.range(-30, 30), top + w * 0.3, w * 0.55, w * 0.35))
            T.add(platform(cx - w * 0.45, cx + w * 0.45, top, 18, 30))
            continue
        T.add(rect(cx - w / 2, top, cx + w / 2, gy + 30), crisp=True)
        if kind == 0:  # двускатная крыша
            T.add(poly([(cx - w / 2 - 10, top + 2), (cx + w / 2 + 10, top + 2), (cx, top - w * 0.42)]), crisp=True)
        else:  # плоская с парапетом и трубой
            T.add(rect(cx - w / 2 - 6, top - 10, cx + w / 2 + 6, top + 2), crisp=True)
            ax = cx + r.range(-w * 0.3, w * 0.3)
            T.add(rect(ax - 7, top - r.range(30, 50), ax + 7, top), crisp=True)
        # этажи-комнаты с дверью на одну сторону
        floors = int((gy - top - 40) / 90)
        for j in range(floors):
            if not r.chance(0.55):
                continue
            fy = top + 40 + j * 90
            T.carve(rect(cx - w / 2 + 12, fy, cx + w / 2 - 12, fy + 44))
            side = -1 if r.chance(0.5) else 1
            dx = cx + side * (w / 2 - 6)
            T.carve(rect(dx - 14, fy + 6, dx + 14, fy + 44))
    # балки между соседними домами
    for (c0, w0, t0), (c1, w1, t1) in zip(tw, tw[1:]):
        if r.chance(0.4):
            y = max(t0, t1) + r.range(20, 60)
            T.add(capsule(c0 + w0 / 2 - 4, y, c1 - w1 / 2 + 4, y + r.range(-10, 10), 6), crisp=True)


def a_pit(T, r, wl, meta):
    base = r.range(250, 330)
    h = base + fbm1(r, [(400, 45), (120, 14), (40, 4)])
    m = r.range(30, 70)
    T.add(band(h, m, W - m))
    cx = W / 2 + r.range(-120, 120)
    rx = r.range(300, 420)
    yc = base - 30
    ry = (wl - yc) + r.range(40, 100)
    T.carve(ellipse(cx, yc, rx, ry))
    # полки на стенках котлована
    for j in range(r.int(3, 4)):
        fr = r.range(0.3, 0.8)
        y = yc + ry * fr
        if y > wl - 30:
            continue
        side = 1 if j % 2 else -1
        xw = cx + side * rx * math.sqrt(1 - fr * fr)
        T.add(capsule(xw + side * 10, y, xw - side * r.range(70, 120), y + 4, r.range(10, 13)))
    if r.chance(0.65):  # скала посреди лужи
        top = wl - r.range(40, 90)
        T.add(rect(cx - r.range(35, 55), top, cx + r.range(35, 55), H + 20, 14))
    for _ in range(r.int(1, 2)):  # норы в бортах
        side = 1 if r.chance(0.5) else -1
        y = yc + r.range(60, min(200, max(70, wl - yc - 60)))
        fr = min(0.95, (y - yc) / ry)
        xw = cx + side * rx * math.sqrt(1 - fr * fr)
        T.carve(capsule(xw - side * 20, y, xw + side * r.range(140, 240), y - r.range(0, 40), r.range(22, 28)))


def _fort(T, r, side, P, hground):
    mx = (lambda x: x) if side < 0 else (lambda x: W - x)

    def R(x0, y0, x1, y1, rr=0):
        a, b = sorted((mx(x0), mx(x1)))
        return rect(a, y0, b, y1, rr)
    fw, top = P['fw'], P['top']
    T.add(R(-20, top, fw, H + 20), crisp=True)
    for x in np.arange(P['tw'] + 14, fw - 20, 48):  # зубцы
        T.carve(R(x, top - 30, x + 22, top + 18))
    T.add(R(-20, P['ttop'], P['tw'], top), crisp=True)
    for x in np.arange(10, P['tw'] - 20, 40):
        T.carve(R(x, P['ttop'] - 30, x + 18, P['ttop'] + 16))
    T.carve(R(P['tw'] * 0.3, P['ttop'] + 40, P['tw'] * 0.7, P['ttop'] + 80))  # бойница в башне…
    T.carve(R(P['tw'] * 0.5, P['ttop'] + 50, P['tw'] + 10, P['ttop'] + 80))  # …с выходом на стену
    # откос от земли к стене
    gy = hground
    T.add(poly([(mx(fw - 2), top + P['glacis_top']), (mx(fw - 2), gy + 30), (mx(fw + P['glacis']), gy + 30), (mx(fw + P['glacis']), gy + 4)]))
    # казематы: два этажа, дверь к врагу, лаз между этажами
    y1, y2 = top + 55, top + 55 + P['floor']
    T.carve(R(40, y1, fw - 30, y1 + 52))
    T.carve(R(fw - 40, y1 + 8, fw + 12, y1 + 52))
    if y2 + 52 < gy - 10:
        T.carve(R(70, y2, fw - 60, y2 + 52))
        T.carve(R(P['hatch'], y1 + 40, P['hatch'] + 34, y2 + 10))


def a_fortress(T, r, wl, meta):
    base = wl - r.range(60, 100)
    h = base + fbm1(r, [(300, 20), (90, 6)])
    T.add(band(h))
    cx = W / 2 + r.range(-40, 40)
    T.carve(ellipse(cx, base - 10, r.range(90, 150), (wl - base) + r.range(60, 110)))  # ров
    for sg in (-1, 1):  # пригорки по сторонам рва
        T.add(ellipse(cx + sg * r.range(230, 330), base + 20, r.range(70, 120), r.range(40, 70)))
    P = dict(fw=r.range(320, 410), top=r.range(200, 260), tw=r.range(70, 95), floor=r.range(85, 105),
             glacis=r.range(60, 140), glacis_top=r.range(60, 120))
    P['ttop'] = P['top'] - r.range(70, 110)
    P['hatch'] = r.range(110, P['fw'] - 120)
    for sg in (-1, 1):
        _fort(T, r, sg, P, float(base))


def a_staircase(T, r, wl, meta):
    d = 1 if r.chance(0.5) else -1
    n = r.int(6, 8)
    m = r.range(30, 60)
    wts = [r.range(0.7, 1.3) for _ in range(n)]
    y0, y1 = min(wl - 50, 600), r.range(110, 170)
    lv = [y0 + (y1 - y0) * i / (n - 1) + r.range(-12, 12) for i in range(n)]
    edges = [m]
    for wv in wts:
        edges.append(edges[-1] + (W - 2 * m) * wv / sum(wts))
    xs = np.arange(W, dtype=float)
    h = np.full(W, float(lv[0]))
    for i in range(1, n):  # подступенки с небольшим уклоном
        s = edges[i]
        ramp = r.range(10, 30)
        t = np.clip((xs - s) / ramp, 0, 1)
        h = h + (lv[i] - lv[i - 1]) * t
    h = h + fbm1(r, [(150, 5), (50, 2)])
    if d < 0:
        h = h[::-1].copy()
        edges = [W - e for e in edges][::-1]
        lv = lv[::-1]
    T.add(band(h, m, W - m))
    for i in range(1, n):
        s = edges[i]
        hi, lo = (i, i - 1) if lv[i] < lv[i - 1] else (i - 1, i)
        dirn = -1 if hi == i else 1  # куда нависает козырёк — в сторону нижней ступени
        sx = s + (dirn * -1) * 10
        L = r.range(30, 60)
        T.add(capsule(sx, lv[hi] + 10, sx + dirn * L, lv[hi] + 14, r.range(10, 12)))
        if lv[lo] - lv[hi] > 60:  # ниша под козырьком
            T.carve(ellipse(s - dirn * 8, lv[lo] - 26, r.range(26, 36), 22))
    if r.chance(0.5):  # одна ступень с провалом в жидкость
        i = r.int(1, n - 2)
        a, b = sorted((edges[i], edges[i + 1]))
        gx, gw = (a + b) / 2 + r.range(-30, 30), r.range(60, 100)
        T.carve(rect(gx - gw / 2, min(lv) - 40, gx + gw / 2, H + 40, 20))


def a_floating(T, r, wl, meta):
    m = 40
    nz = fbm1(r, [(70, 12), (25, 4)])
    rows = r.int(3, 4)
    for k in range(r.int(1, 3)):  # кочки у жидкости
        T.add(ellipse(r.range(150, W - 150), wl + 30, r.range(90, 160), r.range(60, 80)))
    for j in range(rows):
        y = 160 + (wl - 90 - 160) * j / (rows - 1)
        x = m + (r.range(80, 160) if j % 2 else r.range(0, 60))
        while x < W - m - 100:
            w = r.range(110, 250)
            yy = y + r.range(-25, 25)
            if r.chance(0.25):  # бетонная плита
                T.add(rect(x, yy, x + w, yy + 16, 4), crisp=True)
            else:
                T.add(platform(x, x + w, yy, r.range(18, 26), r.range(30, 90), nz))
            x += w + r.range(70, 170)


def a_valley(T, r, wl, meta):
    hl, hr = r.range(130, 220), r.range(130, 220)
    lo = wl - (r.range(-10, 20) if r.chance(0.25) else r.range(60, 120))  # иногда дно залито
    c = W / 2 + r.range(-200, 200)
    s = r.range(320, 440)
    xs = np.arange(W)
    side = hl + (hr - hl) * xs / W
    bell = 1 / (1 + ((xs - c) / s) ** 4)
    h = side + (lo - side) * bell + fbm1(r, [(300, 35), (110, 14), (40, 4)])
    q = h / 45  # мягкие террасы
    h = 0.5 * h + 0.5 * 45 * (np.floor(q) + smooth(q - np.floor(q)) ** 3)
    m = r.range(20, 50)
    T.add(band(h, m, W - m))
    for sg in (-1, 1):  # пещеры в склонах, выход в долину
        target = (min(hl, hr) + lo) / 2 + 40
        seg = xs[:int(c)] if sg < 0 else xs[int(c):]
        idx = seg[np.argmin(np.abs(h[seg] - target))]
        y = h[idx] + r.range(30, 44)  # вход у склона, ход горизонтально вглубь склона
        L = r.range(150, 230)
        ex = idx + sg * L
        T.carve(capsule(idx - sg * 20, y, ex, y + r.range(0, 30), r.range(22, 27)))
        T.carve(circle(ex, y + 10, r.range(34, 44)))  # зал в конце


def a_cliff(T, r, wl, meta):
    sg = 1 if r.chance(0.5) else -1  # 1 — плато слева
    xf = W * r.range(0.36, 0.46)
    top = r.range(100, 160)
    low = min(wl - 90, 560)
    h_low = low + fbm1(r, [(260, 45), (90, 14), (30, 3)])
    T.add(band(h_low, r.range(20, 50), W - r.range(20, 50)))
    nv = fbm1(r, [(90, 35), (30, 10)], H)
    ht = top + fbm1(r, [(200, 12), (50, 4)])
    lean = r.range(0.0, 0.15)
    face = lambda y: xf + nv[int(np.clip(y, 0, H - 1))] - lean * (y - top)

    def fn(X, Y):
        Xm = X if sg > 0 else W - X
        xi = np.clip(Xm.astype(int), 0, W - 1)
        yi = np.clip(Y.astype(int), 0, H - 1)
        return mn(Y - ht[xi], (xf + nv[yi] - lean * (Y - top)) - Xm, Xm - 15)
    T.add(Shape((0, top - 20, W, H), fn))
    mxx = (lambda x: x) if sg > 0 else (lambda x: W - x)
    ys = sorted(r.range(top + 80, low - 60) for _ in range(3))
    for y in ys:  # уступы на стене обрыва
        fx = face(y)
        T.add(capsule(mxx(fx - 15), y, mxx(fx + r.range(60, 110)), y + 4, r.range(10, 13)))
    # тайный ход: со второго уступа внутрь и наверх
    y = ys[1] - 30
    fx = face(y)
    pts = [(fx + 10, y), (fx - r.range(130, 170), y - r.range(30, 60)), (fx - r.range(240, 300), top - 10)]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        T.carve(capsule(mxx(x0), y0, mxx(x1), y1, r.range(22, 26)))
    if r.chance(0.6):  # пруд в низине
        px = xf + r.range(200, W - xf - 250)
        T.carve(ellipse(mxx(px), low, r.range(70, 120), wl - low + 50))


def a_maze(T, r, wl, meta):
    T.fill()
    cols, rows = r.int(9, 12), 4
    ox, oy = 60, 60
    cw, ch = (W - 2 * ox) / (cols - 1), (H - oy - 90) / (rows - 1)
    cen = [[(ox + c * cw + r.range(-cw, cw) * 0.15, oy + rr * ch + r.range(-ch, ch) * 0.12) for c in range(cols)] for rr in range(rows)]
    seen = [[False] * cols for _ in range(rows)]
    links = []
    start = (r.int(0, rows - 1), 0)
    stack = [start]
    seen[start[0]][start[1]] = True
    while stack:  # «рекурсивный» бэктрекер на стеке
        y, x = stack[-1]
        nb = [(y + dy, x + dx) for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0))
              if 0 <= y + dy < rows and 0 <= x + dx < cols and not seen[y + dy][x + dx]]
        if not nb:
            stack.pop()
            continue
        ny, nx = nb[r.int(0, len(nb) - 1)]
        seen[ny][nx] = True
        links.append(((y, x), (ny, nx)))
        stack.append((ny, nx))
    for y in range(rows):  # лишние проходы — петли
        for x in range(cols):
            if x + 1 < cols and r.chance(0.12):
                links.append(((y, x), (y, x + 1)))
            if y + 1 < rows and r.chance(0.08):
                links.append(((y, x), (y + 1, x)))
    rad = r.range(26, 31)
    for (a, b) in links:
        (x0, y0), (x1, y1) = cen[a[0]][a[1]], cen[b[0]][b[1]]
        T.carve(capsule(x0, y0, x1, y1, rad))
    for rr in range(rows):
        for c in range(cols):
            T.carve(circle(*cen[rr][c], rad * 1.25))
    # финиш — самая дальняя клетка по проходам (BFS)
    adj = {}
    for a, b in links:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    dist = {start: 0}
    q = [start]
    for cur in q:
        for nb in adj.get(cur, []):
            if nb not in dist:
                dist[nb] = dist[cur] + 1
                q.append(nb)
    fin = max(sorted(dist), key=lambda k: (dist[k], k[1]))
    meta['race'] = {'start_cell': list(cen[start[0]][start[1]]), 'finish_cell': list(cen[fin[0]][fin[1]]),
                    'path_cells': dist[fin], 'grid': [cols, rows]}


def a_arena(T, r, wl, meta):
    base = min(wl - 100, r.range(400, 470))
    h = base + fbm1(r, [(500, 16), (150, 5)])
    m = r.range(40, 80)
    T.add(band(h, m, W - m))
    k = r.int(7, 10)
    for i in range(k):
        x = m + 90 + (W - 2 * m - 180) * i / (k - 1) + r.range(-30, 30)
        g = float(h[int(x)])
        kind = r.int(0, 4)
        if kind == 0:  # насыпь
            T.add(ellipse(x, g + 10, r.range(70, 120), r.range(45, 65)))
        elif kind == 1:  # стенка
            ww = r.range(8, 12)
            T.add(rect(x - ww, g - r.range(70, 110), x + ww, g + 20, 3), crisp=True)
        elif kind == 2:  # навес на двух столбах
            top = g - r.range(62, 80)
            T.add(rect(x - 56, top, x - 44, g + 20), crisp=True)
            T.add(rect(x + 44, top, x + 56, g + 20), crisp=True)
            T.add(rect(x - 72, top - 14, x + 72, top + 2, 3), crisp=True)
        elif kind == 3:  # воронка
            rr = r.range(50, 75)
            T.carve(circle(x, g + rr * 0.35, rr))
        else:  # валун
            bw = r.range(40, 58)
            T.add(rect(x - bw, g - r.range(55, 80), x + bw, g + 20, 16))


def a_objects(T, r, wl, meta):
    base = min(wl - 90, r.range(540, 580))
    h = base + fbm1(r, [(400, 8), (90, 2)])
    T.add(band(h, 20, W - 20))
    sky = h.copy()
    objs = meta.setdefault('objects', [])
    kinds = ['garages'] * 3 + ['container'] * 2 + ['car'] * 2 + ['bus', 'barrels', 'barrels', 'tyres', 'fridge', 'pipe', 'gap']

    def put(kind, x, w, stack=False):
        """Поставить предмет шириной w на «линию крыш» под ним; вернуть верх."""
        xi0, xi1 = int(max(0, x)), int(min(W, x + w))
        yf = float(sky[xi0:xi1].min())
        if kind == 'garages':
            c = max(1, int(w // 140))
            gh = r.range(125, 155)
            T.add(rect(x, yf - gh, x + w, yf + 12), crisp=True)
            T.add(rect(x - 8, yf - gh - 10, x + w + 8, yf - gh + 2), crisp=True)
            top = yf - gh - 10
            for k in range(1, c):  # стыки боксов — неглубокие щели под козырьком
                T.carve(rect(x + w * k / c - 2, yf - gh, x + w * k / c + 2, yf - gh + 24))
        elif kind == 'container':
            ch = r.range(105, 125)
            T.add(rect(x, yf - ch, x + w, yf + 6, 2), crisp=True)
            top = yf - ch
        elif kind in ('car', 'bus'):
            bh, wr = (50, 17) if kind == 'car' else (100, 22)
            T.add(rect(x, yf - 2 * wr - bh + 10, x + w, yf - wr, 8 if kind == 'car' else 12), crisp=True)
            if kind == 'car':
                T.add(poly([(x + w * .24, yf - 2 * wr - bh + 12), (x + w * .33, yf - 2 * wr - bh - 22),
                            (x + w * .7, yf - 2 * wr - bh - 22), (x + w * .8, yf - 2 * wr - bh + 12)]), crisp=True)
                top = yf - 2 * wr - bh - 22
            else:
                top = yf - 2 * wr - bh + 10
            for fx in (0.2, 0.8):
                T.add(circle(x + w * fx, yf - wr, wr), crisp=True)
        elif kind == 'barrels':
            b = r.int(2, 4)
            bw, bh = 54, 74
            for row in range(b):
                for j in range(b - row):
                    bx = x + j * bw + row * bw / 2
                    T.add(rect(bx + 1, yf - (row + 1) * bh, bx + bw - 1, yf - row * bh + (6 if row == 0 else 1), 6), crisp=True)
            top = yf - b * bh
        elif kind == 'tyres':
            k = r.int(3, 5)
            for j in range(k):
                jx = r.range(-4, 4)
                T.add(rect(x + jx, yf - (j + 1) * 24, x + w + jx, yf - j * 24 + (4 if j == 0 else 1), 10), crisp=True)
            top = yf - k * 24
        elif kind == 'fridge':
            T.add(rect(x, yf - 140, x + w, yf + 4, 6), crisp=True)
            top = yf - 140
        elif kind == 'pipe':
            pr = r.range(36, 46)
            T.add(capsule(x + pr, yf - pr + 2, x + w - pr, yf - pr + 2, pr), crisp=True)
            top = yf - 2 * pr
        objs.append({'kind': kind, 'x0': round(x), 'y0': round(top), 'x1': round(x + w), 'y1': round(yf)})
        sky[xi0:xi1] = np.minimum(sky[xi0:xi1], top)
        return top
    widths = dict(garages=lambda: r.int(2, 3) * r.range(140, 165), container=lambda: r.range(260, 320),
                  car=lambda: r.range(190, 230), bus=lambda: r.range(320, 360), barrels=lambda: 0,
                  tyres=lambda: 70, fridge=lambda: 72, pipe=lambda: r.range(260, 360))
    x = 40 + r.range(0, 40)
    while x < W - 90:
        kind = kinds[r.int(0, len(kinds) - 1)]
        if kind == 'gap':
            gw = r.range(60, 110)
            if r.chance(0.5):
                T.carve(rect(x, base - 20, x + gw, H + 40, 18))
            x += gw
            continue
        w = widths[kind]()
        if kind == 'barrels':
            w = 54 * r.int(2, 4)
        if x + w > W - 30:
            break
        put(kind, x, w)
        lw, lx = w, x
        for lvl in range(2):  # ярусы: на гаражи/контейнеры/автобус — ещё что-то, на то — ещё
            if not r.chance(0.6 if lvl == 0 else 0.35):
                break
            k2 = ['car', 'barrels', 'tyres', 'fridge', 'container', 'garages'][r.int(0, 5)]
            w2 = 54 * r.int(1, 2) if k2 == 'barrels' else widths[k2]()
            if w2 > lw - 10:
                break
            nx = lx + r.range(-30, max(-29, lw - w2 + 30))
            if float(sky[int(max(0, nx)):int(min(W, nx + w2))].min()) < 300:
                break
            put(k2, nx, w2)
            lw, lx = w2, nx
        x += w + (r.range(0, 14) if r.chance(0.3) else r.range(20, 70))


ARCH_FN = {a: globals()[f'a_{a}'] for a in ARCHETYPES}


# ------------------------------------------------------------------ сборка маски
def box_max(a, rx, ry):
    """Дилатация квадратом (2rx+1)×(2ry+1) — разделимо, сдвигами."""
    out = a.copy()
    for d in range(1, rx + 1):
        out[:, d:] |= a[:, :-d]
        out[:, :-d] |= a[:, d:]
    b = out.copy()
    for d in range(1, ry + 1):
        out[d:] |= b[:-d]
        out[:-d] |= b[d:]
    return out


def water_y(water):
    return int(round(H - 20 - float(water) * 300))


def generate(recipe):
    arch = recipe['archetype']
    seed = int(recipe.get('seed', 1))
    water = float(recipe.get('water', WATER.get(arch, 0.15)))
    dens = float(recipe.get('props', 0.5))
    s32 = fnv1a(arch) ^ imul(seed & M32, 0x9E3779B1)
    rng = Rng(s32)
    wl = water_y(water)
    meta = {'version': 1, 'recipe': {'archetype': arch, 'seed': seed, 'water': water, 'props': dens},
            'size': [W, H], 'water_y': wl,
            'edges': {'walls': arch in WALLED, 'ceiling': arch in WALLED}}
    T = Canvas()
    ARCH_FN[arch](T, rng, wl, meta)
    nz = 0.65 * noise2(rng, 40) + 0.35 * noise2(rng, 11)
    amp = {'objects': 3.0, 'maze': 4.0, 'fortress': 4.0, 'towers': 5.0}.get(arch, 7.0)
    f = np.maximum(T.F + amp * nz, T.C + 1.2 * noise2(rng, 6))
    mask = f > 0
    if arch in WALLED:
        mask[:14] = True
        mask[:, :14] = True
        mask[:, -14:] = True
    else:
        mask[:6] = False
    # чистка: мелкие куски земли — прочь, запертые карманы воздуха — залить
    lab, n = ndimage.label(mask)
    if n:
        sizes = np.bincount(lab.ravel())
        small = sizes < 500
        small[0] = False
        mask[small[lab]] = False
    # «снаружи» — рамка воздуха: у открытых карт со всех сторон, у закрытых только снизу (жидкость)
    air = np.pad(~mask, 1, constant_values=False)
    if arch in WALLED:
        air[-1] = True
    else:
        air[0] = air[-1] = True
        air[:, 0] = air[:, -1] = True
    lab, n = ndimage.label(air)
    outside = lab[-1, 0]
    if arch in WALLED:  # у пещер главная — самая большая полость, плюс всё, что выходит в жидкость
        sizes = np.bincount(lab.ravel())
        sizes[0] = 0
        keep = {int(np.argmax(sizes)), int(outside)}
    else:
        keep = {int(outside)}
    lab = lab[1:-1, 1:-1]
    pocket = ~mask & ~np.isin(lab, list(keep))
    mask[pocket] = True
    if 'race' in meta:
        for k in ('start', 'finish'):
            cx, cy = meta['race'].pop(k + '_cell')
            meta['race'][k] = [int(cx), surf_y(mask, cx, cy)]
    sp_rng = Rng(s32 ^ 0x5BD1E995)
    spawns, cand, up = find_spawns(mask, wl, sp_rng)
    meta['spawns'] = spawns
    meta['props'] = find_props(mask, wl, cand, up, spawns, dens, sp_rng)
    meta['stats'] = {'ground': round(float(mask.mean()), 3), 'spawn_capacity': len(spawns),
                     'enough_for_36': len(spawns) >= 36}
    return mask, meta


# ------------------------------------------------------------------ высадка и предметы
CLEAR, HALF_W, MIN_D, MAX_SP = 32, 8, 40, 48


def air_up(mask):
    air = ~mask
    up = np.zeros((H, W), np.int32)
    up[0] = air[0]
    for y in range(1, H):
        up[y] = (up[y - 1] + 1) * air[y]
    return up


def row_min(a, rx):
    out = a.copy()
    for d in range(1, rx + 1):
        out[:, d:] = np.minimum(out[:, d:], a[:, :-d])
        out[:, :-d] = np.minimum(out[:, :-d], a[:, d:])
        out[:, :d] = 0
        out[:, -d:] = 0
    return out


def fps(points, rng, min_d, max_n, first=None):
    """Дальняя точка: упорядоченная выборка, любые первые N разнесены."""
    if not len(points):
        return []
    pts = np.asarray(points, float)
    i = rng.int(0, len(pts) - 1) if first is None else first
    out = [i]
    d = np.hypot(pts[:, 0] - pts[i, 0], pts[:, 1] - pts[i, 1])
    while len(out) < max_n:
        i = int(np.argmax(d))
        if d[i] < min_d:
            break
        out.append(i)
        d = np.minimum(d, np.hypot(pts[:, 0] - pts[i, 0], pts[:, 1] - pts[i, 1]))
    return out


def find_spawns(mask, wl, rng):
    up = air_up(mask)
    U = np.zeros_like(up)
    U[1:] = up[:-1]  # воздух над пикселем
    surf = mask & (U > 0)
    U6 = np.zeros_like(up)
    U6[6:] = up[:-6]  # воздух начиная с 6 px над ногами: допускает склон до ~37°
    umin = row_min(U6, HALF_W)
    below = mask.copy()
    for k in range(1, 9):
        below[:-k] |= mask[k:]
    sup = np.zeros_like(below)
    sup[:, 6:-6] = below[:, :-12] & below[:, 12:]
    ok = surf & (umin >= CLEAR - 6) & sup
    ys = np.arange(H)[:, None]
    ok &= (ys > 36) & (ys < wl - 6)
    ok[:, :12] = ok[:, -12:] = False
    ok[:, np.arange(W) % 3 != 0] = False
    yy, xx = np.nonzero(ok)
    cand = np.stack([xx, yy], 1)
    st = rng.s
    for md in (MIN_D, 32, 26):  # тесная карта — сближаем, пока не влезут 36 бойцов
        rng.s = st
        idx = fps(cand, rng, md, MAX_SP)
        if len(idx) >= 36:
            break
    return [[int(cand[i, 0]), int(cand[i, 1])] for i in idx], cand, up


def find_props(mask, wl, cand, up, spawns, dens, rng):
    if not len(cand) or dens <= 0:
        return []
    U = np.zeros_like(up)
    U[1:] = up[:-1]
    surf = mask & (U > 0)
    sb = surf.copy()
    for k in range(1, 5):
        sb[k:] |= surf[:-k]
        sb[:-k] |= surf[k:]
    um = row_min(U, 20)
    good = []
    sp = np.asarray(spawns[:24], float).reshape(-1, 2)
    for x, y in cand:
        if um[y, x] < 70 or x < 30 or x > W - 30:
            continue
        if not all(sb[y, x + dx] for dx in (-20, -10, 10, 20)):
            continue
        if len(sp) and np.min(np.hypot(sp[:, 0] - x, sp[:, 1] - y)) < 30:
            continue
        good.append((x, y))
    if not good:
        return []
    n = int(round(dens * 30))
    idx = fps(good, rng, 70, n)
    out = []
    for i in idx:
        x, y = good[i]
        w = 48
        while w < 200 and 0 < x - w // 2 - 8 and x + w // 2 + 8 < W and sb[y, x - w // 2 - 8] and sb[y, x + w // 2 + 8] \
                and U[y, x - w // 2 - 8] > 40 and U[y, x + w // 2 + 8] > 40:
            w += 16
        hh = int(min(160, U[y, x - w // 2:x + w // 2 + 1].min()))
        out.append({'x': int(x), 'y': int(y), 'w': int(w), 'h': hh})
    return out


def deal_spawns(spawns, teams, per_team, seed=0):
    """Раздать точки бригадам: первые teams·per_team из упорядоченного списка, по кругу после перемешивания."""
    n = teams * per_team
    pts = list(spawns[:n])
    Rng(seed).shuffle(pts)
    return [pts[t::teams] for t in range(teams)]


# ------------------------------------------------------------------ превью
def _first(paths):
    for p in paths:
        if p and os.path.exists(p):
            return p
    return None


def load_theme(theme, time=None):
    """Картинки темы из 21-themes; чего нет — из 06-yard, иначе None (плоские цвета)."""
    time = time or THEME_TIMES.get(theme, ['day'])[0]
    T = THEMES_DIR
    ss = (1, 2, 3)
    got = {
        'near': _first([f'{T}/{theme}-near-{time}-{s}.png' for s in ss] + [f'{T}/{theme}-far-{time}-{s}.png' for s in ss]),
        'ground': _first([f'{T}/seamless/{theme}-ground-{s}.png' for s in ss] + [f'{T}/{theme}-ground-{s}.png' for s in ss]),
        'crust': _first([f'{T}/{theme}-crust-{s}.png' for s in ss]),
        'liquid': _first([f'{T}/{theme}-liquid-{s}.png' for s in ss]),
        'props': sorted(glob.glob(f'{T}/cut/{theme}-prop*.png')),
    }
    src = 'theme' if got['near'] and got['ground'] else 'yard'
    got['near'] = got['near'] or _first([f'{YARD}/bg-near-8.png'])
    got['ground'] = got['ground'] or _first([f'{YARD}/cut/ground-tile.png'])
    got['crust'] = got['crust'] or _first([f'{YARD}/crust-8.png'])
    got['props'] = got['props'] or sorted(glob.glob(f'{YARD}/cut/prop-*.png'))
    got['src'] = src
    return got


def crust_band(path, height=40):
    crust = Image.open(path).convert('RGB')
    ca = np.asarray(crust).astype(int)
    bgc = ca[2, 2]
    diff = np.abs(ca - bgc).sum(axis=2)
    rows = np.where(diff.mean(axis=1) > 25)[0]
    if len(rows) < 4:
        return None
    band_img = crust.crop((0, rows[0], crust.width, rows[-1]))
    alpha = (np.abs(np.asarray(band_img).astype(int) - bgc).sum(axis=2) > 30).astype(np.uint8) * 255
    band_img.putalpha(Image.fromarray(alpha))
    band_img = band_img.resize((band_img.width * height // band_img.height, height), Image.LANCZOS)
    return np.asarray(band_img).astype(np.float32)


def tile(img, w, h):
    out = Image.new('RGB', (w, h))
    for ty in range(0, h, img.height):
        for tx in range(0, w, img.width):
            out.paste(img, (tx, ty))
    return out


def _font(size):
    try:
        return ImageFont.truetype('arialbd.ttf', size)
    except OSError:
        return ImageFont.load_default()


OBJ_COLORS = dict(garages=(128, 104, 92), container=(64, 108, 140), car=(214, 200, 165), bus=(214, 172, 62),
                  barrels=(66, 112, 74), tyres=(48, 48, 52), fridge=(226, 226, 214), pipe=(160, 158, 150))
TEAM_COLORS = [(90, 220, 210), (255, 120, 110), (250, 210, 90), (170, 140, 255), (140, 230, 110), (255, 150, 220)]


def render(mask, meta, theme='yard', time=None, label=None):
    A = load_theme(theme, time)
    arch = meta['recipe']['archetype']
    wl = meta['water_y']
    rnd = random.Random(meta['recipe']['seed'] * 7919 + len(arch))
    canvas = Image.new('RGBA', (W, H), (90, 110, 130, 255))
    gtile = Image.open(A['ground']).convert('RGB') if A['ground'] else None
    if gtile and gtile.width > 512:
        gtile = gtile.resize((512, 512), Image.LANCZOS)
    gfill = tile(gtile, W, H) if gtile else Image.new('RGB', (W, H), (120, 85, 55))
    # фон
    if arch in UNDERGROUND:
        dark = np.asarray(gfill).astype(np.float32) * 0.32
        yy, xx = np.mgrid[0:H, 0:W]
        vig = 1 - 0.35 * (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) / 2
        canvas.paste(Image.fromarray((dark * vig[..., None]).clip(0, 255).astype(np.uint8)), (0, 0))
    elif A['near']:
        bg = Image.open(A['near']).convert('RGB')
        sc = max(W / bg.width, (H + 60) / bg.height)
        bg = bg.resize((round(bg.width * sc), round(bg.height * sc)), Image.LANCZOS)
        ox = (bg.width - W) // 2
        oy = max(0, bg.height - H - 30)
        bg = bg.crop((ox, oy, ox + W, oy + H)).filter(ImageFilter.GaussianBlur(1.2))
        bg = Image.blend(bg, Image.new('RGB', bg.size, (235, 190, 160)), 0.15)
        canvas.paste(bg, (0, 0))
    m8 = (mask * 255).astype(np.uint8)
    mask_img = Image.fromarray(m8)
    # задняя стенка выкопанного: узкие полости под поверхностью
    if arch not in UNDERGROUND:
        closed = ~box_max(~box_max(mask, 36, 36), 36, 36)
        top = np.argmax(mask, axis=0)
        has = mask.any(axis=0)
        below = (np.arange(H)[:, None] > top[None, :] + 6) & has[None, :]
        cave = closed & ~mask & below
        back = Image.fromarray((np.asarray(gfill).astype(np.float32) * 0.35).astype(np.uint8)).convert('RGBA')
        back.putalpha(Image.fromarray((cave * 255).astype(np.uint8)))
        canvas.alpha_composite(back)
    # кайма
    edge = box_max(mask, 2, 2) & ~mask
    rim = Image.new('RGBA', (W, H), (40, 26, 18, 255))
    rim.putalpha(Image.fromarray((edge * 255).astype(np.uint8)))
    canvas.alpha_composite(rim)
    # грунт с затемнением по глубине от поверхности
    depth = np.zeros((H, W), np.float32)
    for y in range(1, H):
        depth[y] = (depth[y - 1] + 1) * mask[y]
    shade = 1 - 0.38 * np.clip((depth - 20) / 260, 0, 1)
    g = (np.asarray(gfill).astype(np.float32) * shade[..., None]).clip(0, 255).astype(np.uint8)
    ground = Image.fromarray(g).convert('RGBA')
    ground.putalpha(mask_img)
    canvas.alpha_composite(ground)
    # предметы-ландшафт (архетип objects): свой цвет по виду, чтобы читались силуэты
    objmask = np.zeros((H, W), bool)
    if meta.get('objects'):
        arr0 = np.asarray(canvas).astype(np.float32)
        noise = np.asarray(gfill.convert('L')).astype(np.float32) / 255 - 0.5
        for o in meta['objects']:
            x0, x1 = max(0, o['x0'] - 10), min(W, o['x1'] + 10)
            y0, y1 = max(0, o['y0'] - 12), min(H, o['y1'] + 6)
            sub = mask[y0:y1, x0:x1] & ~objmask[y0:y1, x0:x1]
            col = np.array(OBJ_COLORS.get(o['kind'], (150, 150, 150)), np.float32)
            yy = np.linspace(1.12, 0.78, y1 - y0)[:, None, None]
            px = col[None, None, :] * yy * (1 + 0.35 * noise[y0:y1, x0:x1, None])
            reg = arr0[y0:y1, x0:x1, :3]
            reg[sub] = px[sub]
            objmask[y0:y1, x0:x1] |= sub
        canvas = Image.fromarray(arr0.clip(0, 255).astype(np.uint8))
    # кромка поверх верхних поверхностей
    band_a = crust_band(A['crust']) if A['crust'] else None
    up = air_up(mask)
    U = np.zeros_like(up)
    U[1:] = up[:-1]
    sy, sx = np.nonzero(mask & (U >= 4) & ~objmask)
    sel = sy < wl + 6
    sy, sx = sy[sel], sx[sel]
    arr = np.asarray(canvas).astype(np.float32)
    if band_a is not None:
        bh, bw = band_a.shape[:2]
        off = int(bh * 0.6)
        for rr in range(bh):
            yy = sy - off + rr
            ok = (yy >= 0) & (yy < H)
            px = band_a[rr, sx[ok] % bw]
            a = px[:, 3:4] / 255
            arr[yy[ok], sx[ok], :3] = arr[yy[ok], sx[ok], :3] * (1 - a) + px[:, :3] * a
    else:
        for rr in range(4):
            yy = np.clip(sy + rr, 0, H - 1)
            arr[yy, sx, :3] = (110, 150, 70)
    canvas = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    # предметы
    pimgs = [Image.open(p).convert('RGBA') for p in A['props'][:24]]
    for i, sp in enumerate(meta['props']):
        if not pimgs:
            break
        im = pimgs[rnd.randrange(len(pimgs))]
        im = im.crop(im.getbbox() or (0, 0, im.width, im.height))
        hh = min(sp['h'] - 8, rnd.randint(40, 90))
        ww = round(im.width * hh / im.height)
        if ww > sp['w'] * 1.3:
            ww = int(sp['w'] * 1.3)
            hh = round(im.height * ww / im.width)
        if hh < 18:
            continue
        im = im.resize((ww, hh), Image.LANCZOS)
        if rnd.random() < 0.5:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        canvas.alpha_composite(im, (sp['x'] - ww // 2, sp['y'] - hh + 4))
    # жидкость
    water = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dw = ImageDraw.Draw(water)
    if A['liquid']:
        lq = Image.open(A['liquid']).convert('RGB')
        lq = lq.crop((0, int(lq.height * 0.4), lq.width, lq.height))
        lq = lq.resize((lq.width * max(1, H - wl) // max(1, lq.height), max(1, H - wl)), Image.LANCZOS)
        lt = tile(lq, W, H - wl).convert('RGBA')
        lt.putalpha(220)
        water.paste(lt, (0, wl))
        col = tuple(int(c) for c in np.asarray(lq).reshape(-1, 3).mean(0))
        hl = tuple(min(255, c + 80) for c in col)
    else:
        dw.rectangle((0, wl, W, H), fill=(70, 88, 92, 225))
        hl = (170, 190, 190)
    for x in range(0, W, 2):
        y = wl + 3 * math.sin(x / 18)
        dw.line((x, y, x + 2, y), fill=hl + (255,), width=2)
    canvas.alpha_composite(water)
    # бойцы на первых точках (4 бригады × 4) и остальные точки — точками
    d = ImageDraw.Draw(canvas)
    sprites = []
    for br in ('zatulinka', 'rastochka'):
        p = f'{G}/05-sprites/{br}-atlas.png'
        if os.path.exists(p):
            a = Image.open(p).convert('RGBA')
            for c in range(0, 12, 3):
                fr = a.crop((c * 192, 0, c * 192 + 192, 192))
                fr = fr.crop(fr.getbbox())
                sprites.append(fr.resize((round(fr.width * 30 / fr.height), 30), Image.LANCZOS))
    sp = meta['spawns']
    for i, (x, y) in enumerate(sp):
        team = i % 4
        if i < 16 and sprites:
            im = sprites[(team // 2) * 4 + (i // 4) % 4] if len(sprites) >= 8 else sprites[0]
            if x > W / 2:
                im = im.transpose(Image.FLIP_LEFT_RIGHT)
            canvas.alpha_composite(im, (x - im.width // 2, y - 29))
            d.polygon([(x - 5, y - 40), (x + 5, y - 40), (x, y - 33)], fill=TEAM_COLORS[team] + (255,), outline=(20, 20, 24, 255))
        else:
            d.ellipse((x - 3, y - 6, x + 3, y), fill=(255, 255, 255, 220), outline=(20, 20, 24, 255))
    if 'race' in meta:
        for k, colr in (('start', (90, 230, 110)), ('finish', (255, 90, 90))):
            x, y = meta['race'][k]
            d.line((x, y, x, y - 44), fill=(30, 30, 30, 255), width=3)
            d.polygon([(x, y - 44), (x + 26, y - 37), (x, y - 30)], fill=colr + (255,), outline=(20, 20, 20, 255))
    if label:
        f = _font(18)
        tw = d.textlength(label, font=f)
        d.rounded_rectangle((10, 10, 26 + tw, 38), 6, fill=(20, 20, 24, 210))
        d.text((18, 13), label, font=f, fill=(255, 235, 150))
    return canvas.convert('RGB'), A['src']


# ------------------------------------------------------------------ прогоны
def save_level(recipe, out, stem, theme='yard', time=None, preview=True, label=None):
    mask, meta = generate(recipe)
    out = pathlib.Path(out)
    out.mkdir(parents=True, exist_ok=True)
    Image.fromarray((mask * 255).astype(np.uint8)).save(out / f'{stem}-mask.png', optimize=True)
    meta['mask'] = f'{stem}-mask.png'
    (out / f'{stem}.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    img = None
    if preview:
        img, src = render(mask, meta, theme, time, label)
        img.save(out / f'{stem}.png')
    return mask, meta, img


def make_sheet(items, path, cols=4, cw=640):
    ch = round(cw * H / W)
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cw, rows * ch), (24, 24, 28))
    for i, im in enumerate(items):
        sheet.paste(im.resize((cw, ch), Image.LANCZOS), ((i % cols) * cw, (i // cols) * ch))
    sheet.save(path, quality=88)
    print(path)


def run_missions(path, out):
    data = json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    ms = data.get('missions', data.get('levels', [])) if isinstance(data, dict) else data
    lv = pathlib.Path(out) / 'levels'
    lv.mkdir(parents=True, exist_ok=True)
    thumbs = []
    for m in ms:
        tr = m.get('terrain') or {}
        if 'archetype' not in tr:
            print('пропуск без terrain:', m.get('id'))
            continue
        mask, meta = generate(tr)
        theme = m.get('theme', 'yard')
        src = load_theme(theme, m.get('time'))['src']
        img, _ = render(mask, meta, theme, m.get('time'),
                        f"{m.get('id')} · {theme}/{m.get('time', '')} · {tr['archetype']} #{tr.get('seed', 1)} · точек {len(meta['spawns'])}"
                        + ('' if src == 'theme' else ' (двор-заглушка)'))
        img.save(lv / f"{m['id']}.png")
        thumbs.append(img)
        print(m['id'], tr['archetype'], 'точек', len(meta['spawns']))
    if thumbs:
        make_sheet(thumbs, lv / 'sheet.jpg')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=OUT_DIR)
    ap.add_argument('--arch', default=','.join(ARCHETYPES))
    ap.add_argument('--seeds', default='1,2')
    ap.add_argument('--recipe', help='JSON-рецепт одного уровня')
    ap.add_argument('--theme', default=None, help='тема превью (по умолчанию — по кругу)')
    ap.add_argument('--time', default=None)
    ap.add_argument('--missions', help='missions.json → превью уровней в <out>/levels')
    ap.add_argument('--no-preview', action='store_true')
    a = ap.parse_args()
    if a.missions:
        run_missions(a.missions, a.out)
        return
    if a.recipe:
        rc = json.loads(a.recipe)
        stem = f"{rc['archetype']}-{rc.get('seed', 1)}"
        _, meta, _ = save_level(rc, a.out, stem, a.theme or 'yard', a.time, not a.no_preview, stem)
        print(stem, 'точек', len(meta['spawns']), 'предметов', len(meta['props']))
        return
    themes = list(THEME_TIMES)
    items = []
    for i, arch in enumerate(a.arch.split(',')):
        for s in [int(x) for x in a.seeds.split(',')]:
            theme = a.theme or themes[i % len(themes)]
            stem = f'{arch}-{s}'
            rc = {'archetype': arch, 'seed': s, 'water': WATER[arch], 'props': 0.5}
            _, meta, img = save_level(rc, a.out, stem, theme, a.time, not a.no_preview, None)
            if img is not None:
                lab = f"{arch} #{s} · точек {len(meta['spawns'])} · предм. {len(meta['props'])}"
                im = img.copy()
                dd = ImageDraw.Draw(im)
                f = _font(40)
                tw = dd.textlength(lab, font=f)
                dd.rounded_rectangle((12, 12, 36 + tw, 66), 8, fill=(20, 20, 24, 220))
                dd.text((24, 16), lab, font=f, fill=(255, 235, 150))
                items.append(im)
            print(stem, 'точек', len(meta['spawns']), 'предметов', len(meta['props']), 'земли', meta['stats']['ground'])
    if items and a.arch == ','.join(ARCHETYPES):
        make_sheet(items, pathlib.Path(a.out) / 'sheet.jpg')
    elif items:
        make_sheet(items, pathlib.Path(a.out) / 'sheet-part.jpg')


if __name__ == '__main__':
    main()
