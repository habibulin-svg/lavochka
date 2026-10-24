# Иконки четырёх углов: насыщенные пиксели → область (закрытие), внутри — всё, что отличается от фона.
import cv2, numpy as np
F = cv2.imread('D:/temp/nep/full1c.png').astype(np.float32); C = 277
boxes = {'tl': (0, 0), 'tr': (2000 - C, 0), 'br': (2000 - C, 2000 - C), 'bl': (0, 2000 - C)}
for k, (x, y) in boxes.items():
    t = F[y:y + C, x:x + C]
    pad = 12
    bg = np.median(np.concatenate([t[pad:pad + 8, pad:-pad].reshape(-1, 3), t[-pad - 8:-pad, pad:-pad].reshape(-1, 3)]), 0)
    hsv = cv2.cvtColor(np.clip(t, 0, 255).astype(np.uint8), cv2.COLOR_BGR2HSV)
    sat = ((hsv[..., 1] > 70) & (hsv[..., 2] > 60)).astype(np.uint8)
    sat[:pad] = sat[-pad:] = 0; sat[:, :pad] = sat[:, -pad:] = 0
    reg = cv2.morphologyEx(sat, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17)))
    n, lab, st, _ = cv2.connectedComponentsWithStats(reg)
    j = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
    reg = (lab == j).astype(np.uint8)
    reg = cv2.dilate(reg, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    d = np.abs(t - bg).max(2)
    a = np.clip((d - 14) / 46, 0, 1) * reg
    ys, xs = np.where(a > 0.05)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    a = cv2.GaussianBlur(a, (0, 0), 0.6)[y0:y1, x0:x1]
    crop = t[y0:y1, x0:x1]
    col = np.clip((crop - (1 - a[..., None]) * bg) / np.maximum(a[..., None], 0.05), 0, 255)
    cv2.imwrite(f'D:/temp/nep/icons/c_{k}.png', np.dstack([col, a * 255]).astype(np.uint8))
    print(k, 'box', x0, y0, x1, y1)
