"""Коммерсы: отобранное с выхода конвейера → lavochka/public/kommersy/a/ (WebP, LFS).

Отбор — studio/bible/kolyan.md. Звуки (08-sfx, уже Opus после runners/sfx.py) — копируются в sfx/ как есть. Панорамы 1600×800; портреты — ключ по хромакею (зелёный → прозрачный), 512×512.
  G:/ai/ComfyUI/venv/Scripts/python.exe -I studio/post/pack_kommersy.py [--voice]
--cards — только иллюстрации карточек (партия 11-cards): сид 55, кроме отобранных в CARD_PICK → cards/<id>.webp 576×384.
--voice — только голос Коляна: лучший дубль каждой фразы (picks.json от asr_score.py) → voice/<ситуация>-<NN>.ogg
и число фраз по ситуациям → src/games/kommersy/voice.json.
"""
import json
import pathlib
import sys
import shutil

import numpy as np
from PIL import Image

OUT = pathlib.Path(__file__).resolve().parents[2] / 'lavochka/public/kommersy/a'
SRC = pathlib.Path('G:/temp/studio/out/kommersy')
VOICE = pathlib.Path('G:/temp/kommersy-voice')
COUNTS = OUT.parents[2] / 'src/games/kommersy/voice.json'


# Иллюстрации: другой сид, если у первого рамка или надписи (по листам)
CARD_PICK: dict[str, str] = {'e-krestiny': '66', 'h-black': '66', 'h-gkchp': '66', 'k-kinul': '66', 'k-zakaz': '66', 'n-bad': '66', 'n-ceny': '66', 'r-shik': '66', 's-bazar': '66', 's-sport': '66', 'set-magazinov': '66', 'telekanal': '66', 'w-akadem': '66', 'w-klass': '66', 'w-moskva': '66', 'w-teatr': '66'}


def cards():
    (OUT / 'cards').mkdir(parents=True, exist_ok=True)
    src = SRC / '11-cards'
    names = sorted({f.stem.rsplit('-', 1)[0] for f in src.glob('*.png')})
    for n in names:
        Image.open(src / f'{n}-{CARD_PICK.get(n, "55")}.png').convert('RGB').resize((576, 384), Image.LANCZOS).save(OUT / 'cards' / f'{n}.webp', quality=78)
    print('иллюстраций', len(names), round(sum(f.stat().st_size for f in (OUT / 'cards').glob('*.webp')) / 1e6, 1), 'МБ')


def voice():
    picks = json.loads((VOICE / 'picks.json').read_text(encoding='utf-8'))
    (OUT / 'voice').mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    for phrase, wav in sorted(picks.items()):
        name = phrase.split('/', 1)[1]  # kolyan/start-01 → start-01
        key, n = name.rsplit('-', 1)
        counts[key] = max(counts.get(key, 0), int(n))
        shutil.copyfile(VOICE / 'kolyan' / 'ogg' / (pathlib.Path(wav).stem + '.ogg'), OUT / 'voice' / f'{name}.ogg')
    COUNTS.write_text(json.dumps(counts, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('реплик', len(picks), 'ситуаций', len(counts), round(sum(f.stat().st_size for f in (OUT / 'voice').glob('*.ogg')) / 1e6, 1), 'МБ')

PANO = {
    'dvor-soviet': ['1-222', '2-111', '3-111'], 'dvor-wild': ['1-111', '2-111', '3-111'],
    'kiosk-soviet': ['1-111', '2-111', '3-222'], 'kiosk-wild': ['1-111', '2-111', '3-111'],
    'bazar-wild': ['1-111', '2-111', '3-111'], 'bazar-new': ['1-111', '2-222', '3-111'],
    'center-wild': ['1-111', '2-111', '3-111'], 'center-new': ['1-111', '2-222', '3-111'],
    'oblast-wild': ['1-111', '2-111', '3-111'], 'oblast-new': ['1-111', '2-111', '3-222'],
    'moscow-new': ['1-111', '2-222', '3-111'], 'london-new': ['1-222', '2-111', '3-111'],
}
KOLYAN = {'1988': '01-concepts/kolyan-1988-demb-22', '1990': '01-concepts/kolyan-1990-coop-66', '1993': '03-kolyan-looks/1993-leather-22',
          '1996': '03-kolyan-looks/1996-blazer-33', '2003': '03-kolyan-looks/2003-suit-33'}
NPC = ['mother', 'girl', 'brigadir', 'byk', 'oper', 'uchastkovy', 'nalogovik', 'chinovnik', 'bankir', 'direktor', 'chelnochnitsa', 'konkurent', 'zhurnalist', 'reshala', 'yurist', 'drug']


def key(img: Image.Image) -> Image.Image:
    """Хромакей: насколько зелёный перевешивает красный и синий — настолько прозрачно; зелёный ореол гасим."""
    a = np.asarray(img.convert('RGB')).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    spill = g - np.maximum(r, b)
    alpha = np.clip(1 - (spill - 18) / 40, 0, 1)
    g2 = np.minimum(g, np.maximum(r, b) + 8)
    rgba = np.dstack([r, np.where(alpha < 1, g2, g), b, alpha * 255]).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')


def main():
    (OUT / 'pano').mkdir(parents=True, exist_ok=True)
    (OUT / 'people').mkdir(parents=True, exist_ok=True)
    for place, parts in PANO.items():
        for i, p in enumerate(parts, 1):
            part, seed = p.split('-')
            # с дорогой по roads.json (партия 07), пока её нет — исходная панорама
            road = SRC / '07-road-panos' / f'{place}-{i}-{seed}.png'
            Image.open(road if road.exists() else SRC / '04-panoramas' / f'{place}-{part}-{seed}.png').convert('RGB').resize((1600, 800), Image.LANCZOS).save(OUT / 'pano' / f'{place}-{i}.webp', quality=80)
    for year, src in KOLYAN.items():
        key(Image.open(SRC / f'{src}.png')).resize((512, 512), Image.LANCZOS).save(OUT / 'people' / f'kolyan-{year}.webp', quality=85)
    for n in NPC:
        seed = '22' if n == 'nalogovik' else '11'
        key(Image.open(SRC / '05-npc' / f'{n}-{seed}.png')).resize((512, 512), Image.LANCZOS).save(OUT / 'people' / f'{n}.webp', quality=85)
    (OUT / 'sfx').mkdir(parents=True, exist_ok=True)
    for f in sorted((SRC / '08-sfx' / 'ogg').glob('*.ogg')):
        shutil.copyfile(f, OUT / 'sfx' / f.name)
    print('звуков', len(list((OUT / 'sfx').glob('*.ogg'))))
    print('готово', sum(1 for _ in OUT.rglob('*.webp')), 'файлов,', round(sum(f.stat().st_size for f in OUT.rglob('*.webp')) / 1e6, 1), 'МБ')


if __name__ == "__main__":
    voice() if '--voice' in sys.argv else cards() if '--cards' in sys.argv else main()
