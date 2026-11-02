"""Сборка ассетов ГОПС для игры: отобранное с выхода конвейера → lavochka/public/gops/a/ (Git LFS).

G:/ai/ComfyUI/venv/Scripts/python.exe -X utf8 studio/post/pack_gops.py [--only icons,world,fx,themes,brand,atlases,music,voices,sfx]

Раскладка — та же, что на выходе конвейера (G:/temp/studio/out/gops/<партия>/…), картинки PNG → WebP (имя то же, расширение .webp),
звук — как есть (Opus); ролики собирает studio/post/cutscenes.py (40-cutscenes, со звуком и апскейлом). Отбор — тот же, что в lavochka/src/gops/assets.ts
(тест tests/gops/assets.test.ts сверяет, что всё, на что ссылается код, лежит здесь). Готовое не пересжимается.
"""
import argparse
import json
import pathlib
import shutil
import subprocess

from PIL import Image

SRC = pathlib.Path('G:/temp/studio/out/gops')
MUSIC = pathlib.Path('G:/ai/out/studio/gops/music')
ROOT = pathlib.Path(__file__).resolve().parents[2]
DST = ROOT / 'lavochka/public/gops/a'
FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'

# иконки оружия: id → вариант (22-arsenal) или переделка (22b) — как ICON_PICK / ICON_FIX в assets.ts
ICON_PICK = {
    'armatura': 2, 'babka': 1, 'buratino': 1, 'carbide': 2, 'dog': 1, 'holodilnik': 1, 'homing': 1, 'kalash': 1, 'kedy': 2, 'kirpichi': 1,
    'kite': 1, 'korsar': 2, 'kozy': 1, 'kukuruznik': 1, 'kuryu': 1, 'limonka': 1, 'makarov': 2, 'marshrutka': 1, 'mawashi': 2, 'mine': 1,
    'mukha': 1, 'napalm': 1, 'nevidimka': 1, 'obrez': 1, 'ognetushitel': 1, 'pas': 1, 'payalnik': 1, 'pigeon': 1, 'pochta': 1, 'posylka': 1,
    'pulemet': 1, 'rope': 1, 'samogon': 1, 'sling': 2, 'tnt': 1, 'truba': 1, 'tychok': 1, 'ukazka': 2, 'uppercut': 1, 'vanna': 1,
    'zapacanov': 1, 'zontik': 1,
}
ICON_FIX = {'auger': 12, 'mortar': 13, 'otboinik': 11, 'plita': 12, 'ponyatiya': 12, 'rezinka': 13, 'tyidi': 12, 'yagga': 12}
# картинки в мире — WORLD_ART в assets.ts
WORLD = [
    '22-arsenal/cut/world-limonka-1', '22-arsenal/cut/world-carbide-2', '22-arsenal/cut/world-korsar-1', '22-arsenal/cut/world-korsar-2',
    '22-arsenal/cut/world-posylka-1', '22-arsenal/cut/world-samogon-1', '22-arsenal/cut/world-tnt-1', '22-arsenal/cut/world-mine-1',
    '22-arsenal/cut/world-mine-2', '22-arsenal/cut/world-homing-2', '22-arsenal/cut/world-homing-1', '22-arsenal/cut/world-kite-1',
    '22-arsenal/cut/world-pigeon-1', '22-arsenal/cut/world-dog-1', '22-arsenal/cut/world-babka-1', '22-arsenal/cut/world-kozy-1',
    '22-arsenal/cut/world-vanna-1', '22-arsenal/cut/world-kirpichi-2', '22-arsenal/cut/icon-holodilnik-1',
    '23-common/cut/crate-weapon-1', '23-common/cut/crate-health-2', '23-common/cut/crate-utility-1', '23-common/cut/fuel-barrel-2',
    '23-common/cut/gas-cylinder-1', '23-common/cut/target-2',
    '23e-mission-props/cut/prop-can-2', '23e-mission-props/cut/prop-keg-2', '23e-mission-props/cut/prop-boiler-2',
    '23e-mission-props/cut/prop-transformer-2', '23e-mission-props/cut/prop-beehive-2', '23e-mission-props/cut/prop-locomotive-2',
    '23e-mission-props/cut/prop-kiosk-3', '23e-mission-props/cut/prop-hostage-2',
]
# полосы кадров — FX_ART и ANIM_ART
STRIPS = [
    '31-sprites/fx/fx-explosion-s-2-v1', '31-sprites/fx2/fx2-explosion-l-2-v1', '31-sprites/fx/fx-fire-2-v1', '31-sprites/fx/fx-smoke-2-v1',
    '31-sprites/actors/world-dog-1-v1', '31-sprites/actors/world-babka-1-v1', '31-sprites/actors/world-kozy-1-v1',
    '31-sprites/actors/world-pigeon-1-v1', '31-sprites/actors/world-kukuruznik-1-v1',
]
# темы и времена суток — THEME_TIMES в assets.ts
THEME_TIMES = {
    'yard': ['grey', 'night'], 'garages': ['day', 'evening', 'night'], 'construction': ['day', 'evening', 'grey'], 'dacha': ['day', 'evening'],
    'depot': ['evening', 'grey', 'night'], 'dump': ['evening', 'grey'], 'factory': ['evening', 'grey', 'night'], 'heating': ['grey', 'night'],
    'market': ['day', 'evening'], 'school': ['day', 'evening'], 'beach': ['day', 'evening'], 'winter': ['night', 'winter'],
}
BRAND = ['title-keyart-1', 'menu-bg-1', 'menu-bg-2', 'menu-bg-3', 'campaign-map-1', 'brigade-select-bg-1', 'brigade-select-bg-2',
         'loading-1-1', 'loading-2-1', 'loading-3-1', 'loading-4-1']
BRIGADES = ['zatulinka', 'rastochka', 'zaton', 'pervomayka', 'chemskoy', 'leninskiy']


def webp(src: pathlib.Path, rel: str, max_side: int | None = None, q: int = 82) -> int:
    out = DST / (rel + '.webp')
    if out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
        return 0
    out.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src)
    if im.mode not in ('RGB', 'RGBA'):
        im = im.convert('RGBA')
    if max_side and max(im.size) > max_side:
        im.thumbnail((max_side, max_side), Image.LANCZOS)
    im.save(out, 'WEBP', quality=q, method=6)
    return 1


def copy(src: pathlib.Path, dst: pathlib.Path) -> int:
    if dst.exists() and dst.stat().st_size == src.stat().st_size:
        return 0
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return 1


def strip(rel: str) -> int:
    """Полоса кадров: картинка в WebP (без уменьшения — кадры режутся по ширине), json — как есть."""
    n = webp(SRC / f'{rel}.png', rel, None, 85)
    return n + copy(SRC / f'{rel}.json', DST / f'{rel}.json')



def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    want = set(filter(None, a.only.split(','))) or {'icons', 'world', 'fx', 'themes', 'brand', 'atlases', 'music', 'voices', 'sfx'}
    done = 0
    if 'icons' in want:
        for wid, v in ICON_PICK.items():
            done += webp(SRC / f'22-arsenal/cut/icon-{wid}-{v}.png', f'22-arsenal/cut/icon-{wid}-{v}', 160)
        for wid, v in ICON_FIX.items():
            done += webp(SRC / f'22b-arsenal-fix/cut/icon-{wid}-{v}.png', f'22b-arsenal-fix/cut/icon-{wid}-{v}', 160)
    if 'world' in want:
        for rel in WORLD:
            done += webp(SRC / f'{rel}.png', rel, 256)
    if 'fx' in want:
        for rel in STRIPS:
            done += strip(rel)
    if 'themes' in want:
        for th, times in THEME_TIMES.items():
            done += webp(SRC / f'21-themes/seamless/{th}-ground-1.png', f'21-themes/seamless/{th}-ground-1', 1024, 85)
            for t in times:
                for layer in ('far', 'near'):
                    done += webp(SRC / f'21-themes/{th}-{layer}-{t}-1.png', f'21-themes/{th}-{layer}-{t}-1', 2048, 80)
    if 'brand' in want:
        for name in BRAND:
            done += webp(SRC / f'20-brand/{name}.png', f'20-brand/{name}', 1920, 80)
    if 'atlases' in want:
        for b in BRIGADES:
            src = SRC / f'28-anims/{b}-atlas.json'
            meta = json.loads(src.read_text(encoding='utf-8'))
            meta['meta']['image'] = f'{b}-atlas.webp'
            out = DST / f'28-anims/{b}-atlas.json'
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(meta, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
            done += copy(SRC / f'28-anims/{b}-atlas.webp', DST / f'28-anims/{b}-atlas.webp')
    if 'music' in want:
        for f in sorted(MUSIC.glob('*.ogg')):
            done += copy(f, DST / 'music' / f.name)
    if 'voices' in want:
        vdir = SRC / '33-voices-qwen'
        picks = json.loads((vdir / 'picks.json').read_text(encoding='utf-8'))
        for phrase, wav in picks.items():
            s, name = wav.split('/')
            ogg = name.replace('.wav', '.ogg')
            done += copy(vdir / s / 'ogg' / ogg, DST / f'33-voices-qwen/{s}/ogg/{ogg}')
        done += copy(vdir / 'picks.json', DST / '33-voices-qwen/picks.json')
    if 'sfx' in want:
        for d in ('08-sfx', '26-sfx-arsenal'):
            for f in sorted((SRC / d / 'ogg').glob('*.ogg')):
                done += copy(f, DST / d / 'ogg' / f.name)
    total = sum(f.stat().st_size for f in DST.rglob('*') if f.is_file())
    print(f'обновлено файлов: {done}; в public/gops/a — {total / 1e6:.1f} МБ')


if __name__ == '__main__':
    main()
