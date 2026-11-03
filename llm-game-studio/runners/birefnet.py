"""Вырезка фона (BiRefNet, MIT) → PNG с прозрачностью, обрезанный по содержимому.

Единица: input (путь к картинке), threshold (необязательно, 0–255, по умолчанию 16 — граница обрезки), pad (поля, px).
Нужны: torch, torchvision, transformers, pillow, timm, kornia, einops.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import _lgs  # noqa: E402


def main():
    j = _lgs.job()
    import numpy as np
    import torch
    import torchvision.transforms.functional as TF
    from PIL import Image
    from transformers import AutoModelForImageSegmentation

    dev = _lgs.device(j)
    net = AutoModelForImageSegmentation.from_pretrained(str(j['model_dirs'][0]), trust_remote_code=True).to(dev).eval()
    half = dev != 'cpu'
    net = net.half() if half else net.float()   # веса в репозитории — fp16; на процессоре нужен fp32
    out = pathlib.Path(j['out'])
    units = j['units']
    for i, u in enumerate(units):
        _lgs.progress(i, len(units), u['key'])
        img = Image.open(u['input']).convert('RGB')
        x = TF.normalize(TF.to_tensor(img.resize((1024, 1024))), [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])[None].to(dev)
        with torch.no_grad():
            m = net(x.half() if half else x)[-1].sigmoid()[0, 0].float().cpu().numpy()
        alpha = Image.fromarray((m * 255).astype(np.uint8)).resize(img.size)
        rgba = img.copy()
        rgba.putalpha(alpha)
        thr = int(u.get('threshold', 16))
        bbox = alpha.point(lambda v: 255 if v > thr else 0).getbbox()
        if bbox:
            pad = int(u.get('pad', 0))
            bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(img.width, bbox[2] + pad), min(img.height, bbox[3] + pad))
            rgba = rgba.crop(bbox)
        dest = out / f"{u['key']}.png"
        rgba.save(dest)
        _lgs.output(dest, key=u['key'], item=u['name'], source=u['input'], size=list(rgba.size))
        _lgs.progress(i + 1, len(units), u['key'])


if __name__ == '__main__':
    main()
