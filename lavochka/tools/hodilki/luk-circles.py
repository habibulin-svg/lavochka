"""Поиск белых кружков на скане поля «Лукоморья» (для сверки разметки): белое пятно после
размыкания диском (дороги тоньше кружков и пропадают) → компоненты нужного размера и круглости.
Запуск из lavochka/:  python -I tools/hodilki/luk-circles.py <N> <out.json>"""
import json, sys, os
import numpy as np, cv2
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
n, out = sys.argv[1], sys.argv[2]
im = cv2.imread(os.path.join(ROOT, '..', 'materials/nastolki/lukomorie/field-%s.webp' % n))
hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
white = ((hsv[:, :, 1] < 45) & (hsv[:, :, 2] > 200)).astype(np.uint8) * 255
# чёрные стрелки внутри кружков — закрыть
cs, _ = cv2.findContours(white, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
filled = np.zeros_like(white)
cv2.drawContours(filled, cs, -1, 255, -1)
op = cv2.morphologyEx(filled, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (51, 51)))
cs, _ = cv2.findContours(op, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
res = []
for c in cs:
    a = cv2.contourArea(c)
    if a < 3000 or a > 40000: continue
    (cx, cy), r = cv2.minEnclosingCircle(c)
    if a < 0.7 * 3.1416 * r * r: continue
    res.append({'x': int(cx), 'y': int(cy), 'r': int(r)})
res.sort(key=lambda c: (c['y'] // 150, c['x']))
json.dump(res, open(out, 'w'), indent=0)
print(len(res), 'кружков')
