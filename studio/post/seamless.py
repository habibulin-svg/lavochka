"""Сделать текстуру бесшовной: смесь с копией, сдвинутой на полпериода, вес — от расстояния до краёв.

python studio/post/seamless.py <вход.png> <выход.png> [размер, px]
"""
import sys

import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
size = int(sys.argv[3]) if len(sys.argv) > 3 else 512
img = np.asarray(Image.open(src).convert('RGB').resize((size, size), Image.LANCZOS), dtype=np.float32)
h, w, _ = img.shape
rolled = np.roll(np.roll(img, h // 2, axis=0), w // 2, axis=1)
# вес исходника: 1 в центре, 0 у краёв (там, где сдвинутая копия сама бесшовна)
wy = np.sin(np.linspace(0, np.pi, h))[:, None]
wx = np.sin(np.linspace(0, np.pi, w))[None, :]
wgt = (wy * wx) ** 0.8
out = img * wgt[..., None] + rolled * (1 - wgt[..., None])
Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(dst)
print(dst)
