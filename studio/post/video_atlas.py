"""Ролики анимаций существа (Wan i2v из одного эталона, камера неподвижна) → атлас «Героев» (webp + json).

G:/ai/venvs/3d/Scripts/python.exe studio/post/video_atlas.py <папка роликов> <имя> <выход: .../creatures> [--cpu]

В папке — <имя>-idle-*.mp4, -walk-, -attack-, -hit-, -defend-, -death- (берётся первый по алфавиту; -attack2 важнее -attack).
Все ролики начинаются с одного кадра, поэтому масштаб и опора (ноги) — общие, по первому кадру idle.
Петли (idle, move) — отрезок между двумя самыми похожими кадрами; вырезка фона — BiRefNet (MIT).
Формат атласа — как у creature_sprites.py: кадр 320, ряды idle/move/shoot/hit/defend/death, origin/top/muzzle.
"""
import argparse
import json
import pathlib
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
BIREFNET = 'G:/ai/models/birefnet'
FRAME = 320
ORIGIN = (160.0, 281.6)
HEIGHT = 150.0  # ноги → макушка (без оружия) в кадре атласа
# анимация игры: (ролик, кадров, fps, петля)
ANIMS = [('idle', 'idle', 10, 8, True), ('move', 'walk', 10, 12, True), ('shoot', 'attack', 12, 14, False),
         ('hit', 'hit', 8, 12, False), ('defend', 'defend', 6, 10, False), ('death', 'death', 12, 12, False)]


def frames_of(path):
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run([FFMPEG, '-v', 'error', '-i', str(path), f'{tmp}/%04d.png'], check=True)
        return [Image.open(p).convert('RGB').copy() for p in sorted(pathlib.Path(tmp).glob('*.png'))]


def loop_span(fr, n_min):
    """Отрезок [i, j) между двумя самыми похожими кадрами: петля без скачка."""
    small = [np.asarray(f.resize((48, 64))).astype(np.float32) for f in fr]
    best = (1e18, 0, len(fr))
    for i in range(0, len(fr) - n_min):
        for j in range(i + n_min, len(fr)):
            d = float(((small[i] - small[j]) ** 2).mean())
            if d < best[0]:
                best = (d, i, j)
    return best[1], best[2]


def outline(im, px=2, color=(52, 34, 20)):
    """Тонкий тёплый контур, как у toon-рендера прежних существ: фигура читается на любом поле."""
    from PIL import ImageFilter
    a = im.getchannel('A')
    ring = a.point(lambda v: 255 if v > 90 else 0).filter(ImageFilter.MaxFilter(px * 2 + 1)).filter(ImageFilter.GaussianBlur(0.6))
    base = Image.new('RGBA', im.size, color + (0,))
    base.putalpha(ring.point(lambda v: int(v * 0.85)))
    base.alpha_composite(im)
    return base


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('name')
    ap.add_argument('out')
    ap.add_argument('--cpu', action='store_true')
    a = ap.parse_args()
    import torch
    from torchvision import transforms
    from transformers import AutoModelForImageSegmentation
    dev = 'cpu' if a.cpu else 'cuda'
    net = AutoModelForImageSegmentation.from_pretrained(BIREFNET, trust_remote_code=True).to(dev).eval()
    net = net.half() if dev == 'cuda' else net.float()
    tf = transforms.Compose([transforms.Resize((1024, 1024)), transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])

    def cut(im):
        x = tf(im).unsqueeze(0).to(dev)
        if dev == 'cuda':
            x = x.half()
        with torch.no_grad():
            m = net(x)[-1].sigmoid()[0, 0].float().cpu().numpy()
        al = Image.fromarray((m * 255).astype(np.uint8)).resize(im.size, Image.BILINEAR)
        o = im.convert('RGBA')
        o.putalpha(al)
        return o

    src = pathlib.Path(a.src)
    clips = {}
    for _, key, *_ in ANIMS:
        cand = sorted(src.glob(f'{a.name}-{key}2-*.mp4')) or sorted(src.glob(f'{a.name}-{key}-*.mp4'))
        if cand:
            clips[key] = cand[0]
    if 'idle' not in clips:
        sys.exit('нет ролика idle')
    # общий масштаб и опора — по первому кадру idle
    first = cut(frames_of(clips['idle'])[0])
    al = np.asarray(first)[..., 3] > 128
    ys, xs = np.nonzero(al)
    bottom = ys.max()
    # макушка — первая строка, где фигура шире древка или дубины (оружие выше головы рост не считает)
    widths = al.sum(1)
    top = int(np.argmax(widths > widths.max() * 0.18))
    foot_x = float(np.median(xs[ys > bottom - 12]))
    k = HEIGHT / (bottom - top)
    print(f'опора x={foot_x:.0f} низ={bottom} рост={bottom - top}px → ×{k:.3f}', flush=True)

    rows = []
    meta = {'frame': FRAME, 'origin': list(ORIGIN), 'muzzle': [ORIGIN[0] + 44, ORIGIN[1] - 110], 'top': [ORIGIN[0], ORIGIN[1] - HEIGHT], 'anims': {}}
    for row, (anim, key, n, fps, loop) in enumerate(ANIMS):
        fr = frames_of(clips.get(key, clips['idle']))
        if loop:
            i, j = loop_span(fr, max(12, len(fr) // 3))
            fr = fr[i:j]
        idx = np.linspace(0, len(fr) - 1 - (1 if loop else 0), n).round().astype(int)
        cells = []
        for t in idx:
            o = cut(fr[t])
            w, h = o.size
            o = o.resize((round(w * k), round(h * k)), Image.LANCZOS)
            cell = Image.new('RGBA', (FRAME, FRAME))
            cell.alpha_composite(o, (round(ORIGIN[0] - foot_x * k), round(ORIGIN[1] - bottom * k)))
            cells.append(cell)
        rows.append(cells)
        meta['anims'][anim] = {'row': row, 'fps': fps, 'loop': loop, 'frames': n}
        print(anim, key, clips.get(key, '—'), flush=True)
    cols = max(len(r) for r in rows)
    atlas = Image.new('RGBA', (cols * FRAME, len(rows) * FRAME))
    for r, cells in enumerate(rows):
        for c, cell in enumerate(cells):
            atlas.alpha_composite(cell, (c * FRAME, r * FRAME))
    atlas = outline(atlas)
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    atlas.save(out / f'{a.name}.webp', 'WEBP', quality=88, method=6)
    (out / f'{a.name}.json').write_text(json.dumps(meta), encoding='utf-8')
    print('готово', out / f'{a.name}.webp', atlas.size)


def relink(path):
    """Обвести готовый атлас: python video_atlas.py --outline <атлас.webp>."""
    im = Image.open(path).convert('RGBA')
    outline(im).save(path, 'WEBP', quality=88, method=6)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--outline':
        relink(sys.argv[2])
    else:
        main()
