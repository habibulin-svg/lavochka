"""«Герои»: города одной картиной для всех фракций (решение пользователя 2026-11-24: «да, всех так» после пробы Затулья).

G:/ai/ComfyUI/venv/Scripts/python.exe -X utf8 studio/jobs/geroi/wb/make_towns.py whole
    схемы расстановки (прежние постройки на прежнем фоне, по LAYOUT из ui/town.ts) → refs/t-<фр>-layout.png, -site.png,
    рамки → G:/temp/geroi-wb/towns/<фр>-boxes.json, задание t1-towns-whole.yaml (Klein ref2: схема + манера фона).
G:/ai/ComfyUI/venv/Scripts/python.exe -X utf8 studio/jobs/geroi/wb/make_towns.py empty zatonye=91 kuznya=33 ...
    выбранные целые картины → refs/t-<фр>-whole.png, задание t2-towns-empty.yaml (та же картина без построек).
Дальше — studio/post/town_layers.py <целый> <пустой> <рамки> <фр> lavochka/public/geroi/a/towns lavochka/src/geroi/ui/townplace.ts
"""
import json
import pathlib
import shutil
import sys

import yaml
from PIL import Image

TOWNS = pathlib.Path('G:/Claude/Shish/lavochka/public/geroi/a/towns')
REFS = pathlib.Path('G:/ai/out/webbook/geroi/refs')
OUTW = pathlib.Path('G:/ai/out/webbook/geroi/t1-towns-whole')
TMP = pathlib.Path('G:/temp/geroi-wb/towns')
HERE = pathlib.Path(__file__).parent
LICENSE = 'FLUX Kommunity License v1.0 (FLUX 3 Image Klein)'

# как LAYOUT и UNIQ в lavochka/src/geroi/ui/town.ts: [ряд, центр x, размер]
LAYOUT = {
    'guild': (0, 170, 330), 'dwell7': (0, 450, 400), 'dwell6': (0, 740, 380), 'fort': (0, 1060, 560), 'dwell5': (0, 1390, 340),
    'storehouse': (1, 120, 330), 'dwell4': (1, 360, 350), 'hall': (1, 680, 480), 'tavern': (1, 980, 330), 'market': (1, 1220, 370), 'uniq2': (1, 1450, 330),
    'shipyard': (1.4, 130, 350), 'dwell1': (1.4, 400, 340), 'dwell2': (1.4, 660, 340), 'uniq1': (2, 950, 370), 'smithy': (2, 1190, 340), 'dwell3': (2, 1430, 360),
}
UNIQ = {
    'zatulye': {'uniq1': 'skhod'}, 'zatonye': {'uniq1': 'fogwell', 'uniq2': 'gat'}, 'kuznya': {'uniq1': 'furnace', 'uniq2': 'scrapyard'},
    'akademiya': {'uniq1': 'lab', 'uniq2': 'observatory'}, 'plotina': {'uniq1': 'dam', 'uniq2': 'turbine'}, 'ostrog': {'uniq1': 'drill', 'uniq2': 'banya'},
    'bazar': {'uniq1': 'caravanserai', 'uniq2': 'bank'}, 'kurgany': {'uniq1': 'memory', 'uniq2': 'bindstone'},
}
# место, чем заполнить промежутки, свет
SETTING = {
    'zatonye': ('a Slavic fantasy swamp town on a marshy meadow among reeds, ponds and old willows',
                'buildings stand on wooden piles and earth mounds, plank walkways and boardwalks over the water lead to every door, '
                'reed fences, fishing nets on poles, punts moored at the walkways, stacks of peat and firewood fill the space between them',
                'soft misty morning light, a thin fog over the water, the far buildings fade into the haze'),
    'kuznya': ('a dwarven Slavic fantasy forge town on dark volcanic ash ground with glowing lava cracks',
               'buildings stand on heavy stone foundations cut into the black slope, stone stairs and terraces, paved ore roads with cart rails lead to every gate, '
               'heaps of ore and coal, anvils, crates, chains and iron scrap fill the space between them, smoke rises from chimneys',
               'red sunset sky with orange glow from the forges and the lava, long dark shadows, smoky haze on the far buildings'),
    'akademiya': ('a Slavic fantasy scholars\' town in a clearing of a tall pine forest by the sea',
                  'buildings stand on mossy granite foundations and terraces, stone-paved paths and little bridges lead to every door, '
                  'boulders, fern and blueberry bushes, lanterns on posts, telescopes and stacks of books under awnings fill the space between them',
                  'clear cool afternoon light under a deep blue sky, crisp shadows of the pines, soft blue haze on the far buildings'),
    'plotina': ('a Slavic fantasy town of dam builders on a rocky sea coast with a waterfall falling from the cliffs',
                'buildings stand on cut stone foundations on the rock shelves, stone stairs, sluice channels with running water and wooden bridges lead to every door, '
                'waterwheels, mooring posts, coiled ropes, barrels and lobster traps fill the space between them',
                'stormy grey sky with sunbeams breaking through, wet glistening stone, sea spray haze on the far buildings'),
    'ostrog': ('a northern Slavic fantasy fortress town in deep winter snow at the edge of a fir forest',
               'buildings stand on log foundations banked with snow, trodden snowy paths and ski tracks lead to every door, '
               'snow-covered woodpiles, sledges, log fences, frozen barrels and smoke rising from every chimney fill the space between them',
               'low golden winter sun, long blue shadows on the snow, frosty haze on the far buildings'),
    'bazar': ('an eastern caravan trading town on a white salt flat by a turquoise lake',
              'buildings stand on whitewashed adobe platforms, paved streets with colourful awnings lead to every door, '
              'market stalls, carpets, clay jars, bales, camels and carts fill the space between them',
              'bright hot noon sun, short sharp shadows, shimmering heat haze on the far buildings'),
    'kurgany': ('an ancient Slavic fantasy steppe town among burial mounds on a heather moor with standing stones',
                'buildings stand on earth mounds and old stone platforms, trodden heath paths lined with stones lead to every door, '
                'standing stones, carved wooden idols, cairns, grave banners and crow-haunted posts fill the space between them',
                'quiet violet dusk light, low warm sun on the horizon, soft purple haze on the far buildings'),
}
PROMPT = ('Repaint <ref_image_0> as one single coherent hand-painted oil painting of {place}, in the exact painterly brushwork and palette of <ref_image_1>. '
          'Keep every building at the same place, size and design as in <ref_image_0>, but make them truly belong to the land: {between}. '
          'One shared light: {light}; consistent cast shadows fall on the ground and on neighbouring buildings. '
          'Believable weathered architecture and materials, earthy natural colours, rich detail, painted like a classic fantasy town screen, not cartoon, no black outlines. No text.')
EMPTY = ('The same painting as <ref_image_0>, exactly the same landscape, sky, water, trees, light, colours and brushwork, but every building, tower, tent, wall and fence is gone: '
         'in their places lie empty building plots with bare trodden ground, a few cut logs and stones, the same paths still crossing the land. Nothing else changes.')


def layout(fac):
    bg = Image.open(TOWNS / f'{fac}-site.webp').convert('RGBA').resize((1920, 1080), Image.LANCZOS)
    bg.convert('RGB').save(REFS / f't-{fac}-site.png')
    boxes = {}
    for k, (row, x, size) in sorted(LAYOUT.items(), key=lambda e: e[1][0]):
        art = UNIQ[fac].get(k, k)
        if k.startswith('uniq') and k not in UNIQ[fac]:
            continue
        p = TOWNS / f'{fac}-{art}.webp'
        if not p.exists():
            print('нет', fac, art)
            continue
        im = Image.open(p).convert('RGBA')
        w = size * (0.7 + 0.15 * row)
        h = im.height * w / im.width
        bottom = 500 + 200 * row
        im = im.resize((round(w), round(h)), Image.LANCZOS)
        bg.alpha_composite(im, (round(x - w / 2), round(bottom - h)))
        boxes[art] = (round(x - w / 2), round(bottom - h), round(w), round(h), row)
    bg.convert('RGB').save(REFS / f't-{fac}-layout.png')
    (TMP / f'{fac}-boxes.json').write_text(json.dumps(boxes), encoding='utf-8')
    return boxes


def main():
    TMP.mkdir(parents=True, exist_ok=True)
    head = '# Сгенерировано make_towns.py — правки вносить туда.\n'
    if sys.argv[1] == 'whole':
        items = []
        for fac, (place, between, light) in SETTING.items():
            print(fac, len(layout(fac)), 'построек')
            items.append({'name': f'{fac}-whole', 'image': f'refs/t-{fac}-layout.png', 'image2': f'refs/t-{fac}-site.png',
                          'prompt': PROMPT.format(place=place, between=between, light=light)})
        (HERE / 't1-towns-whole.yaml').write_text(head + yaml.safe_dump(
            {'workflow': 'flux3_klein_ref2', 'server': 'comfy-big', 'license': LICENSE, 'seeds': [11, 57, 91],
             'defaults': {'steps': 20, 'ref_mp': 1.0, 'width': 1920, 'height': 1088}, 'items': items}, allow_unicode=True, sort_keys=False, width=200), encoding='utf-8')
    else:
        items = []
        for kv in sys.argv[2:]:
            fac, seed = kv.split('=')
            shutil.copy(OUTW / f'{fac}-whole-{seed}.png', REFS / f't-{fac}-whole.png')
            items.append({'name': f'{fac}-empty', 'image': f'refs/t-{fac}-whole.png', 'prompt': EMPTY})
        (HERE / 't2-towns-empty.yaml').write_text(head + yaml.safe_dump(
            {'workflow': 'flux3_klein_ref1', 'server': 'comfy-big', 'license': LICENSE, 'seeds': [11, 33],
             'defaults': {'steps': 20, 'ref_mp': 2.0, 'width': 1920, 'height': 1088}, 'items': items}, allow_unicode=True, sort_keys=False, width=200), encoding='utf-8')
    print('готово')


if __name__ == '__main__':
    main()
