"""Коммерсы: заготовки панорам под img2img — на отобранную панораму рисуем асфальт по кривой из roads.json,
модель вписывает дорогу в сцену (denoise ~0.5–0.65) и замазывает старую. Пишет картинки в ComfyUI/input/kommersy/
и задание studio/jobs/kommersy/07-road-panos.yaml.
  G:/ai/ComfyUI/venv/Scripts/python.exe -I studio/post/road_templates.py [--only dvor-soviet-1,...] [--denoise 0.55,0.65]
"""
import argparse
import json
import pathlib
import sys

import yaml
from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'studio/post'))
ROADS = json.loads((ROOT / 'lavochka/src/games/kommersy/roads.json').read_text(encoding='utf-8'))
SRC = pathlib.Path('G:/temp/studio/out/kommersy/04-panoramas')
INPUT = pathlib.Path('G:/ai/ComfyUI/input/kommersy')
W, H = 1792, 896
K = W / 1600


def bez(p, t):
    seg, u = (0, t * 2) if t < 0.5 else (1, (t - 0.5) * 2)
    o = seg * 6
    k = [(1 - u) ** 3, 3 * (1 - u) ** 2 * u, 3 * (1 - u) * u ** 2, u ** 3]
    return (sum(k[i] * p[o + i * 2] for i in range(4)) * K, sum(k[i] * p[o + i * 2 + 1] for i in range(4)) * K)


def edges(road, half):
    """Края полотна: точки кривой, сдвинутые по нормали на half (пикселей заготовки)."""
    pts = [bez(road, i / 600) for i in range(601)]
    L, R = [], []
    for i, (x, y) in enumerate(pts):
        ax, ay = pts[max(0, i - 1)]
        bx, by = pts[min(600, i + 1)]
        d = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5 or 1
        nx, ny = -(by - ay) / d, (bx - ax) / d
        L.append((x + nx * half, y + ny * half))
        R.append((x - nx * half, y - ny * half))
    return L + R[::-1]


def template(src: pathlib.Path, road: list) -> Image.Image:
    im = Image.open(src).convert('RGB')
    w = ROADS['width'] * K
    d = ImageDraw.Draw(im)
    d.polygon(edges(road, w / 2 + 7), fill=(176, 172, 160))   # бордюр
    d.polygon(edges(road, w / 2), fill=(92, 92, 96))         # асфальт
    # маска: дорога с бордюром остаётся (непрозрачная), всё остальное модель рисует заново
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).polygon(edges(road, w / 2 + 4), fill=255)
    im.putalpha(m.filter(ImageFilter.GaussianBlur(2)))
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only')
    ap.add_argument('--denoise', default='0.9')
    ap.add_argument('--denoise2', type=float, default=0.3)
    a = ap.parse_args()
    sys.path.insert(0, str(ROOT / 'studio/post'))
    from pack_kommersy import PANO  # noqa: E402  (отбор — там же)
    manifest = {m['file']: m for m in json.loads((SRC / 'manifest.json').read_text(encoding='utf-8'))}
    INPUT.mkdir(parents=True, exist_ok=True)
    only = set(a.only.split(',')) if a.only else None
    items = []
    for place, parts in PANO.items():
        for i, p in enumerate(parts, 1):
            name = f'{place}-{i}'
            if only and name not in only:
                continue
            part, seed = p.split('-')
            file = f'{place}-{part}-{seed}.png'
            template(SRC / file, ROADS['roads'][i - 1]).save(INPUT / f'{name}.png')
            prompt = manifest[file]['prompt'].split('A single clear winding road')[0] + (
                'An empty grey asphalt road with light curbs winds across the whole picture from the left edge to the right edge, '
                'it lies flat on the ground and is clearly visible along its whole length, buildings, trees and cars stand beside the road, never on it, '
                'sidewalks along both sides. '
                'Tiny distant people only. No text, no letters, no signs with writing, no logos, no watermark.')
            for dn in a.denoise.split(','):
                items.append({'name': f'{name}-d{dn.replace("0.", "")}' if len(a.denoise.split(',')) > 1 else name, 'image': f'kommersy/{name}.png', 'denoise': float(dn), 'denoise2': a.denoise2, 'seeds': [int(seed)], 'prompt': prompt})
    job = {'workflow': 'z_image_img2img', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)', 'defaults': {'steps': 8}, 'items': items}
    out = ROOT / 'studio/jobs/kommersy/07-road-panos.yaml'
    out.write_text('# Коммерсы, партия 07: панорамы с дорогой по roads.json (img2img) — сгенерировано road_templates.py.\n'
                   + yaml.safe_dump(job, allow_unicode=True, sort_keys=False, width=200), encoding='utf-8')
    print(len(items), 'positions', out)


main()
