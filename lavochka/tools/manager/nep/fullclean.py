# Затирает два сгиба (крест через середину) на выпрямленном фото всего поля.
import cv2, numpy as np
F = cv2.imread('D:/temp/nep/full1.png'); S = 2000
def crease(img, vertical, c0, c1):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    if not vertical: g = g.T
    hp = np.abs(g - cv2.blur(g, (31, 1)))
    hp = cv2.blur(hp, (1, 41))
    ys = np.arange(20, S - 20, 4)
    xs = np.array([c0 + np.argmax(hp[y, c0:c1]) for y in ys])
    p = np.polyfit(ys, xs, 2)
    for _ in range(3):
        res = np.abs(np.polyval(p, ys) - xs); keep = res < 3
        p = np.polyfit(ys[keep], xs[keep], 2)
    m = np.zeros((S, S), np.uint8)
    for y in range(S):
        x = int(round(np.polyval(p, y))); m[y, max(0, x - 6):x + 7] = 255
    print('line', vertical, np.polyval(p, [0, 1000, 2000]))
    return m if vertical else m.T
m = cv2.max(crease(F, True, 975, 1025), crease(F, False, 975, 1025))
cv2.imwrite('D:/temp/nep/full1c.png', cv2.inpaint(F, m, 5, cv2.INPAINT_TELEA))
