"""Герои кастета и семок: все задания контента первого выпуска из одних списков (урок ГОПС — правка в списке, перезапуск).

python studio/jobs/geroi/make_jobs.py
Пишет studio/jobs/geroi/1x-*.yaml, creatures.json (очередь 3D) и docs/geroi/CONTENT.md (что где в игре).
Первый выпуск (DESIGN §14–15): фракции Затулье, Затонье, Пепельная кузня, Звёздная академия + нейтралы; кампании «За Тулой» и
«Звёздный счёт» (docs/geroi/CAMPAIGNS.md). Стиль — B «гуашь» (studio/bible/geroi.md). Озвучки нет, звуки — есть.
"""
import json
import pathlib

import yaml

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent.parent.parent
OUT = 'G:/temp/studio/out/geroi'

GOUACHE = ('Rich gouache painting, classic 1990s fantasy strategy game art made cleaner and more refined, confident brush strokes, '
           'saturated but harmonious colors, warm sunlight and soft shadows.')
ISOLATED = 'Single isolated object, centered, whole object in frame with margin, plain light grey background.'
ICON = ('Rich gouache painting of a single fantasy item resting on dark warm brown velvet, painted with volume, texture and warm highlights, '
        'like an inventory item in a classic 1990s fantasy strategy game, centered and filling most of the square.')
SPELL_ART = ('Rich gouache miniature painting filling the whole square, a small dramatic scene with depth and glowing light, '
             'painted like the spell art of a classic 1990s fantasy strategy game:')
CREATURE3D = ('Stylized 3D game creature render, clean sculpted shapes, toon shading with a thin dark outline, soft studio light, '
              'bright but refined colors. Full body, whole figure in frame with margin, standing in a three-quarter view facing right, '
              'seen slightly from above, centered, plain light grey background.')
MOTION = 'Painterly gouache animation, hand-painted look, gentle cinematic camera motion, smooth natural movement.'

# ------------------------------------------------------------------ фракции и существа
# (id, ступень, улучш., описание для эталона). Описание — что на картинке; ракурс и фон даёт CREATURE3D.
FACTIONS = {
    'zatulye': {
        'ru': 'Затулье', 'look': 'river free-folk of a fantasy northern land, linen, leather and river-blue cloth',
        'units': [
            ('militia', 1, 0, 'a sturdy peasant militiaman with a wooden pitchfork, padded linen jacket and a simple cap'),
            ('spearman', 1, 1, 'a veteran militia spearman with a long boar spear, round wooden shield with a blue stripe and padded armor'),
            ('slinger', 2, 0, 'a young slinger whirling a leather sling, linen shirt, a pouch of stones on the belt'),
            ('strelets', 2, 1, 'a crossbowman in a long blue caftan and fur-trimmed cap holding a heavy crossbow'),
            ('vataga', 3, 0, 'a burly river raider with a long boat hook pole and a rough fur vest'),
            ('brodnik', 3, 1, 'a fearless ford-walker warrior in chainmail with a heavy hooked polearm'),
            ('boatman', 4, 0, 'a river boatman warrior with a broad oar-shaped axe and a small round shield'),
            ('ushkuynik', 4, 1, 'a river pirate warrior with a long bearded axe, riveted conical helmet and chainmail'),
            ('herbalist', 5, 0, 'a village herbalist woman in an embroidered linen dress holding a bundle of herbs and a glowing clay bowl'),
            ('wisewoman', 5, 1, 'a wise healer woman with a carved birch staff, flowing scarf and softly glowing herbs'),
            ('rider', 6, 0, 'a light horseman on a sturdy steppe horse with a lance and a fur hat'),
            ('vityaz', 6, 1, 'an armored knight on a heavy horse, scale armor, long lance with a red and blue pennant'),
            ('tur', 7, 0, 'a giant aurochs bull with huge curved horns ridden by a champion with a war banner'),
            ('thundertur', 7, 1, 'an enormous storm aurochs with glowing blue runes on its horns, ridden by an armored champion'),
        ]},
    'zatonye': {
        'ru': 'Затонье', 'look': 'misty swamp folk, moss green, murky teal and reed ochre',
        'units': [
            ('reedling', 1, 0, 'a small reed-folk creature woven of reeds and mud holding a sharpened reed spear'),
            ('sedgeling', 1, 1, 'a sedge warrior made of tough reeds with a sickle-like blade and a woven reed shield'),
            ('frog', 2, 0, 'an upright stocky frog humanoid with mossy green skin and a pale belly, big golden eyes, woven reed vest and a reed hat, holding a long bamboo blowpipe'),
            ('toad', 2, 1, 'a toad sharpshooter with warty brown-green skin, an ornate long blowpipe, a quiver of darts and reed armor'),
            ('wisp', 3, 0, 'a floating will-o-wisp: a glowing pale green flame spirit with a faint gentle face'),
            ('wanderwisp', 3, 1, 'a bright blue-green will-o-wisp with trailing sparks and a lantern-like glowing core'),
            ('willow', 4, 0, 'a walking weeping willow tree giant with drooping branches like hair and a sad bark face'),
            ('oldwillow', 4, 1, 'an ancient massive willow giant with mossy bark, roots as legs and glowing eyes'),
            ('vodyanitsa', 5, 0, 'a swamp water maiden with pale green skin, long wet hair with water lilies and a driftwood staff'),
            ('omutnitsa', 5, 1, 'a dark pool witch with teal skin, robes of waterweed and a glowing whirlpool orb'),
            ('troll', 6, 0, 'a huge hunched swamp troll with grey-green warty skin, very long arms, moss and reeds growing on its shoulders, a wide toothy mouth, standing'),
            ('bogtroll', 6, 1, 'a massive ancient bog troll covered in thick moss and hanging waterweed, driftwood antlers, huge hands and glowing yellow eyes, standing'),
            ('mistserpent', 7, 0, 'a long coiled serpent dragon of green scales wrapped in mist, without wings'),
            ('phantomserpent', 7, 1, 'a phantom mist serpent dragon, half transparent, with glowing pale eyes'),
        ]},
    'kuznya': {
        'ru': 'Пепельная кузня', 'look': 'forge clans of an ash land, copper, bronze, soot black and ember orange',
        'units': [
            ('apprentice', 1, 0, 'a young forge apprentice with a leather apron, soot on the face and a heavy hammer'),
            ('smith', 1, 1, 'a burly master blacksmith with a huge war hammer and riveted leather armor'),
            ('wasp', 2, 0, 'a big mechanical copper wasp insect with brass wings, six thin jointed legs, a striped segmented abdomen and a sharp stinger'),
            ('stingwasp', 2, 1, 'a bigger clockwork bronze wasp with a glowing furnace abdomen'),
            ('riveter', 3, 0, 'a riveter in goggles with a heavy steam bolt-thrower on his shoulder'),
            ('repeater', 3, 1, 'an armored gunner with a repeating copper bolt-thrower and pipes on his back'),
            ('steamhound', 4, 0, 'a steam-powered iron hound with a boiler belly and smoking vents'),
            ('forgehound', 4, 1, 'a furnace hound with glowing coals inside a bronze body'),
            ('founder', 5, 0, 'a foundry woman in heat-proof leather holding a ladle of glowing molten metal'),
            ('firemistress', 5, 1, 'a fire mistress of the foundry with flowing whips of molten metal'),
            ('walkcannon', 6, 0, 'a walking cannon: a heavy bronze cannon on four mechanical legs'),
            ('walkmortar', 6, 1, 'a squat walking mortar with six iron legs and a wide barrel'),
            ('colossus', 7, 0, 'a giant copper colossus knight-machine with a furnace chest'),
            ('forgecolossus', 7, 1, 'a huge bronze colossus with glowing molten joints and a hammer arm'),
        ]},
    'akademiya': {
        'ru': 'Звёздная академия', 'look': 'star academy mages, night blue, silver, deep green and warm gold',
        'units': [
            ('student', 1, 0, 'a young human academy student boy in a dark blue robe carrying a glowing star lantern on a pole'),
            ('adept', 1, 1, 'an apprentice mage with an armillary charm and a glowing lantern staff'),
            ('owl', 2, 0, 'a large owl with a satchel of scrolls and wise eyes, standing'),
            ('seerowl', 2, 1, 'a great silver owl with starry feathers and glowing runes, standing'),
            ('crystal', 3, 0, 'a tall humanoid knight made entirely of clear pale-blue quartz crystal, faceted body, a crystal shield and a crystal sword'),
            ('prism', 3, 1, 'a tall humanoid knight made of rainbow prism crystal facets, glowing edges, a large refracting crystal shield'),
            ('stag', 4, 0, 'a large night-blue stag with tall antlers glowing with small stars, a star-chart saddle cloth, standing on four legs'),
            ('moonstag', 4, 1, 'a majestic silver-white stag with crystal antlers radiating moonlight, a silver star circlet on its brow, standing on four legs'),
            ('pineguard', 5, 0, 'a gentle tall treant giant: a walking humanoid made of pine bark with arms and legs of branches, needle hair, carrying a warm lantern'),
            ('borguard', 5, 1, 'an ancient huge treant: a walking humanoid of mossy pine bark with branch arms, pine cones and glowing amber sap in the cracks'),
            ('moondragon', 6, 0, 'a slim pale silver-blue dragon with wide feathered wings, a calm face and small star-like spots, standing on four legs with wings spread'),
            ('stardragon', 6, 1, 'a majestic white-gold dragon with wide wings dusted with glowing constellations and a star on its forehead, standing on four legs with wings spread'),
            ('fallenstar', 7, 0, 'a star elemental: a tall slender humanoid figure made of white-gold starlight flame, glowing core in the chest, arms raised'),
            ('wanderstar', 7, 1, 'a wandering star spirit: a radiant floating humanoid in a flowing robe of starlight, a long comet tail of light behind it'),
        ]},
}
NEUTRALS = [
    ('wolf', 2, 'a grey forest wolf, lean and alert'),
    ('boar', 3, 'a wild boar with big tusks and bristly dark fur'),
    ('bandit', 2, 'a forest bandit in a hood with a knotted club'),
    ('leshak', 3, 'a small forest spirit of moss, bark and twigs with glowing eyes'),
    ('kikimora', 4, 'a swamp hag with a long nose, a mossy shawl and a crooked stick'),
    ('salamander', 4, 'a fire salamander lizard with glowing ember spots'),
    ('bear', 5, 'a huge brown bear standing on all fours'),
    ('sirin', 5, 'a mythical bird with a gentle woman face and colorful long feathers, standing'),
    ('stonegiant', 6, 'a giant of mossy grey boulders with a flat calm face'),
    ('poloz', 7, 'a giant golden-scaled serpent with a jeweled crest'),
]


def creatures():
    out = []
    for fid, f in FACTIONS.items():
        for uid, tier, up, desc in f['units']:
            out.append({'name': f'{fid}-{uid}', 'faction': fid, 'tier': tier, 'up': up,
                        'prompt': f'{desc[0].upper()}{desc[1:]}. Colors and style: {f["look"]}. {{style}}'})
    for uid, tier, desc in NEUTRALS:
        out.append({'name': f'neutral-{uid}', 'faction': 'neutral', 'tier': tier, 'up': 0, 'prompt': f'{desc[0].upper()}{desc[1:]}, fantasy creature. {{style}}'})
    return out


# ------------------------------------------------------------------ герои
LADS = [  # DESIGN §1.1; облик держим одинаковым в портретах и роликах (LOOK)
    ('seryoga', 'Серёга «Тула»', 'zatulye', 'a sixteen-year-old boy with a light brown buzz cut, freckles and a cheeky confident smile'),
    ('lenka', 'Ленка «Кнопка»', 'akademiya', 'a small fifteen-year-old girl with two short dark braids, round glasses and a sharp clever look'),
    ('dimon', 'Димон «Сом»', 'zatonye', 'a big chubby sixteen-year-old boy with a calm lazy smile and a sunburnt face'),
    ('vityok', 'Витёк «Шлак»', 'kuznya', 'a lanky sixteen-year-old boy with messy black hair and soot on his cheek'),
    ('maks', 'Макс «Штиль»', None, 'a tall athletic sixteen-year-old boy with wet-looking blond hair and a calm gaze'),
    ('andryukha', 'Андрюха «Прапор»', None, 'a stocky sixteen-year-old boy with a short military haircut and a serious frown'),
    ('zheka', 'Жека «Барыга»', None, 'a skinny sixteen-year-old boy with slicked hair and a sly grin'),
    ('tyoma', 'Тёма «Тихий»', None, 'a pale quiet sixteen-year-old boy with dark hair over his eyes'),
]
LOOK = {k: d for k, _, _, d in LADS}
OUTFIT = {  # что носит пацан в мире: спортивная куртка 90-х + наряд фракции
    'zatulye': 'wearing a worn blue tracksuit jacket with white stripes under a leather jerkin and a fur-trimmed cloak',
    'akademiya': 'wearing a striped knitted sweater under a dark blue star-embroidered academy mantle',
    'zatonye': 'wearing a faded striped sailor shirt under a cloak of woven reeds, a wreath of water lilies on the head',
    'kuznya': 'wearing a black tracksuit jacket under a scorched leather forge apron with brass buckles',
    None: 'wearing a 1990s tracksuit jacket under a simple traveling cloak',
}
CLASSES = {  # фракция → (класс силы, класс магии); описания для местных героев
    'zatulye': (('sotnik', 'a seasoned captain of river militia with a short beard and a blue cloak'),
                ('znakhar', 'a village sage healer with herbs braided into the hair')),
    'zatonye': (('bolotnik', 'a broad swamp chieftain with mossy armor and a reed crown'),
                ('vorozheya', 'a swamp witch with green-tinged skin and lily ornaments')),
    'kuznya': (('master', 'a master mechanic in riveted armor with goggles on the forehead'),
               ('ognelit', 'a fire-forging mage with glowing ember tattoos')),
    'akademiya': (('strazh', 'a star guard knight in silver-blue armor'),
                  ('zvezdochet', 'a stargazer mage with a silver beard or long silver hair and a star diadem')),
}
VARIANTS = ['a young man', 'a middle-aged woman', 'an old man', 'a young woman']


def heroes():
    items = []
    for key, ru, fac, desc in LADS:
        items.append({'name': f'lad-{key}', 'width': 1024, 'height': 1024,
                      'prompt': f'{GOUACHE} Hero portrait, head and shoulders: {desc}, {OUTFIT[fac]}. Plain dark warm background.'})
    items.append({'name': 'lad-starshoy', 'width': 1024, 'height': 1024,
                  'prompt': f'{GOUACHE} Villain portrait, head and shoulders: a man about thirty with a hard face and a scar, a flat 1980s cap, '
                            'a long black coat with dark iron armor plates, cold eyes, faint red glow behind. Plain dark background.'})
    for fac, (might, magic) in CLASSES.items():
        for cid, cdesc in (might, magic):
            for i, who in enumerate(VARIANTS):
                items.append({'name': f'hero-{fac}-{cid}-{i + 1}', 'width': 1024, 'height': 1024, 'seeds': [11],
                              'prompt': f'{GOUACHE} Hero portrait, head and shoulders: {who}, {cdesc}, of the {FACTIONS[fac]["look"]}. Plain dark warm background.'})
    return items


def mounts():
    items = []
    for fac, (might, magic) in CLASSES.items():
        for cid, cdesc in (might, magic):
            items.append({'name': f'mount-{fac}-{cid}', 'prompt': f'A hero on horseback, {cdesc}, riding a horse with {FACTIONS[fac]["look"]} tack and a small banner. {{style}}'})
    return items


# ------------------------------------------------------------------ замки
COMMON_BUILDINGS = [
    ('hall', 'town hall, a large carved council hall'), ('fort', 'fortress walls with a gate and towers'),
    ('tavern', 'a cozy tavern with a sign and a porch'), ('market', 'a covered market with stalls and awnings'),
    ('guild', 'a mage guild tower'), ('smithy', 'a smithy with a chimney and an anvil outside'),
    ('storehouse', 'a storehouse for resources with barrels and crates'), ('shipyard', 'a small shipyard with a boat on a slipway'),
]
TOWNS = {
    'zatulye': {'look': 'old northern wooden architecture: log-built halls, steep plank roofs, carved gables, timber watchtowers, log palisades, square timber watchtowers with low hipped plank roofs, roof ridges ending in carved horse heads',
                'site': 'a wide riverbank meadow with birch groves and a calm river, summer evening',
                'dwell': ['a militia barracks hut', 'a slinger range with targets', 'a raider longhouse with boat hooks', 'a boat shed with river boats',
                          'a herbalist hut with drying herbs', 'horse stables with a paddock', 'a giant aurochs pen with a carved gate'],
                'unique': [('skhod', 'a carved assembly pavilion for the people\'s gathering with benches in a circle'),
                           ('relic', 'a carved wooden shrine pavilion holding a glowing brass relic')]},
    'zatonye': {'look': 'northern swamp architecture: houses on stilts, reed roofs, boardwalks over water, weeping willow arches, alders and reeds, lanterns in mist',
                'site': 'a misty green swamp with dark water pools, willows and reeds, early morning',
                'dwell': ['a reed hut cluster', 'a frog pond with lily pads and a hut', 'a glowing mist hollow', 'a weeping willow grove ring',
                          'a water maiden pool with stones', 'a big mossy troll den under a fallen tree with a fence of bones', 'a serpent lair cave in misty rocks'],
                'unique': [('fogwell', 'a stone well breathing thick mist'), ('gat', 'a long wooden causeway over the swamp')]},
    'kuznya': {'look': 'forge city architecture: brick and riveted iron workshops, tall chimneys with smoke, copper domes of furnaces, rails and cranes',
               'site': 'an ash plain with dark slag hills and glowing cracks, red sunset haze',
               'dwell': ['an apprentice workshop', 'a wasp hive of copper honeycomb', 'a bolt-thrower range', 'an iron kennel with steam vents',
                         'a foundry with glowing crucibles', 'a cannon walker assembly hangar', 'a colossus gantry crane'],
               'unique': [('furnace', 'a giant blast furnace with molten metal pouring'), ('scrapyard', 'a repair yard with mechanical scrap')]},
    'akademiya': {'look': 'star academy architecture: white stone and pine wood towers, silver observatory domes, glass galleries, lanterns',
                  'site': 'a tall pine forest on a hill under a deep blue twilight sky with first stars',
                  'dwell': ['a student dormitory with lantern windows', 'an owl tower with perches', 'a crystal grotto', 'a stag glade with a star-chart stone',
                            'a sacred pine grove with lanterns', 'a moonlit dragon perch tower with a wide stone platform', 'a fallen star crater shrine'],
                  'unique': [('observatory', 'a great observatory with a huge brass telescope'), ('lab', 'a research laboratory with glowing glassware')]},
}


def towns():
    items = []
    for fid, t in TOWNS.items():
        items.append({'name': f'town-{fid}-full', 'width': 1536, 'height': 864,
                      'prompt': f'{GOUACHE} Wide panorama of a fantasy town of the {FACTIONS[fid]["look"]}, {t["look"]}, on {t["site"]}. '
                                'Many buildings, lively and inviting, calm composition.'})
        items.append({'name': f'town-{fid}-site', 'width': 1536, 'height': 864,
                      'prompt': f'{GOUACHE} Wide panorama of an empty landscape: {t["site"]}, open flat building ground in the middle, calm composition.'})
        items.append({'name': f'map-town-{fid}', 'width': 1024, 'height': 1024,
                      'prompt': f'{GOUACHE} Adventure map object seen from above in three-quarter view: a small walled fantasy town, {t["look"]}. {ISOLATED}'})
        blds = [(b, d) for b, d in COMMON_BUILDINGS] + [(f'dwell{i + 1}', d) for i, d in enumerate(t['dwell'])] + list(t['unique'])
        for bid, d in blds:
            items.append({'name': f'bld-{fid}-{bid}', 'width': 1024, 'height': 1024, 'seeds': [21],
                          'prompt': f'{GOUACHE} A building of a fantasy town, {d}, in the style of {t["look"]}, three-quarter view. {ISOLATED}'})
    return items


# ------------------------------------------------------------------ карта
RESOURCES = [('semki', 'a burlap sack overflowing with glowing golden sunflower seeds'), ('wood', 'a neat pile of logs'),
             ('stone', 'a pile of grey cut stones'), ('amber', 'a heap of glowing honey-colored amber chunks'),
             ('salt', 'a stack of white salt blocks and a small sack'), ('stariron', 'a few dark meteoric iron ingots with silver sparkles'),
             ('resin', 'clay jars of golden pine resin')]
MAP_OBJECTS = [
    ('mine-semki', 'a golden sunflower field with a small wooden windmill'), ('mine-wood', 'a sawmill with a water wheel and log piles'),
    ('mine-stone', 'a stone quarry with a wooden crane'), ('mine-amber', 'an amber mine entrance in a sandy cliff with glowing chunks'),
    ('mine-salt', 'a salt works with evaporation pans and a shed'), ('mine-stariron', 'a meteor crater mine with a wooden derrick'),
    ('mine-resin', 'a resin tapping camp among pines with buckets'),
    ('chest', 'an old wooden treasure chest with iron bands'), ('campfire', 'a campfire with a cooking pot'),
    ('artifact', 'a stone pedestal with a glowing relic on it'), ('windmill', 'a wooden windmill on a hill'),
    ('watermill', 'a water mill with a turning wheel'), ('watchtower', 'a tall wooden lookout tower'),
    ('shrine1', 'a small stone shrine with a blue glowing rune'), ('shrine2', 'a stone shrine with two glowing runes and candles'),
    ('shrine3', 'a large stone shrine with three glowing round blue gems in its arch'), ('learnstone', 'a tall standing stone carved with glowing spiral patterns'),
    ('wisewell', 'a wooden well with a carved roof and sparkling water'), ('luckfountain', 'a small fountain with a stone fish'),
    ('gloryhill', 'a burial hill with old weapons stuck in it and a banner'), ('stables', 'horse stables with a fenced yard'),
    ('tavern', 'a roadside tavern with a lantern'), ('tradepost', 'a trading post tent with goods'),
    ('shipyard', 'a small shipyard by the water'), ('boat', 'a wooden river boat with a sail'),
    ('prison', 'a wooden prison cage wagon'), ('obelisk', 'a carved stone obelisk with a glowing top'),
    ('portal2', 'a stone ring portal with swirling blue light'), ('portal1', 'a stone arch portal with swirling red light'),
    ('whirlpool', 'a whirlpool on dark water'), ('seerhut', 'a seer hut on a hill with a smoking chimney'),
    ('guardtent', 'a striped border guard tent with a barrier'), ('keytent', 'a round canvas tent with a flat top and a large brass key hanging over the entrance'),
    ('signpost', 'a wooden signpost with arrows'), ('garrison', 'a small stone gate garrison with a tower'),
    ('treasury-meadow', 'ruins of an old stone tower'), ('treasury-swamp', 'a sunken barge in the swamp with treasure'),
    ('treasury-ash', 'ruins of a slag furnace with glowing cracks'), ('treasury-pine', 'a fallen star crater glowing among pines'),
    ('dwell-wolf', 'a wolf den in rocks'), ('dwell-boar', 'a boar thicket with a muddy wallow'), ('dwell-bandit', 'a bandit camp with tents and a fire'),
    ('dwell-leshak', 'a mossy grove with twisted trees'), ('dwell-kikimora', 'a crooked hut on stilts in the swamp'),
    ('dwell-salamander', 'a lava pit with glowing rocks'), ('dwell-bear', 'a bear cave in a hillside'),
    ('dwell-sirin', 'a giant nest on a tall dead tree'), ('dwell-stonegiant', 'a circle of huge mossy boulders'),
    ('dwell-poloz', 'a golden serpent lair in a rocky hill'),
]
TERRAINS = {  # местность → текстура грунта (вид сверху), декор
    'meadow': ('lush green meadow grass with small wildflowers', ['a white birch tree', 'a broad oak tree', 'a green bush', 'a mossy grey rock',
               'a haystack', 'a clump of birch trees', 'a fallen log', 'a wooden fence piece']),
    'swamp': ('murky swamp ground with moss, small pools of dark water and reeds', ['a dead twisted tree', 'a clump of reeds', 'a lily pond',
              'a mossy log', 'a weeping willow', 'a hummock with grass', 'bog cotton tufts', 'a rotten tree stump']),
    'ash': ('dark grey ash ground with slag pebbles and faint glowing cracks', ['a charred dead tree', 'a black lava rock', 'a slag heap',
            'a smoking steam vent', 'a cluster of dark crystals', 'a rusty broken cogwheel', 'a burnt stump', 'an ash dune']),
    'pine': ('flat brown pine needle litter with moss patches and scattered cones', ['a tall pine tree', 'a young fir tree', 'a mossy boulder', 'a ring of mushrooms',
             'a clump of pines', 'a fern bush', 'a pine stump', 'a glowing blue crystal in moss']),
}
GROUNDS = [('road-dirt', 'a packed dirt road surface'), ('road-stone', 'a cobblestone road surface'), ('road-plank', 'a wooden plank road surface'),
           ('water', 'calm river water with soft ripples'), ('sand', 'a sandy riverbank'), ('rough', 'rough rocky highland ground with sparse grass'),
           ('underground', 'a dark cave floor of stone')]


def mapping():
    items = []
    for rid, d in RESOURCES:
        items.append({'name': f'res-{rid}', 'width': 1024, 'height': 1024, 'prompt': f'{GOUACHE} Adventure map pickup seen from above: {d}. {ISOLATED}'})
    for oid, d in MAP_OBJECTS:
        items.append({'name': f'obj-{oid}', 'width': 1024, 'height': 1024,
                      'prompt': f'{GOUACHE} Adventure map object seen from above in three-quarter view: {d}. {ISOLATED}'})
    for tid, (ground, decor) in TERRAINS.items():
        items.append({'name': f'ground-{tid}', 'width': 1024, 'height': 1024,
                      'prompt': f'{GOUACHE} Seamless top-down ground texture: {ground}, even soft lighting, fills the whole square.'})
        for i, d in enumerate(decor):
            items.append({'name': f'decor-{tid}-{i + 1}', 'width': 1024, 'height': 1024, 'seeds': [31],
                          'prompt': f'{GOUACHE} Game scenery sprite seen from above in three-quarter view: {d} on a tiny patch of its own ground. {ISOLATED}'})
    for gid, d in GROUNDS:
        items.append({'name': f'ground-{gid}', 'width': 1024, 'height': 1024,
                      'prompt': f'{GOUACHE} Seamless top-down ground texture: {d}, even soft lighting, fills the whole square.'})
    for i, d in enumerate(['a rocky grey mountain massif with snow on the top', 'a group of green forested hills', 'a jagged dark volcanic ridge',
                           'a steep sandstone cliff']):
        items.append({'name': f'mountain-{i + 1}', 'width': 1536, 'height': 864,
                      'prompt': f'{GOUACHE} Game scenery sprite seen from above in three-quarter view: {d}, its own rocky ground at the foot. {ISOLATED}'})
    return items


# ------------------------------------------------------------------ бой
FIELDS = {'meadow': 'a wide flat even summer meadow with short grass, a few wildflowers, a thin strip of birch forest along the very top',
          'swamp': 'a wide flat boggy swamp meadow with moss, small puddles and reeds along the very top edge',
          'ash': 'a wide flat ash plain with dark grey ground, slag pebbles and glowing cracks along the very top edge',
          'pine': 'a wide flat pine forest clearing with needles and moss, tall pine trunks along the very top edge',
          'ford': 'a wide flat meadow with a shallow sandy river ford across the top edge',
          'crater': 'a wide flat scorched crater floor with glowing star fragments along the edges'}
OBSTACLES = ['a big mossy boulder', 'a fallen birch log', 'a thorny bush', 'a tree stump', 'a muddy puddle', 'a small smoking crater',
             'a blue crystal cluster', 'a pile of mechanical scrap', 'a dead tree', 'a heap of stones']


def battle():
    items = []
    for fid, d in FIELDS.items():
        items.append({'name': f'field-{fid}', 'width': 1536, 'height': 864,
                      'prompt': f'{GOUACHE} Battlefield background seen from high above at a steep angle, almost top-down: {d}. The middle is open, flat and clear.'})
    for fid, t in TOWNS.items():
        items.append({'name': f'siege-{fid}', 'width': 1536, 'height': 864,
                      'prompt': f'{GOUACHE} Battlefield background seen from high above at a steep angle: a flat open ground in front of town walls on the right side, '
                                f'{t["look"]}. The middle and left are open, flat and clear.'})
    for i, d in enumerate(OBSTACLES):
        items.append({'name': f'obstacle-{i + 1}', 'width': 1024, 'height': 1024, 'seeds': [41],
                      'prompt': f'{GOUACHE} Game scenery sprite seen from above in three-quarter view: {d} on a tiny patch of its own ground. {ISOLATED}'})
    return items


# ------------------------------------------------------------------ осада: стена, ворота, башня у каждого замка спрайтами (фоны осады с нарисованными стенами не легли на гексы)
# в промпте только материал и одна деталь: описание города тянет в кадр целый городок с кровлями и шпилями
SIEGE_PARTS = [('wall', 'one short chunky block of a defensive wall, as wide as it is tall, flat crenellated top'),
               ('gate', 'one short chunky block of a defensive wall with a single heavy closed gate in its front, flat crenellated top'),
               ('tower', 'one stout round defensive tower, as wide as it is tall, flat crenellated top')]
SIEGE_MATERIAL = {'zatulye': 'dark sharpened oak logs bound with rope', 'zatonye': 'mossy grey river stones and wet black timber',
                  'kuznya': 'dark red brick with riveted iron plates', 'akademiya': 'smooth white stone with thin silver trim'}


def siege():
    items = []
    for fid, material in SIEGE_MATERIAL.items():
        for pid, d in SIEGE_PARTS:
            items.append({'name': f'{pid}-{fid}', 'width': 1024, 'height': 1024,
                          'prompt': f'{GOUACHE} Game scenery sprite seen from above in three-quarter view: {d}, built of {material}, standing alone on bare ground. {ISOLATED}'})
    return items


# ------------------------------------------------------------------ иконки
ARTIFACTS = [
    'an iron helmet', 'a fur hat of the steppe', 'a crown of woven reeds', 'a starlit silver circlet', 'copper goggles with glowing lenses', 'a horned bronze helm',
    'an amber amulet', 'a wolf fang necklace', 'a silver star pendant', 'a copper gear medallion', 'a river pearl necklace',
    'a padded linen jerkin', 'a chainmail shirt', 'a bronze scale armor', 'a robe embroidered with stars', 'a riveted forge apron armor', 'a woven reed armor',
    'a fur-trimmed cloak', 'a cloak of mist', 'a feathered cloak', 'an ember-glowing cloak', 'a night sky mantle with stars',
    'a boar spear', 'a war axe', 'a blacksmith war hammer', 'a bone dagger', 'a crystal staff', 'an elder bamboo blowpipe', 'a flaming sword', 'an oak club',
    'a round wooden shield', 'a bronze shield', 'a turtle shell shield', 'a crystal shield',
    'an amber ring', 'an iron ring', 'a silver moon ring', 'a copper spiral ring', 'a ring with a green stone', 'a ring with a ruby',
    'leather boots', 'boots with small wings', 'swamp boots woven of reeds', 'iron boots', 'felt winter boots',
    'a ferryman horn', 'a bag of glowing sunflower seeds', 'a brass spyglass', 'an hourglass', 'a compass', 'a star lantern', 'an old map scroll',
    'a golden sunflower', 'a pocket mirror', 'a bundle of keys', 'a clay flask of potion', 'a carved wooden idol', 'a feather quill and inkpot',
    'a glowing brass knuckle shard', 'an assembled glowing brass knuckle',
]
SPELLS = {
    'fire': ['fire arrow', 'fireball', 'wall of fire', 'rain of fire from the sky', 'blinding flash', 'berserk rage', 'fire shield', 'bloodlust', 'curse of embers', 'inferno'],
    'water': ['ice bolt', 'frost ring', 'healing light', 'blessing', 'weakness', 'dispel magic', 'forgetfulness', 'tidal wave', 'cloak of mist', 'summon boat'],
    'earth': ['stone skin', 'slow', 'quicksand', 'earthquake', 'meteor shower', 'resurrection', 'shield of earth', 'sorrow', 'animate stone', 'view of the earth'],
    'air': ['lightning bolt', 'chain lightning', 'haste', 'precision', 'disrupting ray', 'flight', 'town portal', 'view of the air', 'protection from air', 'wind gust'],
}
# что нарисовано на иконке заклинания (название в промпт не идёт: модель вписывает его буквами)
SPELL_SCENE = {
    'fire': ['a flaming arrow streaking through the night air', 'a huge fireball bursting over a battlefield', 'a tall wall of roaring flames across a field',
             'burning meteors falling from a red sky onto hills', 'a blinding white-gold flash exploding in the dark', 'a snarling warrior with eyes glowing red and fiery aura',
             'a round shield made of swirling flames', 'a raised sword dripping with red fiery glow', 'glowing embers swirling around a cowering silhouette', 'a sea of fire engulfing a valley'],
    'water': ['a sharp shard of blue ice flying through the air', 'a ring of frost and icicles bursting outward on the ground', 'soft white light pouring from above onto an open palm',
              'a radiant blue halo over a kneeling knight', 'a drooping limp sword wrapped in grey mist', 'a crackling magic sigil shattering into blue shards',
              'a blank faded scroll dissolving into blue mist', 'a giant towering wave about to crash', 'a figure fading into thick white mist', 'a small boat rising out of glowing blue water'],
    'earth': ['a fist turning into grey granite', 'a giant snail shell glowing green over the grass', 'a hand sinking into swirling quicksand', 'the ground cracking open with rocks flying up',
              'green-glowing meteors striking a rocky plain', 'a green light lifting a fallen warrior from the earth', 'a dome of stone slabs rising from the ground',
              'a weeping stone face with green tears', 'a stone statue coming alive with glowing green eyes', 'a glowing green map of hills and rivers carved in stone'],
    'air': ['a single bolt of lightning striking a hill', 'lightning jumping between several dark silhouettes', 'a running figure with swift white wind streaks behind',
            'an arrow flying straight along a glowing violet line to a target', 'a violet beam shattering a shield', 'a figure soaring high on violet wings of wind',
            'a swirling violet portal on a town square', 'a violet glowing map of clouds and mountains', 'a violet whirlwind barrier around a knight', 'a strong gust of wind bending trees and scattering leaves'],
}
SPELL_TINT = {'fire': 'red and orange flames', 'water': 'blue and white water and ice', 'earth': 'green and brown earth and stone', 'air': 'pale violet wind and lightning'}
SKILLS = ['logistics: a horse hoof with a wing', 'pathfinding: a forest trail with arrows', 'scouting: an eye over a hill', 'wisdom: an open book with a star',
          'fire magic: a flame dancing over a bronze bowl', 'water magic: a spinning water sphere over a silver bowl', 'earth magic: a floating mossy stone', 'air magic: a glass orb with a tiny storm inside',
          'leadership: a raised banner', 'luck: a four-leaf clover', 'offense: crossed swords', 'armorer: a breastplate', 'archery: a bow with an arrow',
          'tactics: a war map with figures', 'first aid: a healer tent', 'estates: a sack of seeds', 'diplomacy: a handshake', 'scholar: a scroll and quill',
          'learning: a lit candle', 'resistance: a shield against sparks', 'mysticism: a glowing crystal ball', 'sorcery: a magic staff with sparks',
          'navigation: a ship wheel', 'eagle eye: an eagle head']
PRIMARY = ['attack: a sword', 'defense: a shield', 'spell power: a glowing staff', 'knowledge: a book', 'morale: a war horn with a ribbon', 'luck: a golden horseshoe',
           'movement: a horseshoe with wings', 'experience: a star medal', 'mana: a blue crystal', 'population: a small carved wooden house with lit windows']


def icons():
    items = []
    for i, d in enumerate(ARTIFACTS):
        items.append({'name': f'art-{i + 1:02d}', 'width': 768, 'height': 768, 'seeds': [51], 'prompt': f'{ICON} {d}.'})
    for school, names in SPELLS.items():
        for i, d in enumerate(names):
            items.append({'name': f'spell-{school}-{i + 1:02d}', 'width': 768, 'height': 768, 'seeds': [51],
                          'prompt': f'{SPELL_ART} {SPELL_SCENE[school][i]}, {SPELL_TINT[school]}.'})
    for i, d in enumerate(SKILLS):
        items.append({'name': f'skill-{i + 1:02d}', 'width': 768, 'height': 768, 'seeds': [51], 'prompt': f'{ICON} The item: {d.split(": ", 1)[1]}.'})
    for i, d in enumerate(PRIMARY):
        items.append({'name': f'stat-{i + 1:02d}', 'width': 768, 'height': 768, 'seeds': [51], 'prompt': f'{ICON} The item: {d.split(": ", 1)[1]}.'})
    for rid, d in RESOURCES:
        items.append({'name': f'icon-{rid}', 'width': 768, 'height': 768, 'prompt': f'{ICON} {d}.'})
    return items


# ------------------------------------------------------------------ ролики (тексты — docs/geroi/CAMPAIGNS.md)
SER, LEN, DIM, VIT = LOOK['seryoga'], LOOK['lenka'], LOOK['dimon'], LOOK['vityok']
CUTSCENES = [  # (id, кадр, движение)
    ('intro-1', 'Summer evening in 1995 in a Siberian city: rows of grey nine-storey panel apartment blocks, a construction site with a crane by a small river, warm sunset sky',
     'slow pan across the panel blocks toward the construction site, birds fly, warm evening light'),
    ('intro-2', f'Four different teenagers in mixed summer clothes of the 1990s (a striped t-shirt, a faded sports jacket, a sleeveless shirt) and a small girl with braids and glasses, looking down into a clay construction pit at sunset, at the bottom an old brass knuckle glows warmly in the clay; one of them is {SER}',
     'the teenagers lean a little closer, the brass knuckle lies perfectly still in the clay, only its warm golden glow pulses softly, slow gentle push in'),
    ('intro-3', 'A solar eclipse over a construction pit and panel houses, the sun becomes a black disc with a bright ring, eerie green light, wind lifting dust',
     'the sun darkens into the eclipse, dust swirls in the wind, eerie light flickers'),
    ('intro-4', 'A blinding white flash bursting from a construction pit, light rays engulfing the city at dusk',
     'a burst of white light expands from the pit and floods everything, shards of light fly outward'),
    ('intro-5', f'{SER} lying in tall summer grass among white birches, two pale moons in the sky, a glowing brass shard in his hand',
     'he slowly opens his eyes and looks up, grass sways in the wind, the shard glows'),
    ('intro-6', 'View from a hill over a wide fantasy river valley: a wooden free-folk settlement with timber towers, river boats, endless meadows to the horizon, two pale moons',
     'slow sweeping pan across the valley, boats drift on the river, clouds move'),
    ('c1-1a', f'An old grey-bearded ferryman on a wooden raft bowing to {SER} on a riverbank, a wooden settlement behind',
     'the ferryman bows and smiles, the raft rocks gently, the river flows'),
    ('c1-2a', 'A horseman with a small blue flag galloping through morning dew toward a log palisade',
     'the horseman gallops toward the camera, dew sparkles, the flag flutters'),
    ('c1-2b', f'{DIM} wearing a wreath of water lilies sitting on a throne of twisted driftwood in the middle of a misty swamp, frog warriors around',
     'mist drifts, the boy yawns lazily, frogs croak and shift, fireflies glow'),
    ('c1-3a', 'Thick mist over a river, silhouettes of frog warriors with blowpipes and floating will-o-wisps emerging from the fog',
     'the frog warriors step out of the mist, the wisps float and glow, fog swirls'),
    ('c1-3b', 'Black riders on black horses standing on a hill ridge under heavy storm clouds',
     'cloaks flap in the wind, horses stamp, lightning flickers in the clouds'),
    ('c1-4a', 'A carved stone obelisk glowing from inside among hills, a dark army camp with black banners around it at dusk',
     'the obelisk pulses with light, banners wave, campfires flicker'),
    ('c1-fin1', 'Two glowing brass shards in an open palm drawing together and fusing with a bright flash',
     'the shards slide together and fuse with a burst of golden light'),
    ('c1-fin2', 'A dark castle on a high rock under a stormy sky, in a lit window the silhouette of a man in a long coat and a flat cap',
     'clouds race past the castle, the silhouette turns away from the window, lightning flashes'),
    ('c1-fin3', f'{SER} and {DIM} sitting on a hill above a river at sunset, a small campfire beside them',
     'the campfire crackles, they talk and laugh, the sun sets slowly over the river'),
    ('c2-1a', f'Inside an observatory dome among pines: {LEN} wakes up among brass telescopes, a glowing star chart overhead',
     'she sits up and adjusts her glasses, the star chart slowly rotates and glows'),
    ('c2-1b', f'Old mages in blue star-embroidered robes bowing before {LEN} in an observatory hall, a star chart lighting up',
     'the mages bow deeply, stars on the chart light up one by one, she crosses her arms'),
    ('c2-2a', 'A forge city on an ash plain at dusk: red glow, tall smoking chimneys, walking steam machines among the workshops',
     'smoke rises, furnaces glow, a steam machine walks across the scene'),
    ('c2-2b', f'{VIT} in a leather apron hammering at an anvil, sparks flying, a copper colossus standing behind him',
     'he strikes the anvil, sparks fly, the colossus slowly turns its head'),
    ('c2-3a', 'An unrolled magic scroll on a table in a tower, above it eight glowing lights appear on a floating map',
     'the scroll glows, eight lights ignite one by one above the map'),
    ('c2-3b', 'A figure in a black cloak and a flat cap leaping from a tower window with a scroll against a big moon',
     'the thief jumps from the window and runs across the roof, the cloak flutters'),
    ('c2-4a', 'A meteor shower over a huge crater in a pine forest at night, burning meteors falling into the trees',
     'meteors streak across the sky and crash with bursts of light, smoke rises'),
    ('c2-fin1', f'{LEN} standing in a smoking crater, raising a glowing brass shard, steaming rocks around',
     'she lifts the shard, it glows brighter, smoke drifts around her'),
    ('c2-fin2', 'An open leather bag on stones, inside a yellowed metal badge and an old black-and-white photo of a Soviet courtyard with panel houses',
     'slow push in on the old photo, dust drifts in a beam of light'),
    ('c2-fin3', f'{LEN} on top of a stone tower at night sending a beam of white light toward the western horizon over a river',
     'the beam shoots across the sky, her hair and scarf blow in the wind'),
    ('win', 'A player banner being raised over a captured wooden town, a cheering army below, bright day',
     'the banner rises and unfurls, the army cheers and raises weapons'),
    ('lose', 'Dark storm clouds over an empty wooden town, a torn banner lying on the ground',
     'clouds roll in, the torn banner flaps weakly in the wind, rain begins'),
]


def cutscene_keys():
    return [{'name': cid, 'prompt': f'{GOUACHE} Cinematic wide shot: {shot}.'} for cid, shot, _ in CUTSCENES]


def videos():
    return [{'name': cid, 'keys': [f'{cid}-1'], 'prompt': f'{motion}. {MOTION}'} for cid, _, motion in CUTSCENES]


# ------------------------------------------------------------------ музыка (утверждённое звучание пробы 02)
NEW_AGE = 'new age, downtempo, early 1990s, instrumental'
MUSIC = [
    ('town-kuznya', f'industrial {NEW_AGE}, 92 bpm, rhythmic anvil hits and metal percussion in the beat, deep breakbeat, warm synth pads, low brass drones, smoky and proud', 'v'),
    ('town-akademiya', f'{NEW_AGE}, 88 bpm, glass bells, celtic harp arpeggios, airy synth pads, soft breakbeat, starry and wondrous, major key', 'v'),
    ('map-swamp', f'dark ambient {NEW_AGE}, 84 bpm, muffled drums, breathy flute, watery textures, frogs-like percussion clicks, mysterious and calm', 'v'),
    ('map-ash', f'{NEW_AGE}, 90 bpm, deep taiko, slow breakbeat, low drones, distant metal chimes, dusty and tense', 'v'),
    ('map-pine', f'{NEW_AGE}, 90 bpm, pan flute, kalimba, soft breakbeat, warm pads, peaceful forest journey, major key', 'v'),
    ('battle-b', f'epic {NEW_AGE}, 118 bpm, big drums, hard breakbeat, ethnic flute lead, low synth brass, choir pad stabs, minor key, heroic', 'b'),
    ('battle-c', f'epic {NEW_AGE}, 120 bpm, driving taiko, pulsing bass, shakuhachi lead, tense strings pad, minor key', 'b'),
    ('siege', f'cinematic {NEW_AGE}, 104 bpm, war drums, heavy breakbeat, horn calls, dark choir pads, relentless', 'b'),
    ('villain', f'dark cinematic {NEW_AGE}, 80 bpm, deep male choir humming, low organ drones, slow heavy beat, menacing and majestic, minor key', 'v'),
    ('campaign1', f'{NEW_AGE}, 94 bpm, gusli, wooden flute, frame drum, warm pads, hopeful adventure theme, major key', 'v'),
    ('campaign2', f'{NEW_AGE}, 92 bpm, music box bells, harp, airy pads, curious and clever, starry, major key', 'v'),
    ('intro', f'cinematic {NEW_AGE}, 90 bpm, slow build from soft pads to big drums, bamboo flute, mysterious then majestic', 'v'),
    ('finale', f'cinematic {NEW_AGE}, 96 bpm, triumphant, big drums, choir pads, flute melody, warm and emotional, major key', 'v'),
    ('victory', f'triumphant {NEW_AGE}, 100 bpm, short fanfare, drums and flute, bright major key', 's'),
    ('defeat', f'sad {NEW_AGE}, 70 bpm, short, low pads and lonely flute, minor key', 's'),
]
FORMS = {'v': '[intro]\n[verse]\n[chorus]\n[interlude]\n[chorus]\n[outro]', 'b': '[intro]\n[chorus]\n[verse]\n[chorus]\n[bridge]\n[chorus]', 's': '[intro]\n[outro]'}


# ------------------------------------------------------------------ звуки (озвучки нет — решение пользователя)
SFX = [
    # карта
    ('horse-grass', 2, 'normal', 1.5, 'horse walking on soft grass, hoof steps, a few steps'),
    ('horse-road', 2, 'normal', 1.5, 'horse trotting on a packed dirt road, clear hoof beats'),
    ('horse-swamp', 2, 'normal', 1.5, 'horse walking through mud and shallow water, squelching hooves'),
    ('horse-ash', 2, 'normal', 1.5, 'horse walking on gravel and ash, crunchy hooves'),
    ('horse-snort', 1, 'quiet', 1.0, 'a horse snorting and shaking its head'),
    ('boat-row', 3, 'quiet', 2.0, 'wooden boat oars rowing in calm water'),
    ('pickup-res', 1, 'ui', 0.6, 'picking up a sack, soft thud and rustle'),
    ('pickup-semki', 1, 'ui', 0.8, 'pouring a handful of dry seeds into a sack'),
    ('chest-open', 2, 'normal', 1.2, 'old wooden chest creaking open with coins inside'),
    ('artifact', 2, 'normal', 1.5, 'magical shimmering chime, a treasure found'),
    ('flag', 1, 'normal', 1.0, 'cloth banner flapping in the wind as it is raised'),
    ('mine-capture', 2, 'normal', 1.5, 'pickaxe hits on rock and a cart rolling'),
    ('shrine', 2, 'normal', 1.8, 'ethereal choir swell and magic chime'),
    ('levelup', 2, 'normal', 1.8, 'heroic short brass and bell sting, level up'),
    ('newday', 2, 'ui', 1.5, 'a rooster crows in the distance at dawn'),
    ('newweek', 3, 'normal', 2.5, 'church-free village bells? no: festive wooden drum roll and flute flourish'),
    ('teleport', 2, 'normal', 1.5, 'magical whoosh portal teleport'),
    ('dig', 2, 'normal', 1.5, 'shovel digging into soil'),
    ('learn', 2, 'quiet', 1.5, 'page turning with a soft magical sparkle'),
    ('water-splash', 1, 'normal', 1.0, 'small splash in water'),
    # город
    ('build', 3, 'normal', 2.0, 'construction sounds: hammering wood and a saw'),
    ('recruit', 2, 'normal', 1.2, 'soldiers marching a few steps and armor clinking'),
    ('market', 2, 'normal', 1.2, 'coins clinking on a wooden counter'),
    ('gate', 2, 'normal', 1.5, 'heavy wooden town gate creaking open'),
    ('forge', 2, 'normal', 1.5, 'hammer striking an anvil twice with a hiss of steam'),
    ('owl', 1, 'quiet', 1.0, 'an owl hooting once'),
    ('frogs', 2, 'quiet', 2.0, 'swamp frogs croaking chorus'),
    ('river', 3, 'ambience', 3.0, 'calm river flowing, gentle ambience'),
    # бой — удары и выстрелы
    ('hit-blade', 1, 'normal', 0.8, 'sword slash hitting leather armor'),
    ('hit-blunt', 1, 'normal', 0.8, 'heavy wooden club hit, thud'),
    ('hit-metal', 1, 'normal', 0.8, 'hammer hitting metal armor, clang'),
    ('hit-claw', 1, 'normal', 0.8, 'animal claw swipe and bite'),
    ('hit-spear', 1, 'normal', 0.8, 'spear thrust impact'),
    ('hit-crystal', 1, 'normal', 0.8, 'crystal shattering hit, glassy'),
    ('hit-wood', 1, 'normal', 0.8, 'heavy tree branch whipping hit'),
    ('hit-magic', 1, 'normal', 0.8, 'magical energy impact burst'),
    ('shot-sling', 1, 'normal', 0.8, 'sling whirling and releasing a stone'),
    ('shot-crossbow', 1, 'normal', 0.8, 'crossbow firing a bolt, twang'),
    ('shot-blowpipe', 1, 'normal', 0.6, 'blowpipe dart puff'),
    ('shot-bow', 1, 'normal', 0.8, 'bow string release, arrow whoosh'),
    ('shot-bolt-steam', 1, 'normal', 0.8, 'steam powered bolt launcher hiss and thunk'),
    ('shot-cannon', 2, 'loud', 1.5, 'bronze cannon firing, deep boom'),
    ('shot-mortar', 2, 'loud', 1.5, 'mortar launching with a hollow thump'),
    ('impact-stone', 1, 'normal', 0.8, 'stone hitting the ground'),
    ('impact-arrow', 1, 'normal', 0.6, 'arrow thudding into wood'),
    ('impact-boom', 2, 'loud', 1.5, 'explosion of a cannonball'),
    ('miss', 1, 'quiet', 0.6, 'whoosh of a missed swing'),
    ('defend', 1, 'normal', 0.8, 'shield raised and braced, wooden thud'),
    ('death-human', 1, 'normal', 1.0, 'body falling to the ground in armor, no voice'),
    ('death-creature', 2, 'normal', 1.2, 'large creature collapsing heavily'),
    ('death-machine', 2, 'normal', 1.5, 'machine breaking apart, metal parts falling, steam hiss'),
    ('death-spirit', 2, 'normal', 1.2, 'ghostly spirit fading away with a sigh of wind'),
    ('move-foot', 1, 'quiet', 1.0, 'soldiers footsteps on grass'),
    ('move-hoof', 1, 'quiet', 1.0, 'cavalry galloping short'),
    ('move-hop', 1, 'quiet', 0.8, 'a frog hopping, wet slap'),
    ('move-fly', 1, 'quiet', 1.0, 'wings flapping'),
    ('move-mech', 1, 'quiet', 1.0, 'mechanical steps with clanking gears'),
    ('move-float', 1, 'quiet', 1.0, 'soft magical floating hum'),
    ('move-heavy', 2, 'normal', 1.2, 'giant creature heavy footsteps shaking the ground'),
    ('morale', 2, 'normal', 1.2, 'triumphant short horn call'),
    ('luck', 1, 'normal', 1.0, 'sparkling lucky chime'),
    ('badmorale', 1, 'normal', 1.0, 'sad low horn, discouraged'),
    ('catapult', 2, 'loud', 1.5, 'wooden siege ram hitting a wall, crumbling stones'),
    ('wall-break', 2, 'loud', 1.8, 'stone wall collapsing'),
    ('tower-shot', 1, 'normal', 1.0, 'arrow volley from a tower'),
    ('battle-start', 2, 'normal', 2.0, 'war drums and horn signaling the start of battle'),
    ('battle-win', 2, 'normal', 2.0, 'victory cheer of a crowd without words and drums'),
    ('battle-lose', 2, 'normal', 2.0, 'low gloomy drum and wind, defeat'),
    # голоса существ (без слов)
    ('voice-frog', 1, 'normal', 1.0, 'a big frog croak'),
    ('voice-wolf', 2, 'normal', 1.5, 'a wolf growl and short howl'),
    ('voice-boar', 1, 'normal', 1.0, 'a wild boar grunt'),
    ('voice-bear', 2, 'normal', 1.5, 'a bear roar'),
    ('voice-bird', 1, 'normal', 1.0, 'a large bird screech'),
    ('voice-owl', 1, 'normal', 1.0, 'an owl screech'),
    ('voice-bull', 2, 'normal', 1.5, 'a giant bull bellowing'),
    ('voice-horse', 1, 'normal', 1.0, 'a war horse neighing'),
    ('voice-tree', 2, 'normal', 1.5, 'creaking groaning old tree'),
    ('voice-water', 2, 'normal', 1.5, 'gurgling water spirit hiss'),
    ('voice-fish', 2, 'normal', 1.5, 'deep underwater rumble and bubbles'),
    ('voice-serpent', 2, 'normal', 1.5, 'serpent dragon hiss and low roar'),
    ('voice-wasp', 1, 'normal', 1.0, 'mechanical buzzing of a big wasp'),
    ('voice-hound', 1, 'normal', 1.0, 'metal hound bark with steam hiss'),
    ('voice-colossus', 2, 'normal', 1.5, 'giant metal machine groan and furnace roar'),
    ('voice-crystal', 1, 'normal', 1.0, 'crystal resonance chime'),
    ('voice-whale', 2, 'normal', 2.0, 'whale song low call'),
    ('voice-star', 2, 'normal', 1.5, 'shimmering cosmic hum rising'),
    ('voice-salamander', 1, 'normal', 1.0, 'lizard hiss with crackling fire'),
    ('voice-stone', 2, 'normal', 1.5, 'grinding rocks rumble'),
    ('voice-war', 1, 'normal', 1.0, 'group battle shout of warriors without words'),
    # заклинания
    ('spell-fire', 2, 'normal', 1.5, 'fireball whoosh and fiery burst'),
    ('spell-water', 2, 'normal', 1.5, 'ice crystals forming and shattering'),
    ('spell-earth', 2, 'normal', 1.5, 'earth rumble with rocks rising'),
    ('spell-air', 2, 'normal', 1.5, 'lightning strike with crackle'),
    ('spell-buff', 2, 'normal', 1.2, 'bright ascending magical chime, blessing'),
    ('spell-curse', 2, 'normal', 1.2, 'dark descending magical whisper sound, curse'),
    ('spell-heal', 2, 'normal', 1.2, 'soft warm healing shimmer'),
    ('spell-summon', 2, 'normal', 1.5, 'magical summoning swirl'),
    ('spell-fail', 1, 'ui', 0.8, 'fizzle of failed magic'),
    # интерфейс
    ('ui-click', 1, 'ui', 0.3, 'soft wooden button click'),
    ('ui-open', 1, 'ui', 0.6, 'opening a leather book'),
    ('ui-close', 1, 'ui', 0.5, 'closing a leather book'),
    ('ui-scroll', 1, 'ui', 0.8, 'unrolling a parchment scroll'),
    ('ui-error', 1, 'ui', 0.5, 'dull wooden knock, denied'),
    ('ui-turn', 2, 'ui', 1.5, 'short warm horn call, your turn'),
    ('text-type', 1, 'ui', 0.4, 'quill scratching on parchment, short'),
]
SFX = [s if s[0] != 'newweek' else ('newweek', 3, 'normal', 2.5, 'festive wooden drum roll and a bright flute flourish') for s in SFX]


# ------------------------------------------------------------------ запись
def image_job(name, title, items, seeds, defaults=None):
    job = {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)',
           'defaults': defaults or {'width': 1024, 'height': 1024, 'steps': 8}, 'seeds': seeds, 'items': items}
    write(name, title, job)


def write(name, title, job):
    head = f'# Герои, {title}\n# Сгенерировано make_jobs.py — правки вносить туда.\n'
    (HERE / name).write_text(head + yaml.safe_dump(job, allow_unicode=True, sort_keys=False, width=160), encoding='utf-8')


# Переделки после отбора: те же пункты с новыми промптами и новыми сидами — отдельной партией «<партия>-redo»,
# чтобы ночные варианты остались для сравнения. Отбор — studio/jobs/geroi/picks.json.
REDO = {
    '10-creatures': ([f'akademiya-{u[0]}' for u in FACTIONS['akademiya']['units']] + ['kuznya-wasp'], [43, 44]),
    '10-creatures#2': (['akademiya-stag', 'akademiya-moonstag'], [45, 46]),  # кентавры не дались (люди с конской головой, всадники) — олени
    '10-creatures#3': (['zatonye-troll', 'zatonye-bogtroll', 'akademiya-moondragon', 'akademiya-stardragon'], [47, 48]),  # рыбы и киты на поле — «глупо» (пользователь 2026-11-04)
    '11b-mounts': (['mount-akademiya-strazh', 'mount-akademiya-zvezdochet'], [63, 64]),
    '12-towns': ([f'bld-{f}-{b}' for f in ('zatulye', 'zatonye') for b in [c[0] for c in COMMON_BUILDINGS] + [f'dwell{i}' for i in range(1, 8)]
                  + [u[0] for u in TOWNS[f]['unique']]], [22, 23]),
    '12-towns#2': (['bld-zatonye-dwell6', 'bld-akademiya-dwell6'], [24, 25]),
    '13-map': ([f'decor-{t}-{i}' for t in TERRAINS for i in range(1, 9)] + [f'mountain-{i}' for i in range(1, 5)]
               + ['obj-learnstone', 'obj-shrine3', 'obj-keytent', 'ground-pine'], [32, 33]),
    '14-battle': (['obstacle-3', 'obstacle-5', 'obstacle-6', 'obstacle-9'], [42, 43]),
    '15-icons': (None, [52, 53]),  # все: ночные вышли плоскими пиктограммами с буквами
    '15-icons#2': ([f'spell-{sc}-{i:02d}' for sc in SPELLS for i in range(1, 11)], [54, 55]),  # в redo вписаны названия буквами, сцены однообразны
    '16-cutscene-keys': (['intro-2'], [3, 4]),
    '17-videos': ({'intro-2': ('intro-2-4', 1), 'c2-3b': ('c2-3b-1', 2)}, None),
    '17-videos#2': ({'intro-2': ('intro-2-4', 2)}, None),  # в первой переделке кастет превращался в трубку  # intro-2-4 — из 16-cutscene-keys-redo; c2-3b: вор появлялся из ниоткуда
    '19-sfx': (['death-spirit', 'learn', 'market', 'move-hop', 'pickup-res', 'shot-sling', 'voice-star'], [3, 4]),  # тихие: почти один шум
}


def redo_jobs():
    for key, (names, seeds) in REDO.items():
        batch, _, n = key.partition('#')
        job = yaml.safe_load((HERE / f'{batch}.yaml').read_text(encoding='utf-8'))
        if 'clips' in job:  # ролики: names — {ролик: (ключ, сид)}; ключ из переделок копируется к ключам партии 16
            job['clips'] = [{**c, 'keys': [names[c['name']][0]], 'seeds': [names[c['name']][1]]} for c in job['clips'] if c['name'] in names]
            write(f'{batch}-redo{n}.yaml', f'переделки партии {batch} после отбора', job)
            continue
        key = 'sounds' if 'sounds' in job else 'items'
        job[key] = [{k: v for k, v in i.items() if k != 'seeds'} for i in job[key] if names is None or i['name'] in names]
        if key == 'sounds':
            for i in job[key]:
                i['prompt'] = 'close-up, clear and present: ' + i['prompt']
        job['seeds'] = seeds
        write(f'{batch}-redo{n}.yaml', f'переделки партии {batch} после отбора', job)


def main():
    cr = creatures()
    write('10-creatures.yaml', 'партия 10: эталоны существ под 3D (4 фракции × 14 + 10 нейтралов)',
          {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)',
           'defaults': {'width': 1024, 'height': 1024, 'steps': 8}, 'seeds': [41, 42], 'style': CREATURE3D,
           'items': [{'name': c['name'], 'prompt': c['prompt']} for c in cr]})
    (HERE / 'creatures.json').write_text(json.dumps(cr, ensure_ascii=False, indent=1), encoding='utf-8')
    image_job('11-heroes.yaml', 'партия 11: портреты героев (8 пацанов, Старшой, 32 местных)', heroes(), [11, 12])
    write('11b-mounts.yaml', 'партия 11б: герой на коне — эталоны под 3D (8 классов)',
          {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)',
           'defaults': {'width': 1024, 'height': 1024, 'steps': 8}, 'seeds': [61, 62], 'style': CREATURE3D, 'items': mounts()})
    image_job('12-towns.yaml', 'партия 12: замки — панорамы, площадки, постройки, замки на карте', towns(), [11, 12])
    image_job('13-map.yaml', 'партия 13: карта — ресурсы, объекты, грунты, декор, горы', mapping(), [11, 12])
    image_job('14-battle.yaml', 'партия 14: поля боя, осады, препятствия', battle(), [11, 12])
    image_job('14b-siege.yaml', 'партия 14б: осада — стена, ворота, башня × 4 замка', siege(), [73, 74])
    image_job('15-icons.yaml', 'партия 15: иконки — артефакты, заклинания, навыки, параметры, ресурсы', icons(), [11, 12])
    image_job('16-cutscene-keys.yaml', 'партия 16: ключевые кадры роликов (docs/geroi/CAMPAIGNS.md)', cutscene_keys(), [1, 2],
              {'width': 1280, 'height': 704, 'steps': 8})
    write('17-videos.yaml', 'партия 17: ролики Wan 2.2 (окно кампании + вступление; апскейл и монтаж — утром)',
          {'keys': f'{OUT}/16-cutscene-keys', 'server': 'comfy-big',
           'defaults': {'width': 1280, 'height': 704, 'frames': 121, 'steps': 30}, 'seeds': [1], 'clips': videos()})
    write('18-music.yaml', 'партия 18: музыка YuE2 — полный набор первого выпуска (к пробе 02)',
          {'out': f'{OUT}/18-music', 'max_duration': 150,
           'tracks': [{'name': n, 'seeds': [11, 22], 'style': st, 'lyrics': FORMS[f], **({'max_duration': 40} if f == 's' else {})}
                      for n, st, f in MUSIC]})
    write('19-sfx.yaml', 'партия 19: звуки (озвучки нет)',
          {'out': f'{OUT}/19-sfx', 'seeds': [1, 2],
           'sounds': [{'name': n, 'duration': d, 'level': lv, 'max': mx, 'prompt': p} for n, d, lv, mx, p in SFX]})
    content(cr)
    n = {f: len(yaml.safe_load((HERE / f).read_text(encoding='utf-8')).get('items', [])) for f in
         ('10-creatures.yaml', '11-heroes.yaml', '11b-mounts.yaml', '12-towns.yaml', '13-map.yaml', '14-battle.yaml', '15-icons.yaml', '16-cutscene-keys.yaml')}
    print(n, 'ролики', len(CUTSCENES), 'музыка', len(MUSIC), 'звуки', len(SFX))


def content(cr):
    """docs/geroi/CONTENT.md — что где в игре (разметка мест)."""
    L = ['# «Герои кастета и семок» — контент первого выпуска', '',
         '_Сгенерировано `studio/jobs/geroi/make_jobs.py` — правки вносить туда. Выход конвейера — `G:/temp/studio/out/geroi/<партия>/`, '
         'отбор — мой, в игру — `lavochka/public/geroi/a/` (LFS) через `pack_geroi.py`._', '',
         '| Партия | Что | Где в игре |', '|---|---|---|',
         f'| 10-creatures → 20-creature-3d | {len(cr)} существ: эталон → TripoSG → Blender, анимации idle/move/shoot/hit/defend/death | бой (отряды), окно найма, карта (нейтралы-охрана), иконки отрядов в армии героя |',
         '| 11-heroes | 8 пацанов + Старшой (2 варианта), 32 местных героя | портрет героя (панель, таверна, найм), кампании, экран выбора |',
         '| 11b-mounts | 8 классов героя на коне (эталон под 3D) | герой на карте приключений (8 направлений — утром) |',
         '| 12-towns | панорама замка целиком и пустая площадка × 4, постройки по 18 × 4, замок на карте × 4 | экран замка (слои построек поверх площадки), меню стройки, карта |',
         '| 13-map | ресурсы × 7, объекты × 50, грунты × 11, декор × 32, горы × 4 | карта приключений (шейдер грунта, спрайты объектов, генератор §7) |',
         '| 14-battle | поля × 6, осада × 4, препятствия × 10 | фон боя по местности, осада, препятствия на гексах |',
         '| 15-icons | артефакты × 60, заклинания × 40, навыки × 24, параметры × 10, ресурсы × 7 | книга магии, кукла героя, навыки, ресурсная строка |',
         '| 16-cutscene-keys → 17-videos | 27 роликов (`docs/geroi/CAMPAIGNS.md`) | вступление (весь экран), окно ролика кампании, победа/поражение |',
         '| 18-music | 15 треков × 2 (+ проба 02 — 12 треков) | меню, замки, карта по местности, бой, осада, кампании, злодей, финал, победа/поражение |',
         '| 19-sfx | ' + str(len(SFX)) + ' звуков × 2 | конь по местностям, подборы, стройка, удары/выстрелы по типам, гибель, голоса существ, заклинания, интерфейс |', '',
         '## Существа', '', '| Имя | Фракция | Ступень | Улучшение | Звук голоса/удара (подбор) |', '|---|---|---|---|---|']
    for c in cr:
        L.append(f"| `{c['name']}` | {c['faction']} | {c['tier']} | {'да' if c['up'] else ''} | |")
    L += ['', '## Ролики', '', '| Ролик | Где | Ключ | Движение |', '|---|---|---|---|']
    for cid, shot, motion in CUTSCENES:
        where = 'вступление' if cid.startswith('intro') else 'кампания 1' if cid.startswith('c1') else 'кампания 2' if cid.startswith('c2') else 'итог сценария'
        L.append(f'| `{cid}` | {where} | {shot[:90]}… | {motion} |')
    L += ['', '## Музыка', '', '| Трек | Ситуация |', '|---|---|']
    for n, _, f in MUSIC:
        L.append(f'| `{n}` | {"короткий (до 40 с)" if f == "s" else "петля"} |')
    L += ['', 'Проба 02 (утверждена): `menu`, `menu-vox`, `zatulye`, `zatonye`, `battle`, `map` (луга).', '',
          '## Звуки', '', ', '.join(f'`{s[0]}`' for s in SFX), '']
    (ROOT / 'docs/geroi/CONTENT.md').write_text('\n'.join(L), encoding='utf-8')


if __name__ == '__main__':
    main()
    redo_jobs()
