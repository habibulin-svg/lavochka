"""Проверка графа «Звезды Африки» по скану: расстояние ВДОЛЬ дороги между соседними точками.

Строим маску дорог (белые полосы суши; море и синие линии сюда не входят) на уменьшенной копии,
затем от каждой клетки пускаем волну по маске и смотрим, какие клетки достижимы и за сколько шагов
(в пикселях карты). Если вдоль дороги ближе 1.35 × расстояния по прямой — значит, точки соединены
дорогой. Сравниваем с рёбрами из path.json.

Запуск:  python -I tools/hodilki/star-check.py   (пишет отчёт в %TEMP%/star-check.txt)
"""
import json
import math
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(ROOT, 'materials', 'nastolki', 'zvezda-afriki')
SCALE = 4            # во сколько раз уменьшаем скан для волны
NEAR = 320.0         # какие пары вообще проверяем (в пикселях карты)
K = 1.4              # допуск: вдоль дороги не дальше, чем K × по прямой


def road_mask(im):
    """Дороги: белые полосы суши. Розовые квадраты жетонов тоже проходимы — дорога идёт под ними."""
    a = np.asarray(im.convert('RGB')).astype(np.int16)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mn = a.min(axis=2)
    mx = a.max(axis=2)
    white = (mn > 168) & ((mx - mn) < 62)
    pink = (r > 190) & (b > 90) & (g < 120) & (r - g > 90)
    # квадраты чуть расширяем: между квадратом и дорогой есть тёмная обводка
    grow = pink.copy()
    for _ in range(6):
        g2 = grow.copy()
        g2[1:, :] |= grow[:-1, :]
        g2[:-1, :] |= grow[1:, :]
        g2[:, 1:] |= grow[:, :-1]
        g2[:, :-1] |= grow[:, 1:]
        grow = g2
    return white | grow


def wave(mask, cx, cy, rad):
    """Волна по маске от точки: массив «за сколько шагов достигли» (в пикселях уменьшенной копии)."""
    y0, y1 = max(0, cy - rad), min(mask.shape[0], cy + rad + 1)
    x0, x1 = max(0, cx - rad), min(mask.shape[1], cx + rad + 1)
    sub = mask[y0:y1, x0:x1]
    seen = np.zeros_like(sub)
    if not (0 <= cy - y0 < sub.shape[0] and 0 <= cx - x0 < sub.shape[1]) or not sub[cy - y0, cx - x0]:
        # точка попала на чёрный кружок или мимо дороги — берём ближайшую дорожную клетку рядом
        ys, xs = np.nonzero(sub)
        if not len(ys):
            return None, (y0, x0)
        d = (ys - (cy - y0)) ** 2 + (xs - (cx - x0)) ** 2
        i = int(np.argmin(d))
        seen[ys[i], xs[i]] = True
    else:
        seen[cy - y0, cx - x0] = True
    dist = np.zeros_like(sub, dtype=np.int16)
    step = 0
    while seen.any() and step < rad * 2:
        step += 1
        grow = np.zeros_like(seen)
        grow[1:, :] |= seen[:-1, :]
        grow[:-1, :] |= seen[1:, :]
        grow[:, 1:] |= seen[:, :-1]
        grow[:, :-1] |= seen[:, 1:]
        grow[1:, 1:] |= seen[:-1, :-1]
        grow[:-1, :-1] |= seen[1:, 1:]
        grow[1:, :-1] |= seen[:-1, 1:]
        grow[:-1, 1:] |= seen[1:, :-1]
        grow &= sub
        grow &= ~seen
        if not grow.any():
            break
        dist[grow] = step
        seen |= grow
    return dist, (y0, x0)


def main():
    # сверяем то, что реально играет: собранные данные (path.json + поправки tools/hodilki/star.py)
    built = os.path.join(ROOT, 'lavochka', 'src', 'games', 'star', 'data.json')
    d = json.load(open(built, encoding='utf8')) if os.path.exists(built) else json.load(open(os.path.join(SRC, 'path.json'), encoding='utf8'))
    cells = d['cells']
    byid = {c['id']: c for c in cells}
    im = Image.open(os.path.join(SRC, 'field.webp')).convert('RGB')
    W, H = im.size
    small = im.resize((W // SCALE, H // SCALE), Image.BOX)
    mask = road_mask(small)
    edges = set()
    for c in cells:
        for nb in c.get('next', []):
            edges.add(frozenset((c['id'], nb)))
    rad = int(NEAR / SCALE / 2) + 6
    missing, extra = [], []
    for c in cells:
        cx, cy = int(c['x'] / SCALE), int(c['y'] / SCALE)
        dist, (y0, x0) = wave(mask, cx, cy, rad)
        if dist is None:
            continue
        for o in cells:
            if o['id'] == c['id']:
                continue
            eu = math.hypot(o['x'] - c['x'], o['y'] - c['y'])
            if eu > NEAR or eu < 1:
                continue
            ox, oy = int(o['x'] / SCALE) - x0, int(o['y'] / SCALE) - y0
            if not (0 <= ox < dist.shape[1] and 0 <= oy < dist.shape[0]):
                continue
            # достижимость: сама точка или клетка рядом с ней (кружки на карте закрывают дорогу)
            near = dist[max(0, oy - 2):oy + 3, max(0, ox - 2):ox + 3]
            vals = near[near > 0]
            if not len(vals):
                continue
            geo = float(vals.min()) * SCALE
            if geo <= K * eu:
                if frozenset((c['id'], o['id'])) not in edges:
                    missing.append((round(eu), c['id'], o['id']))
            elif eu < 190 and frozenset((c['id'], o['id'])) in edges:
                extra.append((round(eu), c['id'], o['id'], round(geo)))
    # убираем дубли
    missing = sorted(set((a, tuple(sorted((b, e)))) for a, b, e in missing))
    extra = sorted(set((a, tuple(sorted((b, e))), g) for a, b, e, g in extra))
    out = ['клеток %d, рёбер %d' % (len(cells), len(edges)), '']
    out.append('ПРОПУЩЕНО (дорога есть, ребра нет) — %d:' % len(missing))
    for m in missing:
        out.append('   %s' % (m,))
    out.append('')
    out.append('СОМНИТЕЛЬНО (ребро есть, дороги вдоль не видно) — %d:' % len(extra))
    for m in extra:
        out.append('   %s' % (m,))
    p = os.path.join(os.environ['TEMP'], 'star-check.txt')
    open(p, 'w', encoding='utf8').write('\n'.join(out))
    print(p)


if __name__ == '__main__':
    main()
