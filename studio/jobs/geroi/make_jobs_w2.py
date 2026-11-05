"""Герои, вторая волна (платная часть, решение пользователя 2026-11-06): 4 фракции, кампании 3–6 и финал «Кастет».

python studio/jobs/geroi/make_jobs_w2.py
Пишет studio/jobs/geroi/3x-*.yaml и creatures-w2.json (очередь 3D). Общие приёмы и стиль — из make_jobs.py.
Фракции — DESIGN §5.5–5.8, кампании — docs/geroi/CAMPAIGNS2.md. Уроки первой волны учтены в промптах:
никаких рыб и китов на поле (замечание пользователя), «adventure map» только у объектов, без названий в кавычках, без кентавров.
"""
import json

import yaml

from make_jobs import (CREATURE3D, GOUACHE, HERE, ICON, ISOLATED, LOOK, MOTION, NEW_AGE, OUT, COMMON_BUILDINGS, FORMS, SIEGE_PARTS, VARIANTS,
                       image_job, write)

FACTIONS2 = {
    'plotina': {
        'ru': 'Плотина бурь', 'look': 'storm dam keepers of a rocky sea coast, slate grey stone, sea teal, white foam and brass',
        'units': [
            ('lockguard', 1, 0, 'a sturdy dam guard with a tall rectangular iron-bound shield and a short trident, oilskin coat and a brass helmet'),
            ('gatekeeper', 1, 1, 'a veteran lock keeper warrior with a huge tower shield shaped like a sluice gate and a heavy trident'),
            ('harpooner', 2, 0, 'a coastal harpooner with a long harpoon on a rope coil, oilskin hood and sea boots'),
            ('whaler', 2, 1, 'a grizzled harpoon master with a heavy brass harpoon launcher on his shoulder, thick oilskin coat, rope coils'),
            ('stormbird', 3, 0, 'a big grey-white storm petrel bird with sharp wings and blue lightning sparks on its feathers, standing'),
            ('thunderbird', 3, 1, 'a large majestic thunder eagle with dark blue feathers crackling with white lightning, standing with wings half open'),
            ('triton', 4, 0, 'a muscular sea triton warrior: humanoid with blue-green scaly skin, fin crest on the head, two legs, holding a coral spear'),
            ('tritonherd', 4, 1, 'a tall triton chieftain with teal scales, fin crest, two legs, a conch horn on the belt and a long trident'),
            ('seawitch', 5, 0, 'a sea witch woman in a robe of grey kelp with a staff topped by a swirling water orb, wet dark hair'),
            ('tidewitch', 5, 1, 'a tide witch with white hair flowing like foam, a robe of sea shells and a staff with a glowing whirlpool'),
            ('stormbull', 6, 0, 'a huge grey bull with sea-blue hide, white foam-like mane and brass rings on its horns, standing on four legs'),
            ('tempestbull', 6, 1, 'an enormous storm bull with dark hide, lightning crackling between its horns and glowing blue eyes, standing on four legs'),
            ('tidegiant', 7, 0, 'a giant humanoid water elemental made of rolling sea waves and foam, with arms and legs of water, rocks in its chest'),
            ('stormtitan', 7, 1, 'a towering storm titan humanoid of dark sea water and storm clouds, lightning inside, a crown of white foam'),
        ]},
    'ostrog': {
        'ru': 'Северный острог', 'look': 'northern taiga fort warriors, dark brown sheepskin, dark wood, blackened iron, dark forest green and muted crimson cloth, no white fur trim, no Santa Claus look',
        'units': [
            ('recruit', 1, 0, 'a young recruit soldier in a dark green padded quilted coat and a grey wolf fur hat with a short spear and a small round wooden shield'),
            ('druzhinnik', 1, 1, 'a hardened northern guardsman in chainmail over furs, a conical helmet with a nose guard, axe and red round shield'),
            ('skiarcher', 2, 0, 'a young human hunter archer with a bare face on short wooden skis with a long bow, a dark green hooded sheepskin coat and a quiver'),
            ('snowarcher', 2, 1, 'a veteran snow archer in a white hooded fur cloak with a powerful recurve bow, snowflakes around'),
            ('wolf', 3, 0, 'a large grey northern war wolf with a leather harness and red tassels, standing on four legs'),
            ('wolfrider', 3, 1, 'a huge white wolf with an armored harness ridden by a warrior with a short spear, standing on four legs'),
            ('bearguard', 4, 0, 'a burly warrior wearing a bear pelt as a cloak with the bear head as a hood, a big two-handed axe'),
            ('bearknight', 4, 1, 'a massive armored bear warrior: a big brown bear standing on two legs in iron plate armor and a green tabard, holding a huge war hammer'),
            ('shaman', 5, 0, 'a human northern shaman man with a weathered face and a braided beard, sheepskin coat with bone charms and ribbons, beating a big round frame drum'),
            ('thundershaman', 5, 1, 'a powerful human thunder shaman man with a stern face and an antler headdress, a glowing drum crackling with blue sparks, ribbons flying'),
            ('mammothtower', 6, 0, 'a woolly mammoth carrying a small wooden archer tower on its back, two archers inside, standing on four legs'),
            ('warmammoth', 6, 1, 'a huge armored woolly mammoth with iron plates on its tusks and a fortified tower on its back, standing on four legs'),
            ('snowgiant', 7, 0, 'a giant made of packed white snow and ice blocks, a human-like face with a frosty beard, holding a club of a whole pine trunk'),
            ('icegiant', 7, 1, 'a towering ice giant humanoid of blue glacier ice with a crown of icicles and a huge ice hammer'),
        ]},
    'bazar': {
        'ru': 'Нахалов базар', 'look': 'salt desert bazaar folk, saffron yellow, crimson, turquoise and bright silk',
        'units': [
            ('pickpocket', 1, 0, 'a nimble street thief in a patched silk vest and turban with a curved small dagger and a coin purse'),
            ('cutpurse', 1, 1, 'a sly master thief in a dark turquoise hooded cloak with two curved daggers and many purses on the belt'),
            ('pepperthrower', 2, 0, 'a merchant boy throwing red pepper powder from a pouch, saffron robes and a sash, a red cloud of pepper'),
            ('peppermaster', 2, 1, 'a pepper master with a bandolier of colorful spice pouches and a sling, red pepper smoke swirling'),
            ('carpetrider', 3, 0, 'a rider sitting cross-legged on a small flying patterned carpet, holding a curved sword, the carpet floating'),
            ('carpetace', 3, 1, 'a daring rider standing on a large flying ornate carpet with tassels, a scimitar raised, the carpet floating'),
            ('mirrorman', 4, 0, 'a mysterious man in a long robe covered with small round mirrors, holding a large polished mirror shield'),
            ('miragemaster', 4, 1, 'a mirage master in a shimmering robe of mirror shards, his outline doubled like a heat haze'),
            ('camel', 5, 0, 'a giant two-humped camel carrying a colorful trade wagon of crates on its back, standing on four legs'),
            ('caravanox', 5, 1, 'a huge humped ox with painted horns pulling a small armored caravan cart, standing on four legs'),
            ('djinn', 6, 0, 'a blue-skinned djinn with a smoky tail instead of legs, golden bracelets and an abacus of glowing beads'),
            ('djinnchanger', 6, 1, 'a powerful turquoise djinn with a smoky tail, a turban with a jewel and a pair of golden scales in his hand'),
            ('sandserpent', 7, 0, 'a giant sand serpent of yellow scales with a hood like a cobra, wrapped in swirling sand'),
            ('goldserpent', 7, 1, 'an enormous serpent with gold coin-like scales and jeweled eyes, hooded like a cobra, rearing up'),
        ]},
    'kurgany': {
        'ru': 'Курганы предков', 'look': 'ancestor spirits of a heath barrow land, bronze, pale ghost blue, heather purple and old bone',
        'units': [
            ('shadowherd', 1, 0, 'a translucent pale blue ghost of an old bearded man in a tattered hooded cloak leaning on a long wooden staff, human face, no animals'),
            ('shadowwanderer', 1, 1, 'a ghostly wanderer spirit with a lantern and a long crook, a hooded cloak trailing mist'),
            ('stonebaba', 2, 0, 'an ancient carved stone idol statue of a woman holding a bowl, glowing pale blue eyes, standing on a small mound'),
            ('barrowidol', 2, 1, 'a tall weathered stone idol of an ancestor with crossed arms, glowing runes and pale blue eyes, standing on a mound'),
            ('ghosthorse', 3, 0, 'a translucent ghost horse of pale blue mist with a flowing mane, no rider, standing'),
            ('riderless', 3, 1, 'a spectral war horse with bronze barding and an empty saddle, glowing eyes, mist trailing from its hooves, standing'),
            ('barrowknight', 4, 0, 'a ghostly ancient warrior in old bronze scale armor with a round shield and a sword, pale blue glow'),
            ('bronzeknight', 4, 1, 'a tall spectral champion in ornate bronze armor and a crested helmet, a long spear, ghostly blue light'),
            ('seeress', 5, 0, 'an old seeress woman in a heather purple shawl with a bone necklace and glowing pale eyes, holding a staff with rattles'),
            ('mourner', 5, 1, 'a ghostly mourner woman in long grey veils with a lantern, tears of light on her face'),
            ('boneeagle', 6, 0, 'a large eagle with pale bone-white feathers and glowing blue eyes, bronze rings on its legs, standing with wings half open'),
            ('ancestoreagle', 6, 1, 'a huge spectral eagle with bronze and ghost blue feathers and a halo of pale light, standing with wings half open'),
            ('greatancestor', 7, 0, 'a giant ghostly ancient chieftain in a bronze crown and fur cloak, translucent pale blue, a great sword'),
            ('barrowkhan', 7, 1, 'a towering spectral khan on a ghostly throne of stones, bronze armor, a tall crown, glowing pale blue, holding a mace'),
        ]},
}
NEUTRALS2 = [
    ('crab', 3, 'a big armored sea crab with huge claws and a barnacle shell'),
    ('lynx', 3, 'a large northern lynx with tufted ears and spotted grey fur'),
    ('scorpion', 4, 'a giant desert scorpion with a sand-yellow shell and a raised stinger'),
    ('raven', 2, 'a big black raven with a sharp beak and clever eyes, standing'),
    ('nomad', 2, 'a desert nomad raider in a headscarf with a curved sword and a small round shield'),
    ('griffin', 6, 'a giant golden mountain eagle with a hooked beak and huge wings, standing on a rock'),  # грифоны Z-Image не даются (лев с крыльями) — горные орлы
]


def creatures2():
    out = []
    for fid, f in FACTIONS2.items():
        for uid, tier, up, desc in f['units']:
            out.append({'name': f'{fid}-{uid}', 'faction': fid, 'tier': tier, 'up': up,
                        'prompt': f'{desc[0].upper()}{desc[1:]}. Colors and style: {f["look"]}. {{style}}'})
    for uid, tier, desc in NEUTRALS2:
        out.append({'name': f'neutral-{uid}', 'faction': 'neutral', 'tier': tier, 'up': 0, 'prompt': f'{desc[0].upper()}{desc[1:]}, fantasy creature. {{style}}'})
    return out


# ------------------------------------------------------------------ герои
LADS2 = [('maks', 'plotina'), ('andryukha', 'ostrog'), ('zheka', 'bazar'), ('tyoma', 'kurgany')]
OUTFIT2 = {
    'plotina': 'wearing a faded blue swimming club tracksuit jacket under a grey oilskin sea cloak with brass buckles',
    'ostrog': 'wearing an army green padded jacket of the 1990s under a fur-trimmed northern cloak and a red sash',
    'bazar': 'wearing a black leather jacket of the 1990s under an open saffron silk robe, a gold chain',
    'kurgany': 'wearing a dark hooded sweatshirt under a ragged heather-purple cloak with a bronze clasp',
}
CLASSES2 = {
    'plotina': (('smotritel', 'a broad-shouldered dam warden in an oilskin coat with a brass spyglass'),
                ('bureveshchun', 'a storm caller with wild grey hair and lightning sparks in the fingers')),
    'ostrog': (('voevoda', 'a stern fort commander in fur and chainmail with a long moustache'),
               ('shaman', 'a northern shaman with an antler headdress and a drum')),
    'bazar': (('kupets', 'a sly rich merchant in silk with rings on every finger'),
              ('menyala', 'a money-changer mage with a turban and glowing beads')),
    'kurgany': (('khan', 'a barrow lord in bronze armor with a pale ghostly glow'),
                ('veshchun', 'a seer with pale eyes and bone charms in the hair')),
}
VILLAIN_YOUNG = 'a nineteen-year-old young man with a hard face, a flat 1980s cap and a worn denim jacket'


def heroes2():
    items = []
    for key, fac in LADS2:
        items.append({'name': f'lad-{key}', 'width': 1024, 'height': 1024,
                      'prompt': f'{GOUACHE} Hero portrait, head and shoulders: {LOOK[key]}, {OUTFIT2[fac]}. Plain dark warm background.'})
    items.append({'name': 'lad-starshoy-young', 'width': 1024, 'height': 1024,
                  'prompt': f'{GOUACHE} Portrait, head and shoulders: {VILLAIN_YOUNG}, faded photo colors of 1983. Plain dark background.'})
    items.append({'name': 'lad-kostya', 'width': 1024, 'height': 1024,
                  'prompt': f'{GOUACHE} Portrait, head and shoulders: a tall eighteen-year-old young man with blond hair and a tired kind face, a torn sailor shirt. Plain dark background.'})
    items.append({'name': 'lad-ded', 'width': 1024, 'height': 1024,
                  'prompt': f'{GOUACHE} Portrait, head and shoulders: a translucent pale blue ghost of a kind old watchman in a quilted jacket and a flat cap, a cigarette. Plain dark background.'})
    for fac, (might, magic) in CLASSES2.items():
        for cid, cdesc in (might, magic):
            for i, who in enumerate(VARIANTS):
                items.append({'name': f'hero-{fac}-{cid}-{i + 1}', 'width': 1024, 'height': 1024, 'seeds': [11],
                              'prompt': f'{GOUACHE} Hero portrait, head and shoulders: {who}, {cdesc}, of the {FACTIONS2[fac]["look"]}. Plain dark warm background.'})
    return items


def mounts2():
    items = []
    for fac, (might, magic) in CLASSES2.items():
        for cid, cdesc in (might, magic):
            items.append({'name': f'mount-{fac}-{cid}', 'prompt': f'A hero on horseback, {cdesc}, riding a horse with {FACTIONS2[fac]["look"]} tack and a small banner. {{style}}'})
    items.append({'name': 'mount-starshoy', 'prompt': 'A hero on horseback, a man in a long black coat with iron armor plates and a flat cap, riding a black war horse with dark iron tack and a black banner. {style}'})
    return items


# ------------------------------------------------------------------ замки
TOWNS2 = {
    'plotina': {'look': 'storm dam architecture: massive grey stone dam walls, sluice gates with brass wheels, lighthouses, slate roofs, foaming water channels',
                'site': 'a rocky sea coast with cliffs, a river falling into the sea through a gorge, grey stormy sky with sunbeams',
                'dwell': ['a stone guardhouse on the dam', 'a harpoon workshop with nets and harpoons', 'a cliff nest tower for storm birds', 'a sea grotto pool with steps',
                          'a witch tower of shells and kelp', 'a stone bull pen by the surf', 'a giant flooded sluice basin with whirling water'],
                'unique': [('dam', 'a huge stone dam with open sluices and roaring water'), ('turbine', 'a great water wheel turbine house with brass gears')]},
    'ostrog': {'look': 'northern fort architecture: dark log palisades with sharpened tops, tall log towers with tent roofs, snow on roofs, smoke from chimneys',
               'site': 'a snowy taiga clearing with tall dark firs, a frozen river, pale winter sun',
               'dwell': ['a log barracks with a training yard', 'a ski hunters lodge with skis and bows', 'a wolf kennel with a log fence', 'a bear pit with a log roof',
                         'a shaman yurt of hides with antlers', 'a giant mammoth stable of logs', 'an ice cave with a giant door'],
                'unique': [('drill', 'a drill square with wooden training dummies and a banner'), ('banya', 'a log bath house with steam rising')]},
    'bazar': {'look': 'desert bazaar architecture: sun-dried brick, colorful silk awnings, domes with turquoise tiles, minaret-free towers, palm-free, lanterns and carpets',
              'site': 'a white salt flat with dunes, a turquoise oasis lake, hot hazy afternoon',
              'dwell': ['a thieves den behind a curtain', 'a spice shop with sacks of red pepper', 'a carpet workshop with hanging carpets', 'a hall of mirrors',
                        'a camel caravan yard', 'a blue lamp tower', 'a sand pit lair with a domed roof'],
              'unique': [('bank', 'a moneylender house with a golden scale sign'), ('caravanserai', 'a caravanserai courtyard with camels and goods')]},
    'kurgany': {'look': 'barrow land architecture: grass-covered burial mounds with stone doors, standing stones, bronze braziers, wooden totem poles, low stone halls',
                'site': 'a misty purple heather moor with low hills, standing stones, pale evening light',
                'dwell': ['a shepherd ghost fold of stones', 'a ring of carved stone idols', 'a ghostly horse corral of stones', 'a warrior barrow with a bronze door',
                          'a seeress hut of bones and heather', 'an eagle rock with a bone nest', 'a great royal barrow with a stone gate'],
                'unique': [('memory', 'a stone circle with glowing pale blue runes'), ('bindstone', 'a tall amber-veined binding stone with chains')]},
}
DARK_TOWN = ('dark fortress architecture: black stone and iron walls, sharp towers, red-lit windows, chains and iron spikes, smoke',
             'a black rocky cliff over an ash plain, storm clouds and red glow')


def towns2():
    items = []
    for fid, t in TOWNS2.items():
        items.append({'name': f'town-{fid}-full', 'width': 1536, 'height': 864,
                      'prompt': f'{GOUACHE} Wide panorama of a fantasy town of the {FACTIONS2[fid]["look"]}, {t["look"]}, on {t["site"]}. '
                                'Many buildings, lively and inviting, calm composition.'})
        items.append({'name': f'town-{fid}-site', 'width': 1536, 'height': 864,
                      'prompt': f'{GOUACHE} Wide panorama of an empty landscape: {t["site"]}, open flat building ground in the middle, calm composition.'})
        items.append({'name': f'map-town-{fid}', 'width': 1024, 'height': 1024,
                      'prompt': f'{GOUACHE} Adventure map object seen from above in three-quarter view: a small walled fantasy town, {t["look"]}. {ISOLATED}'})
        blds = list(COMMON_BUILDINGS) + [(f'dwell{i + 1}', d) for i, d in enumerate(t['dwell'])] + list(t['unique'])
        for bid, d in blds:
            items.append({'name': f'bld-{fid}-{bid}', 'width': 1024, 'height': 1024, 'seeds': [21],
                          'prompt': f'{GOUACHE} A building of a fantasy town, {d}, in the style of {t["look"]}, three-quarter view. {ISOLATED}'})
    look, site = DARK_TOWN
    items.append({'name': 'town-dark-full', 'width': 1536, 'height': 864,
                  'prompt': f'{GOUACHE} Wide panorama of a dark fantasy fortress, {look}, on {site}. Menacing but beautiful, calm composition.'})
    items.append({'name': 'map-town-dark', 'width': 1024, 'height': 1024,
                  'prompt': f'{GOUACHE} Adventure map object seen from above in three-quarter view: a small dark fortress, {look}. {ISOLATED}'})
    return items


# ------------------------------------------------------------------ карта
TERRAINS2 = {
    'coast': ('wet grey coastal rocks with patches of sea grass and small tide pools', ['a wind-bent pine on a rock', 'a grey sea stack rock', 'a pile of driftwood',
              'a clump of sea grass', 'a wrecked boat hull', 'a cluster of barnacled rocks', 'an old anchor in the sand', 'a stone cairn']),
    'snow': ('fresh white snow ground with soft blue shadows and a few frozen grass tufts', ['a snowy fir tree', 'a clump of snowy firs', 'a snow covered boulder',
             'a frozen bush', 'a snowdrift', 'an ice block', 'a dead birch in snow', 'a snowy log']),
    'saltflat': ('cracked white salt flat ground with pale yellow sand patches', ['a dry thorn tree', 'a white salt pillar', 'a desert rock arch',
                 'a dry tumbleweed bush', 'a sand dune', 'a bleached animal skull on sand', 'a cluster of salt crystals', 'a small turquoise spring']),
    'heath': ('purple heather moor ground with grey grass and small stones', ['a gnarled lonely oak', 'a standing stone', 'a heather bush', 'a small burial mound',
              'a ring of small stones', 'a dead juniper', 'a wooden totem pole', 'a mossy fallen stone']),
}
MAP_OBJECTS2 = [
    ('treasury-coast', 'a sunken ship on rocks with an open chest'), ('treasury-snow', 'a frozen ancient tomb door in an ice cliff'),
    ('treasury-saltflat', 'a half buried golden caravan in the sand'), ('treasury-heath', 'an old burial mound with an open bronze door'),
    ('dwell-crab', 'a rocky shore with crab burrows'), ('dwell-lynx', 'a lynx den under a fallen fir'), ('dwell-scorpion', 'a scorpion pit in the sand'),
    ('dwell-raven', 'a dead tree full of raven nests'), ('dwell-nomad', 'a nomad camp of tents'), ('dwell-griffin', 'a griffin nest on a rocky peak'),
    ('lighthouse', 'a tall stone lighthouse on a rock'), ('heart', 'a huge round crater pit with a glowing brass heart at the bottom'),
    ('shardaltar', 'a stone altar with eight hollows, one glowing brass shard in it'), ('darkcamp', 'a dark army camp with black tents and banners'),
    ('caravan', 'a trade caravan of carts with awnings'), ('dragonbones', 'huge ancient bones half buried in the ground'),
]


def mapping2():
    items = []
    for oid, d in MAP_OBJECTS2:
        items.append({'name': f'obj-{oid}', 'width': 1024, 'height': 1024,
                      'prompt': f'{GOUACHE} Adventure map object seen from above in three-quarter view: {d}. {ISOLATED}'})
    for tid, (ground, decor) in TERRAINS2.items():
        items.append({'name': f'ground-{tid}', 'width': 1024, 'height': 1024,
                      'prompt': f'{GOUACHE} Seamless top-down ground texture: {ground}, even soft lighting, fills the whole square.'})
        for i, d in enumerate(decor):
            items.append({'name': f'decor-{tid}-{i + 1}', 'width': 1024, 'height': 1024, 'seeds': [31],
                          'prompt': f'{GOUACHE} Game scenery sprite seen from above in three-quarter view: {d} on a tiny patch of its own ground. {ISOLATED}'})
    for i, d in enumerate(['a snowy jagged mountain ridge', 'a high grey sea cliff with foam at the foot', 'a flat-topped yellow mesa', 'a low heather hill with standing stones']):
        items.append({'name': f'mountain-{i + 5}', 'width': 1536, 'height': 864,
                      'prompt': f'{GOUACHE} Game scenery sprite seen from above in three-quarter view: {d}, its own ground at the foot. {ISOLATED}'})
    return items


# ------------------------------------------------------------------ бой
FIELDS2 = {'coast': 'a wide flat rocky seashore with wet sand, tide pools and surf along the very top edge',
           'snow': 'a wide flat snowy field with frozen grass, snowy firs along the very top edge',
           'saltflat': 'a wide flat cracked white salt flat with low dunes along the very top edge',
           'heath': 'a wide flat purple heather moor with low burial mounds along the very top edge',
           'heart': 'a wide flat floor of a giant crater glowing with golden brass light from cracks, spiral walls along the edges',
           'darkkeep': 'a wide flat black stone courtyard with iron grates and red braziers along the very top edge'}
OBSTACLES2 = ['an ice block', 'a white salt crystal cluster', 'a small standing stone', 'a pile of driftwood', 'a frozen dead bush', 'a bronze brazier']
SIEGE_MATERIAL2 = {'plotina': 'grey granite blocks with brass rivets', 'ostrog': 'dark sharpened pine logs with snow on top',
                   'bazar': 'sun-dried yellow brick with turquoise tiles', 'kurgany': 'turf covered earth with old standing stones',
                   'dark': 'black stone with iron spikes'}
TRAPS = [('trap-pepper', 'a small cloth sack of red pepper powder with a red cloud above it'), ('trap-pit', 'a hidden pit covered with sticks and sand'),
         ('trap-mirage', 'a shimmering transparent mirror ghost of a warrior')]


def battle2():
    items = []
    for fid, d in FIELDS2.items():
        items.append({'name': f'field-{fid}', 'width': 1536, 'height': 864,
                      'prompt': f'{GOUACHE} Battlefield background seen from high above at a steep angle, almost top-down: {d}. The middle is open, flat and clear.'})
    for i, d in enumerate(OBSTACLES2):
        items.append({'name': f'obstacle-{i + 11}', 'width': 1024, 'height': 1024, 'seeds': [41],
                      'prompt': f'{GOUACHE} Game scenery sprite seen from above in three-quarter view: {d} on a tiny patch of its own ground. {ISOLATED}'})
    for fid, material in SIEGE_MATERIAL2.items():
        for pid, d in SIEGE_PARTS:
            items.append({'name': f'{pid}-{fid}', 'width': 1024, 'height': 1024,
                          'prompt': f'{GOUACHE} Game scenery sprite seen from above in three-quarter view: {d}, built of {material}, standing alone on bare ground. {ISOLATED}'})
    for tid, d in TRAPS:
        items.append({'name': tid, 'width': 1024, 'height': 1024, 'prompt': f'{GOUACHE} Game sprite seen from above in three-quarter view: {d}. {ISOLATED}'})
    return items


# ------------------------------------------------------------------ иконки
ARTIFACTS2 = [  # art-61…: вещи новых краёв и комплекты эндгейма
    'a brass storm compass', 'a sea shell horn', 'an oilskin cloak with brass buckles', 'a coral trident',
    'a bear claw necklace', 'a fur winter hat with a red star', 'a frost axe', 'felt boots with iron spikes',
    'a golden abacus', 'a flying carpet piece', 'a djinn lamp', 'a purse of endless coins',
    'a bronze ancestor mask', 'a bone flute', 'a heather wreath', 'a ghost lantern',
    'an iron crown of the dark prince', 'a black coat with iron plates', 'a flat cap with an iron star', 'a black iron gauntlet',
    'a brass heart amulet', 'a silver chain of eight links', 'a lucky sunflower seed of gold', 'an old pocket watch stopped at seven',
]
MISC_ICONS = [('icon-napor', 'a small brass pressure gauge with a needle in the red'), ('icon-memory', 'a pale blue ghost flame in a bronze bowl'),
              ('icon-rank', 'three red cloth chevrons on a fur patch'), ('icon-credit', 'a sealed loan scroll with a wax seal and coins'),
              ('icon-trap', 'a small iron trap with open jaws'), ('icon-flood', 'a sluice gate with water bursting through'),
              ('icon-turbine', 'a small brass water wheel'), ('icon-bind', 'a stone with a chain and an amber vein'),
              ('icon-mercenary', 'a sack of coins tied to a sword'), ('icon-drill', 'a wooden training dummy with a helmet'),
              ('skill-25', 'a pair of dice and a deck of cards'), ('icon-shard', 'a single glowing brass knuckle shard on velvet')]


def icons2():
    items = [{'name': f'art-{i + 61:02d}', 'width': 768, 'height': 768, 'seeds': [51], 'prompt': f'{ICON} {d}.'} for i, d in enumerate(ARTIFACTS2)]
    items += [{'name': n, 'width': 768, 'height': 768, 'seeds': [51], 'prompt': f'{ICON} The item: {d}.'} for n, d in MISC_ICONS]
    return items


# ------------------------------------------------------------------ ролики (тексты — docs/geroi/CAMPAIGNS2.md)
SER, LEN, DIM, VIT = LOOK['seryoga'], LOOK['lenka'], LOOK['dimon'], LOOK['vityok']
MAK, AND, ZHE, TYO = LOOK['maks'], LOOK['andryukha'], LOOK['zheka'], LOOK['tyoma']
STAR = 'a man about thirty with a hard face and a scar, a flat 1980s cap and a long black coat with dark iron armor plates'
EIGHT = 'eight different teenagers, seven boys and one small girl with braids and glasses, each in a cloak of a different fantasy land over 1990s clothes'
CUTSCENES2 = [
    ('c3-1a', f'A huge stone dam among rocky cliffs, water roaring through open sluices, on the top of the dam stands {MAK}', 'water roars and sprays, mist rises, he looks down calmly, slow push in'),
    ('c3-1b', 'Old keepers in blue oilskin cloaks turning a giant brass sluice wheel inside a stone hall', 'the wheel turns slowly, water flows in channels, the keepers bow'),
    ('c3-2a', 'A storm over a grey sea, small sailing boats tossed by waves, lightning, a distant lighthouse', 'waves rise and fall, lightning flashes, the boats rock, the lighthouse beam turns'),
    ('c3-3a', f'A colorful merchant ship at a wooden pier, on deck {ZHE} lays out goods on a carpet', 'he grins and spreads goods, flags flutter, gulls fly over'),
    ('c3-3b', 'A lighthouse on a cliff at night, its beam falling on black sails of a fleet near the rocks', 'the beam sweeps across the sea, black sails sway, waves crash'),
    ('c3-4a', 'A stone prison fort on a lonely rock in the sea, in a lit tower window the silhouette of a young man', 'waves crash at the rock, clouds move, the silhouette leans on the window'),
    ('c3-fin1', f'{MAK} hugging a tall blond young man in a torn sailor shirt on a wet wooden pier in the rain', 'rain falls, they hug tightly, waves lap at the pier'),
    ('c3-fin2', 'A glowing brass shard lying in an open wet palm, sea spray around', 'spray flies, the shard pulses with warm light'),
    ('c4-1a', f'A log fort in a snowy taiga, warriors in furs standing in a row on the drill square, before them {AND}', 'snow falls gently, banners move, he walks along the row'),
    ('c4-1b', f'A grey-bearded commander in a fur coat handing an old war horn to {AND} in a log hall', 'the old man hands over the horn, firelight flickers, snow outside'),
    ('c4-2a', 'A blizzard over a mountain pass, snow-covered fort gates, campfires burning on the walls', 'snow swirls in the wind, fires flicker, the gates creak'),
    ('c4-3a', 'A purple heather moor with burial mounds at night, ghostly lights and pale riders above them', 'ghost lights float, pale riders move slowly, mist drifts'),
    ('c4-3b', f'{TYO} sitting on top of a burial mound, pale ghostly ancestor spirits standing around him', 'the spirits sway and whisper, his hair moves in the wind, mist swirls'),
    ('c4-4a', 'A narrow mountain pass in snow, black banners and a huge army camp below', 'banners wave, smoke rises from the camp, snow drifts'),
    ('c4-fin1', f'{AND} and {TYO} standing on a log fort wall under the northern lights', 'the northern lights ripple across the sky, they talk, breath steams'),
    ('c4-fin2', 'A glowing brass shard frozen in clear ice on a mountain peak', 'light pulses inside the ice, snow blows past'),
    ('c5-1a', f'A noisy fantasy bazaar on a white salt flat, silk tents, camels, {ZHE} wearing a silk robe over a leather jacket at a stall', 'people bustle, silk awnings flutter, he haggles with a grin'),
    ('c5-1b', f'An important old merchant with a huge abacus bowing to {ZHE} in a silk tent', 'the merchant bows, abacus beads click, lanterns sway'),
    ('c5-2a', f'A black rider handing a sealed scroll to {ZHE}, an empty open chest behind him', 'the rider holds out the scroll, the horse stamps, dust swirls'),
    ('c5-3a', 'A great fair at a crossroads of three roads, tents and flags of different lands, crowds', 'flags flutter, crowds move between tents, smoke rises from food stalls'),
    ('c5-3b', 'A merchant in black at a stall slowly raising a price written on a wooden board', 'he raises the board, a crowd murmurs, coins glitter'),
    ('c5-4a', 'A treasure vault in a dark castle, a glowing brass shard on a velvet cushion, sleeping guards', 'the shard glows softly, a guard snores and shifts, torchlight flickers'),
    ('c5-fin1', f'{ZHE} running across bazaar rooftops at night with a glowing shard in his fist', 'he runs and jumps between roofs, his robe flaps, lanterns pass by'),
    ('c5-fin2', f'{ZHE} sitting on a crate by a campfire among camels, counting glowing seeds and smiling', 'the fire crackles, camels chew, he counts seeds'),
    ('c6-1a', f'A misty purple heather moor with burial mounds, {TYO} getting up from the ground, pale shadows whispering around him', 'he slowly rises, shadows drift around, mist moves'),
    ('c6-1b', 'Ghostly old warriors in bronze armor standing in a half circle and bowing, pale blue glow, heather moor', 'the spirits bow slowly, their glow pulses, mist drifts'),
    ('c6-2a', 'A night funeral feast: bonfires burning on the tops of burial mounds, a chain of fire to the horizon', 'fires flicker one after another, sparks rise, wind moves the heather'),
    ('c6-3a', 'A translucent ghost of an old watchman in a quilted jacket and a flat cap sitting by a campfire on a burial mound', 'the fire crackles, the ghost smokes a cigarette, smoke curls'),
    ('c6-3b', 'A translucent ghost of an old watchman in a flat cap pointing to the night sky where eight lights draw together into one', 'he points up, the eight lights slowly move together'),
    ('c6-4a', 'A huge ancient burial mound under a stormy sky, a black army at its foot', 'lightning flashes, banners wave, the army stirs'),
    ('c6-fin1', f'{TYO} holding a glowing brass shard, behind him the ghost of an old watchman slowly fading', 'the ghost waves and fades, the shard glows brighter, heather sways'),
    ('c6-fin2', 'A stone map by a campfire, six bright lights on it and two dim red lights far to the east', 'the six lights glow steady, the two red ones flicker, fire crackles'),
    ('c7-1a', f'{EIGHT} standing together on a hill at sunset, banners of different lands behind them', 'banners wave, they stand shoulder to shoulder, the sun sets'),
    ('c7-1b', 'A great stone map of the world with eight lights, six bright and two dim red in the east, teenagers leaning over it', 'the lights glow, hands point at the red lights, torchlight flickers'),
    ('c7-2a', 'A black fortress on a cliff above an ash plain, lightning, thousands of torches on the walls', 'lightning strikes, torches flicker along the walls, smoke drifts'),
    ('c7-2b', 'An empty throne of black iron in a dark hall, an old flat cap lying on the armrest', 'dust drifts in a beam of light, slow push in on the cap'),
    ('c7-3a', 'A gigantic crater with a glowing heart of brass and light at the bottom, armies descending along a spiral road', 'light pulses from the heart, armies march down the spiral, dust rises'),
    ('c7-3b', f'{STAR} standing by a glowing brass heart at the bottom of a crater, holding two glowing shards', 'he turns slowly, his coat moves in the wind, the heart pulses'),
    ('c7-fin1', 'Eight hands holding glowing brass shards coming together above a glowing heart, the brass knuckle assembling whole', 'the shards slide together and fuse with a bright golden flash'),
    ('c7-fin2', 'A blinding pillar of light rising from a giant crater into a sky with two moons', 'the light pillar rises and spreads, clouds swirl around it'),
    ('c7-home1', 'Summer evening in 1995, a construction site by a small river, eight teenagers lying on the grass by a clay pit and laughing, grey panel apartment blocks behind', 'they laugh and sit up, grass sways, warm sunset light'),
    ('c7-home2', 'A man in a flat cap standing at the entrance of a grey nine-storey panel apartment block at dusk, a window on the third floor lights up', 'the window lights up, he looks up, then walks inside'),
    ('c7-stay1', 'Eight teenagers on a hill above a fantasy valley walking away in different directions toward different lands, two pale moons', 'they walk apart and wave, clouds move, banners flutter far away'),
    ('c7-stay2', 'A man in a flat cap walking down a summer path toward grey panel apartment blocks that stand in a fantasy field like a mirage', 'he walks away, turns and waves his cap, the mirage shimmers'),
]


def cutscene_keys2():
    return [{'name': cid, 'prompt': f'{GOUACHE} Cinematic wide shot: {shot}.'} for cid, shot, _ in CUTSCENES2]


def videos2():
    return [{'name': cid, 'keys': [f'{cid}-1'], 'prompt': f'{motion}. {MOTION}'} for cid, _, motion in CUTSCENES2]


# ------------------------------------------------------------------ музыка
MUSIC2 = [
    ('town-plotina', f'{NEW_AGE}, 90 bpm, ocean surf textures, low horn calls, deep drum, wide airy pads, calm and powerful', 'v'),
    ('town-ostrog', f'{NEW_AGE}, 88 bpm, throat singing drone, frame drum, wooden flute, cold airy pads, proud and steady, minor key', 'v'),
    ('town-bazar', f'{NEW_AGE}, 96 bpm, oud melody, darbuka groove, breakbeat, warm pads, lively and cunning', 'v'),
    ('town-kurgany', f'dark ambient {NEW_AGE}, 82 bpm, jaw harp, whistling wind, low choir humming without words, slow beat, solemn', 'v'),
    ('map-coast', f'{NEW_AGE}, 90 bpm, sea waves, bamboo flute, soft breakbeat, wide pads, open horizon, major key', 'v'),
    ('map-snow', f'{NEW_AGE}, 86 bpm, glassy bells, frame drum, cold pads, quiet winter journey', 'v'),
    ('map-saltflat', f'{NEW_AGE}, 92 bpm, ney flute, hand drums, shimmering heat pads, desert journey', 'v'),
    ('map-heath', f'{NEW_AGE}, 84 bpm, lonely low whistle, wind, soft drums, misty pads, wistful, minor key', 'v'),
    ('battle-d', f'epic {NEW_AGE}, 120 bpm, big taiko, hard breakbeat, throat singing stabs, low brass, minor key', 'b'),
    ('campaign3', f'{NEW_AGE}, 92 bpm, surf, flute, harp, hopeful sea theme, major key', 'v'),
    ('campaign4', f'{NEW_AGE}, 90 bpm, frame drum march, horn, cold pads, determined, minor key', 'v'),
    ('campaign5', f'{NEW_AGE}, 98 bpm, oud and darbuka, playful and sly theme', 'v'),
    ('campaign6', f'{NEW_AGE}, 80 bpm, low whistle, choir humming without words, gentle and mysterious', 'v'),
    ('finale-battle', f'epic cinematic {NEW_AGE}, 124 bpm, massive drums, deep male choir humming, all ethnic flutes together, dark then heroic, minor key', 'b'),
    ('ending-home', f'{NEW_AGE}, 90 bpm, warm nostalgic pads, soft breakbeat, bamboo flute melody, summer evening, major key', 'v'),
    ('ending-stay', f'{NEW_AGE}, 88 bpm, wide majestic pads, harp, flute, bittersweet and bright, major key', 'v'),
]

# ------------------------------------------------------------------ звуки
SFX2 = [
    ('horse-snow', 2, 'normal', 1.5, 'horse walking through deep crunchy snow'),
    ('horse-sand', 2, 'normal', 1.5, 'horse walking on soft dry sand'),
    ('horse-rock', 2, 'normal', 1.5, 'horse hooves on wet rocks near the sea'),
    ('horse-heath', 2, 'normal', 1.5, 'horse walking through dry heather and grass'),
    ('waves', 3, 'ambience', 3.0, 'sea waves crashing on rocks, ambience'),
    ('blizzard', 3, 'ambience', 3.0, 'cold blizzard wind howling'),
    ('desert-wind', 3, 'ambience', 3.0, 'hot desert wind with blowing sand'),
    ('moor-wind', 3, 'ambience', 3.0, 'lonely wind over an empty moor with faint whispers'),
    ('flood', 3, 'loud', 2.5, 'sluice gates opening and a rush of water'),
    ('turbine', 2, 'normal', 2.0, 'a big wooden water wheel turning with creaks and splashes'),
    ('drill', 2, 'normal', 1.5, 'soldiers stamping in step and a short shout without words'),
    ('rankup', 2, 'normal', 1.5, 'a short proud horn call and a drum hit'),
    ('loan', 2, 'normal', 1.2, 'a heavy purse of coins dropped on a table'),
    ('steal', 1, 'normal', 0.8, 'a quick coin snatch jingle'),
    ('trap', 1, 'normal', 0.8, 'a trap snapping shut'),
    ('pepper', 1, 'normal', 0.8, 'a puff of powder and a sneeze-like cough without words'),
    ('mirage', 2, 'normal', 1.2, 'shimmering glassy whoosh of an illusion'),
    ('memory', 2, 'normal', 1.5, 'soft ghostly choir breath rising'),
    ('bind', 2, 'normal', 1.5, 'chains clinking and a low stone hum'),
    ('summon-spirit', 2, 'normal', 1.5, 'ghostly wind swirl and a distant horn'),
    ('shot-harpoon', 1, 'normal', 0.8, 'a heavy harpoon launched with a rope whizzing'),
    ('shot-gaze', 1, 'normal', 0.8, 'a low eerie stone hum with a magic zap'),
    ('hit-ice', 1, 'normal', 0.8, 'ice cracking under a heavy blow'),
    ('hit-water', 1, 'normal', 0.8, 'a heavy wave slapping hit'),
    ('death-ice', 2, 'normal', 1.2, 'ice shattering and collapsing'),
    ('voice-mammoth', 2, 'normal', 1.5, 'a mammoth trumpeting'),
    ('voice-camel', 1, 'normal', 1.0, 'a camel grunting and groaning'),
    ('voice-djinn', 2, 'normal', 1.5, 'a deep magical laugh with a swirl of wind, no words'),
    ('voice-ghost', 2, 'normal', 1.5, 'a ghostly moan, soft and sad'),
    ('voice-eagle', 1, 'normal', 1.0, 'an eagle screech'),
    ('voice-giant', 2, 'normal', 1.5, 'a giant deep grunt with rumble'),
    ('voice-crab', 1, 'normal', 0.8, 'crab claws clicking'),
    ('voice-lynx', 1, 'normal', 1.0, 'a lynx growl'),
    ('voice-scorpion', 1, 'normal', 0.8, 'a scorpion chitter and hiss'),
    ('voice-raven', 1, 'normal', 1.0, 'a raven caw'),
    ('voice-griffin', 2, 'normal', 1.5, 'a griffin screech mixed with a lion roar'),
    ('voice-thunder', 2, 'loud', 1.5, 'a thunderclap and crackling lightning'),
    ('heart', 3, 'normal', 2.5, 'a deep magical heartbeat pulse with a golden shimmer'),
    ('shards', 3, 'normal', 2.5, 'metal shards sliding together and a bright magical chime'),
]


def main():
    cr = creatures2()
    write('30-creatures.yaml', 'партия 30: эталоны существ второй волны (4 фракции × 14 + 6 нейтралов)',
          {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)',
           'defaults': {'width': 1024, 'height': 1024, 'steps': 8}, 'seeds': [41, 42], 'style': CREATURE3D,
           'items': [{'name': c['name'], 'prompt': c['prompt']} for c in cr]})
    (HERE / 'creatures-w2.json').write_text(json.dumps(cr, ensure_ascii=False, indent=1), encoding='utf-8')
    image_job('31-heroes.yaml', 'партия 31: портреты второй волны (4 пацана в нарядах краёв, Старшой в 1983-м, Костя, дед, 32 местных)', heroes2(), [11, 12])
    write('31b-mounts.yaml', 'партия 31б: герой на коне второй волны (8 классов + Старшой)',
          {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)',
           'defaults': {'width': 1024, 'height': 1024, 'steps': 8}, 'seeds': [61, 62], 'style': CREATURE3D, 'items': mounts2()})
    image_job('32-towns.yaml', 'партия 32: замки второй волны + Чёрная крепость', towns2(), [11, 12])
    image_job('33-map.yaml', 'партия 33: карта — 4 местности, сокровищницы, жилища нейтралов, объекты финала', mapping2(), [11, 12])
    image_job('34-battle.yaml', 'партия 34: поля боя, препятствия, осада, ловушки Базара', battle2(), [11, 12])
    image_job('35-icons.yaml', 'партия 35: артефакты 61–84 и значки механик второй волны', icons2(), [11, 12])
    image_job('36-cutscene-keys.yaml', 'партия 36: ключевые кадры роликов кампаний 3–7 (docs/geroi/CAMPAIGNS2.md)', cutscene_keys2(), [1, 2],
              {'width': 1280, 'height': 704, 'steps': 8})
    write('37-videos.yaml', 'партия 37: ролики Wan 2.2 кампаний 3–7',
          {'keys': f'{OUT}/36-cutscene-keys', 'server': 'comfy-big',
           'defaults': {'width': 1280, 'height': 704, 'frames': 121, 'steps': 30}, 'seeds': [1], 'clips': videos2()})
    write('38-music.yaml', 'партия 38: музыка YuE2 второй волны',
          {'out': f'{OUT}/38-music', 'max_duration': 150,
           'tracks': [{'name': n, 'seeds': [11, 22], 'style': st, 'lyrics': FORMS[f]} for n, st, f in MUSIC2]})
    write('39-sfx.yaml', 'партия 39: звуки второй волны',
          {'out': f'{OUT}/39-sfx', 'seeds': [1, 2],
           'sounds': [{'name': n, 'duration': d, 'level': lv, 'max': mx, 'prompt': p} for n, d, lv, mx, p in SFX2]})
    n = {f: len(yaml.safe_load((HERE / f).read_text(encoding='utf-8')).get('items', [])) for f in
         ('30-creatures.yaml', '31-heroes.yaml', '31b-mounts.yaml', '32-towns.yaml', '33-map.yaml', '34-battle.yaml', '35-icons.yaml', '36-cutscene-keys.yaml')}
    print(n, 'ролики', len(CUTSCENES2), 'музыка', len(MUSIC2), 'звуки', len(SFX2))


# Переделки после отбора (как REDO в make_jobs.py): пункты с новыми промптами и сидами — партией «<партия>-redo», ночные остаются для сравнения.
REDO2 = {
    '30-creatures': ([f'ostrog-{u[0]}' for u in FACTIONS2['ostrog']['units']] + ['kurgany-shadowherd', 'neutral-griffin'], [43, 44]),  # Острог «дедами-морозами», грифон без орлиной головы, пастух — собакой
    '30-creatures#2': (['ostrog-shaman', 'ostrog-thundershaman', 'ostrog-skiarcher', 'ostrog-bearknight', 'ostrog-snowgiant', 'kurgany-shadowherd', 'neutral-griffin'], [45, 46]),  # «волчий мех» сделал волков-людей
}


def redo2():
    for key, (names, seeds) in REDO2.items():
        batch, _, n = key.partition('#')
        job = yaml.safe_load((HERE / f'{batch}.yaml').read_text(encoding='utf-8'))
        job['items'] = [i for i in job['items'] if i['name'] in names]
        job['seeds'] = seeds
        write(f'{batch}-redo{n}.yaml', f'переделки партии {batch} после отбора', job)


if __name__ == '__main__':
    main()
    redo2()
