# Центр поля НЭП: основа — photo (1) (c1), машина — photo.jpg (c0), под карточками — pikabu (c2); сгибы затираются.
import cv2, numpy as np
W = 1460
c1 = cv2.imread('D:/temp/nep/c1.png').astype(np.float32)
c0 = cv2.imread('D:/temp/nep/c0.png').astype(np.float32)
c2 = cv2.imread('D:/temp/nep/c2.png').astype(np.float32)

def poly(pts, grow):
    m = np.zeros((W, W), np.uint8)
    cv2.fillPoly(m, [np.int32(np.array(pts) * 2)], 255)
    if grow: m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1)))
    return m

shans = poly([(372, 215), (440, 150), (577, 292), (505, 360)], 14)
lot = poly([(130, 445), (200, 382), (345, 520), (275, 590)], 14)
dice = poly([(535, 450), (585, 425), (645, 470), (600, 535), (546, 528)], 12)
deed = poly([(538, 572), (682, 557), (692, 672), (546, 686)], 10)
car = cv2.max(dice, deed)
cards = cv2.max(shans, lot)
occl = cv2.max(car, cards)

# --- сгибы: найти линию по рядам/столбцам и затереть
def crease(img, vertical):
    g = cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    if not vertical: g = g.T
    hp = np.abs(g - cv2.blur(g, (31, 1)))
    hp = cv2.blur(hp, (1, 41))
    ys = np.arange(60, W - 60, 4)
    xs = np.array([715 + np.argmax(hp[y, 715:752]) for y in ys])
    p = np.polyfit(ys, xs, 2)
    res = np.abs(np.polyval(p, ys) - xs); keep = res < 3
    p = np.polyfit(ys[keep], xs[keep], 2)
    m = np.zeros((W, W), np.uint8)
    for y in range(W):
        x = int(round(np.polyval(p, y))); m[y, max(0, x - 6):x + 7] = 255
    return m if vertical else m.T

cm = cv2.max(crease(c1, True), crease(c1, False))

# --- подгонка цвета: глобальная матрица 3×4 + плавная поправка освещения
def match(src, ref, bad):
    a = cv2.GaussianBlur(src, (0, 0), 4); b = cv2.GaussianBlur(ref, (0, 0), 4)
    ok = (bad == 0)
    ok[:50, :] = ok[-50:, :] = ok[:, :50] = ok[:, -50:] = False
    ok[::1] &= (np.random.RandomState(1).rand(W, W) < 0.05)
    X = np.c_[a[ok], np.ones(ok.sum())]; Y = b[ok]
    M, *_ = np.linalg.lstsq(X, Y, rcond=None)
    out = (np.c_[src.reshape(-1, 3), np.ones(W * W)] @ M).reshape(W, W, 3)
    # низкочастотная поправка по маске (нормированная свёртка)
    wgt = ((bad == 0).astype(np.float32))
    wgt[:40, :] = wgt[-40:, :] = wgt[:, :40] = wgt[:, -40:] = 0
    s = 45
    num = cv2.GaussianBlur((ref - out) * wgt[..., None], (0, 0), s)
    den = cv2.GaussianBlur(wgt, (0, 0), s)[..., None] + 1e-4
    return out + num / den

bad_all = cv2.max(occl, cv2.dilate(cm, np.ones((9, 9), np.uint8)))
c0m = match(c0, c1, cv2.max(bad_all, (c0.sum(2) < 5).astype(np.uint8) * 255))
c2m = match(c2, c1, cv2.max(bad_all, (c2.sum(2) < 5).astype(np.uint8) * 255))

def sharpen(img, amt, sig):
    return img + amt * (img - cv2.GaussianBlur(img, (0, 0), sig))

c0m = sharpen(c0m, 0.8, 2.5)
c2m = sharpen(c2m, 1.0, 3.5)
# зерно печати: шум как у основы
rs = np.random.RandomState(7)
grain = rs.randn(W, W, 1).astype(np.float32) * 4.0
c2m = c2m + cv2.GaussianBlur(grain, (0, 0), 0.8)[..., None] * 1.6

def blend(base, src, mask, feather):
    m = cv2.GaussianBlur(mask.astype(np.float32) / 255, (0, 0), feather)[..., None]
    return base * (1 - m) + src * m

out = c1.copy()
out = blend(out, c0m, car, 5)
out = blend(out, c2m, cards, 6)
o8 = np.clip(out, 0, 255).astype(np.uint8)
o8 = cv2.inpaint(o8, cm, 6, cv2.INPAINT_TELEA)
cv2.imwrite('D:/temp/nep/center0.png', o8)
