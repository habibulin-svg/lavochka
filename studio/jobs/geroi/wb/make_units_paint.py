"""«Герои»: все существа в живописном стиле (решение пользователя 2026-11-24 после пробы Затулья: «да, всех так»).

G:/ai/ComfyUI/venv/Scripts/python.exe -X utf8 studio/jobs/geroi/wb/make_units_paint.py still
    → p1-units-paint.yaml: Klein ref2, облик — прежний эталон refs/c-<id>.png, манера письма — портрет героя refs/z-portrait.png
      (берём только технику: иначе к существу прилипает лицо и одежда с портрета).
G:/ai/ComfyUI/venv/Scripts/python.exe -X utf8 studio/jobs/geroi/wb/make_units_paint.py pad
    → refs/p-<id>.png: кадр с полями (широкие и летуны не упираются в край ролика), p2-units-paint-anims.yaml (Wan 2.2, 6 анимаций).
Атласы — STAGE=p2-units-paint-anims bash studio/post/atlas_worker.sh.
"""
import pathlib
import sys

import numpy as np
import yaml
from PIL import Image
from scipy import ndimage

from make_units import HUMANS, LICENSE_K, LICENSE_W, anim_prompts, creatures

ROOT = pathlib.Path('G:/ai/out/webbook/geroi')
HERE = pathlib.Path(__file__).parent
DONE = {'zatulye-militia', 'neutral-bandit', 'zatulye-vityaz', 'neutral-bear'}  # проба z3/z4
SEED = 11
TECH = ('Painted with only the oil painting technique and warm lighting of <ref_image_1> (its brushwork, not its person, face or clothes). ')
TAIL = ('Whole figure in frame from the lowest point to the very top, three-quarter view facing right, '
        'plain flat light grey background, soft warm light from the left, faint contact shadow. Not cartoon, not chibi, no outlines. No text.')
HUMAN = ('The same character as <ref_image_0>: same outfit, weapon, colours and gender. ' + TECH +
         'A semi-realistic person with natural adult proportions and a weathered expressive face, believable wool, linen, leather, wood and iron with wear and dirt, Slavic medieval fantasy. ')
BEAST = ('The same creature as <ref_image_0>: same design, shape, parts and colours. ' + TECH +
         'A semi-realistic believable creature with correct anatomy and real textures of fur, feathers, scales, skin, bark, stone or water as appropriate, Slavic fantasy bestiary. ')
MACHINE = ('The same contraption as <ref_image_0>: same design, shape, parts and colours. ' + TECH +
           'A semi-realistic believable machine of forged iron, riveted plates, brass, wood and glowing coals, with soot, rust and wear. ')
GHOST = ('The same spirit as <ref_image_0>: same design, shape and colours. ' + TECH +
         'A semi-realistic eerie translucent apparition with soft glow and drifting mist, believable folds of its shroud. ')
STATIC = ('The camera is completely static, locked off, the character stays in the same place in the centre of the frame; '
          'plain flat light grey background stays empty and unchanged; the hand-painted oil painting style stays exactly the same.')


def wide(cid):
    im = Image.open(ROOT / 'w7-units-refine' / f'{cid}-11.png')
    return im.width > im.height


def todo():
    return [c for c in creatures() if c['id'] not in DONE]


def still():
    items = []
    for c in todo():
        ab = c['ab']
        body = HUMAN if c['id'] in HUMANS else MACHINE if 'machine' in ab else GHOST if 'ghost' in ab else BEAST
        w = wide(c['id'])
        items.append({'name': c['id'], 'image': f"refs/c-{c['id']}.png", 'image2': 'refs/z-portrait.png',
                      'width': 1024 if w else 768, 'height': 768 if w else 1024, 'prompt': body + TAIL})
    (HERE / 'p1-units-paint.yaml').write_text('# Сгенерировано make_units_paint.py — правки вносить туда.\n' + yaml.safe_dump(
        {'workflow': 'flux3_klein_ref2', 'server': 'comfy-big', 'license': LICENSE_K, 'seeds': [SEED],
         'defaults': {'steps': 20, 'ref_mp': 0.6}, 'items': items}, allow_unicode=True, sort_keys=False, width=200), encoding='utf-8')
    print(len(items), 'существ')


def pad_one(src, dst, fly):
    """Фигура — не больше 64% ширины и 74% высоты кадра, ноги на 90% высоты; летунам запас сверху под взмах крыльев."""
    im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
    H, W = im.shape[:2]
    corners = np.concatenate([im[:8, :8].reshape(-1, 3), im[:8, -8:].reshape(-1, 3), im[-8:, :8].reshape(-1, 3), im[-8:, -8:].reshape(-1, 3)])
    bgc = np.median(corners, 0)
    d = np.sqrt(((im - bgc) ** 2).sum(2)) > 45
    ys, xs = np.nonzero(d)
    # фон расписан (виньетка) — рамку фигуры по сильному отличию и без крайних 0.5% точек
    y0, y1 = np.percentile(ys, 0.5), np.percentile(ys, 99.5)
    x0, x1 = np.percentile(xs, 0.5), np.percentile(xs, 99.5)
    fw, fh = x1 - x0, y1 - y0
    k = min(1.0, W * 0.64 / fw, H * (0.66 if fly else 0.74) / fh)
    if k > 0.97:
        Image.fromarray(im.astype(np.uint8)).save(dst)
        return
    # вся картина уменьшается, края продолжаются краевыми пикселями — без рамки-заплатки
    sm = np.asarray(Image.fromarray(im.astype(np.uint8)).resize((round(W * k), round(H * k)), Image.LANCZOS))
    cx, by = (x0 + x1) / 2 * k, y1 * k
    left = round(W / 2 - cx)
    top = round(H * (0.86 if fly else 0.9) - by)
    pl, pt = max(0, left), max(0, top)
    pr, pb = max(0, W - left - sm.shape[1]), max(0, H - top - sm.shape[0])
    big = np.pad(sm, ((pt, pb), (pl, pr), (0, 0)), mode='edge')
    ox, oy = pl - left, pt - top
    big = big[oy:oy + H, ox:ox + W].astype(np.float32)
    inside = np.zeros((H, W), np.float32)
    iy, ix = max(0, top), max(0, left)
    inside[iy + 6:min(H, top + sm.shape[0]) - 6, ix + 6:min(W, left + sm.shape[1]) - 6] = 1
    inside = ndimage.gaussian_filter(inside, 6)[..., None]
    soft = ndimage.gaussian_filter(big, (30, 30, 0))
    Image.fromarray(np.clip(big * inside + soft * (1 - inside), 0, 255).astype(np.uint8)).save(dst)


def pad():
    neg = yaml.safe_load((HERE / 'w5-unit-anims.yaml').read_text(encoding='utf-8'))['defaults']['negative']
    anims = []
    for c in todo():
        # p1b — переделка людей, духов и стоявших на подставке (без портрета), она главнее p1
        src = ROOT / 'p1b-units-paint' / f"{c['id']}-{SEED}.png"
        if not src.exists():
            src = ROOT / 'p1-units-paint' / f"{c['id']}-{SEED}.png"
        if not src.exists():
            print('нет кадра', c['id'])
            continue
        pad_one(src, ROOT / 'refs' / f"p-{c['id']}.png", 'fly' in c['ab'])
        w = wide(c['id'])
        for key, (p, frames) in anim_prompts(c).items():
            anims.append({'name': f"{c['id']}-{key}", 'image': f"refs/p-{c['id']}.png", 'prompt': f'{p} {STATIC}', 'frames': frames,
                          'width': 640 if w else 480, 'height': 480 if w else 640})
    (HERE / 'p2-units-paint-anims.yaml').write_text('# Сгенерировано make_units_paint.py — правки вносить туда.\n' + yaml.safe_dump(
        {'workflow': 'wan22_14b_i2v', 'server': 'comfy-big', 'license': LICENSE_W, 'ext': 'mp4', 'seeds': [7],
         'defaults': {'negative': neg}, 'items': anims}, allow_unicode=True, sort_keys=False, width=200), encoding='utf-8')
    print(len(anims), 'роликов')


if __name__ == '__main__':
    {'still': still, 'pad': pad}[sys.argv[1]]()
