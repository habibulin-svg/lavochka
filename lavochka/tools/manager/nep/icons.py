# Иконки клеток с выпрямленного фото поля (full1.png, 2000×2000, угол 277): каждая клетка — в положении «нижнего ряда»
# (внутренняя сторона сверху), иконка — последний по высоте блок непустых строк. Выход: icons/<i>.png с прозрачностью.
import cv2, numpy as np, os, sys
src = sys.argv[1] if len(sys.argv) > 1 else 'D:/temp/nep/full1c.png'
out = 'D:/temp/nep/icons'; os.makedirs(out, exist_ok=True)
F = cv2.imread(src)
S = 2000; C = 277; w = (S - 2 * C) / 9

def tile(i):
    """клетка i (0..39) в ориентации нижнего ряда: ширина w, высота C, внутренняя сторона сверху."""
    side, k = divmod(i, 10)
    if k == 0: return None
    if side == 0:   # левый столбец, снизу вверх: x 0..C, y от S-C вверх
        y1 = S - C - (k - 1) * w; y0 = y1 - w
        t = F[int(y0):int(y1), 0:C]; return cv2.rotate(t, cv2.ROTATE_90_COUNTERCLOCKWISE)
    if side == 1:   # верхний ряд, слева направо
        x0 = C + (k - 1) * w; t = F[0:C, int(x0):int(x0 + w)]; return cv2.rotate(t, cv2.ROTATE_180)
    if side == 2:   # правый столбец, сверху вниз
        y0 = C + (k - 1) * w; t = F[int(y0):int(y0 + w), S - C:S]; return cv2.rotate(t, cv2.ROTATE_90_CLOCKWISE)
    x1 = S - C - (k - 1) * w; t = F[S - C:S, int(x1 - w):int(x1)]; return t

def extract(t, y_from, y_to=None):
    t = t.astype(np.float32)
    h, ww = t.shape[:2]
    pad = 10
    bgpix = np.concatenate([t[int(y_from):h - pad, pad:pad + 6].reshape(-1, 3), t[int(y_from):h - pad, ww - pad - 6:ww - pad].reshape(-1, 3)])
    bg = np.median(bgpix, 0)
    d = np.abs(t - bg).max(2)
    m = (d > 38).astype(np.uint8)
    m[:int(y_from)] = 0; m[:, :pad] = 0; m[:, ww - pad:] = 0; m[int(y_to or h - pad):] = 0
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    keep = np.zeros_like(m)
    for j in range(1, n):
        if st[j, cv2.CC_STAT_AREA] > 25: keep[lab == j] = 1
    ys, xs = np.where(keep)
    if len(ys) == 0: return None, bg
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    m2 = 4
    y0 = max(0, y0 - m2); x0 = max(0, x0 - m2); y1 = min(h, y1 + m2); x1 = min(ww, x1 + m2)
    crop = t[y0:y1, x0:x1]
    a = np.clip((np.abs(crop - bg).max(2) - 14) / 46, 0, 1)
    a = cv2.GaussianBlur(a, (0, 0), 0.6)
    col = (crop - (1 - a[..., None]) * bg) / np.maximum(a[..., None], 0.05)
    col = np.clip(col, 0, 255)
    rgba = np.dstack([col, a * 255]).astype(np.uint8)
    return rgba, bg

# откуда искать иконку (доля высоты клетки): ниже текста
Y = {}
for i in range(40):
    Y[i] = 0.52
for i in (1, 5, 13, 25, 33, 35): Y[i] = 0.30          # Шанс/Лотерея: одна строка
for i in (8, 18, 28, 38, 3, 36): Y[i] = 0.55           # порт, налог: три строки
for i in (15, 23): Y[i] = 0.45
BOT = {37: 0.86, 38: 0.87}
for i in range(40):
    t = tile(i)
    if t is None: continue
    cv2.imwrite(f'{out}/t{i:02d}.png', t)
    yf = Y[i] * C
    if i % 10 not in (0,) and i not in (8, 18, 28, 38, 3, 36):
        hsv = cv2.cvtColor(t, cv2.COLOR_BGR2HSV)
        dark = ((hsv[..., 2] < 110) & (hsv[..., 1] < 90))[:, 15:-15]
        rows = np.where(dark[int(0.15 * C):int(0.62 * C)].sum(1) >= 2)[0]
        if len(rows): yf = int(0.15 * C) + rows.max() + 4
    if i in (17, 27, 39): yf = 0.52 * C
    if i == 23: yf = 0.45 * C
    if i == 14: yf = 0.472 * C
    print(i, round(yf / C, 2))
    rgba, bg = extract(t, yf, BOT.get(i, 0) * C or None)
    if rgba is not None: cv2.imwrite(f'{out}/{i:02d}.png', rgba)
