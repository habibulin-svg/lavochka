"""Герои: новый ландшафт (пользователь 2026-11-07: «как акварель разлили» → чёткий, яркий, детальный).
Стиль A по пробе 60-terrain-probe. Пишет переделки партий карты и боя (*-redo9): pack_geroi.py берёт их вместо старых.
Декор и препятствия — без «своего клочка земли» (тень рисует игра), грунты — ровный тон и мелкая деталь.
python studio/jobs/geroi/make_jobs_terrain.py
"""
import pathlib
import sys

import yaml

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
from make_jobs import FIELDS, GROUNDS, OBSTACLES, TERRAINS  # noqa: E402
from make_jobs_w2 import FIELDS2, OBSTACLES2, TERRAINS2  # noqa: E402

STYLE = ('Crisp hand-painted 2D fantasy strategy game art in the manner of classic late 1990s turn-based strategy games, highly detailed, sharp clean edges, '
         'clearly readable shapes, bright vivid natural colors, even bright daylight.')
ISOLATED = 'Single isolated object, centered, whole object in frame with margin, plain light grey background.'
TILE = 'Uniform even tone across the whole square, fine small-scale detail, no large spots, fills the whole square.'
# грунты, у которых старое описание тянет «пейзаж» — уточнены
GROUND_FIX = {'water': 'clear bright blue water surface with small crisp ripples and sparkles, only water',
              'sand': 'fine light golden sand with tiny pebbles and small ripples',
              'underground': 'dark grey cave floor of flat stone slabs with small pebbles',
              'rough': 'rocky highland ground of grey stones and sparse dry grass tufts'}
MOUNTAINS = ['a rocky grey mountain massif with snow on the top', 'a group of green forested hills', 'a jagged dark volcanic ridge', 'a steep sandstone cliff']
MOUNTAINS2 = ['a snowy jagged mountain ridge', 'a high grey sea cliff', 'a flat-topped yellow mesa', 'a low heather hill with standing stones']


def ground(name, d):
    return {'name': f'ground-{name}', 'seeds': [71, 72, 73, 74],
            'prompt': f'{STYLE} Seamless top-down ground texture tile for a strategy game map: {GROUND_FIX.get(name, d)}. {TILE}'}


def sprite(name, d, seeds=(71, 72), w=1024, h=1024):
    return {'name': name, 'seeds': list(seeds), 'width': w, 'height': h,
            'prompt': f'{STYLE} Game scenery sprite seen from above in three-quarter view: {d}, standing alone, no ground under it. {ISOLATED}'}


def field(name, d):
    return {'name': f'field-{name}', 'seeds': [71, 72], 'width': 1920, 'height': 1088,
            'prompt': f'{STYLE} Battlefield background seen from high above at a steep angle, almost top-down: {d}. '
                      'The middle is open, flat and clear, an even surface with fine crisp detail.'}


def job(title, items):
    return {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)',
            'defaults': {'width': 1024, 'height': 1024, 'steps': 8}, 'seeds': [71, 72], 'items': items}, title


def main():
    m1 = [ground(t, d) for t, (d, _) in TERRAINS.items()] + [ground(g, d) for g, d in GROUNDS]
    m1 += [sprite(f'decor-{t}-{i + 1}', d) for t, (_, dec) in TERRAINS.items() for i, d in enumerate(dec)]
    m1 += [sprite(f'mountain-{i + 1}', d, w=1536, h=864) for i, d in enumerate(MOUNTAINS)]
    m2 = [ground(t, d) for t, (d, _) in TERRAINS2.items()]
    m2 += [sprite(f'decor-{t}-{i + 1}', d) for t, (_, dec) in TERRAINS2.items() for i, d in enumerate(dec)]
    m2 += [sprite(f'mountain-{i + 5}', d, w=1536, h=864) for i, d in enumerate(MOUNTAINS2)]
    b1 = [field(f, d) for f, d in FIELDS.items()] + [sprite(f'obstacle-{i + 1}', d) for i, d in enumerate(OBSTACLES)]
    b2 = [field(f, d) for f, d in FIELDS2.items()] + [sprite(f'obstacle-{i + 11}', d) for i, d in enumerate(OBSTACLES2)]
    for fname, (j, title) in {'13-map-redo9': job('карта: грунты, декор, горы', m1), '33-map-redo9': job('карта, волна 2', m2),
                              '14-battle-redo9': job('бой: поля, препятствия', b1), '34-battle-redo9': job('бой, волна 2', b2)}.items():
        (HERE / f'{fname}.yaml').write_text(f'# Герои, {fname}: новый ландшафт — {title}. Сгенерировано make_jobs_terrain.py.\n'
                                            + yaml.safe_dump(j, allow_unicode=True, sort_keys=False, width=200), encoding='utf-8')
        print(fname, len(j['items']))


if __name__ == '__main__' and not sys.argv[1:]:
    main()


# ------------------------------------------------------------------ переделка (redo9b): «standing alone» превращал кусты, пни и лужи в деревья
def plain(name, d, seeds=(81, 82, 83), w=1024, h=1024):
    return {'name': name, 'seeds': list(seeds), 'width': w, 'height': h,
            'prompt': f'{STYLE} Game scenery sprite seen from above in three-quarter view: {d}. {ISOLATED}'}


REDO_MAP = [plain('decor-swamp-1', 'a dead leafless twisted grey tree with bare crooked branches'),
            plain('decor-swamp-6', 'a small round grassy hummock, a low soft mound of moss and grass'),
            plain('mountain-2', 'a group of three rounded green hills covered with dense forest, irregular natural outline', w=1536, h=864),
            plain('decor-ash-1', 'a charred black dead tree without leaves')]
REDO_BATTLE = [plain('obstacle-3', 'a low round thorny bush with sharp thorns and small red berries, no trunk'),
               plain('obstacle-4', 'a short cut tree stump with roots and visible rings, no branches'),
               plain('obstacle-5', 'a flat muddy puddle of brown water, seen from above'),
               plain('obstacle-8', 'a heap of rusty mechanical scrap: gears, pipes and bolts, irregular pile'),
               plain('obstacle-9', 'a dead leafless grey tree with bare crooked branches')]


def redo():
    for fname, items in {'13-map-redo9b': REDO_MAP, '14-battle-redo9b': REDO_BATTLE}.items():
        j, _ = job('переделка', items)
        (HERE / f'{fname}.yaml').write_text(f'# Герои, {fname}: переделка нового ландшафта. Сгенерировано make_jobs_terrain.py redo.\n'
                                            + yaml.safe_dump(j, allow_unicode=True, sort_keys=False, width=200), encoding='utf-8')


if __name__ == '__main__' and sys.argv[1:] == ['redo']:
    redo()


# ------------------------------------------------------------------ переделка второй волны: «сеткой» вышли берег и вереск, плита вместо столовой горы
def ground_redo(name, d):
    return {'name': f'ground-{name}', 'seeds': [81, 82, 83, 84],
            'prompt': f'{STYLE} Seamless top-down ground texture for a strategy game map, natural irregular scattering without any grid or rows: {d}. {TILE}'}


REDO_MAP2 = [ground_redo('coast', 'wet dark grey pebble beach with small scattered stones and a few tufts of sea grass'),
             ground_redo('heath', 'low heather moorland, a soft carpet of tiny purple flowers mixed with grey-green grass'),
             plain('decor-saltflat-1', 'a dry leafless thorn tree with spiky bare branches'),
             plain('decor-saltflat-8', 'a small round natural turquoise spring among pale stones, irregular rounded outline'),
             plain('decor-heath-6', 'a dead grey juniper bush without needles, dry twisted twigs'),
             plain('decor-heath-7', 'a tall carved wooden totem pole with stern faces and painted ornaments'),
             plain('mountain-7', 'a tall flat-topped yellow sandstone mesa with steep layered cliffs, irregular natural outline', w=1536, h=864)]
REDO_BATTLE2 = [{'name': 'field-heath', 'seeds': [81, 82, 83], 'width': 1920, 'height': 1088,
                 'prompt': f'{STYLE} Battlefield background seen from high above, almost straight top-down, no sky and no horizon: a wide flat moor of short grey-green grass '
                           'with patches of purple heather, low burial mounds along the very top edge. The middle is open, flat and clear, an even surface with fine crisp detail.'}]


def redo2():
    for fname, items in {'33-map-redo9b': REDO_MAP2, '34-battle-redo9b': REDO_BATTLE2}.items():
        j, _ = job('переделка', items)
        (HERE / f'{fname}.yaml').write_text(f'# Герои, {fname}: переделка нового ландшафта. Сгенерировано make_jobs_terrain.py redo2.\n'
                                            + yaml.safe_dump(j, allow_unicode=True, sort_keys=False, width=200), encoding='utf-8')


if __name__ == '__main__' and sys.argv[1:] == ['redo2']:
    redo2()


# ------------------------------------------------------------------ переделка 3: плоские грунты бора и пепелища
REDO_MAP3 = [ground_redo('pine', 'forest floor of brown pine needles with patches of dark green moss, small ferns, twigs and scattered cones, rich natural variation'),
             ground_redo('ash', 'dark charcoal ash ground with cracked black basalt plates, grey cinders and thin cracks glowing orange'),
             ground_redo('swamp', 'boggy marsh ground: wet dark green moss, tufts of sedge, small murky puddles, rich natural variation')]


if __name__ == '__main__' and sys.argv[1:] == ['redo3']:
    j, _ = job('переделка 3', REDO_MAP3)
    (HERE / '13-map-redo9c.yaml').write_text('# Герои, 13-map-redo9c: плоские грунты бора, пепелища, болота. Сгенерировано make_jobs_terrain.py redo3.\n'
                                             + yaml.safe_dump(j, allow_unicode=True, sort_keys=False, width=200), encoding='utf-8')
