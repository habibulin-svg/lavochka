"""Герои: постройки замков заново (2026-11-06, по замечанию пользователя «они же все одинаковые»).

Старые промпты (make_jobs.py / make_jobs_w2.py, партии 12/32) ставили длинный стиль фракции впереди назначения —
модель рисовала одну и ту же избу с башенкой на любую постройку. Здесь наоборот: сначала узнаваемый силуэт
постройки (что это и чем отличается), стиль фракции — коротко, только материалы. Отрицаний нет (урок Z-Image).

python studio/jobs/geroi/make_jobs_bld.py [фракция ...]  → studio/jobs/geroi/42-buildings.yaml
"""
import sys

import yaml

from make_jobs import GOUACHE, HERE, ISOLATED, TOWNS
from make_jobs_w2 import TOWNS2

# стиль фракции — только материал и отделка, без башен и форм зданий
MATERIAL = {
    'zatulye': 'built of weathered golden-brown logs with grey plank roofs and carved wooden trim',
    'zatonye': 'built of grey driftwood, reeds and willow, standing on wooden stilts over dark water with lily pads',
    'kuznya': 'built of red brick and dark riveted iron with copper details and soot stains',
    'akademiya': 'built of white limestone and pale pine wood with silver roofs and blue glass',
    'plotina': 'built of grey granite blocks with slate roofs and brass fittings, wet with sea spray',
    'ostrog': 'built of dark tarred logs with thick snow on the roofs and icicles',
    'bazar': 'built of sand-colored clay brick with striped red and gold silk awnings and turquoise tiles',
    'kurgany': 'built of rough grey standing stones, green turf and dark bronze, with heather around',
}

# жилища существ: у каждого своя форма и примета существа (старые описания в одно-два слова давали одинаковые дома)
DWELL = {
    'zatulye': [
        'militia barracks: a long low guardhouse with a rack of tall boar spears leaning along the wall and a straw training dummy in front',
        'archers range: an open shooting yard with three round straw targets on stands, a small roofed shelter and bundles of arrows',
        'river wanderers camp: a cluster of three conical hide tents around a campfire with a cooking pot and fishing nets on poles',
        'boat shed: a long open shed on the riverbank with two long narrow oared river boats pulled up on wooden rollers',
        'herbalist hut: a tiny round hut with a steep thatched roof, bundles of drying herbs hanging from the eaves and a bubbling cauldron outside',
        'knights stable: a two-storey stable with tall arched doors, a white war horse in armor tied at the gate and shields on the wall',
        'aurochs pen: a huge round paddock of thick logs with a giant black bull with glowing horns inside and a carved ox-head arch over the gate',
    ],
    'zatonye': [
        'reed cutters huts: two small round reed huts on short stilts connected by a plank bridge over the water, bundles of cut reeds',
        'frog pond: a round pond with giant lily pads and a small hut shaped like a sitting frog on the bank',
        'will-o-wisp hollow: a dark mossy hollow among twisted roots with several floating glowing blue-green lights',
        'old willow grove: a ring of huge ancient weeping willows with faces in their bark around a small dark pond',
        'water maiden pool: a round stone pool with steps going down into glowing water, white water lilies and a carved stone arch',
        'troll den: a huge cave under a fallen giant tree trunk with a big round boulder door and a fence of bones',
        'serpent lair: a deep misty rock crevice with a giant coiled scaled serpent tail visible inside and dark water',
    ],
    'kuznya': [
        'apprentice smithy: a small brick workshop with an open front, two anvils outside and tongs and hammers on a rack',
        'wasp hive: a tall cone-shaped hive of copper honeycomb plates on iron legs with small metal wasps buzzing around',
        'crossbow workshop: a brick shed with giant crossbows on a rack outside and a target wall with bolts sticking in it',
        'hound kennel: a row of iron kennels with steam vents, glowing furnace eyes in the doorways and chains',
        'smelting house: a round brick foundry with a big crucible pouring glowing molten metal into molds',
        'cannon walker hangar: a tall open hangar with a huge iron mortar standing on mechanical legs inside, chains and a gantry',
        'colossus gantry: a tall iron scaffolding tower with a giant iron head and arm hanging from chains, sparks of welding',
    ],
    'akademiya': [
        'student hall: a neat two-storey white stone college with arched windows, a small bell turret and an open book carved over the door',
        'owl tower: a slim round tower with many perches and round openings, large white owls sitting on it',
        'prism hall: a pavilion with tall glowing crystal prisms standing like pillars, rainbows of light around it',
        'moon deer glade: a fenced glade with a white stone gate shaped like antlers and a silver deer grazing beside a pool',
        'pine guardians grove: a ring of tall pines with lanterns hanging from branches and a carved pine-wood gatehouse',
        'dragon perch: a high rock pillar with a wide round stone platform on top, a starry blue dragon curled on it',
        'fallen star crater: a crater with a glowing star stone in the middle surrounded by a ring of white stone arches',
    ],
    'plotina': [
        'sluice guardhouse: a small square stone blockhouse built over a little sluice gate with a brass wheel and a lantern',
        'whalers wharf: a wooden pier with giant harpoons on racks, a whale jawbone arch at the entrance and nets drying on poles',
        'storm bird cliff: a tall sea cliff rock with big nests on ledges, storm birds with crackling lightning wings',
        'triton grotto: a sea cave in a rock with a pool and wide steps going down into the water, a carved trident over the entrance',
        'tide witch hut: a crooked hut on stilts in the surf, covered in seashells and kelp, a lantern of green fire',
        'storm bull pen: a stone corral by the surf with a huge blue bull with crackling lightning horns inside',
        'titan basin: a giant round flooded stone basin with a whirlpool in the middle and a huge stone hand rising from the water',
    ],
    'ostrog': [
        'guard barracks: a long log barracks with a training yard, a row of round shields on the fence and a war horn on a post',
        'ski hunters lodge: a small log lodge with skis and bows leaning against the wall and a deer hide stretched on a frame',
        'wolf kennel: a fenced log yard with grey wolves inside and a wolf skull over the gate',
        'bear pit: a deep round pit with a log roof on posts and a carved bear head over the entrance, a big armored bear inside',
        'shaman tent: a tall cone tent of hides with deer antlers on top, drums and bone charms hanging around it',
        'mammoth stable: a huge long log stable with an enormous arched gate and a woolly mammoth with tusks standing in front',
        'ice cave: a cave entrance in a glacier with giant icicles and a huge carved ice door',
    ],
    'bazar': [
        'thieves den: a small crooked clay house with a dark curtained doorway, rope ladders and a hidden roof hatch',
        'pepper shop: an open stall piled with big baskets and sacks of red, orange and yellow spices, ropes of dried red peppers hanging',
        'carpet workshop: a courtyard with big colorful carpets hanging on frames and one flying carpet hovering above',
        'hall of mirrors: a domed pavilion with walls of tall shining mirrors and shimmering mirage light',
        'caravan yard: a walled yard with a huge pack bull loaded with bundles, crates and saddlebags, and a drinking trough',
        'genie lamp tower: a slim tower topped by a giant golden oil lamp with blue smoke rising and curling',
        'serpent sand pit: a round sandy pit with a domed roof on columns and a big golden-scaled serpent coiled inside on piles of coins',
    ],
    'kurgany': [
        'wanderers stone fold: a low circular stone wall fold with a few shadowy grey ghost figures and a lone pole with rags',
        'idol ring: a ring of tall carved stone idols with stern faces around a small fire',
        'ghost horse corral: a stone corral with pale glowing riderless horses inside and old saddles on the wall',
        'bronze warrior barrow: a grass-covered burial mound with a big bronze door and two bronze shields on posts',
        'mourners hut: a low hut of bones and heather with candles and long white veils hanging at the door',
        'eagle rock: a tall rock with a huge nest of bones on top and a giant eagle spreading its wings',
        'royal barrow: a huge grass-covered royal burial mound with a stone gate of three giant slabs and bronze braziers burning',
    ],
}

# общие постройки: главное — силуэт, по которому их узнаёшь с первого взгляда
COMMON = [
    ('hall', 'the town hall: the largest and grandest building, a wide two-storey council hall with a tall central clock tower, '
             'a broad front staircase leading to big double doors, and flags on the roof'),
    ('fort', 'a fortress: a ring of tall thick defensive walls with battlements, a big arched gate in the middle and four round corner towers, '
             'a courtyard inside the walls'),
    ('tavern', 'a small cozy tavern: a low one-storey inn with a big carved wooden beer mug hanging over the door, '
               'wooden tables and benches outside, barrels stacked by the door, warm light in the windows'),
    ('market', 'an open market square: three rows of wooden stalls under bright colorful cloth awnings, piled with fruit, pots, cloth and sacks, '
               'a small fountain in the middle'),
    ('guild', 'a mage guild: one very tall slender round tower with a pointed roof, glowing purple windows spiralling up, '
              'a crescent moon finial on top and magic sparks around the top'),
    ('smithy', 'a blacksmith forge: a low open-sided workshop under a lean-to roof with one huge wide chimney pouring black smoke, '
               'a glowing orange forge fire inside, a big iron anvil in front and swords and axes on racks'),
    ('storehouse', 'a storehouse yard: a long low barn with wide open doors, big stacks of barrels, crates, sacks and timber in front of it'),
    ('shipyard', 'a shipyard: a half-built wooden boat on a sloping slipway at the edge of the water, '
                 'wooden scaffolding around the hull and a small lifting crane'),
]


def buildings(fid: str) -> list[tuple[str, str]]:
    t = TOWNS.get(fid) or TOWNS2[fid]
    return COMMON + [(f'dwell{i + 1}', d) for i, d in enumerate(DWELL[fid])] + list(t['unique'])


def site(fid: str) -> str:
    """Фон экрана замка как в классических «Героях»: пустая земля крупным планом на весь кадр, горизонт высоко.
    Слово «город» не писать — Z-Image сразу рисует сотню домиков."""
    t = TOWNS.get(fid) or TOWNS2[fid]
    return (f'{GOUACHE} A wide empty landscape seen close up from a low viewpoint: broad open ground with grass, bare earth patches, '
            f'dirt paths and wildflowers fills most of the picture, gently rising toward the back in two or three broad flat terraces. '
            f'The horizon line is high, near the top edge, with a narrow strip of sky. '
            f'The scenery is {t["site"]}, shown only at the far left and right edges and along the distant horizon. '
            f'Wild untouched land, quiet and calm.')


def items(factions):
    out = []
    for fid in factions:
        out.append({'name': f'town-{fid}-site', 'width': 1536, 'height': 864, 'seeds': [21, 22], 'prompt': site(fid)})
        for bid, d in buildings(fid):
            out.append({'name': f'bld-{fid}-{bid}',
                        'prompt': f'{GOUACHE} A building for a fantasy strategy game town screen, three-quarter view from slightly above: {d}. '
                                  f'It is {MATERIAL[fid]}. {ISOLATED}'})
    return out


def main():
    factions = sys.argv[1:] or list(MATERIAL)
    job = {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)',
           'defaults': {'width': 1024, 'height': 1024, 'steps': 8}, 'seeds': [21],  # постройки — один вариант (проба: первый почти всегда годен), панорамы — два
           'items': items(factions)}
    dst = HERE / '42-buildings.yaml'
    dst.write_text('# Герои, партия 42: постройки замков заново — силуэт постройки главный, стиль фракции — материалом\n'
                   '# Сгенерировано make_jobs_bld.py — правки вносить туда.\n'
                   + yaml.safe_dump(job, allow_unicode=True, sort_keys=False, width=160), encoding='utf-8', newline='\n')
    print(dst, len(job['items']), 'построек')


if __name__ == '__main__':
    main()
