"""Лист анимаций для просмотра глазами: строка на анимацию с подписью, точки руки/головы из meta.json, GIF.

python studio/post/anim_sheet.py <папка кадров> <выход.png> [--only a,b] [--marks] [--crop 0.15,0,0.85,1] [--gif a,b --gifdir папка]
--marks — нарисовать точки: рука (красная, с чертой по углу), вторая рука (синяя), голова (зелёная), подошвы (жёлтая).
"""
import argparse
import json
import math
import pathlib
import re

from PIL import Image, ImageDraw


def checker(w, h, s=12):
    bg = Image.new('RGBA', (w, h), (205, 205, 205, 255))
    d = ImageDraw.Draw(bg)
    for y in range(0, h, s):
        for x in range(0, w, s):
            if (x // s + y // s) % 2:
                d.rectangle((x, y, x + s - 1, y + s - 1), fill=(232, 232, 232, 255))
    return bg


def marked(img, pt, origin):
    img = img.copy()
    d = ImageDraw.Draw(img)

    def dot(p, col, r=3):
        d.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=col)

    if pt:
        x, y, a = pt['hand']
        d.line((x, y, x + 14 * math.cos(math.radians(a)), y - 14 * math.sin(math.radians(a))), fill=(220, 0, 0), width=2)
        dot(pt['hand'], (220, 0, 0))
        dot(pt['hand2'], (30, 80, 230))
        dot(pt['head'], (0, 170, 60))
    dot(origin, (240, 200, 0), 2)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('frames')
    ap.add_argument('out')
    ap.add_argument('--only')
    ap.add_argument('--marks', action='store_true')
    ap.add_argument('--crop', default='0,0,1,1', help='доли кадра x0,y0,x1,y1')
    ap.add_argument('--cols', type=int, default=20)
    ap.add_argument('--gif')
    ap.add_argument('--gifdir')
    a = ap.parse_args()
    d = pathlib.Path(a.frames)
    meta = json.loads((d / 'meta.json').read_text(encoding='utf-8')) if (d / 'meta.json').exists() else {'anims': {}}
    anims: dict[str, list[pathlib.Path]] = {}
    for f in sorted(d.glob('*_[0-9][0-9].png')):
        anims.setdefault(re.sub(r'_\d\d$', '', f.stem), []).append(f)
    order = [n for n in meta['anims'] if n in anims] + [n for n in anims if n not in meta['anims']]
    if a.only:
        order = [n for n in order if n in a.only.split(',')]
    fw, fh = Image.open(anims[order[0]][0]).size
    c = [float(v) for v in a.crop.split(',')]
    box = (int(c[0] * fw), int(c[1] * fh), int(c[2] * fw), int(c[3] * fh))
    cw, ch = box[2] - box[0], box[3] - box[1]
    origin = meta.get('origin', [fw / 2, fh])
    label = 18

    def frame(name, i, f):
        img = Image.open(f).convert('RGBA')
        pts = meta['anims'].get(name, {}).get('points')
        if a.marks:
            img = marked(img, pts[i] if pts and i < len(pts) else None, origin)
        return img.crop(box)

    rows = []
    for name in order:
        files = anims[name]
        for r0 in range(0, len(files), a.cols):
            rows.append((name if r0 == 0 else '', name, files[r0:r0 + a.cols], r0))
    sheet = checker(a.cols * cw, len(rows) * (ch + label))
    dr = ImageDraw.Draw(sheet)
    for r, (title, name, files, r0) in enumerate(rows):
        y = r * (ch + label)
        m = meta['anims'].get(name, {})
        if title:
            dr.text((4, y + 3), f"{name}  {len(anims[name])} кадр., {m.get('fps', '?')} fps{', цикл' if m.get('loop') else ''}", fill=(0, 0, 0))
        for i, f in enumerate(files):
            sheet.alpha_composite(frame(name, r0 + i, f), (i * cw, y + label))
    sheet.save(a.out)
    print(a.out, sheet.size)

    if a.gif:
        gd = pathlib.Path(a.gifdir or pathlib.Path(a.out).parent)
        gd.mkdir(parents=True, exist_ok=True)
        for name in a.gif.split(','):
            fps = meta['anims'].get(name, {}).get('fps', 10)
            imgs = []
            for i, f in enumerate(anims[name]):
                bg = Image.new('RGBA', (cw, ch), (168, 190, 150, 255))
                bg.alpha_composite(frame(name, i, f))
                imgs.append(bg.convert('RGB').resize((cw * 2, ch * 2), Image.NEAREST))
            imgs[0].save(gd / f'{name}.gif', save_all=True, append_images=imgs[1:], duration=int(1000 / fps), loop=0)
        print('gif:', a.gif)


if __name__ == '__main__':
    main()
