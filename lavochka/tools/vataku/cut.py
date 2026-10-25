"""«В атаку!» (Н. Авцын, худ. В. Антипов): поле — фото photo.jpg сверху с перекосом → выпрямленное public/vataku/board.webp.
python tools/vataku/cut.py

Углы сетки 20×15 (по фото): левый верхний (86, 19), правый верхний (1506, 54), левый нижний (30, 1139), правый нижний (1536, 1134).
Сетка ложится в (M, M)…(M + 20·C, M + 15·C), вокруг — поля с подписями букв и цифр."""
import os
import numpy as np, cv2

SRC = 'D:/temp/настолки/в атаку/photo.jpg'
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'public', 'vataku')
os.makedirs(OUT, exist_ok=True)
C, M = 72, 52
im = cv2.imdecode(np.fromfile(SRC, np.uint8), cv2.IMREAD_COLOR)
src = np.float32([[86, 19], [1506, 54], [30, 1139], [1536, 1134]])
dst = np.float32([[M, M], [M + 20 * C, M], [M, M + 15 * C], [M + 20 * C, M + 15 * C]])
W, H = 20 * C + 2 * M, 15 * C + 2 * M
out = cv2.warpPerspective(im, cv2.getPerspectiveTransform(src, dst), (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
cv2.imwrite(os.path.join(OUT, 'board.webp'), out, [cv2.IMWRITE_WEBP_QUALITY, 82])
print('board', W, H, 'cell', C, 'margin', M)
