"""Ролик «предмет на месте» → кадры спрайта с прозрачностью общей рамкой + лист.

G:/ai/venvs/3d/Scripts/python.exe studio/post/video_sprites.py <папка роликов> <выход> [--frames 16] [--size 256] [--key luma]

Для каждого .mp4: равномерно берёт N кадров, вырезает фон (BiRefNet, MIT; для эффектов на чёрном — --key luma:
прозрачность по яркости), обрезает все кадры одной общей рамкой (чтобы спрайт не прыгал), масштабирует
к высоте size и кладёт <выход>/<ролик>/NN.png + <выход>/<ролик>.png (лист в строку) + <выход>/<ролик>.json.
"""
import argparse
import json
import pathlib
import subprocess
import tempfile

import numpy as np
from PIL import Image

FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
BIREFNET = 'G:/ai/models/birefnet'


def grab(path: pathlib.Path, n: int):
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run([FFMPEG, '-v', 'error', '-i', str(path), f'{tmp}/%04d.png'], check=True)
        all_ = sorted(pathlib.Path(tmp).glob('*.png'))
        idx = np.linspace(0, len(all_) - 1, n).round().astype(int)
        return [Image.open(all_[i]).convert('RGB').copy() for i in idx]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--frames', type=int, default=16)
    ap.add_argument('--size', type=int, default=256)
    ap.add_argument('--glob', default='*.mp4')
    ap.add_argument('--key', choices=['birefnet', 'luma'], default='birefnet')
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    net = None
    if a.key == 'birefnet':
        import torch
        import torchvision.transforms.functional as TF
        from transformers import AutoModelForImageSegmentation
        net = AutoModelForImageSegmentation.from_pretrained(BIREFNET, trust_remote_code=True).cuda().eval().half()

        def alpha(img):
            x = TF.normalize(TF.to_tensor(img.resize((1024, 1024))), [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
            with torch.no_grad():
                m = net(x[None].cuda().half())[-1].sigmoid()[0, 0].float().cpu().numpy()
            return np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize(img.size, Image.BILINEAR))
    else:
        def alpha(img):
            v = np.asarray(img, dtype=np.float32).max(axis=2)
            return np.clip((v - 12) * 2.2, 0, 255).astype(np.uint8)

    for vid in sorted(pathlib.Path(a.src).glob(a.glob)):
        frames = grab(vid, a.frames)
        rgba = []
        for im in frames:
            al = alpha(im)
            arr = np.dstack([np.asarray(im), al])
            if a.key == 'luma':  # снять чёрный ореол: цвет делим на прозрачность
                f = np.maximum(al[..., None] / 255.0, 1e-3)
                arr[..., :3] = np.clip(np.asarray(im) / f, 0, 255)
            rgba.append(arr.astype(np.uint8))
        mask = np.max([r[..., 3] for r in rgba], axis=0) > 24
        ys, xs = np.nonzero(mask)
        if not len(xs):
            print('пусто', vid.name)
            continue
        box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
        k = a.size / (box[3] - box[1])
        w = max(1, round((box[2] - box[0]) * k))
        d = out / vid.stem
        d.mkdir(exist_ok=True)
        strip = Image.new('RGBA', (w * len(rgba), a.size))
        for i, r in enumerate(rgba):
            im = Image.fromarray(r, 'RGBA').crop(box).resize((w, a.size), Image.LANCZOS)
            im.save(d / f'{i:02d}.png')
            strip.paste(im, (i * w, 0))
        strip.save(out / f'{vid.stem}.png')
        (out / f'{vid.stem}.json').write_text(json.dumps({'frames': len(rgba), 'w': w, 'h': a.size, 'fps': 12, 'loop': True,
                                                          'source': vid.name, 'key': a.key}, ensure_ascii=False), encoding='utf-8')
        print('спрайт', vid.stem, len(rgba), 'кадров', f'{w}×{a.size}', flush=True)


if __name__ == '__main__':
    main()
