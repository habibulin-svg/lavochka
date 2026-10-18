"""Планы замков в чистом рисунке: скан книги → SVG той же геометрии (стены, комнаты, тушь), номера комнат — набором.

Запуск из lavochka/:  python tools/zakoldovannaya/plans_svg.py [c12 ...]
Пишет public/zakoldovannaya/plans/<n>.svg (и <n>b.svg для второго листа) рядом со сканами.

Как устроено: тушь — адаптивный порог; белый фон — крупные светлые куски; остальное — «тело» замка. Тело делится на
комнаты и стены: узкие перешейки (дверные проёмы) рвём эрозией, куски с точкой комнаты из plans.json (или очень
толстые) — комнаты, прочие — стены; каждой точке тела достаётся кусок, к которому она ближе. Цифры номеров на скане
стираются и рисуются заново шрифтом. Цвета — как у достроенного подземелья (ui/plan.ts → schematic)."""
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PLANS = json.loads((ROOT / 'src/games/zakoldovannaya/data/plans.json').read_text(encoding='utf-8'))
OUT = ROOT / 'public/zakoldovannaya/plans'

# мутные сканы: тоньше разрез проёмов
TUNE = {'1.webp': {'cut': 7}}

# Части, где скан слишком мутный, — нарисованы вручную по скану и связям комнат (в единицах плана).
# box — что заменяем; body — контур постройки (стены); floors — полы комнат; doors — двери; secret — потайные «S».
def cells15() -> list[dict]:
    """Замок 15 — 21 одинаковая камера (31×41, стена 5) с лестницей в углу; стрелки входов остаются со скана."""
    out = []
    for y in (35, 89, 144):
        for x in (44, 79, 114, 149, 184, 219, 254):
            out.append({
                'box': (x - 1, y - 1, x + 33, y + 43),
                'body': [(x, y), (x + 31, y), (x + 31, y + 41), (x, y + 41)],
                'floors': [[(x + 5, y + 5), (x + 26, y + 5), (x + 26, y + 36), (x + 5, y + 36)]],
                'stairs': [(x + 17, y + 30, 9, 6)],
            })
    # стрелки: входы слева у 1, 8, 15 и лестницы 7↕14↕21 (со скана — кляксами, рисуем заново)
    out.append({'box': (20, 30, 44, 190), 'body': [], 'floors': [],
                'arrows': [(26, 56, 42, 56), (26, 110, 42, 110), (26, 165, 42, 165)]})
    out.append({'box': (256, 76, 282, 89), 'body': [], 'floors': [], 'arrows': [(265, 87, 265, 77), (273, 77, 273, 87)]})
    out.append({'box': (256, 130, 282, 144), 'body': [], 'floors': [], 'arrows': [(265, 142, 265, 132), (273, 132, 273, 142)]})
    return out


HAND = {
    '15.webp': cells15(),
    '1.webp': [{  # донжон первого замка
        'box': (110, 62, 223, 160),
        'body': [(112, 81), (165, 81), (165, 67), (205, 67), (205, 81), (221, 81), (221, 154), (112, 154)],
        'floors': [
            [(115, 85), (141, 85), (141, 100), (115, 100)],  # 13
            [(145, 85), (162, 85), (162, 100), (145, 100)],  # 14
            [(166, 85), (181, 85), (181, 100), (166, 100)],  # 15
            [(185, 71), (201, 71), (201, 85), (217, 85), (217, 101), (193, 101), (185, 95)],  # 16
            [(115, 105), (140, 105), (140, 122), (149, 135), (115, 135)],  # 7
            [(144, 105), (164, 105), (167, 113), (175, 121), (184, 125), (184, 138), (156, 138), (144, 121)],  # 12
            [(169, 105), (217, 105), (217, 116), (207, 116), (207, 124), (189, 124), (177, 120), (171, 112)],  # 11
            [(188, 128), (204, 128), (204, 139), (217, 139), (217, 151), (188, 151)],  # 10
            [(115, 139), (152, 139), (152, 151), (115, 151)],  # 8
            [(152, 142), (157, 142), (157, 150), (152, 150)],  # проход 8–9
            [(157, 141), (184, 141), (184, 151), (157, 151)],  # 9
        ],
        'doors': [(128, 83), (153.5, 83), (128, 102.5), (163.5, 92), (183, 90), (142, 113), (166, 109), (130, 137),
                  (168, 139.5), (186, 132), (196, 126), (165, 152.5), (219, 93), (219, 111)],
        'secret': [(143, 92), (175, 102.5), (205, 103)],
    }],
}

BG, WALL, ROOM, INK = '#e9dcbc', '#7a5636', '#cdbb92', '#3b2716'
ROOM_KINDS = {'room', 'tower', 'corridor'}


def segment(im: np.ndarray, seeds: list[tuple[int, int]], cut: int = 13, block: int = 41, sharpen: bool = False) -> np.ndarray:
    """0 — фон, 1 — стена, 2 — комната, 3 — тушь."""
    if sharpen:  # мутный скан: подчеркнуть тонкие линии
        im = cv2.addWeighted(im, 2.2, cv2.GaussianBlur(im, (0, 0), 3), -1.2, 0)
    b = cv2.GaussianBlur(im, (3, 3), 0)
    # светлота заливки скана (самый частый серый, не фон): по ней — чувствительность к туши
    hist = np.bincount(cv2.medianBlur(im, 9).ravel(), minlength=256)
    fill = int(np.argmax(hist[60:245])) + 60
    c = int(np.clip(0.4 * (255 - fill), 7, 22))
    ink = cv2.adaptiveThreshold(b, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, block, c)
    n, lab, st, _ = cv2.connectedComponentsWithStats(ink, 8)
    small = np.isin(lab, np.nonzero(st[:, 4] < 25)[0]) & (lab > 0)
    ink[small] = 0
    free = ink == 0
    bg = free & (cv2.medianBlur(im, 9) > 244)
    n, lab, st, _ = cv2.connectedComponentsWithStats(bg.astype(np.uint8), 4)
    bg = np.isin(lab, np.nonzero(st[:, 4] > 1500)[0]) & (lab > 0)
    solid = (free & ~bg).astype(np.uint8)
    er = cv2.erode(solid, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (cut, cut)))
    n, lab = cv2.connectedComponents(er, connectivity=4)
    dt = cv2.distanceTransform(solid, cv2.DIST_L2, 5)
    isroom = np.zeros(n, bool)
    H, W = im.shape
    for x, y in seeds:
        win = lab[max(0, y - 25):min(H, y + 26), max(0, x - 25):min(W, x + 26)]
        win = win[win > 0]
        if win.size:
            isroom[np.bincount(win).argmax()] = True
    mx = np.zeros(n)
    np.maximum.at(mx, lab.ravel(), dt.ravel())
    area = np.bincount(lab.ravel(), minlength=n)
    # полуширина стены этого скана — по длинным узким кускам (стены, галереи)
    long = [mx[i] for i in range(1, n) if area[i] > 400 and area[i] / max(mx[i], 1) ** 2 > 25]
    half = float(np.median(long)) if long else 12.0
    isroom |= mx > max(1.6 * half, 14)
    isroom[0] = False
    # каждой точке тела — кусок, до которого ближе, не переходя через тушь (растекаемся только по телу)
    piece = lab.astype(np.float32)
    body = solid > 0
    k3 = np.ones((3, 3), np.uint8)
    for _ in range(60):
        todo = body & (piece == 0)
        if not todo.any():
            break
        grown = cv2.dilate(piece, k3)
        piece[todo] = grown[todo]
    piece = piece.astype(np.int32)
    rooms = (solid > 0) & isroom[piece]
    cls = np.full(im.shape, 3, np.uint8)
    cls[bg] = 0
    cls[(solid > 0) & ~rooms] = 1
    cls[rooms] = 2
    return cls


def find_doors(im: np.ndarray, labels: list[tuple[float, float]] = ()) -> list[tuple[float, float, float]]:
    """Двери книги — колечки туши в проёмах: ищем маленькие светлые «дырки», со всех сторон обведённые тушью.
    Петли цифр («6», «8», «9», «0») — у подписей комнат, их пропускаем."""
    b = cv2.GaussianBlur(im, (3, 3), 0)
    ink = (cv2.adaptiveThreshold(b, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 15, 8) > 0).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(1 - ink, 4)
    out: list[tuple[float, float, float]] = []
    ring_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if not (2 <= a <= 110 and w <= 13 and h <= 13 and max(w, h) <= 2.2 * min(w, h)):
            continue
        cx, cy = cen[i]
        if any(abs(cx - lx) < 26 and abs(cy - ly) < 18 for lx, ly in labels):
            continue
        hole = (lab[max(0, y - 4):y + h + 4, max(0, x - 4):x + w + 4] == i).astype(np.uint8)
        ring = cv2.dilate(hole, ring_k) & (1 - hole)
        if ink[max(0, y - 4):y + h + 4, max(0, x - 4):x + w + 4][ring > 0].mean() < 0.72:
            continue
        if b[lab == i].mean() < 130:
            continue
        out.append((float(cx), float(cy), (w + h) / 4 + 2.5))
    return out


def castle_number(cls: np.ndarray, seeds: list[tuple[int, int]]) -> tuple[float, float, float] | None:
    """Крупный номер замка в углу листа: плотные знаки без комнат внутри, справа. Стираем — его наберём шрифтом.
    Вернёт (x, y, высота) в пикселях скана."""
    n, lab, st, _ = cv2.connectedComponentsWithStats((cls != 0).astype(np.uint8), 8)
    H, W = cls.shape
    cand = []
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if x < 0.5 * W or not (60 <= h <= 230) or w > 1.3 * h or a < 0.5 * w * h:
            continue
        if any(x <= sx < x + w and y <= sy < y + h for sx, sy in seeds):
            continue
        cand.append(i)
    if not cand:
        return None
    best = max(cand, key=lambda i: st[i, 3])
    group = [i for i in cand if abs(st[i, 1] - st[best, 1]) < 30 and abs((st[i, 0] + st[i, 2] / 2) - (st[best, 0] + st[best, 2] / 2)) < 160]
    x0 = min(st[i, 0] for i in group)
    x1 = max(st[i, 0] + st[i, 2] for i in group)
    y0 = min(st[i, 1] for i in group)
    y1 = max(st[i, 1] + st[i, 3] for i in group)
    for i in group:
        cls[lab == i] = 0
    return (x0 + x1) / 2, (y0 + y1) / 2, y1 - y0


def erase_numbers(cls: np.ndarray, labels: list[tuple[float, float]]) -> list[tuple[float, float] | None]:
    """Номер на скане — ближайшая к точке подписи группа мелких знаков, стоящих в ряд; её закрашиваем тем, что
    вокруг (номер потом набирается шрифтом). Значки «S» и прочее рядом не трогаем."""
    ink = (cls == 3).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(ink, 8)
    small = [i for i in range(1, n) if st[i, 2] <= 34 and st[i, 3] <= 40 and st[i, 4] >= 6]
    gone: set[int] = set()
    where: list[tuple[float, float] | None] = []
    for px, py in labels:
        near = [i for i in small if i not in gone and abs(cen[i][0] - px) < 75 and abs(cen[i][1] - py) < 45]
        if not near:
            where.append(None)
            continue
        first = min(near, key=lambda i: (cen[i][0] - px) ** 2 + 2 * (cen[i][1] - py) ** 2)
        group = [first]
        grew = True
        while grew:  # соседние цифры того же числа: рядом по горизонтали, на той же строке
            grew = False
            for i in near:
                if i in group:
                    continue
                if any(abs(cen[i][1] - cen[j][1]) < 8 and abs(cen[i][0] - cen[j][0]) < st[i, 2] / 2 + st[j, 2] / 2 + 9 for j in group):
                    group.append(i)
                    grew = True
        x0 = min(st[i, 0] for i in group)
        x1 = max(st[i, 0] + st[i, 2] for i in group)
        y0 = min(st[i, 1] for i in group)
        y1 = max(st[i, 1] + st[i, 3] for i in group)
        where.append(((x0 + x1) / 2, (y0 + y1) / 2))
        for i in group:
            x, y, w, h, _ = st[i]
            ring = cls[max(0, y - 6):y + h + 6, max(0, x - 6):x + w + 6]
            vals = ring[ring != 3]
            cls[lab == i] = np.bincount(vals, minlength=3).argmax() if vals.size else 2
            gone.add(i)
    return where


def polys(mask: np.ndarray, eps: float = 1.3, blur: int = 7) -> list[np.ndarray]:
    m = cv2.GaussianBlur(mask.astype(np.uint8) * 255, (blur, blur), 0) > 127
    cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cs:
        if cv2.contourArea(c) < 6:
            continue
        a = cv2.approxPolyDP(c, eps, True).reshape(-1, 2).astype(float)
        if len(a) >= 3:
            out.append(a)
    return out


AXIS = np.tan(np.radians(9))  # насколько косую стену считаем горизонтальной/вертикальной
MIN_EDGE = 9  # короче — это скругление башни или мелочь, не трогаем
TOL = 4  # координаты стен ближе этого (в пикселях скана) сводим к одной линии


def cluster(vals: list[tuple[float, float]]) -> list[float]:
    """Сгруппировать близкие координаты (значение, вес = длина) — для каждой вернуть общую (взвешенную) координату."""
    order = sorted(range(len(vals)), key=lambda i: vals[i][0])
    res = [0.0] * len(vals)
    group: list[int] = []

    def flush() -> None:
        if group:
            w = sum(vals[i][1] for i in group)
            v = sum(vals[i][0] * vals[i][1] for i in group) / w
            for i in group:
                res[i] = v

    for i in order:
        if group and vals[i][0] - vals[group[-1]][0] > TOL:
            flush()
            group = []
        group.append(i)
    flush()
    return res


def straighten(layers: list[list[np.ndarray]]) -> None:
    """Огрехи печати 1990 года: почти прямые стены — строго по осям, близкие линии стен разных комнат — на одну линию."""
    edges = []  # (слой, полигон, индекс ребра, ось 'h'|'v', координата, длина)
    for li, ps in enumerate(layers):
        for pi, p in enumerate(ps):
            n = len(p)
            for i in range(n):
                a, b = p[i], p[(i + 1) % n]
                dx, dy = abs(b[0] - a[0]), abs(b[1] - a[1])
                ln = float(np.hypot(dx, dy))
                if ln < MIN_EDGE:
                    continue
                # дуги башен не спрямляем: на концах ребра должен быть угол стены или продолжение прямой
                def turn(u, v):
                    c = np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-9)
                    return np.degrees(np.arccos(np.clip(c, -1, 1)))
                t0 = turn(a - p[i - 1], b - a)
                t1 = turn(b - a, p[(i + 2) % n] - b)
                if any(12 < t < 55 for t in (t0, t1)):
                    continue
                if dy <= AXIS * dx:
                    edges.append((li, pi, i, 'h', (a[1] + b[1]) / 2, ln))
                elif dx <= AXIS * dy:
                    edges.append((li, pi, i, 'v', (a[0] + b[0]) / 2, ln))
    for ax in ('h', 'v'):
        es = [e for e in edges if e[3] == ax]
        vals = cluster([(e[4], e[5]) for e in es])
        best: dict[tuple[int, int, int], tuple[float, float]] = {}  # вершина → (координата, длина ребра)
        for e, v in zip(es, vals):
            li, pi, i, _, _, ln = e
            n = len(layers[li][pi])
            for j in (i, (i + 1) % n):
                key = (li, pi, j)
                if key not in best or best[key][1] < ln:
                    best[key] = (v, ln)
        c = 1 if ax == 'h' else 0
        for (li, pi, j), (v, _) in best.items():
            layers[li][pi][j][c] = v


def path(ps: list[np.ndarray], k: float) -> str:
    out = []
    for p in ps:
        # одинаковые и лежащие на одной прямой вершины после выравнивания — убрать
        q = [p[i] for i in range(len(p)) if np.hypot(*(p[i] - p[i - 1])) > 0.5]
        if len(q) < 3:
            continue
        out.append('M' + 'L'.join(f'{x / k:.1f} {y / k:.1f}' for x, y in q) + 'Z')
    return ''.join(out)


def build(cid: str, idx: int, img: str) -> None:
    P = PLANS[cid]
    w, h = P['sizes'][idx]
    im = cv2.imread(str(OUT / img), cv2.IMREAD_GRAYSCALE)
    k = im.shape[1] / w
    rooms = [r for r in P['rooms'] if (r.get('img') or 0) == idx]
    seeds = [(int(r['x'] * k), int(r['y'] * k)) for r in rooms if r.get('kind') in ROOM_KINDS]
    numbered = [r for r in rooms if str(r['id'])[:1].isdigit()]
    cls = segment(im, seeds, **TUNE.get(img, {}))
    hand = HAND.get(img, [])
    for part in hand:
        x0, y0, x1, y1 = (int(v * k) for v in part['box'])
        cls[y0:y1, x0:x1] = 0
        sub = np.zeros_like(cls)
        if part['body']:
            cv2.fillPoly(sub, [np.array([(x * k, y * k) for x, y in part['body']], np.int32)], 1)
        for f in part['floors']:
            cv2.fillPoly(sub, [np.array([(x * k, y * k) for x, y in f], np.int32)], 2)
        cls[y0:y1, x0:x1] = sub[y0:y1, x0:x1]
    big = castle_number(cls, [(int(r['x'] * k), int(r['y'] * k)) for r in rooms])
    doors = find_doors(im, [(r['x'] * k, r['y'] * k) for r in numbered])
    for part in hand:
        bx0, by0, bx1, by1 = (v * k for v in part['box'])
        doors = [d for d in doors if not (bx0 <= d[0] <= bx1 and by0 <= d[1] <= by1)] + [(x * k, y * k, 2.2 * k) for x, y in part.get('doors', [])]
    for x, y, r in doors:
        # проём с дверью — сплошная стена, сама дверь рисуется кружком поверх
        cv2.circle(cls, (int(x), int(y)), int(r + 3), 1, -1)
    spots = erase_numbers(cls, [(r['x'] * k, r['y'] * k) for r in numbered])
    # номер набирается там, где он стоял на скане (иначе и в нарисованных вручную частях — в точке комнаты)
    def handmade(r: dict) -> bool:
        return any(p['box'][0] <= r['x'] <= p['box'][2] and p['box'][1] <= r['y'] <= p['box'][3] for p in HAND.get(img, []))
    numbered = [{**r, 'x': (sp[0] / k if sp and not handmade(r) else r['x']), 'y': (sp[1] / k if sp and not handmade(r) else r['y'])} for r, sp in zip(numbered, spots)]
    # длинные обводки туши — часть стены (края задаёт ровная обводка), тушью остаются только значки: двери, «S», ловушки
    marks = np.zeros(cls.shape, bool)
    n, lab, st, _ = cv2.connectedComponentsWithStats((cls == 3).astype(np.uint8), 8)
    for i in range(1, n):
        x, y, bw, bh, a = st[i]
        if max(bw, bh) >= 70:
            continue
        ring = cls[max(0, y - 4):y + bh + 4, max(0, x - 4):x + bw + 4]
        vals = ring[ring != 3]
        around = int(np.bincount(vals, minlength=3).argmax()) if vals.size else 1
        if a < 20:
            cls[lab == i] = around  # соринка — под цвет окружения, без дырок в заливке
            continue
        # чёрточки внутри стены — шум скана
        if (ring == 1).mean() > 0.6:
            cls[lab == i] = around
            continue
        marks |= lab == i
    body_p, room_p = polys(cls != 0, 2.0), polys(cls == 2, 2.0)
    straighten([body_p, room_p])
    ink_p = polys(marks, 0.6, 3)
    body, room, ink = path(body_p, k), path(room_p, k), path(ink_p, k)
    if PREVIEW:
        preview(Path(PREVIEW) / f'{Path(img).stem}.png', cls.shape, [(body_p, WALL), (room_p, ROOM), (ink_p, INK)], doors, numbered, k, big, cid[1:])
    door_svg = ''.join(f'<circle cx="{x / k:.1f}" cy="{y / k:.1f}" r="{max(1.6, r / k):.1f}"/>' for x, y, r in doors)
    title = ''
    if big:
        fs = big[2] / k * 1.05
        title = (f'<text x="{big[0] / k:.1f}" y="{big[1] / k + fs * 0.36:.1f}" font-family="Georgia, PT Serif, serif" font-weight="700" '
                 f'font-size="{fs:.1f}" text-anchor="middle" fill="{WALL}" stroke="{INK}" stroke-width="1.2" paint-order="stroke">{cid[1:]}</text>')
    secret = ''.join(f'<text x="{x}" y="{y + 2.5}">S</text>' for part in hand for x, y in part.get('secret', []))
    def arrow(x1, y1, x2, y2):
        d = np.array([x2 - x1, y2 - y1], float)
        d /= np.linalg.norm(d)
        nx, ny = -d[1], d[0]
        hx, hy = x2 - d[0] * 4, y2 - d[1] * 4
        return (f'<line x1="{x1}" y1="{y1}" x2="{hx:.1f}" y2="{hy:.1f}" stroke="{INK}" stroke-width="1.6"/>'
                f'<path d="M{x2} {y2}L{hx + nx * 2.4:.1f} {hy + ny * 2.4:.1f}L{hx - nx * 2.4:.1f} {hy - ny * 2.4:.1f}Z" fill="{INK}"/>')
    arrows = ''.join(arrow(*a) for part in hand for a in part.get('arrows', []))
    # лестница — ступеньки поперёк
    stairs = ''.join(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{INK}"/>' + ''.join(f'<line x1="{x + i}" y1="{y + .6}" x2="{x + i}" y2="{y + h - .6}"/>' for i in np.arange(1.5, w, 1.5))
                     for part in hand for x, y, w, h in part.get('stairs', []))
    nums = ''.join(f'<text x="{r["x"]}" y="{r["y"] + 4}">{r["id"]}</text>' for r in numbered)
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">'
        f'<rect width="{w}" height="{h}" fill="{BG}"/>'
        f'<path d="{body}" fill="{WALL}" fill-rule="evenodd" stroke="{INK}" stroke-width="1.1" stroke-linejoin="round"/>'
        f'<path d="{room}" fill="{ROOM}" fill-rule="evenodd" stroke="{INK}" stroke-width=".9" stroke-linejoin="round"/>'
        f'<path d="{ink}" fill="{INK}" fill-rule="evenodd"/>'
        f'<g fill="{ROOM}" stroke="{INK}" stroke-width=".8">{door_svg}</g>'
        f'<g font-family="PT Sans, Arial, sans-serif" font-weight="700" font-size="11" text-anchor="middle" fill="#2b1a0e">{nums}</g>'
        f'<g font-family="PT Serif, Georgia, serif" font-weight="700" font-style="italic" font-size="8" text-anchor="middle" fill="{INK}">{secret}</g>'
        f'<g stroke="{ROOM}" stroke-width=".5">{stairs}</g>{arrows}'
        f'{title}'
        '</svg>'
    )
    name = Path(img).stem + '.svg'
    (OUT / name).write_text(svg, encoding='utf-8')
    print(cid, name, f'{len(svg) // 1024} КБ')


PREVIEW = os.environ.get('ZS_PREVIEW')  # папка: заодно нарисовать PNG для просмотра (без браузера)


def preview(out: Path, shape: tuple[int, int], layers, doors, numbered, k: float, big=None, title_text: str = '') -> None:
    def bgr(c: str) -> tuple[int, int, int]:
        return int(c[5:7], 16), int(c[3:5], 16), int(c[1:3], 16)

    img = np.zeros((*shape, 3), np.uint8)
    img[:] = bgr(BG)
    for ps, col in layers:
        m = np.zeros(shape, np.uint8)
        for p in ps:  # чёт-нечет: дырки вычитаются
            one = np.zeros(shape, np.uint8)
            cv2.fillPoly(one, [p.astype(np.int32)], 1)
            m ^= one
        img[m > 0] = bgr(col)
        if col != INK:
            cv2.polylines(img, [p.astype(np.int32) for p in ps], True, bgr(INK), 2, cv2.LINE_AA)
    for x, y, r in doors:
        cv2.circle(img, (int(x), int(y)), int(max(1.6, r / k) * k), bgr(ROOM), -1, cv2.LINE_AA)
        cv2.circle(img, (int(x), int(y)), int(max(1.6, r / k) * k), bgr(INK), 2, cv2.LINE_AA)
    for r in numbered:
        t = str(r['id'])
        (tw, th), _ = cv2.getTextSize(t, cv2.FONT_HERSHEY_DUPLEX, 0.9, 2)
        cv2.putText(img, t, (int(r['x'] * k - tw / 2), int(r['y'] * k + th / 2)), cv2.FONT_HERSHEY_DUPLEX, 0.9, (14, 26, 43), 2, cv2.LINE_AA)
    if big:
        sc = big[2] / 30
        (tw, th), _ = cv2.getTextSize(title_text, cv2.FONT_HERSHEY_TRIPLEX, sc, 4)
        cv2.putText(img, title_text, (int(big[0] - tw / 2), int(big[1] + th / 2)), cv2.FONT_HERSHEY_TRIPLEX, sc, bgr(INK), 4, cv2.LINE_AA)
    cv2.imwrite(str(out), img)


def main() -> None:
    ids = sys.argv[1:] or list(PLANS)
    for cid in ids:
        for i, img in enumerate(PLANS[cid]['images']):
            if img:
                build(cid, i, img)


if __name__ == '__main__':
    main()
