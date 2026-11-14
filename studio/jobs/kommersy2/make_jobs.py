"""«Коммерсы 2.0» (второй сезон, 2004–2021): контент-план картинок → задания 21–25 для run.py.

  G:/ai/ComfyUI/venv/Scripts/python.exe -X utf8 studio/jobs/kommersy2/make_jobs.py   (перезаписывает 2x-*.yaml рядом)

Стиль — как в первом сезоне (studio/jobs/kommersy/make_jobs.py, bible/kolyan.md): фоны дороги `a-painted`,
Колян и персонажи — фото по пояс на хромакее, иллюстрации карточек — рисованная сцена во весь кадр.
Все персонажи вымышленные: реальных людей, клубов, турниров и компаний не называем и не рисуем.
"""
import json
import pathlib
import sys

import yaml

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE.parent / 'kommersy'))
from make_jobs import CARD_ART, CARD_TAIL, KOLYAN, LICENSE, PAINT, PORTRAIT, REACT_STYLE, REACTIONS, ROAD, TAIL  # noqa: E402  (общий стиль первого сезона)

# ---------------------------------------------------------------- фоны дороги
# Акт I (клуб, 2004 – авг 2008) и крах (сен–дек 2008): три лондонские местности по 3 части; в крах — «Сити» под дождём.
# Акт III («Цифра»): 6 уровней × 2 эпохи (it1 2009–14, it2 2015–21) × 3 части.
ERA = {
    'club': 'mid 2000s 2004-2008: modern European cars, glass and steel architecture, wealthy and confident mood, early summer, bright clear day',
    'crash': 'autumn 2008 financial crisis: grey rainy evening, wet pavements reflecting lights, fallen leaves, gloomy mood, few people with umbrellas',
    'it1': 'early 2010s 2009-2014: modern cars, early smartphones era, fresh renovation, crisp snowy winter, low golden sun, long blue shadows',
    'it2': 'late 2010s 2015-2021: electric scooters, delivery couriers with big backpacks, LED screens without letters, warm late summer evening, golden light',
}
PLACES = {
    'stadium': dict(eras=['club'], parts=[
        'London: a big modern football stadium with a red roof and steel arches beside a river, crowds of fans in red scarves walking to it, a matchday street with pubs',
        'London: the training ground of a football club, green pitches with goals, a low modern clubhouse, players running drills far away, parked luxury cars',
        'London: a busy street on match day next to the stadium, a club shop with red shirts in the windows, a pub with fans outside, mounted police, a bridge']),
    'city': dict(eras=['club', 'crash'], parts=[
        'the City of London: glass skyscrapers and old stone banks, the dome of a great cathedral in the distance, black taxis and red buses',
        'London: Canary Wharf business district with tall glass towers over the docks, water, a light railway on a viaduct',
        'London: an elegant street of Mayfair with luxury shops, a grand hotel with a canopy, supercars, a small green square']),
    'riviera': dict(eras=['club'], parts=[
        'the French Riviera: a marina with huge white luxury yachts, palm trees along the promenade, terraces of an old town on a hill, turquoise sea',
        'the Swiss Alps: a ski resort village with wooden chalets, a cable car, snowy peaks, a helicopter on a pad, bright winter sun',
        'a Mediterranean coast: a luxury villa with a swimming pool on a cliff, cypress trees, a winding coastal road, a yacht in the bay']),
    'garazh': dict(eras=['it1', 'it2'], parts=[
        'Akademgorodok near Novosibirsk: a row of old brick garages at the edge of a pine and birch forest, one garage open with computers and cables inside, squirrels',
        'Akademgorodok: Soviet-modernist research institute buildings among tall pine trees, a small student cafe, bicycles, a bus stop',
        'Akademgorodok: five-storey brick apartment blocks in a pine forest, a courtyard with a playground, a small shop, a path to the reservoir shore']),
    'kovorking': dict(eras=['it1', 'it2'], parts=[
        'central Novosibirsk: an old red-brick factory converted into lofts and a coworking space, big arched windows, a coffee kiosk, bikes and scooters',
        'Novosibirsk: a renovated industrial courtyard with street food trucks, string lights, young people with laptops on wooden benches',
        'Novosibirsk: a business center street with glass offices, a big shopping mall, a metro entrance, trams, a modern bridge over the Ob river in the distance']),
    'tehnopark': dict(eras=['it1', 'it2'], parts=[
        'a technology park in a Siberian pine forest: modern glass and white office buildings, a round conference hall, landscaped paths, parking lot',
        'a technology park campus: a data center with cooling units, solar panels on roofs, a startup incubator with a glass atrium, pine trees',
        'a technology park: a wide plaza with a fountain, a modern cafe, a pedestrian bridge between glass buildings, forest around']),
    'siti': dict(eras=['it1', 'it2'], parts=[
        'the Moscow business district of tall glass skyscrapers on the river embankment, twisted and spired towers, a wide bridge, river boats',
        'Moscow: the foot of glass skyscrapers, a shopping mall entrance, black business cars, an elevated road interchange, a metro station',
        'Moscow: an embankment park with walking paths opposite the skyscraper district, a river with a pleasure boat, a pedestrian bridge']),
    'dolina': dict(eras=['it1', 'it2'], parts=[
        'Silicon Valley, California: a sprawling tech company campus with low glass buildings, palm trees, green lawns, colorful bicycles, a big parking lot',
        'California: a sunny suburban main street with cafes and a small venture capital office, palm trees, Spanish-style houses, golden hills behind',
        'California: a multi-lane highway between golden hills with office parks, a big glass headquarters ring building far away, palm trees']),
    'tyndex': dict(eras=['it1', 'it2'], parts=[
        'Moscow: the headquarters of a giant fictional internet company, a huge modern glass office building with a bright yellow-red accent color, a plaza with young employees',
        'Moscow: a corporate tech campus with a running track on the roof, a big cafeteria pavilion, yellow self-driving delivery robots on the sidewalk, birch trees',
        'Moscow: a huge data center and a logistics hub of a tech giant, yellow delivery vans, a robot taxi without a driver at a stop, a modern residential district beyond']),
}

# Где эпоха по умолчанию не к месту (снежная зима в Калифорнии) — своя.
ERA_AT = {('dolina', 'it1'): 'early 2010s 2009-2014: modern cars, early smartphones era, green spring hills, bright clear morning sun, long soft shadows'}


def panoramas():
    items = []
    for place, p in PLACES.items():
        for era in p['eras']:
            for i, part in enumerate(p['parts'], 1):
                items.append({'name': f'{place}-{era}-{i}', 'prompt': f'{PAINT}{part}. {ERA_AT.get((place, era), ERA[era])}. {ROAD}{TAIL}'})
    return {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': LICENSE,
            'defaults': {'width': 1792, 'height': 896, 'steps': 8}, 'seeds': [111, 222], 'items': items}


# ---------------------------------------------------------------- Колян: облики второго сезона (родился в 1967-м)
LOOKS = {
    '2004-club': f'A 37-year-old Russian businessman, owner of an English football club, in 2004: {KOLYAN}, heavier, rich and pleased with himself. He wears a camel cashmere coat over a dark polo-neck sweater and a red-and-white knitted football scarf.',
    '2008-crash': f'A 41-year-old Russian businessman in autumn 2008 after losing his fortune: {KOLYAN}, tired and haggard, dark circles under the eyes, unshaven stubble. He wears a crumpled white shirt with an open collar and a loosened tie, no jacket.',
    '2010-it': f'A 43-year-old Russian man who became an IT entrepreneur in 2010: {KOLYAN}, a bit slimmer, curious and energetic. He wears a grey zip hoodie under a dark blazer, a simple plastic-strap watch.',
    '2015-beard': f'A 48-year-old Russian tech investor in 2015: {KOLYAN}, now with a short neat grey-streaked beard, grey at the temples, confident calm look. He wears a black crew-neck t-shirt under an expensive unstructured navy jacket.',
    '2021-ill': f'A 54-year-old Russian man in late 2021 recovering after a serious illness: {KOLYAN}, but now noticeably thin and gaunt, hollow cheeks, completely grey buzz cut and grey stubble, pale skin, tired but warm eyes. He wears a soft light-grey knitted sweater, loose on him.',
    '2030-island': f'A 63-year-old Russian retired millionaire on a tropical island in 2030: {KOLYAN}, old, white hair and a white beard, deeply tanned, relaxed happy squint. He wears a white linen shirt unbuttoned at the neck and a straw panama hat.',
}
# ---------------------------------------------------------------- персонажи второго сезона (вымышленные)
NPC = {
    'trener': 'A 42-year-old southern European football manager in 2005, fictional, slim, dark hair with grey temples, stubble, sharp arrogant smile, a long dark grey overcoat over a suit.',
    'zvezda': 'A 24-year-old West African football striker in 2006, fictional, athletic, short twisted hair, a diamond stud earring, a red club training jacket, playful confident grin.',
    'kapitan': 'A 30-year-old English football captain in 2005, fictional, ginger buzz cut, square jaw, a red club tracksuit jacket, serious honest look.',
    'agent': 'A 45-year-old football agent in London in 2005, fictional, slicked-back hair, tanned, open-collar silk shirt, gold watch, two phones on the table, a salesman smile.',
    'sheikh': 'A 50-year-old Gulf Arab investor in 2007, fictional, neatly trimmed black beard, white thobe and white ghutra headdress, calm polite expression.',
    'amerikanec': 'A 55-year-old American businessman in 2008, fictional, silver hair, tanned, a navy blazer with an open shirt, wide confident smile.',
    'fanat': 'A 35-year-old English football ultras leader in 2006, fictional, shaved head, tattoos on forearms, a red-and-white scarf and a dark bomber jacket, tough grin.',
    'kreditor': 'A 50-year-old London banker in 2008, fictional, thin, rimless glasses, perfect grey suit and dark tie, cold polite expression.',
    'zhena': 'A 34-year-old Russian woman, wife of a rich businessman, in 2007, fictional, long light-brown hair, elegant beige cashmere sweater, small pearl earrings, intelligent warm but strict look.',
    'syn': 'A 17-year-old Russian teenage boy in 2012, fictional, broad face like his father, short hair, a hoodie and headphones around the neck, sulky look.',
    'doch': 'A 15-year-old Russian teenage girl in 2012, fictional, long dark hair in a ponytail, a denim jacket, bright curious eyes.',
    'vnuki': 'A 30-year-old Russian young mother in 2020 sitting with a 4-year-old boy on her lap, fictional, casual knitted clothes, both smiling.',
    'sooosnovatel': 'A 27-year-old Russian programmer from Novosibirsk in 2010, fictional, skinny, messy hair, glasses, a checked flannel shirt, a laptop on the table, shy smart smile.',
    'venchur': 'A 40-year-old Russian venture capitalist in Moscow in 2014, fictional, short beard, trendy round glasses, a white shirt with rolled sleeves, a smartwatch, appraising look.',
    'regulyator': 'A 52-year-old Russian government official in 2017, fictional, balding, a dark blue suit, a small flag pin on the lapel, a thick folder of papers on the table, stern look.',
    'vrach': 'A 45-year-old Russian doctor in 2020, fictional, a white medical coat over green scrubs, a stethoscope around the neck, a surgical mask pulled down under the chin, kind tired eyes.',
    'zheka': 'A 54-year-old Russian man in 2021, an old friend from the 1990s, fictional, lean, grey crew cut, a scar on the cheek, a worn leather jacket, ironic grin.',
    'seryoga': 'A 54-year-old Russian man in 2021, an old friend from the 1990s, fictional, heavy, bald, a warm smile, a knitted sweater, simple and kind.',
    'kurer': 'A 25-year-old courier in Moscow in 2019, fictional, a bright yellow delivery jacket and a cap, a big insulated backpack on the chair, cheerful tired face.',
    'zhurnalistka': 'A 30-year-old Russian business journalist in 2016, fictional, short bob haircut, a smartphone recording on the table, a black blazer, sharp curious look.',
}


def people(table, seeds):
    return {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': LICENSE,
            'defaults': {'width': 1024, 'height': 1024, 'steps': 8}, 'seeds': seeds,
            'items': [{'name': k, 'prompt': PORTRAIT.format(who=v)} for k, v in table.items()]}


# ---------------------------------------------------------------- иллюстрации карточек, сделок и истории
# Сцены пишут агенты Sonnet по G:/temp/kommersy2-art/BRIEF-ART.md (выгрузка s2-items.json) → prompts-*.json.
CARD_PROMPTS = pathlib.Path('G:/temp/kommersy2-art')
CARD_ART2 = CARD_ART.replace('set in Russia unless stated otherwise', 'set in the 2000s-2010s, in Russia unless stated otherwise')


def cards():
    scenes: dict[str, str] = {}
    for f in sorted(CARD_PROMPTS.glob('prompts-*.json')):
        scenes.update(json.loads(f.read_text(encoding='utf-8')))
    return {'workflow': 'z_image_turbo', 'server': 'comfy-big', 'license': LICENSE,
            'defaults': {'width': 1152, 'height': 768, 'steps': 8}, 'seeds': [55, 66],
            'items': [{'name': k, 'prompt': f'{CARD_ART2}{v.strip()}{CARD_TAIL}'} for k, v in scenes.items()]}


# ---------------------------------------------------------------- реакции Коляна (Wan 2.2 i2v), как в первом сезоне
# Ключи — отобранные облики (pack_kommersy2.LOOK_PICK), кладёт `pack_kommersy2.py keys` в 24-keys/kolyan-<облик>.png.
LOOK_YEARS = ['2004', '2008', '2010', '2015', '2021', '2030']


def reactions():
    return {'keys': 'G:/temp/studio/out/kommersy2/24-keys', 'server': 'comfy-big', 'per_clip': True,
            'defaults': {'width': 704, 'height': 704, 'frames': 97, 'steps': 30}, 'seeds': [1],
            'style': REACT_STYLE,
            'clips': [{'name': r, 'keys': [f'kolyan-{y}' for y in LOOK_YEARS], 'prompt': f'{a} {{style}}'} for r, a in REACTIONS.items()]}


JOBS = {
    '21-panoramas': panoramas(),
    '22-kolyan-looks': people(LOOKS, [11, 22, 33]),
    '23-npc': people(NPC, [11, 22]),
    '24-kolyan-reactions': reactions(),
    '25-cards': cards(),
}

if __name__ == '__main__':
    for name, job in JOBS.items():
        head = f'# Коммерсы 2.0, партия {name} — сгенерировано make_jobs.py, правки — там.\n'
        (HERE / f'{name}.yaml').write_text(head + yaml.safe_dump(job, allow_unicode=True, sort_keys=False, width=200), encoding='utf-8')
        print(name, len(job.get('items', job.get('clips', []))))
