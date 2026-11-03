"""Пакетная обработка скачанных вкладышей: обрезка сканерных полей → апскейл нейросетью → webp.

Запуск питоном из venv ComfyUI (там torch с CUDA и spandrel):
  G:\\ai\\ComfyUI\\venv\\Scripts\\python.exe upscale.py G:\\temp\\vkladyshi G:\\temp\\vkladyshi-clean
  ... --only "Turbo 1-50" --limit 5        проба на части
  ... --model G:\\ai\\ComfyUI\\models\\upscale_models\\RealESRGAN_x4plus.pth --long 1024

Раскладку папок и meta.json качалки сохраняет; уже готовые файлы пропускает.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from spandrel import ImageModelDescriptor, ModelLoader

# цифры характеристик держит лучше всех (сравнение 10 моделей 2026-11-03); RealESRGAN_x4plus их выдумывает
DEFAULT_MODEL = r'G:\ai\ComfyUI\models\upscale_models\4x_NMKD-Siax_200k.pth'


def trim(im: Image.Image, tol: int = 28, frac: float = 0.12) -> Image.Image:
    """Срезает поля скана: цвет фона — медиана по краям; строка/столбец — «содержимое»,
    если в нём больше frac пикселей отличаются от фона сильнее tol."""
    a = np.asarray(im.convert('RGB')).astype(np.int16)
    h, w, _ = a.shape
    edge = np.concatenate([a[:3].reshape(-1, 3), a[-3:].reshape(-1, 3), a[:, :3].reshape(-1, 3), a[:, -3:].reshape(-1, 3)])
    bg = np.median(edge, axis=0)
    diff = np.abs(a - bg).max(axis=2) > tol
    rows = np.where(diff.mean(axis=1) > frac)[0]
    cols = np.where(diff.mean(axis=0) > frac)[0]
    if len(rows) < 2 or len(cols) < 2:
        return im
    t, b, l, r = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
    if (b - t) * (r - l) < 0.5 * h * w:  # срезали бы слишком много — фон не однородный, не трогаем
        return im
    return im.crop((int(l), int(t), int(r), int(b)))


class Upscaler:
    def __init__(self, path: str, device: str = 'cuda', tile: int = 384):
        m = ModelLoader().load_from_file(path)
        assert isinstance(m, ImageModelDescriptor), 'не модель апскейла'
        self.scale = m.scale
        self.half = device == 'cuda' and m.supports_half
        self.model = m.model.eval().to(device)
        if self.half:
            self.model = self.model.half()
        self.device = device
        self.tile = tile

    @torch.inference_mode()
    def __call__(self, im: Image.Image) -> Image.Image:
        x = torch.from_numpy(np.array(im.convert('RGB'))).permute(2, 0, 1).float().div(255).unsqueeze(0)
        x = x.to(self.device)
        if self.half:
            x = x.half()
        _, _, h, w = x.shape
        s, t, pad = self.scale, self.tile, 16
        out = torch.zeros((1, 3, h * s, w * s), device=self.device, dtype=x.dtype)
        for y0 in range(0, h, t):
            for x0 in range(0, w, t):
                ya, yb = max(y0 - pad, 0), min(y0 + t + pad, h)
                xa, xb = max(x0 - pad, 0), min(x0 + t + pad, w)
                o = self.model(x[:, :, ya:yb, xa:xb])
                oy, ox = (y0 - ya) * s, (x0 - xa) * s
                th, tw = (min(y0 + t, h) - y0) * s, (min(x0 + t, w) - x0) * s
                out[:, :, y0 * s:y0 * s + th, x0 * s:x0 * s + tw] = o[:, :, oy:oy + th, ox:ox + tw]
        a = out.squeeze(0).float().clamp(0, 1).mul(255).round().byte().permute(1, 2, 0).cpu().numpy()
        return Image.fromarray(a)


def fit_long(im: Image.Image, long: int) -> Image.Image:
    k = long / max(im.size)
    return im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS) if abs(k - 1) > 0.01 else im


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    p = argparse.ArgumentParser()
    p.add_argument('src')
    p.add_argument('dst')
    p.add_argument('--model', default=DEFAULT_MODEL)
    p.add_argument('--long', type=int, default=768, help='длинная сторона результата')
    p.add_argument('--only', help='подстрока в имени коллекции')
    p.add_argument('--limit', type=int, default=0)
    p.add_argument('--quality', type=int, default=85)
    a = p.parse_args()

    src, dst = Path(a.src), Path(a.dst)
    up = Upscaler(a.model)
    metas = sorted(src.glob('*/*/meta.json'))
    t0, n = time.time(), 0
    for m in metas:
        coll = m.parent
        if a.only and a.only.lower() not in coll.name.lower():
            continue
        meta = json.loads(m.read_text(encoding='utf-8'))
        out_dir = dst / coll.parent.name / coll.name
        out_dir.mkdir(parents=True, exist_ok=True)
        items = meta['items'][:a.limit] if a.limit else meta['items']
        print(f'{coll.parent.name} / {coll.name}: {len(items)}', flush=True)
        for it in items:
            sub = out_dir / '_extra' if it['label'] in ('0', '') else out_dir
            sub.mkdir(exist_ok=True)
            out = sub / (Path(it['file']).stem + '.webp')
            it['clean'] = str(out.relative_to(out_dir)).replace('\\', '/')
            if out.exists():
                continue
            im = Image.open(coll / it['file']).convert('RGB')
            im = trim(im)
            it['trimmed'] = list(im.size)
            res = fit_long(up(im), a.long)
            res.save(out, 'WEBP', quality=a.quality, method=6)
            n += 1
        meta['clean'] = {'model': Path(a.model).name, 'long': a.long}
        (out_dir / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'Готово: {n} шт. за {time.time() - t0:.0f} с', flush=True)


if __name__ == '__main__':
    main()
