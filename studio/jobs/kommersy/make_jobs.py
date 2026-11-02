"""Коммерсы: контент-план картинок одним списком → задания 03–05 для run.py.

python studio/jobs/kommersy/make_jobs.py      (перезаписывает 0x-*.yaml рядом)

Стиль: фоны — `a-painted` (партия 02), Колян и NPC — фото по пояс на хромакее, как в холдеме (bible/kolyan.md).
"""
import pathlib

import yaml

HERE = pathlib.Path(__file__).parent
LICENSE = 'Apache-2.0 (Z-Image-Turbo)'

# ---------------------------------------------------------------- фоны дороги
PAINT = ('Highly detailed hand-painted digital illustration like a premium isometric tycoon game background, semi-realistic, '
         'rich textures, long soft shadows. Wide panoramic high-angle three-quarter view. ')
ROAD = ('A single clear winding road enters from the left edge, curves in a pronounced S-shape through the middle of the picture '
        'and leaves at the right edge at mid height; the road is empty and clearly visible along its whole length. ')
TAIL = 'Tiny distant people only. No text, no letters, no signs with writing, no logos, no watermark, no board game tiles.'

ERA = {
    'soviet': 'late Soviet era 1988-1991: old Zhiguli and Volga cars, red propaganda banners without letters, queues, drab colors',
    'wild': 'wild 1990s 1992-1997: metal kiosks with bright imported goods, used foreign cars, satellite dishes, advertising boards without letters',
    'new': 'early 2000s 1999-2003: renovated facades, glass shop fronts, new foreign cars, billboards without letters, cleaner streets',
}
SEASON = {
    'soviet': 'golden autumn, warm afternoon sun',
    'wild': 'late winter, dirty snow and slush, low pale sun',
    'new': 'early summer, bright clear day',
}

# Местности по статусу Коляна (DESIGN §5): 3 панорамы на местность, эпохи — где местность живёт.
PLACES = {
    'dvor': dict(eras=['soviet', 'wild'], parts=[
        'Zatulinka district on the outskirts of Novosibirsk: grey prefab nine-storey panel blocks with laundry on balconies, a courtyard playground with metal climbing frames, benches with old women',
        'Zatulinka: a long row of rusty metal garages, a steaming heating pipe on concrete supports, birch trees, puddles, a dog',
        'Zatulinka: a school and a kindergarten behind fences, a bus stop with an old Ikarus bus, a small grocery shop, poplars']),
    'kiosk': dict(eras=['soviet', 'wild'], parts=[
        'a busy bus stop square in a Siberian residential district: a cluster of small street kiosks, a kvass barrel, a newspaper stand',
        'a video salon in a basement with a crowd at the door, a cooperative cafe in a converted shop, parked cars',
        'a small open market by the metro entrance: folding tables, women selling goods from bags, a phone booth']),
    'bazar': dict(eras=['wild', 'new'], parts=[
        'a huge open-air flea market in Novosibirsk: endless rows of shipping containers turned into shops, tarpaulin roofs, checkered bags',
        'the flea market wholesale zone: trucks and vans unloading boxes, forklifts, warehouses, a cafe trailer',
        'the edge of the flea market: currency exchange booth, car parking full of used foreign cars, a fenced lot with Japanese cars for sale']),
    'center': dict(eras=['wild', 'new'], parts=[
        'central Novosibirsk: a wide avenue with Stalinist buildings, a big domed opera theatre in the distance, trolleybuses',
        'central Novosibirsk: a business street with a bank with columns, an office building, a restaurant with a canopy, black cars',
        'central Novosibirsk: an embankment of the wide Ob river with a long bridge, a park, a bathhouse building']),
    'oblast': dict(eras=['wild', 'new'], parts=[
        'an old Soviet factory on the outskirts of a Siberian city: chimneys, workshops, railway sidings, a checkpoint gate',
        'a huge open-pit coal mine in Kuzbass, Siberia: terraced pit, giant dump trucks, conveyor belts, taiga around',
        'a regional airport in Siberia: a modest terminal, a few airliners on the apron, a road with taxis']),
    'moscow': dict(eras=['new'], parts=[
        'Moscow around 2000: a wide avenue with Stalinist high-rise, traffic of black luxury cars, a big shopping center',
        'Moscow around 2000: an embankment with a red-brick fortress wall and golden church domes in the distance, a bridge',
        'Moscow suburbs around 2000: a road through pine forest with large private mansions behind high fences']),
    'london': dict(eras=['new'], parts=[
        'London around 2003: a street of white Georgian townhouses, red double-decker buses, black taxis',
        'London around 2003: the Thames embankment with a big bridge and towers in the distance, grey sky with sun breaks',
        'London around 2003: a football stadium with blue seats seen from above next to a bridge and railway lines, crowds of fans']),
}


def panoramas():
    items = []
    for place, p in PLACES.items():
        for era in p['eras']:
            for i, part in enumerate(p['parts'], 1):
                items.append({'name': f'{place}-{era}-{i}',
                              'prompt': f'{PAINT}{part}. {ERA[era]}, {SEASON[era]}. {ROAD}{TAIL}'})
    return {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': LICENSE,
            'defaults': {'width': 1792, 'height': 896, 'steps': 8}, 'seeds': [111, 222], 'items': items}


# ---------------------------------------------------------------- люди: фото по пояс, как в холдеме
PORTRAIT = ('Photorealistic portrait photo, square 1:1, shot on a 50mm lens. {who} He or she sits at a table, framed from the waist up, '
            'forearms and hands resting on the table edge at the bottom of the frame, looking at the camera. Natural skin texture, realistic. '
            'Solid flat chroma-key green background (#00B140) and a chroma-key green table surface, warm soft overhead light. '
            'No green in clothing. No text, no logos.')
KOLYAN = ('stocky broad-shouldered build, round broad face, small narrow eyes, wide nose, full cheeks, very short dark buzz cut, '
          'thick neck, a cocky lopsided half-smile')
LOOKS = {
    '1993-leather': f'A 26-year-old Russian man in 1993: {KOLYAN}. He wears a black leather jacket over a dark turtleneck, a thick gold chain over the turtleneck.',
    '1996-blazer': f'A 29-year-old Russian businessman in 1996: {KOLYAN}, slightly heavier. He wears a dark double-breasted blazer with gold buttons, a white shirt, a gold signet ring, a pager on the belt.',
    '2003-suit': f'A 36-year-old Russian oligarch in 2003: {KOLYAN}, heavier, calm and self-assured, neatly groomed. He wears an expensive tailored dark navy suit, white shirt, silk tie, a luxury wristwatch, no chain.',
}
NPC = {
    'mother': 'A 50-year-old Russian woman in the late 1980s, a factory worker, kind tired face, short permed hair, a knitted cardigan over a floral dress.',
    'girl': 'A 21-year-old Russian young woman in 1988, light brown hair in a ponytail with a scrunchie, a striped sweater, warm teasing smile.',
    'brigadir': 'A 30-year-old Russian gang leader in 1993, short haircut, heavy gaze, black leather jacket, thick gold chain, scar on the eyebrow.',
    'byk': 'A 24-year-old huge Russian gang enforcer in 1993, shaved head, thick neck, tracksuit jacket, blank intimidating stare.',
    'oper': 'A 40-year-old Russian police detective in 1994, tired cynical face, mustache, worn grey jacket over a sweater.',
    'uchastkovy': 'A 45-year-old Russian district police officer in 1990, grey Soviet police uniform shirt, cap on the table, sly face.',
    'nalogovik': 'A 35-year-old Russian tax police officer in 1996, neat side-parted hair, glasses, dark suit, cold attentive look.',
    'chinovnik': 'A 50-year-old Russian city hall official in 1995, balding, plump, grey suit and wide tie, a polite but greedy smile.',
    'bankir': 'A 38-year-old Russian banker in 1995, slicked-back hair, expensive suit, gold-rimmed glasses, confident smirk.',
    'direktor': 'A 58-year-old Russian factory director in 1993, heavy build, grey hair combed back, old Soviet suit with a badge on the lapel, stern.',
    'chelnochnitsa': 'A 40-year-old Russian woman shuttle trader in 1992, dyed red hair, puffy jacket, gold earrings, energetic tough look.',
    'konkurent': 'A 30-year-old Russian rival businessman in 1994, curly hair, crimson jacket, gold chain, mocking grin.',
    'zhurnalist': 'A 33-year-old Russian investigative journalist in 1997, messy hair, round glasses, corduroy jacket, notebook-ready look.',
    'reshala': 'A 45-year-old Russian Moscow fixer in 2000, perfectly groomed grey hair, black turtleneck under an expensive jacket, unreadable look.',
    'yurist': 'A 50-year-old English solicitor in London in 2003, thin silver hair, pinstripe suit, tortoiseshell glasses, reserved polite expression.',
    'drug': 'A 22-year-old Russian young man in 1988, army friend, lanky, big ears, wide friendly grin, a striped sailor undershirt under a jacket.',
}


def people(table, seeds):
    return {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': LICENSE,
            'defaults': {'width': 1024, 'height': 1024, 'steps': 8}, 'seeds': seeds,
            'items': [{'name': k, 'prompt': PORTRAIT.format(who=v)} for k, v in table.items()]}


# Реакции Коляна (Wan 2.2 i2v) — по одному эталону на облик (bible/kolyan.md), кадр как в холдеме: по пояс, руки на столе.
KEYS = {'1988': '01-concepts/kolyan-1988-demb-22', '1990': '01-concepts/kolyan-1990-coop-66', '1993': '03-kolyan-looks/1993-leather-22',
        '1996': '03-kolyan-looks/1996-blazer-33', '2003': '03-kolyan-looks/2003-suit-33'}
REACT_STYLE = ('The person starts and ends in the same neutral pose: sitting upright, hands resting on the table, looking at the camera. '
               'Locked-off static camera on a tripod, no camera movement, no zoom, no cuts. Photorealistic, natural skin, realistic natural '
               'micro-movements. Solid flat chroma-key green background (#00B140) and a chroma-key green table surface, evenly lit. '
               'No objects in hands, no text, no logos.')
REACTIONS = {
    'idle': 'The person waits calmly, breathes, blinks, glances to the side and back at the camera, slightly shifts in the chair. Subtle, seamless loop.',
    'think': 'The person thinks hard about a business offer: frowns, rubs the chin with one hand, taps fingers on the table, looks down and then back at the camera.',
    'deal': 'The person nods with a sly satisfied smile, reaches one hand forward across the table as if for a firm handshake, shakes it once, then pulls the hand back.',
    'win': 'The person grins widely, clenches a fist in small celebration, laughs, then leans back pleased with himself.',
    'lose': 'The person freezes, closes eyes, rubs face with both hands in frustration, shakes head, exhales and slowly returns to the neutral pose.',
}


def reactions():
    return {'keys': 'G:/temp/studio/out/kommersy/09-keys', 'server': 'comfy-big', 'per_clip': True,
            'defaults': {'width': 704, 'height': 704, 'frames': 97, 'steps': 30}, 'seeds': [1],
            'style': REACT_STYLE,
            'clips': [{'name': r, 'keys': [f'kolyan-{y}' for y in KEYS], 'prompt': f'{a} {{style}}'} for r, a in REACTIONS.items()]}


JOBS = {
    '03-kolyan-looks': people(LOOKS, [11, 22, 33]),
    '04-panoramas': panoramas(),
    '05-npc': people(NPC, [11, 22]),
    '09-kolyan-reactions': reactions(),
}

if __name__ == '__main__':
    for name, job in JOBS.items():
        head = f'# Коммерсы, партия {name} — сгенерировано make_jobs.py, правки — там.\n'
        (HERE / f'{name}.yaml').write_text(head + yaml.safe_dump(job, allow_unicode=True, sort_keys=False, width=200), encoding='utf-8')
        print(name, len(job.get('items', job.get('clips', []))))
