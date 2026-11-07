"""Городки: текстуры гопника для проекции (к studio/blender/gorodki_gopnik_rig.py).

python studio/post/gopnik_tex.py <эталон.png>  →  <эталон>-front.png, -back.png, -box.json

front — сам эталон; box — рамка фигуры (не белый фон). back — «вид со спины»: голова выше подбородка закрашена
цветом кепки и волос (иначе лицо проецируется на затылок), молния посередине замазана цветом куртки рядом.
"""
import json
import sys

import numpy as np
from PIL import Image

BIREFNET = 'G:/ai/models/birefnet'


def mask(img):
    """Маска фигуры BiRefNet (MIT) — фон у эталонов не чисто белый."""
    import torch
    import torchvision.transforms.functional as TF
    from transformers import AutoModelForImageSegmentation

    net = AutoModelForImageSegmentation.from_pretrained(BIREFNET, trust_remote_code=True).cuda().eval().half()
    x = TF.normalize(TF.to_tensor(img.resize((1024, 1024))), [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    with torch.no_grad():
        m = net(x[None].cuda().half())[-1].sigmoid()[0, 0].float().cpu().numpy()
    return np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize(img.size)) > 128


ref = sys.argv[1]
base = ref[:-4]
img = Image.open(ref).convert('RGB')
a = np.asarray(img).astype(np.int32)
fg = mask(img)
ys, xs = np.where(fg)
x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
arr = np.asarray(img).copy()
chin = int(y0 + (y1 - y0) * 0.135)
cap_low = int(y0 + (y1 - y0) * 0.075)
mid = (x0 + x1) // 2
cap = np.median(a[y0 + 8:y0 + 24, mid - 12:mid + 12].reshape(-1, 3), 0).astype(np.uint8)
hair = np.array([58, 44, 34], np.uint8)
for yy in range(y0, chin):
    arr[yy][fg[yy]] = cap if yy < cap_low else hair
y_zip = int(y0 + (y1 - y0) * 0.52)
side = arr[chin:y_zip, mid - 16:mid - 6].astype(np.int32).mean(1, keepdims=True).astype(np.uint8)
arr[chin:y_zip, mid - 5:mid + 6] = side
from scipy import ndimage  # noqa: E402


def polish(rgb: np.ndarray) -> np.ndarray:
    """Чистая покраска: кожа — одним тоном, кепка — ровная, а фон вокруг фигуры залит ближайшими её цветами,
    чтобы бока, кисти и затылок не цепляли белый фон эталона (белые кляксы на модели)."""
    out = rgb.copy()
    hsv = np.asarray(Image.fromarray(rgb).convert('HSV')).astype(np.int32)
    h, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    skin = fg & (h >= 4) & (h <= 28) & (sat > 45) & (sat < 175) & (val > 90)
    if skin.sum() > 50:
        tone = np.median(out[skin].reshape(-1, 3), 0)
        out[skin] = (out[skin] * 0.35 + tone * 0.65).astype(np.uint8)
    # кепка: ровный цвет с лёгкой фактурой, без бликов
    capz = np.zeros_like(fg)
    capz[y0:cap_low] = True
    capz &= fg & ~skin
    if capz.sum() > 50:
        ct = np.median(out[capz].reshape(-1, 3), 0)
        out[capz] = (out[capz] * 0.25 + ct * 0.75).astype(np.uint8)
    # фон: сжать маску на 3 px (край с ореолом) и залить снаружи ближайшими пикселями фигуры
    inner = ndimage.binary_erosion(fg, iterations=3)
    idx = ndimage.distance_transform_edt(~inner, return_distances=False, return_indices=True)
    out = out[idx[0], idx[1]]
    # убрать мелкий шум
    return ndimage.median_filter(out, size=(3, 3, 1))


front = polish(np.asarray(img).copy())
# перёд: карманы и мелкие швы сгладить (молнию посередине оставить)
fb = ndimage.median_filter(front[chin + 4:], size=(21, 21, 1))
cols = np.abs(np.arange(front.shape[1]) - mid) > 10
front[chin + 4:, cols] = fb[:, cols]
back = polish(arr)
# спина: карманы, молния и прочие мелочи переда здесь не нужны — крупный медианный фильтр ниже подбородка,
# широкие полосы и шевроны остаются
body_rows = slice(chin + 4, back.shape[0])
back[body_rows] = ndimage.median_filter(back[body_rows], size=(31, 31, 1))
Image.fromarray(front).save(base + '-front.png')
Image.fromarray(back).save(base + '-back.png')
json.dump({'w': img.width, 'h': img.height, 'x0': x0, 'x1': x1, 'y0': y0, 'y1': y1}, open(base + '-box.json', 'w'))
print(base, (x0, x1, y0, y1))
