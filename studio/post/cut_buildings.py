"""«Герои»: вырезка построек города с ровного светлого фона (Klein ref2, партия w6-town-all) и листы выбора.

G:/ai/ComfyUI/venv/Scripts/python.exe -X utf8 studio/post/cut_buildings.py <папка png> <выход> [--sheets <папка листов>]

Фон — гладкая модель по краям (уменьшено, объект замаскирован, размыто): бумага с подмесом не остаётся рамкой.
Альфа: отличие от фона × насыщенность, тёмное и контрастное — целиком; берутся крупные связные куски.
Выход — <фракция>-<постройка>-<сид>.png шириной 640. Лист на фракцию: сиды рядом, чтобы выбрать.
"""
import argparse
import pathlib
from collections import defaultdict

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


def cut(path, width=640):
    im = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    s = np.asarray(Image.fromarray(im.astype(np.uint8)).resize((64, 48))).astype(np.float32)
    edge = np.concatenate([s[0], s[-1], s[:, 0], s[:, -1]])
    bg0 = np.median(edge, 0)
    isbg = np.sqrt(((s - bg0) ** 2).sum(2)) < 22
    filled = s.copy()
    filled[~isbg] = bg0
    filled = ndimage.gaussian_filter(filled, (3, 3, 0))
    bg = np.asarray(Image.fromarray(np.clip(filled, 0, 255).astype(np.uint8)).resize((im.shape[1], im.shape[0]), Image.BICUBIC)).astype(np.float32)
    d = np.sqrt(((im - bg) ** 2).sum(2))
    sat = im.max(2) - im.min(2)
    a = np.clip((d - 22) / 50, 0, 1) * np.clip((sat - 8) / 30 + 0.35, 0, 1)
    a = np.maximum(a, np.clip((d - 60) / 40, 0, 1))
    lab, _ = ndimage.label(a > 0.2)
    sizes = ndimage.sum(np.ones_like(a), lab, range(lab.max() + 1))
    keep = np.zeros_like(a, bool)
    for k in np.argsort(sizes)[::-1][:6]:
        if k and sizes[k] > 2000:
            keep |= lab == k
    a = a * ndimage.binary_dilation(keep, iterations=10)
    a = ndimage.gaussian_filter(a, 1.2)
    rgb = np.where(a[..., None] > 0.03, (im - bg * (1 - a[..., None])) / np.maximum(a[..., None], 0.03), im)
    o = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), np.clip(a, 0, 1) * 255]).astype(np.uint8), 'RGBA')
    o = o.crop(o.getbbox())
    return o.resize((width, round(o.height * width / o.width)), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--sheets')
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    groups = defaultdict(lambda: defaultdict(list))
    for p in sorted(pathlib.Path(a.src).glob('*.png')):
        stem = p.stem
        name, seed = stem.rsplit('-', 1)
        q = out / f'{stem}.png'
        if not q.exists():
            cut(p).save(q)
        fac, art = name.split('-', 1)
        groups[fac][art].append(q)
    if not a.sheets:
        return
    sh = pathlib.Path(a.sheets)
    sh.mkdir(parents=True, exist_ok=True)
    cw, chh = 300, 260
    for fac, arts in groups.items():
        rows = sorted(arts)
        cols = max(len(v) for v in arts.values())
        sheet = Image.new('RGB', (cw * cols + 120, chh * len(rows)), (60, 72, 60))
        dr = ImageDraw.Draw(sheet)
        for r, art in enumerate(rows):
            dr.text((6, r * chh + chh // 2), art, fill=(255, 255, 255))
            for c, q in enumerate(sorted(arts[art])):
                im = Image.open(q)
                im.thumbnail((cw - 10, chh - 20))
                sheet.paste(im, (120 + c * cw + 5, r * chh + 15), im)
                dr.text((120 + c * cw + 5, r * chh + 2), q.stem.rsplit('-', 1)[1], fill=(255, 230, 120))
        sheet.save(sh / f'{fac}.jpg', quality=82)


if __name__ == '__main__':
    main()
