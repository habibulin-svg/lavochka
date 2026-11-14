"""«Коммерсы 2.0»: выход конвейера (G:/temp/studio/out/kommersy2) → lavochka/public/kommersy/a/ (WebP, LFS).

  G:/ai/ComfyUI/venv/Scripts/python.exe -I studio/post/pack_kommersy2.py roads   заготовки дороги → ComfyUI/input/kommersy2 + задание 26-road-panos.yaml
  G:/ai/ComfyUI/venv/Scripts/python.exe -I studio/post/pack_kommersy2.py         панорамы, облики, персонажи, иллюстрации

Отбор — PANO / LOOK / NPC_SEED / CARD_PICK ниже (по листам sheet.py). Дорога на панорамах — те же кривые roads.json, что и в первом сезоне.
"""
import json
import pathlib
import sys

import yaml
from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'studio/post'))
from pack_kommersy import key  # noqa: E402  (хромакей первого сезона)

OUT = ROOT / 'lavochka/public/kommersy/a'
SRC = pathlib.Path('G:/temp/studio/out/kommersy2')
INPUT = pathlib.Path('G:/ai/ComfyUI/input/kommersy2')
ROADS = json.loads((ROOT / 'lavochka/src/games/kommersy/roads.json').read_text(encoding='utf-8'))
W, H = 1792, 896
K = W / 1600

# Отбор: <местность>-<эпоха> → сид каждой из трёх частей (по умолчанию 111).
PLACES = {'stadium': ['club'], 'city': ['club', 'crash'], 'riviera': ['club'], 'garazh': ['it1', 'it2'], 'kovorking': ['it1', 'it2'],
          'tehnopark': ['it1', 'it2'], 'siti': ['it1', 'it2'], 'dolina': ['it1', 'it2'], 'tyndex': ['it1', 'it2']}
PANO_PICK: dict[str, str] = {}   # 'stadium-club-2': '222'
LOOK_PICK = {'2004-club': '33', '2008-crash': '11', '2010-it': '33', '2015-beard': '22', '2021-ill': '22', '2030-island': '22'}
LOOKS = {'2004': '2004-club', '2008': '2008-crash', '2010': '2010-it', '2015': '2015-beard', '2021': '2021-ill', '2030': '2030-island'}
NPC_PICK: dict[str, str] = {}    # 'trener': '22' (по умолчанию 11)
# по листам: 66 — где у 55 рамка (найдена автоматически: светлая ровная кайма), надписи или брак
CARD_PICK: dict[str, str] = {"a1-vzyatka": "66", "a2-audit": "66", "a2-bessonnica": "66", "a2-druzya": "66", "a2-ipoteka": "66", "a2-pokushenie": "66", "a2-zhena": "66", "a2-zvonok-domoj": "66", "b3-k-ddos": "66", "b3-k-demping": "66", "b3-k-peremanit": "66", "b3-k-pr": "66", "b3-n-covid": "66", "b3-n-crash-krypto": "66", "b3-n-ipo-soc": "66", "c3-blok": "66", "c3-ev-bessonnica": "66", "h-crash-dolgi": "66", "h-gox": "66", "h-izolyaciya": "66", "ill-3": "66", "n1-domoj": "66", "n1-tv": "66", "n3-btc": "66", "n3-fixer": "66", "r3-noutbuk": "66", "restoran": "66", "voice": "66", "w1-semya": "66", "x-club": "66", "n1-sponsor": "66", "e3-bank": "66", "l-ultimatum": "66"}


def panos():
    for place, eras in PLACES.items():
        for era in eras:
            for i in (1, 2, 3):
                yield f'{place}-{era}-{i}', PANO_PICK.get(f'{place}-{era}-{i}', '111')


def bez(p, t):
    seg, u = (0, t * 2) if t < 0.5 else (1, (t - 0.5) * 2)
    o = seg * 6
    k = [(1 - u) ** 3, 3 * (1 - u) ** 2 * u, 3 * (1 - u) * u ** 2, u ** 3]
    return (sum(k[i] * p[o + i * 2] for i in range(4)) * K, sum(k[i] * p[o + i * 2 + 1] for i in range(4)) * K)


def edges(road, half):
    pts = [bez(road, i / 600) for i in range(601)]
    L, R = [], []
    for i, (x, y) in enumerate(pts):
        ax, ay = pts[max(0, i - 1)]
        bx, by = pts[min(600, i + 1)]
        d = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5 or 1
        nx, ny = -(by - ay) / d, (bx - ax) / d
        L.append((x + nx * half, y + ny * half))
        R.append((x - nx * half, y - ny * half))
    return L + R[::-1]


def template(src: pathlib.Path, road: list) -> Image.Image:
    """Как в первом сезоне (road_templates.py): асфальт с бордюром по кривой, маска — дорога, остальное модель дорисовывает."""
    im = Image.open(src).convert('RGB')
    w = ROADS['width'] * K
    d = ImageDraw.Draw(im)
    d.polygon(edges(road, w / 2 + 7), fill=(176, 172, 160))
    d.polygon(edges(road, w / 2), fill=(92, 92, 96))
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).polygon(edges(road, w / 2 + 4), fill=255)
    im.putalpha(m.filter(ImageFilter.GaussianBlur(2)))
    return im


def roads():
    manifest = {m['file']: m for m in json.loads((SRC / '21-panoramas' / 'manifest.json').read_text(encoding='utf-8'))}
    INPUT.mkdir(parents=True, exist_ok=True)
    items = []
    for name, seed in panos():
        file = f'{name}-{seed}.png'
        i = int(name.rsplit('-', 1)[1])
        template(SRC / '21-panoramas' / file, ROADS['roads'][i - 1]).save(INPUT / f'{name}.png')
        prompt = manifest[file]['prompt'].split('A single clear winding road')[0] + (
            'An empty grey asphalt road with light curbs winds across the whole picture from the left edge to the right edge, '
            'it lies flat on the ground and is clearly visible along its whole length, buildings, trees and cars stand beside the road, never on it, '
            'sidewalks along both sides. Tiny distant people only. No text, no letters, no signs with writing, no logos, no watermark.')
        items.append({'name': name, 'image': f'kommersy2/{name}.png', 'denoise': 0.9, 'denoise2': 0.3, 'seeds': [int(seed)], 'prompt': prompt})
    job = {'workflow': 'z_image_img2img', 'server': 'comfy-big', 'license': 'Apache-2.0 (Z-Image-Turbo)', 'defaults': {'steps': 8}, 'items': items}
    out = ROOT / 'studio/jobs/kommersy2/26-road-panos.yaml'
    out.write_text('# Коммерсы 2.0, партия 26: панорамы с дорогой по roads.json (img2img) — сгенерировано pack_kommersy2.py roads.\n'
                   + yaml.safe_dump(job, allow_unicode=True, sort_keys=False, width=200), encoding='utf-8')
    print(len(items), 'заготовок', out)


def main():
    for d in ('pano', 'people', 'cards'):
        (OUT / d).mkdir(parents=True, exist_ok=True)
    n = 0
    for name, seed in panos():
        road = SRC / '26-road-panos' / f'{name}-{seed}.png'
        src = road if road.exists() else SRC / '21-panoramas' / f'{name}-{seed}.png'
        if src.exists():
            Image.open(src).convert('RGB').resize((1600, 800), Image.LANCZOS).save(OUT / 'pano' / f'{name}.webp', quality=80)
            n += 1
    print('панорам', n)
    for look, stem in LOOKS.items():
        f = SRC / '22-kolyan-looks' / f'{stem}-{LOOK_PICK.get(stem, "11")}.png'
        if f.exists():
            key(Image.open(f)).resize((512, 512), Image.LANCZOS).save(OUT / 'people' / f'kolyan-{look}.webp', quality=85)
    npc = sorted({f.stem.rsplit('-', 1)[0] for f in (SRC / '23-npc').glob('*.png')})
    for nm in npc:
        key(Image.open(SRC / '23-npc' / f'{nm}-{NPC_PICK.get(nm, "11")}.png')).resize((512, 512), Image.LANCZOS).save(OUT / 'people' / f'{nm}.webp', quality=85)
    print('персонажей', len(npc))
    src = SRC / '25-cards'
    names = sorted({f.stem.rsplit('-', 1)[0] for f in src.glob('*.png')})
    for nm in names:
        f = src / f'{nm}-{CARD_PICK.get(nm, "55")}.png'
        if f.exists():
            Image.open(f).convert('RGB').resize((576, 384), Image.LANCZOS).save(OUT / 'cards' / f'{nm}.webp', quality=78)
    print('иллюстраций', len(names))
    sfx()


def sfx():
    import shutil
    (OUT / 'sfx').mkdir(parents=True, exist_ok=True)
    fs = sorted((SRC / '28-sfx' / 'ogg').glob('*.ogg'))
    for f in fs:
        shutil.copyfile(f, OUT / 'sfx' / f.name)
    print('звуков', len(fs))


VOICE = pathlib.Path('G:/temp/kommersy2-voice')
COUNTS = ROOT / 'lavochka/src/games/kommersy/voice.json'


def voice():
    """Голос второго сезона (один дубль ElevenLabs): kolyan/<ситуация>-NN → voice/<ситуация>-NN.ogg, комментатор — voice/kom_<ситуация>-NN.ogg;
    число фраз дописывается в общий voice.json (ключи второго сезона не пересекаются с первым)."""
    import shutil
    counts = json.loads(COUNTS.read_text(encoding='utf-8'))
    n = 0
    for who, pre in (('kolyan', ''), ('kommentator', 'kom_')):
        for f in sorted((VOICE / who).glob('*.ogg')):
            sit, i = f.stem.rsplit('-', 1)
            shutil.copyfile(f, OUT / 'voice' / f'{pre}{sit}-{i}.ogg')
            counts[pre + sit] = max(counts.get(pre + sit, 0), int(i))
            n += 1
    COUNTS.write_text(json.dumps(dict(sorted(counts.items())), ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('реплик', n, 'ситуаций всего', len(counts))


def keys():
    """Ключевые кадры реакций (партия 24): отобранные облики как есть, с хромакеем."""
    import shutil
    d = SRC / '24-keys'
    d.mkdir(parents=True, exist_ok=True)
    for look, stem in LOOKS.items():
        shutil.copyfile(SRC / '22-kolyan-looks' / f'{stem}-{LOOK_PICK[stem]}.png', d / f'kolyan-{look}.png')
    print('ключей', len(LOOKS), d)


if __name__ == '__main__':
    arg = sys.argv[1:]
    roads() if 'roads' in arg else voice() if 'voice' in arg else keys() if 'keys' in arg else sfx() if 'sfx' in arg else main()
