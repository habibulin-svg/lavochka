# «Начало» — в правый нижний угол (решение пользователя): кольцо клеток повёрнуто на 90° против часовой,
# поэтому и каёмку центра с подписями отраслей поворачиваем так же, а картинку внутри каёмки оставляем прямой.
# center.png → center_r.png (запускать после whiten.py, перед render.py).
import cv2, numpy as np

src = cv2.imread('D:/temp/nep/center.png')
W = src.shape[0]
PAPER = np.array([234, 243, 246], np.uint8)  # BGR, как клетки поля
sat = cv2.cvtColor(src, cv2.COLOR_BGR2HSV)[..., 1].astype(np.float32)


def edge(prof2d):
    """где по глубине от края начинается картинка (подряд 5 насыщенных пикселей) — медиана по стороне"""
    hit = prof2d > 90
    run = hit.copy()
    for k in range(1, 5):
        run[:, :-k] &= hit[:, k:]
    pos = np.where(run.any(1), run.argmax(1), 0)
    return int(np.median(pos[pos > 20]))


t, b = edge(sat[:80, :].T), edge(sat[::-1][:80, :].T)
l, r = edge(sat[:, :80]), edge(sat[:, ::-1][:, :80])
B = max(t, b, l, r) + 1
print('каёмка: верх', t, 'низ', b, 'лево', l, 'право', r, '->', B)

# каёмка: повёрнутая на 90° против часовой, всё, что глубже её края, — бумага
band = np.rot90(src).copy()
nt, nb, nl, nr = r, l, t, b  # края после поворота: правая сторона стала верхней и т. д.
ys, xs = np.mgrid[0:W, 0:W]
pic = (ys >= nt) & (ys < W - nb) & (xs >= nl) & (xs < W - nr)
band[pic] = PAPER
# картинка — прямая, растянута на одинаковую каёмку B со всех сторон (сдвиг — пара пикселей)
inner = cv2.resize(src[t:W - b, l:W - r], (W - 2 * B, W - 2 * B), interpolation=cv2.INTER_AREA)
band[B:W - B, B:W - B] = inner
cv2.imwrite('D:/temp/nep/center_r.png', band)
