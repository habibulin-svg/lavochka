"""«Путешествие в Швамбранию»: маршрут по карте — узлы и «ноги» пути.

Узлы сняты с поля (склейка 6725×5242: сканы четвертей + щель посередине из фото «Самое важное»):
тёмные точки найдены автоматически (dots2.json — центры, радиусы), недостающие и номерные кружки/порты заданы вручную
и уточнены по картинке. Порядок узлов на каждом участке пути выписан глазами по линиям карты.

  python tools/sea/shv-route.py <field-full.png> <dots2.json> <out-dir> [check.jpg]
Пишет <out-dir>/shv-route.json (координаты в пикселях field.webp шириной 3200) и картинку проверки."""
import sys, json
import numpy as np
import cv2

FULL_W = 6725
OUT_W = 3200

# номерные пункты, порты и якорь (центры по картинке 6725×5242)
MANUAL = {
    'N1': (4760, 1398), 'N2': (5533, 1067), 'N3': (5975, 2333), 'N4': (5376, 2836), 'N5': (5210, 4224),
    'N6': (3982, 3963), 'N7': (3071, 4179), 'N8': (2333, 4139), 'N9': (1916, 3725), 'N10': (373, 4142),
    'N11': (1273, 1473), 'N12': (2019, 181), 'N13': (2891, 350), 'N14': (4145, 214), 'N15': (4045, 763),
    'N16': (4392, 1617), 'N17': (3591, 632), 'N18': (3424, 1192), 'N19': (3340, 1395), 'N20': (2827, 1631),
    'ANCHOR': (3935, 2610),
    'P_OHOTA': (6075, 1817), 'P_ZR': (3373, 3278), 'P_NAS': (1290, 3881), 'P_LUK': (555, 3273), 'P_DP': (475, 2609),
    'P_IMB': (1527, 2973), 'P_GROT': (464, 4827), 'P_PLEN': (1755, 4918), 'P_DOB': (2241, 1559),
    # тёмные точки, которые не нашёл детектор
    'X1': (95, 3860), 'X2': (1127, 4491), 'X3': (1518, 2178), 'X5': (3527, 928),
    'I1': (6222, 2952), 'I2': (6097, 3087), 'I3': (6222, 3237), 'I4': (6062, 3212),
    'E1': (5270, 3520), 'E2': (5280, 3680), 'E3': (5436, 3800),
    'R1': (3035, 1795), 'R2': (3096, 2015), 'R3': (3227, 2200), 'R4': (3393, 2362), 'R5': (3607, 2442),
}

LEGS = {
    # от Большого рейда (якорь) на восток: 1, 2, Берег Охоты, 3, до пункта 4
    'start': 'd154 d139 d123 d107 d108 d109 d127 d111 N1 d72 d55 d35 d37 d19 d40 d41 d60 N2 d77 d78 d79 d97 d115 d130 P_OHOTA d129 d145 d144 N3 d168 d169 d167 d166 N4',
    # безопасный обход: через льды у острова Благоразумия, Лазурным океаном и южнее Пилигвиники
    'ice': 'd176 d177 d178 I1 I2 d184 d185 d186 I3 I4 d201 d221 d222 d246 d270 d283 d299 d300 d322 d331 d320 d318 d317 d295 d294 d316 d315 d330 d329 d328 d327 d313 d312 d311 d310 d309 d308 d290',
    # короткий путь: Южный пролив мимо батарей Пилигвиники (5, 6, 7)
    'south': 'd175 d183 d199 d200 E1 E2 E3 d244 d269 N5 d268 d267 d243 d242 d240 N6 d238 d236 d261 d259 d258 N7 d257 d256 d255 d277 d279',
    # Проходное море: пираты (8, 9), гавань полуострова Насаждений, до пункта 10
    'p8': 'd278 d276 N8 d230 d210 d195 d194 N9 d227 d226 d225 d252 d251 P_NAS d224 d250 d249 d248 N10',
    # западный берег: Лукоморье, Доброй Памяти — до 11
    'coast': 'd247 X1 d204 d205 d206 P_LUK d188 d203 d179 d180 d171 P_DP d161 d147 d131 d116 d117 d98 d99 N11',
    # пролив Семи Мудрых Школяров: Порт Имбирь — до 11
    'strait': 'd223 d208 d189 d174 P_IMB d173 d148 X3 d118 N11',
    'north': 'd61 d42 d21 d7 N12',
    # от мыса Маяка Доброй Надежды прямо Фиолетовым морем или в Бухту Добычи
    'straight': 'd1 d2 d3 d4 d5 d6 N14',
    'bay': 'd9 d10 d22 d44 d43 d63 d83 P_DOB d84 d64 d45 d24 N13 d12 d13 d14 d15 N14',
    # мимо Мыса Бурь морем: пожар (15), карантин (16)
    'sea': 'd16 d17 d34 N15 d52 d54 d71 d70 d91 N16 d110 d108 d107 d123 d139 d154 ANCHOR',
    # сухопутный маршрут после кораблекрушения у Мыса Бурь
    'land': 'd33 d30 N17 d51 X5 d50 N18 d90 d106 N19 d104 N20 d122 d137 d152 d162 d163 ANCHOR',
    'lake': 'd88 d66 d86 d101 N20',
    'river': 'R1 R2 R3 R4 R5 ANCHOR',
    # в плен: от 8 и (через 8) от 9
    'plen8': 'd274 d275 d289 d307 d306 P_PLEN',
    'plen9': 'd194 d195 d210 d230 N8 d274 d275 d289 d307 d306 P_PLEN',
    # побег: кратчайшим путём на север или на запад к гроту Великого Лоцмана
    'escN': 'd304 d303 X2 d249 d248 N10',
    'escW': 'd304 d326 d325 d324 P_GROT d323 d301 d284 d271 d247 N10',
    # под огнём батарей — на ремонт к Берегу Золотых Рук и назад через 7
    'rep5': 'd268 d267 d243 d242 d240 N6 d237 d235 d234 d218 d219 d216 d215 P_ZR',
    'rep6': 'd237 d235 d234 d218 d219 d216 d215 P_ZR',
    'rep7': 'd233 d214 d213 P_ZR',
    'afterZR': 'd213 d214 d233 N7 d257 d256 d255 d277 d279',
}


def refine(im, x, y, r=34, red=False):
    """Уточнить центр кружка: центр масс тёмного (или красного) пятна рядом."""
    h, w = im.shape[:2]
    x0, y0 = max(0, x - r), max(0, y - r)
    c = im[y0:y + r + 1, x0:x + r + 1].astype(int)
    b, g, rr = c[..., 0], c[..., 1], c[..., 2]
    if red:
        m = (rr > 150) & (g < 110) & (b < 110)
    else:
        v = c.max(2)
        m = v < np.percentile(v, 30)
    ys, xs = np.nonzero(m)
    if len(xs) < 20:
        return x, y
    return int(round(x0 + xs.mean())), int(round(y0 + ys.mean()))


def main():
    src, dots_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
    im = cv2.imread(src)
    dots = json.load(open(dots_path))
    k = OUT_W / im.shape[1]
    pos = {}
    for leg in LEGS.values():
        for t in leg.split():
            if t in pos:
                continue
            if t.startswith('d'):
                x, y = dots[int(t[1:])][:2]
            else:
                x, y = MANUAL[t]
                if t[0] in 'XIER':
                    x, y = refine(im, x, y)
                elif t.startswith('P_') or t == 'ANCHOR':
                    x, y = refine(im, x, y, 45, red=True)
            pos[t] = (x, y)
    names = sorted(pos)
    nodes = {t: [round(pos[t][0] * k), round(pos[t][1] * k)] for t in names}
    legs = {n: s.split() for n, s in LEGS.items()}
    json.dump({'w': OUT_W, 'h': round(im.shape[0] * k), 'nodes': nodes, 'legs': legs}, open(out + '/shv-route.json', 'w'), ensure_ascii=False)
    print('nodes', len(nodes), 'legs', {n: len(v) for n, v in legs.items()})
    if len(sys.argv) > 4:
        vis = im.copy()
        cols = [(0, 0, 255), (0, 200, 0), (255, 0, 0), (0, 200, 255), (255, 0, 255), (255, 255, 0), (0, 120, 255)]
        for li, (n, seq) in enumerate(legs.items()):
            col = cols[li % len(cols)]
            pts = [pos[t] for t in seq]
            for a, b in zip(pts, pts[1:]):
                cv2.arrowedLine(vis, a, b, col, 5, tipLength=0.15)
            for i, p in enumerate(pts):
                cv2.circle(vis, p, 30, col, 5)
            cv2.putText(vis, n, (pts[0][0] + 30, pts[0][1] + 60), cv2.FONT_HERSHEY_SIMPLEX, 1.6, (0, 0, 0), 9)
            cv2.putText(vis, n, (pts[0][0] + 30, pts[0][1] + 60), cv2.FONT_HERSHEY_SIMPLEX, 1.6, col, 4)
        cv2.imwrite(sys.argv[4], cv2.resize(vis, None, fx=0.3, fy=0.3), [cv2.IMWRITE_JPEG_QUALITY, 85])


main()
