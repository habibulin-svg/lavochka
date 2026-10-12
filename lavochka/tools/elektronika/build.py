"""Сборка «Электроники» из материалов MAME (materials/elektronika): прошивки, экраны, корпуса.

  python tools/elektronika/build.py

На выходе public/elektronika/<игра>/:
  rom.bin      — прошивка КБ1013ВК1-2 (SM5A), 1856 байт;
  screen.svg   — сегменты ЖК: у каждого data-s="x.y.z" (группа O, сегмент, общий H), лишнее вырезано;
  under.webp   — плёнка-фон под ЖК (рисунок, что виден сквозь стекло);
  over.webp    — корпус с прозрачным окном (+ надписи поверх ЖК, пыль, блик стекла);
  btn-*.webp   — нажатые кнопки (где в артворке они есть);
  layout.json  — где что лежит (в координатах корпуса), куда кнопки.
Артворк — Lee Robson (hydef), сканы — Henrik Algestam, MilanSK; раскладки — DarthMarino; экраны и прошивки — MAME.
"""
import json
import os
import re
import shutil
import sys
import xml.etree.ElementTree as ET

from PIL import Image, ImageChops

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
MAT = os.path.join(ROOT, 'materials', 'elektronika')
OUT = os.path.join(ROOT, 'lavochka', 'public', 'elektronika')

# корпус в артворке 2782×1654; на сайт — в SCALE раз меньше
UNIT_W, UNIT_H = 2782, 1654
OUT_W = 1600
SCALE = OUT_W / UNIT_W

GAMES = ['nupogodi', 'taynyoke', 'vespovar', 'kosmicmt', 'ehockey', 'rkosmosa', 'okhota', 'biathlon', 'vfutbol', 'auslalom', 'krybolov', 'kvakazad', 'kosmicpt', 'atakaast']

SVG_NS = 'http://www.w3.org/2000/svg'


def clean_svg(src: str) -> str:
    """Оставить только рисунок: сегменты получают data-s из <title>, белая подложка и служебное — вон."""
    ET.register_namespace('', SVG_NS)
    tree = ET.parse(src)
    root = tree.getroot()
    q = lambda t: f'{{{SVG_NS}}}{t}'

    def strip(el):
        for k in list(el.attrib):
            if k.startswith('{') and not k.startswith(f'{{{SVG_NS}}}'):
                del el.attrib[k]
            elif k in ('id',):
                del el.attrib[k]
        for ch in list(el):
            tag = ch.tag
            if tag in (q('metadata'), q('desc'), q('defs')) or not tag.startswith(f'{{{SVG_NS}}}'):
                el.remove(ch)
                continue
            if tag == q('title'):
                el.set('data-s', (ch.text or '').strip())
                el.remove(ch)
                continue
            strip(ch)

    # белая подложка — отдельный слой «white» или первый rect на весь экран
    for g in list(root):
        label = g.attrib.get('{http://www.inkscape.org/namespaces/inkscape}label', '')
        if label.lower() == 'white':
            root.remove(g)
    strip(root)
    for el in list(root.iter()):
        for ch in list(el):
            if ch.tag == q('rect') and 'data-s' not in ch.attrib and re.search(r'fill:#ffffff|fill="#ffffff"', ET.tostring(ch, encoding='unicode')):
                el.remove(ch)
    vb = root.attrib['viewBox']
    for k in list(root.attrib):
        if k not in ('viewBox', 'style'):
            del root.attrib[k]
    root.set('viewBox', vb)
    root.set('preserveAspectRatio', 'none')
    txt = ET.tostring(root, encoding='unicode')
    txt = re.sub(r'\s+', ' ', txt)
    txt = re.sub(r'> <', '><', txt)
    # потрейс пишет координаты целыми — оставляем; убираем лишние нули у дробных
    txt = re.sub(r'(\d+\.\d{2})\d+', r'\1', txt)
    names = re.findall(r'data-s="([^"]+)"', txt)
    return txt, names


def parse_lay(path: str):
    s = open(path, encoding='utf8', errors='replace').read()
    elements = {}
    for m in re.finditer(r'<element name="([^"]+)"[^>]*>(.*?)</element>', s, re.S):
        img = re.search(r'<image file="([^"]+)"', m.group(2))
        if img:
            elements[m.group(1)] = img.group(1)
    views = dict(re.findall(r'<view name="([^"]+)">(.*?)</view>', s, re.S))
    body = views['Unit Only']
    items = []
    for m in re.finditer(r'<(element|screen)\b([^>]*)>\s*<bounds x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"\s*/>(.*?)</\1>', body, re.S):
        kind, attrs = m.group(1), m.group(2)
        b = [float(m.group(i)) for i in range(3, 7)]
        alpha = re.search(r'alpha="([\d.]+)"', m.group(7))
        ref = re.search(r'ref="([^"]+)"', attrs)
        items.append({
            'kind': kind,
            'ref': ref.group(1) if ref else None,
            'blend': (re.search(r'blend="([^"]+)"', attrs) or [None, None])[1],
            'input': re.search(r'inputtag="([^"]+)" inputmask="([^"]+)"', attrs),
            'dummy': 'name="dummy"' in attrs,
            'b': b,
            'alpha': float(alpha.group(1)) if alpha else 1.0,
        })
    return elements, items


def place(canvas: Image.Image, img: Image.Image, b, alpha=1.0, mode='normal'):
    x, y, w, h = b
    w2, h2 = max(1, round(w * SCALE)), max(1, round(h * SCALE))
    im = img.convert('RGBA').resize((w2, h2), Image.LANCZOS)
    if alpha < 1:
        a = im.getchannel('A').point(lambda v: round(v * alpha))
        im.putalpha(a)
    layer = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    layer.paste(im, (round(x * SCALE), round(y * SCALE)))
    if mode == 'add':
        rgb = ImageChops.add(canvas.convert('RGB'), Image.composite(layer.convert('RGB'), Image.new('RGB', canvas.size), layer.getchannel('A')))
        out = rgb.convert('RGBA')
        out.putalpha(canvas.getchannel('A'))
        return out
    canvas.alpha_composite(layer)
    return canvas


def build(game: str):
    art = os.path.join(MAT, 'art', game)
    romdir = os.path.join(MAT, 'rom', game)
    out = os.path.join(OUT, game)
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        os.remove(os.path.join(out, f))

    rom = [f for f in os.listdir(romdir) if f.endswith('.bin')][0]
    shutil.copy(os.path.join(romdir, rom), os.path.join(out, 'rom.bin'))
    svg, names = clean_svg(os.path.join(romdir, game + '.svg'))
    open(os.path.join(out, 'screen.svg'), 'w', encoding='utf8').write(svg)

    elements, items = parse_lay(os.path.join(art, 'default.lay'))
    def load(ref):
        f = os.path.join(art, elements[ref])
        if not os.path.exists(f):  # у некоторых картинки нажатых кнопок лежат в Animation/
            f = os.path.join(art, 'Animation', os.path.basename(elements[ref]))
        return Image.open(f)
    size = (round(UNIT_W * SCALE), round(UNIT_H * SCALE))
    under = Image.new('RGBA', size, (0, 0, 0, 0))
    over = Image.new('RGBA', size, (0, 0, 0, 0))
    lay = {'w': UNIT_W, 'h': UNIT_H, 'screen': None, 'shadow': None, 'buttons': []}
    seen_screen = False
    for it in items:
        if it['dummy'] or it['ref'] == 'black':
            continue
        if it['kind'] == 'screen':
            if it['blend'] == 'multiply':
                lay['screen'] = it['b']
            else:
                lay['shadow'] = {'b': it['b'], 'alpha': it['alpha']}
            seen_screen = True
            continue
        if it['input']:
            tag, mask = it['input'].group(1), int(it['input'].group(2), 16)
            im = load(it['ref']).convert('RGBA')
            # картинка во весь корпус, видна только кнопка; у некоторых — чуть другой размер холста
            k = UNIT_W / im.size[0]
            bb = im.getchannel('A').getbbox()
            crop = im.crop(bb)
            bx = [bb[0] * k, bb[1] * k, (bb[2] - bb[0]) * k, (bb[3] - bb[1]) * k]
            name = f'btn-{tag.replace(".", "")}-{mask:x}.webp'
            w2, h2 = round(bx[2] * SCALE), round(bx[3] * SCALE)
            crop.resize((w2, h2), Image.LANCZOS).save(os.path.join(out, name), 'WEBP', quality=88)
            lay['buttons'].append({'port': tag, 'mask': mask, 'b': [round(v) for v in bx], 'img': name})
            continue
        img = load(it['ref'])
        target = over if seen_screen else under
        if it['ref'] == 'Dust':
            continue  # пыль на стекле — «add» по стеклу, на сайте лишняя грязь
        if target is over:
            over = place(over, img, it['b'], it['alpha'])
        else:
            under = place(under, img, it['b'], it['alpha'])

    # фон кладём только кусок под окном — остальное закрыто корпусом
    sx, sy, sw, sh = lay['screen']
    pad = 40
    box = [max(0, sx - pad), max(0, sy - pad), min(UNIT_W, sx + sw + pad), min(UNIT_H, sy + sh + pad)]
    pbox = [round(v * SCALE) for v in box]
    under.crop(pbox).convert('RGB').save(os.path.join(out, 'under.webp'), 'WEBP', quality=86)
    lay['under'] = [round(pbox[0] / SCALE), round(pbox[1] / SCALE), round((pbox[2] - pbox[0]) / SCALE), round((pbox[3] - pbox[1]) / SCALE)]
    over.save(os.path.join(out, 'over.webp'), 'WEBP', quality=86)
    lay['segs'] = len(names)
    json.dump(lay, open(os.path.join(out, 'layout.json'), 'w'), indent=1)
    sizes = {f: os.path.getsize(os.path.join(out, f)) // 1024 for f in os.listdir(out)}
    print(game, sizes)


if __name__ == '__main__':
    for g in sys.argv[1:] or GAMES:
        build(g)
