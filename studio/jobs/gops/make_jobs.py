"""ГОПС: весь контент-план картинок одним списком → задания 20–29 для run.py / runners/video.py.

python studio/jobs/gops/make_jobs.py      (перезаписывает 2x-*.yaml рядом)

План и порядок — docs/gops/CONTENT.md. Стиль — a-toon3d (bible/gopnik.md), окружение — как 06-yard.
"""
import pathlib

import yaml

HERE = pathlib.Path(__file__).parent

OBJ = ('Stylized cartoon 3D game art, soft toon shading, clean dark outline, flat saturated colors, '
       'Russian provincial town of the 1990s, no people, no text, no letters, no logos, no watermark.')
ENV = ('Stylized cartoon 3D game art, soft toon shading, clean shapes, Russian provincial town of the 1990s, '
       'slightly shabby but cozy, no people, no text, no logos, no watermark.')
TIME = {
    'evening': 'warm late-summer evening light, golden sky with soft clouds',
    'day': 'bright clear midday light, blue sky with small fluffy clouds',
    'night': 'night scene, deep blue sky with stars and a big moon, warm yellow lit windows and street lamps',
    'grey': 'overcast grey autumn day, moody soft light, drizzle haze',
    'winter': 'frosty winter day, pale pink sunset sky, snow everywhere',
}
ISO = 'Single object isolated on plain light grey background, side view, whole object in frame: '

# ---------------------------------------------------------------- темы уровней
# Каждая тема: дальний и ближний фон (для параллакса) в своих временах суток, грунт в разрезе, кромка,
# смертельная жидкость, 12–14 предметов. Двор (06-yard) уже есть — здесь его дополняем ночью и предметами.
THEMES = {
    'yard': dict(
        title='Двор', times=['night', 'grey'],
        near='a row of five-storey grey panel khrushchevka buildings with balconies and laundry, rusty garages, poplars, a playground',
        far='distant silhouettes of nine-storey panel blocks, a factory chimney and a TV tower on the horizon',
        ground='packed brown earth with broken red bricks, gravel, asphalt chunks, rusty pipe fragments, bottle caps',
        crust='cracked grey asphalt with tufts of grass and dandelions',
        liquid='a huge muddy brown puddle with floating leaves and a paper boat',
        props=['metal climbing frame shaped like a rocket', 'Soviet carousel roundabout', 'sandbox with a wooden mushroom roof',
               'clothes drying rack with laundry', 'telephone booth, red and cracked glass', 'street lamp post, concrete',
               'carpet beating rack (metal frame)', 'abandoned baby stroller, Soviet style']),
    'garages': dict(
        title='Гаражи', times=['evening', 'day', 'night'],
        near='endless rows of rusty corrugated metal garages with mismatched doors, tar roofs, satellite dishes, birch trees behind',
        far='flat landscape with power line towers and distant panel blocks',
        ground='oily dark soil with buried car parts, bolts, broken bricks, old batteries, tire chunks',
        crust='crumbling concrete slab edge with weeds and puddle stains',
        liquid='a black oily puddle of used motor oil with rainbow sheen',
        props=['old boxy Soviet sedan on bricks with no wheels', 'garage door painted green, slightly open', 'stack of old car tires',
               'rusty metal barrel of fuel', 'car engine block on a pallet', 'homemade wooden ladder leaning', 'small Soviet motorcycle with sidecar',
               'workbench with vise', 'gas cylinder red', 'car hood leaning on a wall', 'old Soviet minivan, light blue, rusted', 'dog house with a chain']),
    'construction': dict(
        title='Стройка', times=['day', 'evening', 'grey'],
        near='unfinished panel building skeleton with a tower crane, concrete slabs, scaffolding, a blue fence',
        far='new microdistrict under construction, several cranes on the horizon',
        ground='layered sand and clay with concrete chunks, rebar, broken tiles, gravel layers',
        crust='rough concrete edge with sand and rebar sticking out',
        liquid='a pit of grey wet cement slurry',
        props=['concrete mixer, orange', 'stack of concrete slabs', 'big concrete ring for wells', 'wheelbarrow with sand',
               'wooden cable spool', 'construction trailer cabin (bytovka)', 'pile of red bricks on a pallet', 'steel I-beam',
               'traffic barrier striped red white', 'small yellow excavator, toy-like', 'tower crane hook with chain', 'portable toilet booth blue']),
    'dump': dict(
        title='Свалка', times=['grey', 'evening'],
        near='mountains of garbage, old fridges and cars, crows, smoke from burning heaps',
        far='hazy horizon with a landfill hill and seagulls, distant chimneys',
        ground='compressed trash layers: plastic bags, cans, old shoes, newspapers, glass, dirt',
        crust='crust of crumpled cans, bottles and rags with a few weeds',
        liquid='a green toxic sludge pool with bubbles',
        props=['old white Soviet fridge lying on its side', 'broken tube TV set', 'old sofa with springs out', 'pile of garbage bags',
               'rusty car body crushed', 'old bathtub cast iron', 'burning barrel with small fire', 'broken piano upright',
               'shopping cart rusty', 'pile of old tires smoking', 'washing machine old round Soviet', 'mattress stained']),
    'factory': dict(
        title='Завод', times=['grey', 'night', 'evening'],
        near='Soviet factory buildings with sawtooth roofs, huge pipes, cooling towers, overpasses, broken windows',
        far='industrial skyline of chimneys with smoke and red warning lights',
        ground='dark slag and coal layers with metal scraps, gears, pipes and concrete blocks',
        crust='steel grating and rusty metal plates edge with oil stains',
        liquid='a pool of black fuel oil (mazut) with slow ripples',
        props=['big rusty gear wheel', 'industrial pipe valve with red wheel', 'metal container shipping rusty', 'electric transformer box with danger sign (no text)',
               'pallet stack', 'forklift old Soviet yellow', 'big metal hook on chain', 'rusty water tower',
               'control panel with dials', 'coal cart on rails', 'steel drums stacked', 'factory lamp hanging']),
    'market': dict(
        title='Рынок', times=['day', 'evening'],
        near='a 1990s open-air market: rows of stalls under tarps, kiosks with bars, crowds of umbrellas, a bus stop',
        far='city center with a Stalinist building and a church dome, trams',
        ground='trampled soil with cardboard, crates, fruit peels, coins, bottle caps and sunflower husks',
        crust='broken paving tiles with litter and puddles',
        liquid='a deep river of rain water rushing along the market street',
        props=['metal street kiosk with small windows', 'market stall with watermelons', 'kvass yellow barrel on wheels', 'wooden crates with apples',
               'big checkered plastic bag (chelnok bag)', 'old scales with weights', 'striped market umbrella', 'shawarma stand with a grill',
               'soda water vending machine Soviet', 'pile of cabbages', 'stack of VHS tapes on a folding table', 'ice cream cart']),
    'depot': dict(
        title='Депо', times=['evening', 'grey', 'night'],
        near='a railway yard with freight cars, tanks, semaphores, a footbridge and a little station',
        far='steppe horizon with a long freight train and power lines',
        ground='railway ballast gravel over dark soil with sleepers, rails, spikes and coal',
        crust='rail track on wooden sleepers and gravel',
        liquid='a flooded drainage ditch with dark water and reeds',
        props=['freight boxcar red brown', 'railway tank car black', 'old green diesel locomotive', 'railway semaphore signal',
               'hand draisine (handcar)', 'pile of railway sleepers', 'switch lever', 'railway buffer stop',
               'water column for steam engines', 'small booth of a switchman', 'flatcar with logs', 'old steam locomotive black red']),
    'dacha': dict(
        title='Дачи', times=['day', 'evening'],
        near='Soviet dacha village: small wooden houses, greenhouses, fences, apple trees, a water tower',
        far='forest and fields with a river bend, a village church',
        ground='rich black garden soil with potatoes, carrots, roots, worms and pebbles',
        crust='green grass edge with garden beds and strawberries',
        liquid='a pond with water lilies and frogs',
        props=['small wooden dacha house with a veranda', 'greenhouse with plastic film', 'wooden outhouse', 'garden scarecrow',
               'big barrel for rain water', 'wooden bathhouse banya', 'apple tree with red apples', 'old bicycle Soviet',
               'garden wheelbarrow with potatoes', 'beehive', 'well with a wooden crank', 'pile of firewood']),
    'winter': dict(
        title='Зима', times=['winter', 'night'],
        near='snowy courtyard with panel buildings, an ice slide, a frozen hockey box, snowmen and spruce trees',
        far='snowy city skyline with smoke from chimneys rising straight up',
        ground='packed snow and ice layers with frozen dirt, buried sleds and mittens',
        crust='snowdrift edge with icicles and snow crust',
        liquid='an ice hole (prorub) of freezing black water with ice shards',
        props=['snowman with a bucket hat', 'wooden sled Soviet', 'ice slide wooden', 'hockey goal net',
               'decorated spruce New Year tree', 'snow-covered bench', 'frozen car under snow', 'ice sculpture of a bear',
               'snow fort wall', 'pile of snow with a shovel', 'tangerine crate', 'skating rink lamp post']),
    'heating': dict(
        title='Теплотрасса', times=['night', 'grey'],
        near='underground heating tunnel with huge insulated pipes, valves, steam, dim lamps and graffiti-free concrete walls',
        far='dark concrete tunnel depth with pipes fading into steam',
        ground='wet concrete and clay with pipes, cables, rusted brackets and rat holes',
        crust='concrete ledge with pipes running along it and dripping water',
        liquid='steaming hot water from a burst pipe, boiling with bubbles',
        props=['big insulated pipe section with steam leak', 'rusty valve wheel', 'manhole ladder', 'old mattress and a kettle (cozy corner)',
               'electric cable spool', 'pressure gauge on pipe', 'wooden crate as a table with candles', 'concrete pillar cracked',
               'red fire extinguisher old', 'flashlight on the floor', 'rat sitting on a pipe (cute)', 'metal hatch door']),
    'school': dict(
        title='Школа', times=['day', 'evening'],
        near='a typical Soviet school building, stadium with a running track, football goals, a monument-free square, birches',
        far='city outskirts with panel blocks and a water tower',
        ground='sports ground soil with red running track rubber, chalk, lost balls, pencils and erasers',
        crust='red running track edge with white lines and grass',
        liquid='a flooded school basement water, murky with floating balls',
        props=['school desk wooden with a chair', 'blackboard on wheels', 'vaulting horse (gym)', 'basketball hoop',
               'globe on a stand', 'football goal', 'skeleton model from biology class (cartoon, cute)', 'school bus yellow old',
               'piano in an assembly hall', 'stack of books', 'gym mat stack', 'chalk and sponge on a shelf']),
    'beach': dict(
        title='Пляж', times=['day', 'evening'],
        near='city river beach: boat rental station, piers, a rusty barge, sun umbrellas, a bridge over the Ob river',
        far='wide river with a long bridge and the city skyline on the far bank',
        ground='wet river sand with shells, pebbles, driftwood, bottle caps and a lost slipper',
        crust='sandy edge with reeds and a few shells',
        liquid='river water, greenish blue with small waves',
        props=['rowing boat wooden', 'lifeguard tower', 'beach umbrella striped', 'inflatable ring',
               'catamaran pedal boat', 'kvass barrel', 'old rusty anchor', 'beach changing booth',
               'fishing rod with a bucket', 'sand castle', 'deck chair', 'small pier section on stilts']),
}


def theme_job(tid: str, t: dict) -> dict:
    items = []
    for tod in t['times']:
        items.append({'name': f'{tid}-far-{tod}', 'width': 1792, 'height': 768, 'prompt':
                      f"Wide panorama for a side-scrolling 2D game far background: {t['far']}, simple, low detail, "
                      f"horizon at the very bottom. {TIME[tod]}. {ENV}"})
        items.append({'name': f'{tid}-near-{tod}', 'width': 1792, 'height': 768, 'prompt':
                      f"Wide side-view panorama seen at eye level from far away: {t['near']}, horizon in the lower third. "
                      f"{TIME[tod]}. {ENV}"})
    items.append({'name': f'{tid}-ground', 'seeds': [1, 2], 'prompt':
                  f"Flat texture of a cross-section of {t['ground']}, seen straight on, filling the whole frame edge to edge, "
                  f"hand-painted 2D game terrain texture, even lighting, no horizon, no sky. {ENV}"})
    items.append({'name': f'{tid}-crust', 'seeds': [1, 2], 'width': 1792, 'height': 512, 'prompt':
                  f"Horizontal strip texture of a ground edge seen from the side: {t['crust']}, hand-painted 2D game terrain border, "
                  f"plain grey background above and below. {ENV}"})
    items.append({'name': f'{tid}-liquid', 'seeds': [1, 2], 'width': 1792, 'height': 512, 'prompt':
                  f"Side view strip of {t['liquid']}, surface line at the top third, seamless horizontally, 2D game deadly liquid, "
                  f"plain dark background above. {ENV}"})
    for i, p in enumerate(t['props']):
        items.append({'name': f'{tid}-prop{i + 1:02d}', 'seeds': [1, 2], 'prompt': ISO + p + '. ' + OBJ})
    return {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)',
            'defaults': {'width': 1024, 'height': 1024, 'steps': 8}, 'seeds': [1, 2, 3], 'items': items}


# ---------------------------------------------------------------- арсенал
# (id, название, иконка-предмет, как выглядит в мире/в руке — None, если только иконка)
WEAPONS = [
    ('mukha', '«Муха»', 'olive green Soviet disposable rocket launcher tube RPG-18', 'olive green rocket launcher tube'),
    ('homing', 'Ракета с наводкой', 'small cartoon rocket with a red nose and a little antenna', 'small cartoon rocket with fins'),
    ('mortar', 'Миномёт из трубы', 'homemade mortar made of a rusty water pipe on a stand', 'small round mortar shell'),
    ('pigeon', 'Голубь с петардой', 'grey city pigeon with a red firecracker tied to its back', 'flying grey pigeon carrying a firecracker'),
    ('limonka', 'Лимонка', 'cartoon F1 hand grenade, green, ribbed', 'green ribbed hand grenade'),
    ('carbide', 'Банка с карбидом', 'tin can with a lid tied with wire, white smoke seeping', 'tin can with smoke'),
    ('korsar', 'Ящик петард «Корсар»', 'cardboard box full of colorful firecrackers', 'colorful cardboard firecracker tube'),
    ('tnt', 'Тротиловая шашка', 'yellow TNT block with a fuse', 'yellow explosive block with a lit fuse'),
    ('mine', 'Растяжка', 'small round metal landmine with a blinking red light', 'round metal mine with a red light'),
    ('dog', 'Дворняга с петардой', 'cute scruffy mongrel dog with a firecracker on its collar, running', 'cute running mongrel dog'),
    ('kite', 'Воздушный змей', 'diamond-shaped paper kite with a firecracker tail', 'paper kite flying'),
    ('auger', 'Ледобур', 'ice auger drill with a bomb on top, spinning', 'spinning ice auger bomb'),
    ('obrez', 'Обрез', 'sawn-off double barrel shotgun, wooden stock, cartoon', 'sawn-off shotgun'),
    ('makarov', '«Макаров»', 'cartoon Makarov pistol, black', 'black pistol'),
    ('kalash', '«Калаш»', 'cartoon assault rifle with a wooden stock and curved magazine', 'assault rifle with wooden stock'),
    ('pulemet', 'Пулемёт', 'cartoon heavy machine gun with an ammo belt', 'heavy machine gun with ammo belt'),
    ('sling', 'Рогатка', 'wooden slingshot with a red rubber band', 'wooden slingshot'),
    ('uppercut', 'Апперкот', 'boxing glove red with motion lines', None),
    ('mawashi', 'Маваши', 'sneaker kicking with motion swoosh', None),
    ('armatura', 'Арматура', 'rusty steel rebar bar', 'rusty rebar bar'),
    ('tychok', 'Тычок', 'pointing finger hand, cartoon', None),
    ('zapacanov', '«За пацанов!»', 'flat cap flying with an explosion star', None),
    ('kukuruznik', 'Кукурузник с кирпичами', 'green Soviet biplane crop duster dropping red bricks', 'green Soviet biplane flying'),
    ('napalm', 'Кукурузник-химик', 'biplane spraying orange burning liquid', None),
    ('posylka', 'Посылка с минами', 'brown parcel box tied with string, with a mine sticking out', 'parcel box tied with string'),
    ('pochta', 'Почта', 'stack of brown parcels with stamps, falling', 'brown parcel box with stamps'),
    ('samogon', 'Бабкин самогон', 'glass jar of homemade moonshine with a cloth lid, glowing golden', 'glass jar with a cloth lid, glowing'),
    ('babka', 'Бабка с авоськой', 'cute old grandma with a headscarf and a string bag full of potatoes, walking', 'cute old grandma in a headscarf walking with a string bag'),
    ('kozy', 'Стадо коз', 'cute white goat jumping', 'cute white goat running'),
    ('vanna', 'Чугунная ванна', 'old white cast iron bathtub falling', 'old cast iron bathtub'),
    ('truba', 'Прорыв трубы', 'burst pipe with a fountain of water', None),
    ('kirpichi', 'Кирпичный град', 'red bricks falling from a stormy cloud', 'red brick'),
    ('ponyatiya', 'По понятиям', 'old balance scales with two flat caps on the pans', None),
    ('rope', 'Верёвка с крюком', 'coiled rope with a three-pronged metal hook', 'three-pronged metal grappling hook'),
    ('rezinka', 'Резинка от трусов', 'stretched white elastic band', None),
    ('zontik', 'Зонтик', 'black folding umbrella open', 'black umbrella open'),
    ('marshrutka', 'Маршрутка', 'yellow Russian minibus Gazelle, cartoon, no text', 'yellow minibus, cartoon'),
    ('ognetushitel', 'Огнетушитель-ранец', 'two red fire extinguishers strapped as a jetpack, white foam blasting', 'red fire extinguisher jetpack'),
    ('plita', 'Бетонная плита', 'grey concrete slab beam', 'grey concrete slab'),
    ('otboinik', 'Отбойный молоток', 'pneumatic jackhammer', 'jackhammer'),
    ('payalnik', 'Паяльная лампа', 'brass blowtorch with blue flame', 'brass blowtorch'),
    ('buratino', 'Газировка «Буратино»', 'glass bottle of orange lemonade with bubbles and a wooden nose shaped cork', None),
    ('kedy', 'Кеды', 'white canvas sneakers with speed lines', None),
    ('ukazka', 'Лазерная указка', 'small laser pointer with a red beam', None),
    ('nevidimka', 'Невидимка', 'flat cap half transparent, ghostly', None),
    ('yagga', 'Энергетик', 'tin can of energy drink with lightning, no text', None),
    ('holodilnik', 'Заморозка', 'old Soviet fridge with ice crystals', None),
    ('kuryu', 'Курю (пропуск хода)', 'park bench with a thermos and a cup of tea', None),
    ('pas', 'Сдаться', 'white flag on a stick', None),
    ('tyidi', 'Ты иди', 'hand waving forward, come on gesture', None),
]

ICON = ('Game UI weapon icon, single object centered on a plain dark teal background, bold silhouette, '
        'stylized cartoon 3D render, soft toon shading, clean dark outline, flat saturated colors, no text, no letters, no logos.')


def arsenal_job() -> dict:
    items = []
    for wid, _title, icon, world in WEAPONS:
        items.append({'name': f'icon-{wid}', 'prompt': f'{icon}. {ICON}'})
        if world:
            items.append({'name': f'world-{wid}', 'prompt': ISO + world + '. ' + OBJ})
    return {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)',
            'defaults': {'width': 1024, 'height': 1024, 'steps': 8}, 'seeds': [1, 2], 'items': items}


# Переделка иконок после отбора 2026-11-02: миномёт вышел ступкой, плита и резинка — с пистолетом, энергетик — с чужим
# логотипом; отбойник, ледобур, «ты иди», весы — тёмные, теряются на тёмном меню. Описание жёстче, 4 сида.
ICON_FIX = [
    ('mortar', 'military mortar: a short rusty water pipe on a two-legged stand, angled up, a round shell flying out with a puff of smoke'),
    ('plita', 'one plain rectangular grey reinforced concrete beam, lying horizontally, nothing else'),
    ('rezinka', 'loop of white elastic underwear waistband stretched between two fingers like a rubber band, pink and white'),
    ('yagga', 'plain aluminium drink can, smooth silver with one big yellow lightning bolt, generic, no brand, no claws, no letters, no logo'),
    ('otboinik', 'bright yellow pneumatic jackhammer with a steel chisel tip, light colours'),
    ('auger', 'bright orange hand ice auger drill with a shiny spiral blade, light colours'),
    ('tyidi', 'friendly open hand pointing forward with the index finger, light skin tone, light colours'),
    ('ponyatiya', 'shiny golden balance scales, both pans level, light colours'),
]


def arsenal_fix_job() -> dict:
    items = [{'name': f'icon-{wid}', 'prompt': f'{desc}. {ICON}'} for wid, desc in ICON_FIX]
    return {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)',
            'defaults': {'width': 1024, 'height': 1024, 'steps': 8}, 'seeds': [11, 12, 13, 14], 'items': items}


# ---------------------------------------------------------------- общее: ящики, объекты, интерфейс
COMMON = [
    ('crate-weapon', 'wooden crate with a big red star and metal corners, hanging on a small parachute made of a striped umbrella'),
    ('crate-health', 'white first-aid box with a red cross, Soviet style, tied to a bunch of balloons'),
    ('crate-utility', 'blue wooden crate with a question mark sign, tied to a parachute made of a bedsheet'),
    ('gas-cylinder', 'red Soviet propane gas cylinder, slightly dented'),
    ('fuel-barrel', 'rusty metal oil barrel with a hazard stripe'),
    ('cap-grave-1', 'flat herringbone cap lying on the ground with a tiny wilted flower on top'),
    ('cap-grave-2', 'eight-panel newsboy cap on a small pile of dirt with a candle'),
    ('target', 'round shooting target made of plywood on a stick, red and white rings'),
    ('girder-short', 'short grey concrete beam'),
    ('sunflower-seeds-bag', 'small paper cone of sunflower seeds (semki)'),
    ('brigade-flag', 'small hand-made flag on a stick made of a striped tracksuit fabric, blank'),
    ('trophy', 'golden cup trophy made of a samovar'),
]
UI = [
    ('ui-panel-wood', 'Game UI panel frame made of painted plywood with screws in the corners, empty center, flat front view, plain background'),
    ('ui-button-green', 'Game UI rounded button made of a green painted metal plate with rivets, empty, flat front view, plain background'),
    ('ui-button-red', 'Game UI rounded button made of a red painted metal plate with rivets, empty, flat front view, plain background'),
    ('ui-wind-sock', 'orange striped windsock on a pole, side view, plain background'),
    ('ui-timer-clock', 'Soviet alarm clock with two bells, front view, plain background'),
    ('ui-star', 'shiny golden five-pointed star badge, flat front view, plain background'),
    ('ui-star-empty', 'empty dull grey five-pointed star outline badge, flat front view, plain background'),
    ('ui-seeds-coin', 'single big sunflower seed as a coin icon, golden glow, plain background'),
    ('ui-lock', 'rusty padlock, front view, plain background'),
    ('ui-health-heart', 'red heart drawn like a tattoo-free sticker, cartoon, plain background'),
]


def common_job() -> dict:
    items = [{'name': n, 'prompt': ISO + p + '. ' + OBJ} for n, p in COMMON]
    items += [{'name': n, 'prompt': p + '. Stylized cartoon 3D game art, toon shading, clean dark outline, no text, no letters.'} for n, p in UI]
    return {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)',
            'defaults': {'width': 1024, 'height': 1024, 'steps': 8}, 'seeds': [1, 2, 3], 'items': items}


# ---------------------------------------------------------------- предметы миссий (вместо заглушек в render/view.ts)
MISSION_PROPS = [
    ('prop-can', 'dented tin can of condensed milk with a plain blue and white label'),
    ('prop-keg', 'small wooden beer keg with dark metal hoops, standing upright'),
    ('prop-boiler', 'old cast-iron Soviet water boiler (titan) on short legs with a round pressure gauge and a pipe on top'),
    ('prop-transformer', 'small grey Soviet electrical transformer box on short legs with ceramic insulators on top and a yellow lightning bolt pictogram'),
    ('prop-beehive', 'wooden village beehive box painted light blue with a little pitched roof, a few cartoon bees around'),
    ('prop-locomotive', 'small Soviet shunting diesel locomotive painted red and cream, side view, short and chunky'),
    ('prop-kiosk', 'small 1990s Russian street kiosk with a window full of colorful snacks, bottles and chewing gum, metal shutters raised'),
]
HOSTAGE = ('prop-hostage', 'Single character isolated on plain light grey background, side view, whole figure in frame: tiny chibi Russian lad '
           'with ginger hair and a flat herringbone cap, red tracksuit, sitting on a pink inflatable air mattress and waving for help. '
           'Stylized cartoon 3D game art, soft toon shading, clean dark outline, flat saturated colors, no text, no letters, no watermark.')


def mission_props_job() -> dict:
    items = [{'name': n, 'prompt': ISO + p + '. ' + OBJ} for n, p in MISSION_PROPS]
    items.append({'name': HOSTAGE[0], 'prompt': HOSTAGE[1]})
    return {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)',
            'defaults': {'width': 1024, 'height': 1024, 'steps': 8}, 'seeds': [1, 2, 3], 'items': items}


# ---------------------------------------------------------------- логотип, заставка, меню
LOGO_STYLE = 'clean vector-like game studio logo, centered on a plain background, high contrast, crisp edges, no other text'
LOGO = [
    ('logo-a', 'Logo of a game studio: a green Soviet park bench with curved wooden slats seen from the side, '
               'below it bold rounded letters "LAVOCHKA GAMES", warm orange and teal colors, dark navy background'),
    ('logo-b', 'Round emblem badge: a park bench under a glowing street lamp at dusk inside a circle, '
               'text "LAVOCHKA GAMES" curved along the bottom of the circle, retro 1990s style, dark background'),
    ('logo-c', 'Game studio logo: stylized bench made of three thick strokes forming the letter L, '
               'next to it the words "LAVOCHKA" big and "GAMES" small, flat design, white background'),
    ('logo-d', 'Playful logo: cartoon wooden bench with a flat cap lying on it and a few sunflower seeds, '
               'chunky 3D letters "LAVOCHKA GAMES" above, toon shading, light background'),
    ('logo-e', 'Neon sign logo on a brick wall at night: a bench pictogram and the words "LAVOCHKA GAMES" in pink and cyan neon tubes'),
    ('logo-f', 'Retro Soviet poster-style emblem: red star shape replaced by a bench silhouette, '
               'bold condensed letters "LAVOCHKA GAMES", red cream and black palette'),
]
GOPNIK = ('tiny chibi Russian 1990s street lads (gopniks), 2.5 heads tall, huge wide flat herringbone caps pulled over the eyes, '
          'wider than shoulders, tracksuits with two side stripes, worn sneakers, buzz cuts, squinting cheeky grins, cute and funny, not scary')
CHAR_STYLE = ('Stylized low-poly 3D cartoon render, toon shading with clean black outline, flat colors, soft light, '
              'cinematic wide shot, no text, no logos, no watermark.')
KEYART = [
    ('title-keyart', 1792, 768, f'Epic funny standoff: two gangs of {GOPNIK}, one team in teal tracksuits on the left hill, one team in red tracksuits '
                                f'on the right hill, a rocket launcher, a slingshot and a grenade, a Soviet courtyard with panel buildings at sunset between them. {CHAR_STYLE}'),
    ('menu-bg', 1792, 768, f'Empty Soviet courtyard at dusk with a green park bench in the center under a street lamp, a flat cap left on the bench, '
                           f'panel buildings with lit windows, cozy and calm, room for menu on the left. {ENV}'),
    ('brigade-select-bg', 1792, 768, f'Row of six empty rusty garages with doors painted in different colors (teal, red, light blue, navy, green, white) at evening, '
                                     f'empty asphalt in front. {ENV}'),
    ('campaign-map', 1792, 1024, 'Hand-drawn cartoon map of a big Siberian city split by a wide river with a long bridge, districts as colored patches, '
                                 'little icons of garages, factory, market, railway depot, dachas, school stadium, beach, construction crane, landfill, '
                                 'no labels, no text, top-down illustrated game world map, warm paper texture, toon style'),
    ('loading-1', 1792, 768, f'{GOPNIK}, three of them sitting on a park bench at night eating from a bag of sunflower seeds, watching the city lights. {CHAR_STYLE}'),
    ('loading-2', 1792, 768, f'{GOPNIK}, one of them aiming an olive rocket launcher backwards while the others duck, courtyard at day. {CHAR_STYLE}'),
    ('loading-3', 1792, 768, f'{GOPNIK}, swinging on a rope with a hook between two garage roofs over a muddy puddle. {CHAR_STYLE}'),
    ('loading-4', 1792, 768, f'{GOPNIK}, a wooden crate on a striped umbrella parachute is landing among them, they look up amazed. {CHAR_STYLE}'),
]


def brand_job() -> dict:
    items = [{'name': n, 'prompt': f'{p}. {LOGO_STYLE}', 'seeds': [1, 2, 3, 4]} for n, p in LOGO]
    items += [{'name': n, 'width': w, 'height': h, 'prompt': p} for n, w, h, p in KEYART]
    return {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)',
            'defaults': {'width': 1024, 'height': 1024, 'steps': 8}, 'seeds': [1, 2, 3], 'items': items}


# ---------------------------------------------------------------- ролики (как в Worms: коротко, смешно, без сюжета)
# (id, ключевой кадр, движение). Ключевой кадр — Z-Image 1280×704, видео — Wan 2.2 TI2V-5B, 121 кадр = 5 с.
SKETCHES = [
    ('s00-intro', f'Two gangs of {GOPNIK} face each other across a Soviet courtyard at sunset, teal tracksuits on the left, red on the right, '
                  f'everyone squinting dramatically, wind blowing a plastic bag between them',
     'dramatic western standoff, the plastic bag tumbles between the gangs, the lads squint and lean forward, the camera slowly pushes in, then a pigeon lands in the middle and everyone flinches'),
    ('s01-backfire', f'One of the {GOPNIK} in a teal tracksuit holds an olive green rocket launcher tube on his shoulder near a garage, aiming',
     'he fires the rocket launcher but it shoots backwards, a puff of smoke, his huge cap spins in the air and lands back on his head, he blinks surprised'),
    ('s02-crate', f'One of the {GOPNIK} in a red tracksuit stands in a courtyard looking up at a wooden crate falling on a striped umbrella parachute',
     'the crate slowly falls and lands right on him with a puff of dust, then the lid opens and he pops out dizzy holding a grenade, smiling'),
    ('s03-babushka', f'Two of the {GOPNIK} in teal and red tracksuits arguing next to a park bench where a cute old grandma in a headscarf sits with a string bag',
     'the grandma stands up and swats both lads with her string bag, they run away in opposite directions holding their caps, she sits back down calmly'),
    ('s04-pigeon', f'One of the {GOPNIK} proudly posing on a garage roof, a fat grey pigeon sits on the edge next to him',
     'the pigeon grabs his huge flat cap and flies away with it, the lad jumps and chases it along the roof, waving his arms'),
    ('s05-sling', f'One of the {GOPNIK} in a red tracksuit aiming a wooden slingshot at a street lamp post',
     'he shoots the slingshot, the pebble bounces off the lamp post and flies back, bonk on his cap, little stars circle above his head, he wobbles'),
    ('s06-staring', f'Two of the {GOPNIK} squatting face to face in a staring contest on an asphalt courtyard, teal versus red',
     'they stare intensely without blinking, the camera circles them, then one of them sneezes violently and both fall backwards'),
    ('s07-rope', f'One of the {GOPNIK} swinging on a rope with a metal hook between two garage roofs above a big muddy puddle',
     'he swings heroically, the rope slips, he falls into the muddy puddle with a big splash, only his cap floats on the water, then he pops up spitting water'),
    ('s08-dog', f'One of the {GOPNIK} in a teal tracksuit releases a cute scruffy dog that has a small red firecracker on its collar',
     'the dog runs forward happily, stops, turns around and runs back to the lad wagging its tail, the lad panics and runs away, the dog chases him joyfully'),
    ('s09-kvass', f'A queue of {GOPNIK} in teal tracksuits at a yellow kvass barrel on wheels on a sunny street, a red-tracksuit lad sneaks in front',
     'the red lad cuts in line, the teal lads slowly turn their heads toward him, tense silence, the kvass seller lady pours a mug, everybody freezes, the camera zooms on the mug'),
    ('s10-winter', f'One of the {GOPNIK} in a red tracksuit and a fur hat standing at the top of a snowy ice slide in a winter courtyard',
     'he slides down the ice slide standing on his feet, spins, flies off the end and plunges head first into a snowdrift, only his legs stick out and kick'),
    ('s11-victory', f'A team of {GOPNIK} in teal tracksuits on a garage roof at sunset, arms raised in victory',
     'the lads dance a silly squat dance on the garage roof, kicking their legs, one of them waves a flag made of a tracksuit, fireworks in the sky'),
    ('s12-deflate', f'One of the {GOPNIK} in a red tracksuit standing alone on a courtyard, sad face',
     'he slowly deflates like a balloon with a whistle, shrinking and flying around in circles, until only his huge cap is left lying on the ground, a leaf falls on it'),
    ('s13-map', f'Three of the {GOPNIK} gathered around a big paper city map on the hood of an old boxy Soviet car',
     'they turn the map around several times, argue silently, point in different directions, then one of them crumples the map and they all walk off in different directions'),
    ('s14-plane', f'One of the {GOPNIK} with an open black umbrella in a courtyard, a green Soviet biplane flying low overhead',
     'the biplane drops red bricks, the bricks bounce off the umbrella one after another, the lad smiles smugly, then the last brick is a whole bathtub and he runs away'),
    ('s15-marshrutka', f'One of the {GOPNIK} running toward a yellow minibus at a bus stop in the rain',
     'the minibus doors close right in front of him and it drives away splashing a puddle onto him, he stands soaking wet, then another minibus passes and splashes him again'),
    ('s16-finale', f'Gangs of {GOPNIK} in teal, red, light blue, navy, green and white tracksuits sitting together on long benches at night under street lamps',
     'the lads from different districts shake hands, share sunflower seeds from a paper bag and laugh, the camera pulls back slowly to show the night city, fireflies'),
    ('s17-garage-door', f'One of the {GOPNIK} in a teal tracksuit pulling the handle of a rusty garage door',
     'the door is stuck, he pulls harder and harder, finally the whole garage door falls flat on him with a bang, he slowly crawls out from under it holding his cap'),
]
LOGO_ANIM = ('logo-anim', 'A green Soviet park bench under a street lamp in an empty courtyard at dusk, night slowly falls',
             'the street lamp flickers and turns on with a warm glow, two pigeons land on the bench, a flat cap falls from above onto the bench, the camera slowly pushes in')

# эффекты: ключевой кадр на чёрном → Wan → потом вырезка по яркости в спрайт-лист
FX = [
    ('fx-explosion-s', 'a tiny orange spark in the center of a pure black background', 'the spark bursts into a small round cartoon explosion with orange fire and grey smoke puffs, then fades out, pure black background, static camera'),
    ('fx-explosion-l', 'a small glowing ember in the center of a pure black background', 'a huge cartoon mushroom explosion grows from the center with fire, dirt chunks and thick smoke, then the smoke dissipates, pure black background, static camera'),
    ('fx-smoke', 'a small puff of grey smoke in the center of a pure black background', 'the smoke puff expands and drifts upward, slowly dissolving, pure black background, static camera'),
    ('fx-splash', 'a calm dark water surface line at the bottom of a pure black background', 'something falls into the water, a big cartoon splash of water drops shoots up and falls back, pure black background, static camera'),
    ('fx-dust', 'a flat ground line at the bottom of a pure black background', 'a puff of dust and pebbles kicks up from the ground and settles, pure black background, static camera'),
    ('fx-fire', 'a small flame on the ground in the center of a pure black background', 'the flame grows and flickers as a looping cartoon campfire fire, pure black background, static camera'),
    ('fx-bricks', 'a red brick in the center of a pure black background', 'the brick shatters into pieces flying outward with dust, pure black background, static camera'),
]
FX_STYLE = 'Stylized cartoon game visual effect, toon shading, clean shapes, no text.'


# Переделка эффектов после отбора 2026-11-02: в ключах всплеска и пыли была полоса воды/земли (её Wan оставил и нарезка
# не вырезала), большой взрыв почти пустой, кирпич ломался только в конце. Ключ — уже само действие, без линий, 4 сида.
FX_FIX = [
    ('fx2-explosion-l', 'a big round cartoon fireball explosion in the center of a pure black background, orange and yellow fire, dark smoke ring, dirt chunks',
     'the fireball expands fast, dirt chunks fly outward, thick smoke rises and dissolves, pure black background, static camera'),
    ('fx2-splash', 'a crown-shaped cartoon splash of blue water drops at the bottom center of a pure black background, no water surface, no line',
     'the water splash shoots up and the drops fall back down and vanish, pure black background, static camera'),
    ('fx2-dust', 'a small cloud of beige cartoon dust and pebbles at the bottom center of a pure black background, no ground, no line',
     'the dust cloud puffs up, pebbles fly out, then it settles and fades away, pure black background, static camera'),
    ('fx2-bricks', 'red brick fragments and orange dust flying apart from the center of a pure black background',
     'the brick pieces fly outward and fall, the dust fades, pure black background, static camera'),
]
# Ролик «квас»: на бочке вышла абракадабра — бочка без надписей.
KVASS_FIX = ('s09b-kvass', f'A queue of {GOPNIK} in teal tracksuits at a plain yellow barrel on wheels on a sunny street, the barrel has no text, no letters, '
             'a red-tracksuit lad sneaks in front',
             'the red lad cuts the queue, the teal lads turn their heads slowly and stare at him, he freezes with a mug in hand and smiles awkwardly, no text on the barrel')


# Вторая попытка всплеска: «crown-shaped» модель поняла буквально (вышла корона) — только брызги, 4 сида.
SPLASH_FIX = ('fx3-splash', 'a burst of blue water droplets splashing upward from the bottom center of a pure black background, cartoon liquid drops, no objects',
              'the water droplets fly up in a fountain and fall back down, then vanish, pure black background, static camera')


def splash_keys_job() -> dict:
    return {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)',
            'defaults': {'width': 704, 'height': 704, 'steps': 8}, 'seeds': [21, 22, 23, 24],
            'items': [{'name': SPLASH_FIX[0], 'prompt': f'{SPLASH_FIX[1]}. {FX_STYLE}'}]}


def splash_videos_job() -> dict:
    return {'keys': 'G:/temp/studio/out/gops/24d-splash-keys', 'server': 'comfy-big',
            'defaults': {'width': 704, 'height': 704, 'frames': 49, 'steps': 30}, 'seeds': [1],
            'clips': [{'name': SPLASH_FIX[0], 'keys': [f'{SPLASH_FIX[0]}-{k}' for k in (21, 22, 23, 24)], 'prompt': SPLASH_FIX[2]}]}


def fix_keys_job() -> dict:
    items = [{'name': fid, 'width': 704, 'height': 704, 'prompt': f'{key}. {FX_STYLE}'} for fid, key, _ in FX_FIX]
    items.append({'name': KVASS_FIX[0], 'prompt': f'{KVASS_FIX[1]}. {CHAR_STYLE}'})
    return {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)',
            'defaults': {'width': 1280, 'height': 704, 'steps': 8}, 'seeds': [1, 2], 'items': items}


def fix_videos_job() -> dict:
    clips = [{'name': fid, 'keys': [f'{fid}-1', f'{fid}-2'], 'width': 704, 'height': 704, 'frames': 49, 'prompt': motion} for fid, _, motion in FX_FIX]
    clips.append({'name': KVASS_FIX[0], 'keys': [f'{KVASS_FIX[0]}-1', f'{KVASS_FIX[0]}-2'],
                  'prompt': f'{KVASS_FIX[2]}. Stylized 3D cartoon animation, toon shading, funny slapstick, smooth motion.'})
    return {'keys': 'G:/temp/studio/out/gops/24c-fix-keys', 'server': 'comfy-big',
            'defaults': {'width': 1280, 'height': 704, 'frames': 121, 'steps': 30}, 'seeds': [1], 'clips': clips}


def cutscene_keys_job() -> dict:
    items = [{'name': sid, 'prompt': f'{key}. {CHAR_STYLE}'} for sid, key, _ in SKETCHES]
    items.append({'name': LOGO_ANIM[0], 'prompt': f'{LOGO_ANIM[1]}. {ENV}'})
    items += [{'name': fid, 'width': 704, 'height': 704, 'prompt': f'{key}. {FX_STYLE}'} for fid, key, _ in FX]
    return {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)',
            'defaults': {'width': 1280, 'height': 704, 'steps': 8}, 'seeds': [1, 2], 'items': items}


def videos_job() -> dict:
    clips = [{'name': sid, 'keys': [f'{sid}-1', f'{sid}-2'], 'prompt': f'{motion}. Stylized 3D cartoon animation, toon shading, funny slapstick, smooth motion.'}
             for sid, _, motion in SKETCHES]
    clips.append({'name': LOGO_ANIM[0], 'keys': [f'{LOGO_ANIM[0]}-1', f'{LOGO_ANIM[0]}-2'], 'prompt': LOGO_ANIM[2] + '. Stylized 3D cartoon animation, smooth motion.'})
    clips += [{'name': fid, 'keys': [f'{fid}-1', f'{fid}-2'], 'width': 704, 'height': 704, 'frames': 49, 'prompt': motion}
              for fid, _, motion in FX]
    return {'keys': 'G:/temp/studio/out/gops/24-cutscene-keys', 'server': 'comfy-big',
            'defaults': {'width': 1280, 'height': 704, 'frames': 121, 'steps': 30}, 'seeds': [1], 'clips': clips}


# ---------------------------------------------------------------- живые снаряды и жидкости: ролик → кадры спрайта
# Ключевой кадр — предмет «в мире» из 22-arsenal (сбоку на сером фоне); Wan оживляет на месте, камера неподвижна,
# потом post/video_sprites.py режет кадры, вырезает фон BiRefNet общей рамкой и собирает лист.
ACTORS = [
    ('dog', 'the dog runs in place, side view, legs cycling, tail wagging, ears bouncing'),
    ('pigeon', 'the pigeon flaps its wings in place, flying, side view'),
    ('babka', 'the old grandma walks in place with small shuffling steps, swinging the string bag, side view'),
    ('kozy', 'the goat gallops in place, side view, bouncy jumping'),
    ('kukuruznik', 'the biplane flies in place, propeller spinning fast, slight bobbing, side view'),
    ('kite', 'the kite flutters in the wind, tail waving'),
    ('auger', 'the ice auger spins fast in place, drilling motion'),
    ('homing', 'the rocket flies in place, flame and smoke from the nozzle flickering, side view'),
    ('ognetushitel', 'the extinguisher jetpack blasts white foam downward, shaking slightly'),
    ('marshrutka', 'the minibus drives in place, wheels spinning, bouncing on the suspension, side view'),
    ('zontik', 'the umbrella sways gently as if floating down'),
    ('samogon', 'the glowing jar pulses with golden light and sparkles'),
    ('mine', 'the red light on the mine blinks on and off'),
    ('tnt', 'the fuse burns with sparks, getting shorter'),
]
LIQUID_LOOP = 'gentle waves moving from left to right, small bubbles and ripples, seamless looping motion, static camera'


def actors_job() -> dict:
    clips = [{'name': f'actor-{a}', 'keys': [f'world-{a}-1'], 'width': 704, 'height': 704, 'frames': 49,
              'prompt': f'{m}, plain light grey background, static camera, stylized 3D cartoon animation, smooth loop.'} for a, m in ACTORS]
    return {'keys': 'G:/temp/studio/out/gops/22-arsenal', 'server': 'comfy-big',
            'defaults': {'frames': 49, 'steps': 25}, 'seeds': [1], 'clips': clips}


def liquids_job() -> dict:
    clips = [{'name': f'{tid}-liquid', 'keys': [f'{tid}-liquid-1'], 'width': 1280, 'height': 352, 'frames': 49,
              'prompt': f"{t['liquid']}, {LIQUID_LOOP}."} for tid, t in THEMES.items()]
    return {'keys': 'G:/temp/studio/out/gops/21-themes', 'server': 'comfy-big',
            'defaults': {'frames': 49, 'steps': 25}, 'seeds': [1], 'clips': clips}


def dump(name: str, header: str, job: dict):
    (HERE / name).write_text(f'# {header}\n# Сгенерировано make_jobs.py — правки вносить туда.\n'
                             + yaml.safe_dump(job, allow_unicode=True, sort_keys=False, width=200), encoding='utf-8')


if __name__ == '__main__':
    dump('20-brand.yaml', 'ГОПС, партия 20: логотип Lavochka Games, титульный арт, фоны меню, карта кампании, экраны загрузки', brand_job())
    dump('21-themes.yaml', 'ГОПС, партия 21: 12 тем уровней — фоны по времени суток, грунт, кромка, жидкость, предметы',
         {**theme_job('_', THEMES['yard']), 'items': [it for tid, t in THEMES.items() for it in theme_job(tid, t)['items']]})
    dump('22-arsenal.yaml', 'ГОПС, партия 22: иконки оружия и предметы в мире (снаряды, оружие в руке)', arsenal_job())
    dump('22b-arsenal-fix.yaml', 'ГОПС, партия 22b: переделка неудачных иконок оружия (после отбора)', arsenal_fix_job())
    dump('23-common.yaml', 'ГОПС, партия 23: ящики, бочки, кепки-надгробия, интерфейс', common_job())
    dump('23e-mission-props.yaml', 'ГОПС, партия 23e: предметы миссий — банка, кега, котёл, трансформатор, улей, тепловоз, ларёк, Рыжий на матрасе', mission_props_job())
    dump('24-cutscene-keys.yaml', 'ГОПС, партия 24: ключевые кадры роликов, заставки и эффектов', cutscene_keys_job())
    dump('25-videos.yaml', 'ГОПС, партия 25: ролики (Wan 2.2), заставка, эффекты', videos_job())
    dump('24c-fix-keys.yaml', 'ГОПС, партия 24c: ключи переделки эффектов (взрыв, всплеск, пыль, кирпичи) и ролика «квас»', fix_keys_job())
    dump('25c-fix-videos.yaml', 'ГОПС, партия 25c: ролики переделки эффектов и «кваса»', fix_videos_job())
    dump('24d-splash-keys.yaml', 'ГОПС, партия 24d: вторая попытка всплеска — ключи', splash_keys_job())
    dump('25d-splash-videos.yaml', 'ГОПС, партия 25d: вторая попытка всплеска — ролики', splash_videos_job())
    dump('29-actors.yaml', 'ГОПС, партия 29: живые снаряды (собака, голубь, бабка, козы, кукурузник…) — ролик на месте → спрайт', actors_job())
    dump('30-liquids.yaml', 'ГОПС, партия 30: волны смертельной жидкости по темам — петля', liquids_job())
    n = sum(len(theme_job(t, THEMES[t])['items']) for t in THEMES)
    print('темы:', len(THEMES), 'позиций:', n, '| оружие:', len(WEAPONS), '| ролики:', len(SKETCHES))
