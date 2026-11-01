"""Кадры <анимация>_NN.png (+ meta.json из gopnik_sprites.py) → упакованный атлас + JSON для игры + лист просмотра.

python studio/post/atlas.py <папка кадров> <выход без расширения> [--width 2048] [--pad 1]

Кадры обрезаются по непрозрачному (trim), одинаковые кадры хранятся один раз, укладка полками.
<выход>.json — формат спрайт-листа PixiJS (frames/animations/meta) плюс наше в meta.anims:
  frames[имя_NN]: frame (в атласе), spriteSourceSize (где обрезок в исходном кадре), sourceSize, anchor (подошвы);
  animations[имя]: список кадров;
  meta.frameW/frameH, meta.origin — точка подошв в исходном кадре (px);
  meta.anims[имя]: fps, loop, frames, points[кадр] = {hand, hand2, head, foot: [x, y, угол°]} — в пикселях
  исходного кадра (0,0 — левый верх), угол: 0 — вправо, + — против часовой. hand — рука к камере (оружие),
  hand2 — дальняя, head — середина кепки (угол — наклон головы, 90 — прямо), foot — щиколотка ближней ноги.
<выход>.webp — то же без потерь (для игры), <выход>-preview.png — атлас на клетчатом фоне.
"""
import argparse
import hashlib
import json
import pathlib
import re

from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('frames')
    ap.add_argument('out')
    ap.add_argument('--width', type=int, default=2048)
    ap.add_argument('--pad', type=int, default=1)
    a = ap.parse_args()
    d = pathlib.Path(a.frames)
    meta_in = json.loads((d / 'meta.json').read_text(encoding='utf-8')) if (d / 'meta.json').exists() else {'anims': {}}
    anims: dict[str, list[pathlib.Path]] = {}
    for f in sorted(d.glob('*_[0-9][0-9].png')):
        anims.setdefault(re.sub(r'_\d\d$', '', f.stem), []).append(f)
    order = [n for n in meta_in['anims'] if n in anims] + [n for n in anims if n not in meta_in['anims']]
    fw, fh = Image.open(anims[order[0]][0]).size
    ox, oy = meta_in.get('origin', [fw / 2, fh])

    # обрезка и склейка одинаковых
    uniq: dict[str, dict] = {}
    frame_of: dict[str, str] = {}
    for name in order:
        for f in anims[name]:
            img = Image.open(f).convert('RGBA')
            bb = img.getchannel('A').getbbox() or (0, 0, 1, 1)
            crop = img.crop(bb)
            h = hashlib.sha1(crop.tobytes() + repr(bb).encode()).hexdigest()
            uniq.setdefault(h, {'img': crop, 'bb': bb})
            frame_of[f.stem] = h

    # полки: по убыванию высоты
    p = a.pad
    items = sorted(uniq.items(), key=lambda kv: -kv[1]['img'].height)
    x = y = shelf = 0
    for _, it in items:
        w, h = it['img'].size
        if x + w + p > a.width:
            x, y, shelf = 0, y + shelf + p, 0
        it['xy'] = (x + p, y + p)
        x += w + p
        shelf = max(shelf, h)
    H = y + shelf + 2 * p
    atlas = Image.new('RGBA', (a.width, H), (0, 0, 0, 0))
    for _, it in items:
        atlas.paste(it['img'], it['xy'])

    out = pathlib.Path(a.out)
    frames = {}
    for stem, h in frame_of.items():
        it = uniq[h]
        (x0, y0), (w, hh), bb = it['xy'], it['img'].size, it['bb']
        frames[stem] = {
            'frame': {'x': x0, 'y': y0, 'w': w, 'h': hh}, 'rotated': False, 'trimmed': True,
            'spriteSourceSize': {'x': bb[0], 'y': bb[1], 'w': w, 'h': hh},
            'sourceSize': {'w': fw, 'h': fh}, 'anchor': {'x': round(ox / fw, 4), 'y': round(oy / fh, 4)},
        }
    meta = {'image': out.with_suffix('.png').name, 'format': 'RGBA8888', 'size': {'w': a.width, 'h': H}, 'scale': 1,
            'frameW': fw, 'frameH': fh, 'origin': [ox, oy], 'anims': {}}
    for name in order:
        m = meta_in['anims'].get(name, {})
        meta['anims'][name] = {'fps': m.get('fps', 10), 'loop': m.get('loop', False), 'frames': len(anims[name]),
                               'points': m.get('points', [])}
    doc = {'frames': frames, 'animations': {n: [f.stem for f in anims[n]] for n in order}, 'meta': meta}
    atlas.save(out.with_suffix('.png'), optimize=True)
    atlas.save(out.with_suffix('.webp'), lossless=True, method=4)  # для игры: в разы легче PNG
    out.with_suffix('.json').write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    bg = Image.new('RGBA', atlas.size, (200, 200, 200, 255))
    for yy in range(0, atlas.height, 16):
        for xx in range(0, atlas.width, 16):
            if (xx // 16 + yy // 16) % 2:
                bg.paste((230, 230, 230, 255), (xx, yy, xx + 16, yy + 16))
    bg.alpha_composite(atlas)
    bg.convert('RGB').save(str(out) + '-preview.png')
    print(out.with_suffix('.png'), atlas.size, f'{len(frame_of)} кадров, уникальных {len(uniq)}, анимаций {len(order)}')


if __name__ == '__main__':
    main()
