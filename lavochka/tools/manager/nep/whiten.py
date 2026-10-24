# Каёмка центра (белая полоса с подписями отраслей) — отбелить до цвета клеток, надписи оставить чёрными.
# Граница каёмки с картинкой ищется по каждой строке/столбцу (первый насыщенный пиксель), сглаживается и делается чёткой.
import cv2, numpy as np
src = cv2.imread('D:/temp/nep/center_before_white.png')
c = src.astype(np.float32)
W = c.shape[0]
PAPER = np.array([234, 243, 246], np.float32)  # BGR, как клетки поля
INK = np.array([30, 28, 28], np.float32)
sat = cv2.cvtColor(src, cv2.COLOR_BGR2HSV)[..., 1].astype(np.float32)
lum = cv2.cvtColor(src, cv2.COLOR_BGR2GRAY).astype(np.float32)


def edge(prof2d):
    """prof2d: [длина стороны, глубина от края] — где начинается картинка (насыщенность > 90), сглажено медианой."""
    hit = prof2d > 90
    # картинка — подряд 5 насыщенных пикселей (тёмные буквы каёмки тоже бывают насыщенными)
    run = hit.copy()
    for k in range(1, 5):
        run[:, :-k] &= hit[:, k:]
    hit = run
    hit[:, :28] = False
    pos = np.where(hit.any(1), hit.argmax(1), 40).astype(np.float32)
    pos = np.clip(pos, 25, 48)
    # прямая линия по устойчивой подгонке: край каёмки на поле — прямой
    xs_ = np.arange(len(pos)); ok = (pos > 28) & (pos < 48)
    p = np.polyfit(xs_[ok], pos[ok], 1)
    for _ in range(4):
        ok &= np.abs(np.polyval(p, xs_) - pos) < 3
        p = np.polyfit(xs_[ok], pos[ok], 1)
    return np.polyval(p, xs_) + 0.5


top = edge(sat[:60, :].T)
bot = edge(sat[::-1][:60, :].T)
left = edge(sat[:, :60])
right = edge(sat[:, ::-1][:, :60])
ys, xs = np.mgrid[0:W, 0:W].astype(np.float32)
# расстояние «внутрь» от края каёмки (отрицательное — каёмка), по ближайшей стороне
inside = np.minimum.reduce([ys - top[xs.astype(int)], (W - 1 - ys) - bot[xs.astype(int)], xs - left[ys.astype(int)], (W - 1 - xs) - right[ys.astype(int)]])
m = np.clip(0.5 - inside / 1.2, 0, 1)  # 1 — каёмка, чёткий край в 1–2 пикселя

bg = cv2.morphologyEx(lum, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
bg = cv2.GaussianBlur(bg, (0, 0), 6)
t = np.clip((bg - lum - 28) / np.maximum(bg - 45 - 28, 30) * 1.3, 0, 1)
# сгибы поперёк каёмки — не буквы
cr = ((np.abs(xs - 731) < 6) & ((ys < 60) | (ys > W - 60))) | ((np.abs(ys - 729) < 6) & ((xs < 60) | (xs > W - 60)))
t[cr & (t < 0.4)] = 0
t[1426:1450, 333:339] = 0  # пятнышко на фото между «изделия» и «Фаберже»
# у самой границы с картинкой букв нет — там только размытый край фото
t *= np.clip((-inside - 3) / 3, 0, 1)
out_band = PAPER * (1 - t[..., None]) + INK * t[..., None]
out = c * (1 - m[..., None]) + out_band * m[..., None]
# «Т» в «КОНЕВОДСТВО» на фото выцвела — усилить
r = out[1424:1452, 1278:1300]
lr = r.mean(2)
t2 = np.clip((238 - lr) / 45, 0, 1)[..., None]
out[1424:1452, 1278:1300] = PAPER * (1 - t2) + INK * t2
# «КОММЕРЧЕСКИЙ ЕСТОРАН»: «Р» на поле не пропечаталась — копия «Р» из того же слова на пустое место
out[390:411, 3:34] = out[508:529, 3:34].copy()
o8 = np.clip(out, 0, 255).astype(np.uint8)
cv2.imwrite('D:/temp/nep/center.png', o8)
