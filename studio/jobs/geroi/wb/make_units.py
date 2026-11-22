"""«Герои»: массовая переделка существ на моделях Webbook (решение пользователя 2026-11-22: «да, всех»).

G:/ai/ComfyUI/venv/Scripts/python.exe -X utf8 studio/jobs/geroi/wb/make_units.py

Пишет w7-units-refine.yaml (FLUX 3 Klein: облик по прежнему эталону, детальнее, у людей — лица и обычные пропорции)
и w8-units-anims.yaml (Wan 2.2 14B: 6 анимаций из одного кадра), кладёт эталоны в G:/ai/out/webbook/geroi/refs/c-<id>.png.
Порядок — бесплатные фракции и нейтралы первыми. Атлас — studio/post/video_atlas.py.
"""
import pathlib
import re

import yaml
from PIL import Image

SRC = pathlib.Path('G:/Claude/Shish/lavochka/src/geroi/sim/creatures.ts')
REF3D = pathlib.Path('G:/temp/studio/out/geroi/20-creature-3d')
ATLAS = pathlib.Path('G:/Claude/Shish/lavochka/public/geroi/a/creatures')
OUT = pathlib.Path('G:/ai/out/webbook/geroi/refs')
HERE = pathlib.Path(__file__).parent
ORDER = ['neutral', 'zatulye', 'zatonye', 'kuznya', 'akademiya', 'plotina', 'ostrog', 'bazar', 'kurgany']
# пешие люди (как HUMANS в render/view.ts): лицо и обычные пропорции
HUMANS = {
    'zatulye-militia', 'zatulye-spearman', 'zatulye-slinger', 'zatulye-strelets', 'zatulye-vataga', 'zatulye-brodnik', 'zatulye-boatman', 'zatulye-ushkuynik', 'zatulye-herbalist', 'zatulye-wisewoman',
    'kuznya-apprentice', 'kuznya-smith', 'kuznya-riveter', 'kuznya-repeater', 'kuznya-founder', 'kuznya-firemistress', 'akademiya-student', 'akademiya-adept',
    'plotina-lockguard', 'plotina-gatekeeper', 'plotina-harpooner', 'plotina-whaler', 'plotina-seawitch', 'plotina-tidewitch',
    'ostrog-recruit', 'ostrog-druzhinnik', 'ostrog-skiarcher', 'ostrog-snowarcher', 'ostrog-shaman', 'ostrog-thundershaman',
    'bazar-pickpocket', 'bazar-cutpurse', 'bazar-pepperthrower', 'bazar-peppermaster', 'bazar-mirrorman', 'bazar-miragemaster',
    'kurgany-seeress', 'kurgany-mourner', 'neutral-bandit',
    # всадники и рыцари — тоже с лицом
    'zatulye-rider', 'zatulye-vityaz', 'ostrog-wolfrider', 'ostrog-bearguard', 'ostrog-bearknight', 'bazar-carpetrider', 'bazar-carpetace',
}
LICENSE_K = 'FLUX Kommunity License v1.0 (FLUX 3 Image Klein)'
LICENSE_W = 'Apache-2.0 (Wan 2.2 I2V A14B + lightx2v)'
STYLE_HUMAN = ('Stylized 3D game character render in the same style and colours as <ref_image_0>, but more detailed and refined: '
               'clear friendly face with eyes, nose and mouth, natural adult human proportions (head about one sixth of the height, not a big-headed chibi), '
               'well modelled hands, cloth folds, stitched leather, wood and metal texture. ')
STYLE_BEAST = ('Stylized 3D game creature render in the same style, shape and colours as <ref_image_0>, but more detailed and refined: '
               'clear readable eyes and face, well modelled limbs, fur, scales, feathers, metal or stone texture as appropriate. ')
STYLE_TAIL = ('The whole figure in frame from the lowest point to the top, three-quarter view facing right, camera slightly above. '
              'Plain flat very light grey background, soft even light, only a faint contact shadow underneath. No text.')
STATIC = ('The camera is completely static, locked off, the character stays in the same place in the centre of the frame; '
          'plain flat light grey background stays empty and unchanged; the 3D render style stays exactly the same.')


def creatures():
    out = []
    for m in re.finditer(r"\{ id: '([a-z-]+)', name: '([^']*)', tier: (\d)([^\n]*)", SRC.read_text(encoding='utf-8')):
        cid, name, tier, rest = m.groups()
        shots = re.search(r'shots: (\d+)', rest)
        ab = re.search(r'ab: \[([^\]]*)\]', rest)
        out.append({'id': cid, 'name': name, 'tier': int(tier), 'shots': int(shots.group(1)) if shots else 0,
                    'ab': re.findall(r"'(\w+)'", ab.group(1)) if ab else []})
    out.sort(key=lambda c: (ORDER.index(c['id'].split('-')[0]), c['id']))
    return out


def ref_image(cid):
    """Эталон на ровном сером фоне: вырезка, с которой делали 3D, иначе первый кадр атласа."""
    p = REF3D / cid / 'mesh-cut.png'
    if p.exists():
        im = Image.open(p).convert('RGBA')
    else:
        a = Image.open(ATLAS / f'{cid}.webp').convert('RGBA')
        im = a.crop((0, 0, 320, 320)).resize((640, 640), Image.LANCZOS)
    im = im.crop(im.getbbox())
    side = int(max(im.size) * 1.15)
    bg = Image.new('RGBA', (side, side), (226, 226, 222, 255))
    bg.alpha_composite(im, ((side - im.width) // 2, (side - im.height) // 2))
    bg.convert('RGB').save(OUT / f'c-{cid}.png')
    return im.width / im.height


def anim_prompts(c):
    fly = 'fly' in c['ab']
    machine = 'machine' in c['ab']
    ghost = 'ghost' in c['ab']
    who = 'The character'
    idle = (f'{who} hovers in the air on the spot, wings beating slowly and steadily, body gently bobbing.' if fly else
            f'{who} stands on the spot, gears turn and small puffs of steam rise, it sways slightly.' if machine else
            f'{who} floats on the spot, its ghostly body slowly waving like mist.' if ghost else
            f'{who} stands on the spot, breathes calmly, shifts its weight a little and looks around.')
    walk = (f'{who} flies on the spot, wings beating fast in a steady rhythm.' if fly else
            f'{who} walks on the spot with heavy mechanical steps, legs moving in a steady rhythm.' if machine else
            f'{who} drifts on the spot, swaying forward and back.' if ghost else
            f'{who} walks on the spot in a steady marching rhythm, legs and arms moving, without moving across the frame.')
    if c['shots']:
        attack = f'{who} aims to the right and shoots or throws its missile to the right with a clear release and recoil, then returns to its pose.'
    else:
        attack = f'Seen from the side: {who.lower()} lunges forward to the right and makes one strong attack to the right, then pulls back and returns to its pose. Its weapon or body keeps the same shape.'
    hit = f'{who} is struck: it flinches and recoils half a step backwards to the left, then recovers to its pose.'
    defend = f'{who} braces itself and takes a guarded defensive stance, shielding its body, then holds this guard.'
    death = (f'{who} breaks down: it shudders, sparks and steam burst out, and it quickly collapses to the ground in a heap and stays still.' if machine else
             f'{who} fades: it quickly dissolves into drifting mist and vanishes, leaving nothing.' if ghost else
             f'{who} is hit hard and quickly falls to the ground, lying flat and completely still for the rest of the clip.' if fly else
             f'{who} is defeated: it quickly drops and falls flat onto its side on the ground within the first second and then lies completely still.')
    return {'idle': (idle, 41), 'walk': (walk, 41), 'attack': (attack, 41), 'hit': (hit, 33), 'defend': (defend, 33), 'death': (death, 41)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    refine, anims = [], []
    for c in creatures():
        aspect = ref_image(c['id'])
        wide = aspect > 1.1
        human = c['id'] in HUMANS
        refine.append({'name': c['id'], 'image': f"refs/c-{c['id']}.png", 'width': 1024 if wide else 768, 'height': 768 if wide else 1024,
                       'prompt': f"The same {'character' if human else 'creature'} from <ref_image_0>, keeping its design, outfit, weapon and colours. "
                                 + (STYLE_HUMAN if human else STYLE_BEAST) + STYLE_TAIL})
        for key, (p, frames) in anim_prompts(c).items():
            anims.append({'name': f"{c['id']}-{key}", 'image': f"w7-units-refine/{c['id']}-11.png", 'prompt': f'{p} {STATIC}', 'frames': frames,
                          'width': 640 if wide else 480, 'height': 480 if wide else 640})
    head = '# Сгенерировано make_units.py — правки вносить туда.\n'
    (HERE / 'w7-units-refine.yaml').write_text(head + yaml.safe_dump(
        {'workflow': 'flux3_klein_ref1', 'server': 'comfy-big', 'license': LICENSE_K, 'seeds': [11],
         'defaults': {'steps': 16, 'ref_mp': 0.6}, 'items': refine}, allow_unicode=True, sort_keys=False, width=200), encoding='utf-8')
    neg = yaml.safe_load((HERE / 'w5-unit-anims.yaml').read_text(encoding='utf-8'))['defaults']['negative']
    (HERE / 'w8-units-anims.yaml').write_text(head + yaml.safe_dump(
        {'workflow': 'wan22_14b_i2v', 'server': 'comfy-big', 'license': LICENSE_W, 'ext': 'mp4', 'seeds': [7],
         'defaults': {'negative': neg}, 'items': anims}, allow_unicode=True, sort_keys=False, width=200), encoding='utf-8')
    print(len(refine), 'существ,', len(anims), 'роликов')


if __name__ == '__main__':
    main()
