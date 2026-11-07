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
img.save(base + '-front.png')
Image.fromarray(arr).save(base + '-back.png')
json.dump({'w': img.width, 'h': img.height, 'x0': x0, 'x1': x1, 'y0': y0, 'y1': y1}, open(base + '-box.json', 'w'))
print(base, (x0, x1, y0, y1))
