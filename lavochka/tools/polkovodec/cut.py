"""«Полководец»: поле из трёх частей и карточки войск с фото оригинала (D:/temp/настолки/полководец/полководец/) → public/polkovodec/.
python tools/polkovodec/cut.py

Поле: три листа 12×27 клеток сфотографированы по отдельности (post48-swm4ipt — левый, fdefopt — средний, nh8mnfb — правый);
каждый выпрямляется по углам в 2700×1200 (клетка 100 px), поворачивается так, чтобы получилось 12 в ширину и 27 в высоту,
три листа ставятся рядом → 36×27, итог 2160×1620 (клетка 60 px).
Карточки: оригинальные квадраты (русские — зелёные «А», французы — синие «N», австрийцы — белые «F») вырезаны с фото россыпи
полуавтоматически (D:/temp/review/polkovodec/cards/, разбор — docs/analysis/materials-polkovodec.md), сопоставлены с
подписанными листами армий; здесь собираются в ленту cards.webp: 3 ряда × 11 родов по 160 px."""
import os
import numpy as np, cv2

P = 'D:/temp/настолки/полководец/полководец/'
C = 'D:/temp/review/polkovodec/cards/'
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'public', 'polkovodec')
os.makedirs(OUT, exist_ok=True)
rd = lambda f: cv2.imdecode(np.fromfile(f, np.uint8), cv2.IMREAD_COLOR)

PANELS = [
    ('post48-swm4ipt.jpg', [[170, 761], [3809, 676], [3808, 2373], [178, 2307]]),
    ('post48-fdefopt.jpg', [[110, 672], [3846, 560], [3808, 2279], [132, 2246]]),
    ('post48-nh8mnfb.jpg', [[117, 671], [3788, 594], [3869, 2297], [128, 2263]]),
]
parts = []
for f, c in PANELS:
    im = rd(P + f)
    M = cv2.getPerspectiveTransform(np.float32(c), np.float32([[0, 0], [2700, 0], [2700, 1200], [0, 1200]]))
    w = cv2.warpPerspective(im, M, (2700, 1200), flags=cv2.INTER_CUBIC)
    parts.append(cv2.rotate(w, cv2.ROTATE_90_CLOCKWISE))
board = np.hstack(parts)
cv2.imwrite(os.path.join(OUT, 'board.webp'), cv2.resize(board, (2160, 1620), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_WEBP_QUALITY, 82])
cv2.imwrite('D:/temp/review/polkovodec/board3600.png', board)

ORDER = ['musk', 'gren', 'jager', 'jgren', 'dragoon', 'hussar', 'ulan', 'cossack', 'cuir', 'gun', 'hart']
CARDS = [
    ['c53', 'c49', 'c45', 'c42', 'c93', 'c87', 'c79', 'c72', 'c12', 'c00', 'c08'],
    ['c70', 'c67', 'c65', 'c61', 'c119', 'c117', 'c108', 'c103', 'c31', 'c22', 'c27'],
    ['w30', 'w27', 'w21', 'w20', 'w58', 'w50', 'aw_ulan', 'w40', 'aw_kir', 'w00', 'w05'],
]
S = 160
sheet = np.zeros((3 * S, 11 * S, 3), np.uint8)
for r, row in enumerate(CARDS):
    for k, name in enumerate(row):
        t = cv2.imread(C + name + '.png')
        t = t[8:192, 8:192]  # без краёв фона
        sheet[r * S : (r + 1) * S, k * S : (k + 1) * S] = cv2.resize(t, (S, S), interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(OUT, 'cards.webp'), sheet, [cv2.IMWRITE_WEBP_QUALITY, 88])
print('ok')
