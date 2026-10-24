# Центр, шаг 2: места под колоды «Шанс»/«Лотерея» — заново; логотип «НЭП» — чистым контуром по маске.
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W = 1460
img = cv2.imread('D:/temp/nep/center0.png').astype(np.float32)

def spot(img, band_a, band_b, text, flip, turn=0):
    """band_a→band_b — короткая сторона с голубой полосой; прямоугольник уходит перпендикулярно на L."""
    a = np.array(band_a, float) * 2; b = np.array(band_b, float) * 2
    u = (b - a); sw = np.linalg.norm(u); u /= sw
    n = np.array([u[1], -u[0]]) * (1 if not flip else -1)
    L = sw * 165 / 90
    ys, xs = np.mgrid[0:W, 0:W].astype(np.float32)
    px = xs - a[0]; py = ys - a[1]
    s = px * u[0] + py * u[1]          # вдоль короткой
    t = px * n[0] + py * n[1]          # вдоль длинной, от полосы
    inside = (s >= 0) & (s <= sw) & (t >= 0) & (t <= L)
    # мягкий край (1.5 px)
    edge = np.clip(np.minimum.reduce([s, sw - s, t, L - t]) / 1.5 + 0.5, 0, 1)
    band = t < L * 0.2
    out = img.copy()
    cyan = np.array([228, 212, 168], np.float32)  # BGR: светло-голубая
    pink = np.array([120, 92, 196], np.float32)   # BGR: розово-красная
    # полоса — плотная, к краю светлеет
    k = np.clip(t / (L * 0.2), 0, 1)[..., None]
    bandcol = cyan * (1 - 0.15 * k) + np.array([255, 245, 225], np.float32) * 0.15 * (1 - k)
    # тело: розовое у полосы, к дальнему концу растворяется в синеве
    f = np.clip((t - L * 0.2) / (L * 0.8), 0, 1)
    alpha_body = (0.82 - 0.62 * f ** 1.3)[..., None]
    m = (inside & band)[..., None] * edge[..., None]
    out = out * (1 - m) + bandcol * m
    mb = (inside & ~band)[..., None] * edge[..., None] * alpha_body
    out = out * (1 - mb) + pink * mb
    # надпись вдоль длинной стороны
    fnt = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 30)
    tw = int(fnt.getlength(text)) + 8
    tim = Image.new('L', (tw, 44), 0)
    ImageDraw.Draw(tim).text((4, 4), text, font=fnt, fill=255)
    tim = tim.filter(ImageFilter.GaussianBlur(0.6))
    # центр надписи — середина тела
    c = a + u * sw * 0.5 + n * (L * 0.2 + L * 0.8 * 0.45)
    ang = np.degrees(np.arctan2(n[1], n[0])) + turn
    rot = tim.rotate(-ang, expand=True, resample=Image.BICUBIC)
    ta = np.zeros((W, W), np.float32)
    x0 = int(c[0] - rot.width / 2); y0 = int(c[1] - rot.height / 2)
    ta[y0:y0 + rot.height, x0:x0 + rot.width] = np.asarray(rot, np.float32) / 255
    ta = ta[..., None] * 0.75
    tcol = np.array([70, 170, 235], np.float32)  # BGR: жёлто-оранжевая
    out = out * (1 - ta) + tcol * ta
    return out

def poly(pts, grow):
    m = np.zeros((W, W), np.uint8)
    cv2.fillPoly(m, [np.int32(np.array(pts) * 2)], 255)
    return cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1)))
cards = cv2.max(poly([(372, 215), (440, 150), (577, 292), (505, 360)], 20), poly([(130, 445), (200, 382), (345, 520), (275, 590)], 20))
hs = cv2.cvtColor(np.clip(img, 0, 255).astype(np.uint8), cv2.COLOR_BGR2HSV)
blue = (hs[..., 0] >= 100) & (hs[..., 0] <= 140) & (hs[..., 1] > 90) & (hs[..., 2] > 70)
wgt = ((cv2.dilate(cards, np.ones((25, 25), np.uint8)) == 0) & blue).astype(np.float32)
sm = np.zeros_like(img); got = np.zeros((W, W), bool)
for sg in (25, 50, 100, 200):
    den = cv2.GaussianBlur(wgt, (0, 0), sg)
    val = cv2.GaussianBlur(img * wgt[..., None], (0, 0), sg) / (den[..., None] + 1e-6)
    take = (~got) & (den > 0.08)
    sm[take] = val[take]; got |= take
# сгладить швы между масштабами
sm = cv2.GaussianBlur(sm, (0, 0), 12)
grain = cv2.GaussianBlur(np.random.RandomState(3).randn(W, W).astype(np.float32), (0, 0), 0.7) * 7
fill = sm + grain[..., None]
mm = cv2.GaussianBlur(cards.astype(np.float32) / 255, (0, 0), 4)[..., None]
img = img * (1 - mm) + fill * mm
img = spot(img, (390, 227), (455, 165), 'ШАНС', True)
img = spot(img, (332, 512), (265, 572), 'ЛОТЕРЕЯ', True, 180)

# --- логотип
x0, y0, x1, y1 = 455, 570, 1015, 885
src = cv2.imread('D:/temp/nep/center0.png')
reg = src[y0:y1, x0:x1]
hsv = cv2.cvtColor(reg, cv2.COLOR_BGR2HSV).astype(np.int32)
H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
red = (((H <= 12) | (H >= 168)) & (S > 100) & (V > 110)).astype(np.uint8) * 255
wht = ((S < 80) & (V > 165)).astype(np.uint8) * 255
def clean(m, k, minarea):
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    o = np.zeros_like(m)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] >= minarea: o[lab == i] = 255
    return o
red = clean(red, 9, 1500)
allm = clean(cv2.max(red, wht), 9, 4000)
allm = cv2.max(allm, cv2.dilate(red, np.ones((5, 5), np.uint8)))
def smooth(m, s):
    b = cv2.GaussianBlur(m.astype(np.float32) / 255, (0, 0), s)
    return np.clip((b - 0.5) * 3.0 + 0.5, 0, 1)   # мягкий, но чёткий край
A = smooth(allm, 3.6); R = smooth(red, 2.8) * A
cream = np.median(reg[(wht > 0) & (red == 0)], axis=0).astype(np.float32)
redc = np.median(reg[red > 0], axis=0).astype(np.float32)
print('cream', cream, 'red', redc)
# лёгкая фактура краски от оригинала
lum = cv2.GaussianBlur(cv2.cvtColor(reg, cv2.COLOR_BGR2GRAY).astype(np.float32), (0, 0), 6)
rr = img[y0:y1, x0:x1]
redtex = redc * np.clip(1 + (lum - np.median(lum[red > 0])) / 400, 0.9, 1.1)[..., None]
rr = rr * (1 - A[..., None]) + cream * A[..., None]
rr = rr * (1 - R[..., None]) + redtex * R[..., None]
img[y0:y1, x0:x1] = rr
o8 = np.clip(img, 0, 255).astype(np.uint8)
cv2.imwrite('D:/temp/nep/center.png', o8)
cv2.imwrite('D:/temp/nep/center_s.png', cv2.resize(o8, (730, 730), interpolation=cv2.INTER_AREA))
cv2.imwrite('D:/temp/nep/z1.png', o8[480:1000, 300:1200])
