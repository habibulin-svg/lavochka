"""Вырезка фона (BiRefNet, MIT) у пачки картинок → PNG с прозрачностью, обрезанный по содержимому.

G:/ai/venvs/3d/Scripts/python.exe studio/runners/cutout.py <выходная папка> <картинка.png> [...]
"""
import pathlib
import sys

import numpy as np
import torch
import torchvision.transforms.functional as TF
from PIL import Image
from transformers import AutoModelForImageSegmentation

BIREFNET = 'G:/ai/models/birefnet'


def main():
    out = pathlib.Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    net = AutoModelForImageSegmentation.from_pretrained(BIREFNET, trust_remote_code=True).cuda().eval().half()
    for p in map(pathlib.Path, sys.argv[2:]):
        img = Image.open(p).convert('RGB')
        x = TF.normalize(TF.to_tensor(img.resize((1024, 1024))), [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        with torch.no_grad():
            m = net(x[None].cuda().half())[-1].sigmoid()[0, 0].float().cpu().numpy()
        alpha = Image.fromarray((m * 255).astype(np.uint8)).resize(img.size)
        rgba = img.copy()
        rgba.putalpha(alpha)
        bbox = alpha.point(lambda v: 255 if v > 16 else 0).getbbox()
        rgba = rgba.crop(bbox) if bbox else rgba
        rgba.save(out / (p.stem + '.png'))
        print('вырезано', p.name, rgba.size, flush=True)


if __name__ == '__main__':
    main()
