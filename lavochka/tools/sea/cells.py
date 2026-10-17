# Клетки по сетке из наклонных линий (grid-track.py): маска моря по цвету и фрагменты с подписями для ручной правки.
#   python cells.py mask <карта> <grid.json> <out.txt> <правило: piraty|kolonii>
#   python cells.py crops <карта> <grid.json> <mask.txt> <outdir> <cols> <rows>
import sys, json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import uniform_filter

def load(gj):
    d = json.load(open(gj))
    return d['v'], d['h']

def corner(v, h, i, j):
    # пересечение вертикали i (x = a + b*y) и горизонтали j (y = c + d*x)
    a, b = v[i][0], v[i][1]; c, d = h[j][0], h[j][1]
    y = (c + d * a) / (1 - d * b)
    return a + b * y, y

def center(v, h, i, j):
    pts = [corner(v, h, i + di, j + dj) for di in (0, 1) for dj in (0, 1)]
    return sum(p[0] for p in pts) / 4, sum(p[1] for p in pts) / 4

def seamask(im, rule):
    a = np.asarray(im).astype(float)
    r, g, b = [uniform_filter(a[..., k], 9) for k in range(3)]
    if rule == 'piraty':
        return (b > g + 10) & (r > g - 5) & (b > 150)
    return (b / (r + 1) > 0.5) & (r > 90)

cmd = sys.argv[1]
if cmd == 'mask':
    path, gj, out, rule = sys.argv[2:6]
    v, h = load(gj)
    im = Image.open(path).convert('RGB')
    sea = seamask(im, rule)
    with open(out, 'w', encoding='utf-8') as f:
        f.write('    ' + ''.join(str(i % 10) for i in range(len(v) - 1)) + '\n')
        for j in range(len(h) - 1):
            row = ''
            for i in range(len(v) - 1):
                x0, y0 = corner(v, h, i, j); x1, y1 = corner(v, h, i + 1, j + 1)
                m = sea[int(y0 + 10):int(y1 - 10), int(x0 + 10):int(x1 - 10)]
                row += '.' if m.size and m.mean() > 0.5 else '#'
            f.write('%3d ' % j + row + '\n')
elif cmd == 'crops':
    path, gj, maskf, outdir, cw, ch = sys.argv[2:8]; cw, ch = int(cw), int(ch)
    v, h = load(gj)
    mask = [l.rstrip('\n')[4:] for l in open(maskf, encoding='utf-8') if l[:3].strip().isdigit()]
    img = Image.open(path).convert('RGB'); W, H = img.size
    dr = ImageDraw.Draw(img); font = ImageFont.truetype('arial.ttf', 13)
    for a, b in [(p[0], p[1]) for p in v]: dr.line((a, 0, a + b * H, H), fill=(255, 0, 0), width=1)
    for c, d in [(p[0], p[1]) for p in h]: dr.line((0, c, W, c + d * W), fill=(255, 0, 0), width=1)
    nx, ny = len(v) - 1, len(h) - 1
    colors = {'.': (0, 150, 255), 'S': (255, 0, 255), 'P': (255, 0, 255), 'B': (0, 0, 0), 'T': (255, 255, 0)}
    for j in range(ny):
        for i in range(nx):
            x0, y0 = corner(v, h, i, j)
            dr.text((x0 + 2, y0 + 1), f'{i},{j}', fill=(200, 0, 0), font=font)
            m = mask[j][i] if j < len(mask) and i < len(mask[j]) else '#'
            if m != '#':
                cx, cy = center(v, h, i, j)
                dr.ellipse((cx - 6, cy - 6, cx + 6, cy + 6), outline=colors.get(m, (0, 200, 0)), width=3)
    os.makedirs(outdir, exist_ok=True)
    for cj in range(0, ny, ch):
        for ci in range(0, nx, cw):
            x0, y0 = corner(v, h, ci, cj); x1, y1 = corner(v, h, min(nx, ci + cw), min(ny, cj + ch))
            img.crop((int(x0) - 4, int(y0) - 4, int(x1) + 4, int(y1) + 4)).save(f'{outdir}/k{ci:02d}_{cj:02d}.png')
