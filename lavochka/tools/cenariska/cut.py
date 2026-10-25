"""«Цена риска» (Супер игра, 90-е): доска и тайлы с фото → public/cenariska/.
python tools/cenariska/cut.py   (фото.7z распакован в D:/review/cenariska/фото/)

Доска: бирюзовая подложка с 16 окнами неподвижных тайлов, стрелками и цветными стоянками — выпрямляется по углам.
Тайлы: на фото россыпью на ковре — находятся по светлому пятну, выпрямляются по четырём углам в 300×300. Пустые прямой,
угол и тройник — образцы; тайлы с рисунком-тройники (тигр, лев, камни) — как есть; прямым с рисунком (олень, носорог,
охотник, бизон) стены подставляются от образца прямого, чтобы кладка была одинаковой. Бизон на фото обрезан краем кадра —
берётся его середина. Мамонта нет ни на одном снимке — рисуется в игре поверх пустого прямого (разрешение пользователя)."""
import glob, os
import numpy as np, cv2

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'public', 'cenariska')
os.makedirs(OUT, exist_ok=True)
rd = lambda f: cv2.imdecode(np.fromfile(f, np.uint8), cv2.IMREAD_COLOR)
T = 300

# доска
b = rd('D:/temp/настолки/цена риска/dde6202fd4eaede0a46530991a980c83.jpg')
src = np.float32([[47, 414], [1532, 398], [1559, 1873], [68, 1869]])
B = 1400
board = cv2.warpPerspective(b, cv2.getPerspectiveTransform(src, np.float32([[0, 0], [B, 0], [B, B], [0, B]])), (B, B), flags=cv2.INTER_CUBIC)
cv2.imwrite(os.path.join(OUT, 'board.webp'), board, [cv2.IMWRITE_WEBP_QUALITY, 80])
# окна (белые квадраты): центры
hsv = cv2.cvtColor(board, cv2.COLOR_BGR2HSV)
w = ((hsv[..., 1] < 60) & (hsv[..., 2] > 170)).astype(np.uint8) * 255
w = cv2.morphologyEx(w, cv2.MORPH_OPEN, np.ones((15, 15), np.uint8))
n, lab, st, cen = cv2.connectedComponentsWithStats(w)
wins = sorted([(cen[i][0], cen[i][1], st[i][2], st[i][3]) for i in range(1, n) if 5000 < st[i][4] < 60000], key=lambda t: (round(t[1] / 100), t[0]))
print('окна', len(wins), [(round(x), round(y), ww, hh) for x, y, ww, hh in wins])


def tiles():
    srcs = [f for f in glob.glob('D:/review/cenariska/фото/*.jpg') if 'box' not in f] + ['D:/temp/настолки/цена риска/3d8592d121103b27d2d8f5d3c8f20830.jpg']
    out = []
    for f in srcs:
        im = rd(f)
        hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
        m = ((hsv[..., 2] > 150) & (hsv[..., 1] < 170)).astype(np.uint8) * 255
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        A = im.shape[0] * im.shape[1]
        for c in cs:
            a = cv2.contourArea(c)
            if a < A * 0.008 or a > A * 0.12:
                continue
            ap = cv2.approxPolyDP(c, 0.04 * cv2.arcLength(c, True), True)
            if len(ap) != 4:
                continue
            x, y, ww, hh = cv2.boundingRect(ap)
            if not (0.75 < ww / hh < 1.33) or x < 3 or y < 3 or x + ww > im.shape[1] - 3 or y + hh > im.shape[0] - 3:
                continue
            pts = ap.reshape(4, 2).astype(np.float32)
            s = pts.sum(1)
            d = np.diff(pts, axis=1).ravel()
            q = np.float32([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]])
            M = cv2.getPerspectiveTransform(q, np.float32([[0, 0], [T - 1, 0], [T - 1, T - 1], [0, T - 1]]))
            out.append(cv2.warpPerspective(im, M, (T, T)))
    return out


ts = tiles()
print('тайлов', len(ts))
I, L, TT = ts[13], ts[3], ts[27]
BAND = 46  # высота кладки у прямого


def straight(pic: np.ndarray, top: int, bot: int) -> np.ndarray:
    """Прямой с рисунком: кладка сверху и снизу — от образца, середина — с фото (полоса top…bot растягивается)."""
    t = I.copy()
    mid = cv2.resize(pic[top:bot], (T, T - 2 * BAND))
    t[BAND : T - BAND] = mid
    return t


save = lambda name, img: cv2.imwrite(os.path.join(OUT, f'{name}.webp'), img, [cv2.IMWRITE_WEBP_QUALITY, 86])
save('I', I)
save('L', L)
save('T', TT)
save('tiger', ts[28])
save('lion', ts[25])
save('rock', ts[26])
save('rock2', ts[37])
save('deer', straight(ts[16], 40, 260))
save('rhino', straight(ts[41], 40, 262))
save('hunter', straight(ts[39], 42, 258))
# бизон: тайл в главном кадре касается верхнего края — берём середину по рамке вручную
m = rd('D:/temp/настолки/цена риска/3d8592d121103b27d2d8f5d3c8f20830.jpg')
bis = cv2.warpPerspective(m, cv2.getPerspectiveTransform(np.float32([[636, -18], [1012, -14], [1010, 330], [634, 326]]), np.float32([[0, 0], [T - 1, 0], [T - 1, T - 1], [0, T - 1]])), (T, T))
cv2.imwrite('D:/temp/review/bison_raw.png', bis)
save('bison', straight(bis, 40, 255))
print('готово')
