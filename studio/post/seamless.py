"""Сделать текстуру бесшовной без «призраков»: резка по шву с наименьшей разницей (texture quilting), а не смесь.

python studio/post/seamless.py <вход.png> <выход.png> [размер, px]

Прежняя версия смешивала картинку с копией, сдвинутой на полпериода: где веса равны, кирпичи и шины проступали дважды,
полупрозрачно (жалоба пользователя 2026-11-02). Теперь каждый пиксель берётся ровно из одной копии:
1) по x: копия, сдвинутая на w/2, бесшовна по краям, но рвётся посередине — полосу посередине берём из исходника,
   границы полосы — вертикальные пути наименьшей разницы (динамика);
2) по y — то же для результата шага 1; горизонтальные пути начинаются и кончаются на одной высоте, чтобы шов
   не рвался на стыке плиток слева-направо.
"""
import sys

import numpy as np
from PIL import Image

BAND = 0.11   # полуширина полосы замены — доля стороны
GAP = 6       # путь не подходит к самому разрыву ближе, px


def cut_path(cost: np.ndarray, wrap: bool = False) -> np.ndarray:
    """Путь сверху вниз по cost (h × k): по строке — номер столбца, шаг ±1. wrap — конец там же, где начало."""
    h, k = cost.shape

    def run(start: int | None):
        acc = np.full((h, k), np.inf)
        back = np.zeros((h, k), dtype=np.int8)
        if start is None:
            acc[0] = cost[0]
        else:
            acc[0, start] = cost[0, start]
        for y in range(1, h):
            prev = acc[y - 1]
            opts = np.stack([np.r_[np.inf, prev[:-1]], prev, np.r_[prev[1:], np.inf]])
            j = np.argmin(opts, axis=0)
            acc[y] = cost[y] + opts[j, np.arange(k)]
            back[y] = j - 1
        end = start if start is not None else int(np.argmin(acc[-1]))
        if not np.isfinite(acc[-1, end]):
            return np.inf, None
        path = np.zeros(h, dtype=int)
        path[-1] = end
        for y in range(h - 1, 0, -1):
            path[y - 1] = path[y] + back[y, path[y]]
        return acc[-1, end], path

    if not wrap:
        return run(None)[1]
    best = (np.inf, None)
    for s in range(0, k, 2):
        best = min(best, run(s), key=lambda t: t[0])
    return best[1]


def edges(img: np.ndarray) -> np.ndarray:
    g = img.mean(axis=2)
    gx = np.abs(np.diff(g, axis=1, append=g[:, -1:]))
    gy = np.abs(np.diff(g, axis=0, append=g[-1:]))
    return (gx + gy) ** 2


def fix_vertical(base: np.ndarray, patch: np.ndarray, wrap: bool) -> np.ndarray:
    """В base разрыв по столбцу w/2: полосу вокруг него берём из patch, границы — по путям наименьшей разницы."""
    h, w, _ = base.shape
    c, b = w // 2, int(w * BAND)
    # цена шва: разница копий плюс края предметов в обеих (шов идёт по ровной земле, а не режет кирпич пополам)
    diff = ((base - patch) ** 2).sum(axis=2) + 4 * (edges(base) + edges(patch))
    left = cut_path(diff[:, c - b:c - GAP], wrap) + (c - b)
    right = cut_path(diff[:, c + GAP:c + b], wrap) + (c + GAP)
    out = base.copy()
    for y in range(h):
        out[y, left[y]:right[y] + 1] = patch[y, left[y]:right[y] + 1]
    return out


def seamless(img: np.ndarray) -> np.ndarray:
    h, w, _ = img.shape
    # шаг 1 — по горизонтали: сдвинутая копия, разрыв посередине — из исходника
    horiz = fix_vertical(np.roll(img, w // 2, axis=1), img, wrap=False)
    # шаг 2 — по вертикали: то же на транспонированной картинке; путь замкнут, иначе шов рвётся на стыке слева-справа
    t = horiz.transpose(1, 0, 2)
    vert = fix_vertical(np.roll(t, h // 2, axis=1), t, wrap=True)
    return vert.transpose(1, 0, 2)


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 512
    img = np.asarray(Image.open(src).convert('RGB').resize((size, size), Image.LANCZOS), dtype=np.float32)
    Image.fromarray(seamless(img).clip(0, 255).astype(np.uint8)).save(dst)
    print(dst)
