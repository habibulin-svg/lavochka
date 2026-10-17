"""«Путешествие в Швамбранию»: картинки из оригинала.
  python tools/sea/shv-assets.py <поле-склейка.png> <Жетоны: страница-картинка.jpg> <public/shv>
Поле — склейка (четверти скана «Поле.pdf» + середина из фото блога «Самое важное»); компас, марки «1» и «3»,
вымпел Великого Лоцмана — вырезаны из листа «Жетоны.pdf»."""
import sys
import numpy as np
import cv2
from PIL import Image

field, tokens, out = sys.argv[1], sys.argv[2], sys.argv[3]
Image.MAX_IMAGE_PIXELS = None
f = Image.open(field).convert('RGB')
w = 3200
f.resize((w, round(f.height * w / f.width)), Image.LANCZOS).save(out + '/field.webp', quality=84, method=6)
f.resize((800, round(f.height * 800 / f.width)), Image.LANCZOS).save(out + '/field-small.webp', quality=78, method=6)

t = Image.open(tokens).convert('RGB')
# компас: круг с центром (480, 480), радиус 349 на листе 1240×1754
cx, cy, r = 480, 480, 352
c = t.crop((cx - r, cy - r, cx + r, cy + r)).convert('RGBA')
m = Image.new('L', c.size, 0)
yy, xx = np.mgrid[0:c.height, 0:c.width]
m = Image.fromarray(((np.hypot(xx - r + 0.5, yy - r + 0.5) <= r - 1) * 255).astype(np.uint8))
c.putalpha(m)
c.resize((560, 560), Image.LANCZOS).save(out + '/compass.webp', quality=88, method=6)


def cut(box, name, size):
    """Вырезать жетон и убрать белый фон (заливкой от краёв)."""
    im = np.array(t.crop(box))
    bg = (im.min(2) > 200).astype(np.uint8)
    n, lab = cv2.connectedComponents(bg)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    a = np.where(np.isin(lab, list(edge)), 0, 255).astype(np.uint8)
    a = cv2.GaussianBlur(cv2.erode(a, np.ones((3, 3), np.uint8)), (3, 3), 0)
    rgba = np.dstack([im, a])
    ys, xs = np.nonzero(a > 10)
    rgba = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    img = Image.fromarray(rgba, 'RGBA')
    k = size / max(img.size)
    img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS).save(out + '/' + name, quality=90, method=6)


cut((815, 985, 975, 1150), 'mark1.webp', 140)
cut((448, 1175, 612, 1342), 'mark3.webp', 140)
cut((2, 955, 216, 1250), 'pennant.webp', 160)
print('ok')
