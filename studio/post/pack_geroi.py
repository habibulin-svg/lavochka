"""Сборка ассетов «Героев» для игры: отобранное с выхода конвейера → lavochka/public/geroi/a/ (Git LFS).

G:/ai/ComfyUI/venv/Scripts/python.exe -X utf8 studio/post/pack_geroi.py [--only map,mounts,towns,brand,creatures,fields,obstacles,icons,heroes,music,sfx,fonts]

Выбор — studio/jobs/geroi/picks.json (партия → пункт → сид; переделка <партия>-redo[N] важнее партии). Существа — один атлас на существо (кадр как в рендере: 320 px, старшие ступени 400 px, анимации по строкам)
и JSON рядом; поля — WebP 1536; иконки и портреты — WebP; музыка и звуки — Opus. Готовое не пересчитывается (тест tests/geroi/assets.test.ts сверяет ссылки игры с этой папкой).
Препятствия лежат на сером фоне: перед упаковкой — runners/cutout.py (папка 14-battle/cut).
"""
import argparse
import json
import pathlib
import shutil
import subprocess

from PIL import Image

SRC = pathlib.Path('G:/temp/studio/out/geroi')
ROOT = pathlib.Path(__file__).resolve().parents[2]
DST = ROOT / 'lavochka/public/geroi/a'
FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
PICKS = json.loads((ROOT / 'studio/jobs/geroi/picks.json').read_text(encoding='utf8'))
ORDER = ['idle', 'move', 'shoot', 'hit', 'defend', 'death']
# треки «Арены»: меню и бой (проба 02 + партия 18), имя в игре → файл на выходе конвейера
MUSIC = {
    'menu': '02-music-proba/menu', 'menu-vox': '02-music-proba/menu-vox', 'battle': '02-music-proba/battle',
    'battle-b': '18-music/battle-b', 'battle-c': '18-music/battle-c', 'victory': '18-music/victory', 'defeat': '18-music/defeat',
    # карта и замки (этап 3)
    'map': '02-music-proba/map', 'map-swamp': '18-music/map-swamp', 'map-ash': '18-music/map-ash', 'map-pine': '18-music/map-pine', 'siege': '18-music/siege',
    'town-zatulye': '02-music-proba/zatulye', 'town-zatonye': '02-music-proba/zatonye', 'town-kuznya': '18-music/town-kuznya', 'town-akademiya': '18-music/town-akademiya',
    # вторая волна (платная часть, партия 38)
    **{n: f'38-music/{n}' for n in ('town-plotina', 'town-ostrog', 'town-bazar', 'town-kurgany', 'map-coast', 'map-snow', 'map-saltflat', 'map-heath', 'battle-d')},
}
GROUNDS = ['meadow', 'swamp', 'ash', 'pine', 'rough', 'sand', 'water', 'underground', 'road-dirt', 'road-stone', 'road-plank']
FACTIONS = ['zatulye', 'zatonye', 'kuznya', 'akademiya']
# вторая волна (платная часть): партии 30–39 (studio/jobs/geroi/make_jobs_w2.py)
FACTIONS2 = ['plotina', 'ostrog', 'bazar', 'kurgany']
GROUNDS2 = ['coast', 'snow', 'saltflat', 'heath']


def wave2(batch: str) -> bool:
    """Партия второй волны отобрана (есть в picks.json): до отбора её шаги пропускаются."""
    return batch in PICKS
# герой на коне: кадр рендера 256 px, 8 направлений, в ряд idle (8) + move (8)
MOUNT_FRAME = 256


def pick_file(batch: str, name: str, cut: bool = False) -> pathlib.Path:
    """Файл выбранного варианта: последняя переделка, где есть этот пункт, иначе сама партия."""
    keys = sorted((k for k in PICKS if k == batch or k.startswith(batch + '-redo')), key=lambda k: (k != batch, k), reverse=True)
    for k in keys:
        if name in PICKS[k]:
            seed = PICKS[k][name]
            base = SRC / k
            return (base / 'cut' if cut else base) / f'{name}-{seed}.png'
    raise SystemExit(f'нет выбора для {batch}/{name}')


def webp(src: pathlib.Path, dst: pathlib.Path, width: int | None = None, q: int = 86) -> None:
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src)
    if width and im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(dst, 'WEBP', quality=q, method=6)


def creatures() -> None:
    out = DST / 'creatures'
    out.mkdir(parents=True, exist_ok=True)
    # только нынешний состав: снятые с игры существа (сомы, киты) лежат на выходе конвейера
    names = {c['name'] for f in ('creatures.json', 'creatures-w2.json') for c in json.loads((ROOT / f'studio/jobs/geroi/{f}').read_text(encoding='utf8'))}
    for d in sorted((SRC / '20-creature-3d').iterdir()):
        meta_file = d / 'frames/meta.json'
        if d.name not in names or not meta_file.exists():
            continue
        dst = out / f'{d.name}.webp'
        meta = json.loads(meta_file.read_text(encoding='utf8'))
        info_file = out / f'{d.name}.json'
        same_size = info_file.exists() and json.loads(info_file.read_text(encoding='utf8'))['frame'] == meta['frameW']
        if dst.exists() and same_size and dst.stat().st_mtime >= meta_file.stat().st_mtime:
            continue
        # кадр — как отрисован, без ужатия: иначе старшие ступени на поле растягиваются и мылятся
        FRAME = meta['frameW']
        rows = [a for a in ORDER if a in meta['anims']]
        cols = max(meta['anims'][a]['frames'] for a in rows)
        sheet = Image.new('RGBA', (cols * FRAME, len(rows) * FRAME), (0, 0, 0, 0))
        for y, a in enumerate(rows):
            for x in range(meta['anims'][a]['frames']):
                fr = Image.open(d / f'frames/{a}_{x:02d}.png').convert('RGBA')
                sheet.paste(fr, (x * FRAME, y * FRAME))
        sheet.save(dst, 'WEBP', quality=88, method=6, alpha_quality=90)
        info = {'frame': FRAME, 'origin': meta['origin'], 'muzzle': meta['muzzle'], 'top': meta['top'],
                'anims': {a: {'row': i, **meta['anims'][a]} for i, a in enumerate(rows)}}
        (out / f'{d.name}.json').write_text(json.dumps(info), encoding='utf8')
        print('существо', d.name, dst.stat().st_size // 1024, 'КБ', flush=True)


def fields() -> None:
    for name in ('meadow', 'swamp', 'ash', 'pine', 'ford', 'crater'):
        webp(pick_file('14-battle', f'field-{name}'), DST / f'fields/{name}.webp')
    if wave2('34-battle'):
        for name in ('coast', 'snow', 'saltflat', 'heath', 'heart', 'darkkeep'):
            webp(pick_file('34-battle', f'field-{name}'), DST / f'fields/{name}.webp')


def obstacles() -> None:
    for i in range(1, 11):
        webp(pick_file('14-battle', f'obstacle-{i}', cut=True), DST / f'obstacles/{i}.webp', width=256)
    if wave2('34-battle'):
        for i in range(11, 17):
            webp(pick_file('34-battle', f'obstacle-{i}', cut=True), DST / f'obstacles/{i}.webp', width=256)
        for t in ('trap-pepper', 'trap-pit', 'trap-mirage'):
            webp(pick_file('34-battle', t, cut=True), DST / f'obstacles/{t}.webp', width=256)


def icons() -> None:
    for sc in ('fire', 'water', 'earth', 'air'):
        for i in range(1, 11):
            webp(pick_file('15-icons', f'spell-{sc}-{i:02d}'), DST / f'icons/spell-{sc}-{i:02d}.webp', width=128)
    for i in range(1, 11):
        webp(pick_file('15-icons', f'stat-{i:02d}'), DST / f'icons/stat-{i:02d}.webp', width=96)
    for i in range(1, 61):
        webp(pick_file('15-icons', f'art-{i:02d}'), DST / f'icons/art-{i:02d}.webp', width=128)
    for i in range(1, 25):
        webp(pick_file('15-icons', f'skill-{i:02d}'), DST / f'icons/skill-{i:02d}.webp', width=96)
    for r in ('semki', 'wood', 'stone', 'amber', 'salt', 'stariron', 'resin'):
        webp(pick_file('15-icons', f'icon-{r}'), DST / f'icons/icon-{r}.webp', width=96)
    if wave2('35-icons'):
        for name in PICKS['35-icons']:
            webp(pick_file('35-icons', name), DST / f'icons/{name}.webp', width=128 if name.startswith('art-') else 96)


def heroes() -> None:
    for name in PICKS['11-heroes']:
        webp(pick_file('11-heroes', name), DST / f'heroes/{name}.webp', width=320)
    # вторая волна: пацаны в нарядах своих краёв заменяют прежние портреты «в куртке»
    for name in PICKS.get('31-heroes', {}):
        webp(pick_file('31-heroes', name), DST / f'heroes/{name}.webp', width=320)


def mapping() -> None:
    """Карта: грунты бесшовно (резка по шву), объекты и декор — вырезанные."""
    tmp = pathlib.Path('G:/temp/geroi-seamless')
    tmp.mkdir(parents=True, exist_ok=True)
    for g in GROUNDS:
        src = pick_file('13-map', f'ground-{g}')
        mid = tmp / f'{g}.png'
        if not mid.exists():
            subprocess.run(['python', '-X', 'utf8', str(ROOT / 'studio/post/seamless.py'), str(src), str(mid)], check=True)
        webp(mid, DST / f'map/ground-{g}.webp', q=80)
    sizes = {'res-': 180, 'obj-': 400, 'decor-': 280, 'mountain-': 720}
    for name in PICKS['13-map']:
        if name.startswith('ground-'):
            continue
        width = next(v for k, v in sizes.items() if name.startswith(k))
        webp(pick_file('13-map', name, cut=True), DST / f'map/{name}.webp', width=width)
    for f in FACTIONS:
        webp(pick_file('12-towns', f'map-town-{f}', cut=True), DST / f'map/town-{f}.webp', width=720)
    if wave2('33-map'):
        for g in GROUNDS2:
            src = pick_file('33-map', f'ground-{g}')
            mid = tmp / f'{g}.png'
            if not mid.exists():
                subprocess.run(['python', '-X', 'utf8', str(ROOT / 'studio/post/seamless.py'), str(src), str(mid)], check=True)
            webp(mid, DST / f'map/ground-{g}.webp', q=80)
        for name in PICKS['33-map']:
            if not name.startswith('ground-'):
                width = next(v for k, v in sizes.items() if name.startswith(k))
                webp(pick_file('33-map', name, cut=True), DST / f'map/{name}.webp', width=width)
    if wave2('32-towns'):
        for f in FACTIONS2 + ['dark']:
            webp(pick_file('32-towns', f'map-town-{f}', cut=True), DST / f'map/town-{f}.webp', width=720)


def mounts() -> None:
    out = DST / 'mounts'
    out.mkdir(parents=True, exist_ok=True)
    for d in sorted((SRC / '21-mounts-3d').iterdir()):
        meta_file = d / 'frames/meta.json'
        if not meta_file.exists():
            continue
        name = d.name.removeprefix('mount-')
        dst = out / f'{name}.webp'
        if dst.exists() and dst.stat().st_mtime >= meta_file.stat().st_mtime:
            continue
        meta = json.loads(meta_file.read_text(encoding='utf8'))
        k = MOUNT_FRAME / meta['frameW']
        sheet = Image.new('RGBA', (16 * MOUNT_FRAME, meta['dirs'] * MOUNT_FRAME), (0, 0, 0, 0))
        for dir_ in range(meta['dirs']):
            for a, shift in (('idle', 0), ('move', 8)):
                for i in range(8):
                    fr = Image.open(d / f'frames/{a}_d{dir_}_{i:02d}.png').convert('RGBA')
                    if fr.width != MOUNT_FRAME:
                        fr = fr.resize((MOUNT_FRAME, MOUNT_FRAME), Image.LANCZOS)
                    sheet.paste(fr, ((shift + i) * MOUNT_FRAME, dir_ * MOUNT_FRAME))
        sheet.save(dst, 'WEBP', quality=86, method=6, alpha_quality=90)
        (out / f'{name}.json').write_text(json.dumps({'frame': MOUNT_FRAME, 'origin': [meta['origin'][0] * k, meta['origin'][1] * k], 'top': [meta['top'][0] * k, meta['top'][1] * k]}), encoding='utf8')
        print('конь', name, dst.stat().st_size // 1024, 'КБ', flush=True)


def siege() -> None:
    for f in FACTIONS:
        for part in ('wall', 'gate', 'tower'):
            webp(pick_file('14b-siege', f'{part}-{f}', cut=True), DST / f'siege/{part}-{f}.webp', width=320)
    if wave2('34-battle'):
        for f in FACTIONS2 + ['dark']:
            for part in ('wall', 'gate', 'tower'):
                webp(pick_file('34-battle', f'{part}-{f}', cut=True), DST / f'siege/{part}-{f}.webp', width=320)


def towns() -> None:
    for f in FACTIONS:
        webp(pick_file('12-towns', f'town-{f}-site'), DST / f'towns/{f}-site.webp', q=84)
    for name in PICKS['12-towns']:
        if name.startswith('bld-'):
            webp(pick_file('12-towns', name, cut=True), DST / f'towns/{name[4:]}.webp', width=480)
    if wave2('32-towns'):
        for f in FACTIONS2:
            webp(pick_file('32-towns', f'town-{f}-site'), DST / f'towns/{f}-site.webp', q=84)
        webp(pick_file('32-towns', 'town-dark-full'), DST / 'towns/dark-full.webp', q=84)
        for name in sorted({*PICKS['32-towns'], *PICKS.get('32-towns-redo', {})}):
            if name.startswith('bld-'):
                webp(pick_file('32-towns', name, cut=True), DST / f'towns/{name[4:]}.webp', width=480)


def brand() -> None:
    webp(pick_file('16-cutscene-keys', 'intro-6'), DST / 'brand/title.webp', width=1920)


def opus(src: pathlib.Path, dst: pathlib.Path, rate: str) -> None:
    if dst.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', str(src), '-vn', '-c:a', 'libopus', '-b:a', rate, str(dst)], check=True)


def music() -> None:
    for name, rel in MUSIC.items():
        batch, track = rel.split('/')
        pick = PICKS.get(batch, {}).get(track)
        seed = pick if pick else 11
        opus(SRC / batch / f'{track}-{seed}.flac', DST / f'music/{name}.ogg', '96k')


def sfx() -> None:
    picks = {**PICKS['19-sfx'], **PICKS.get('19-sfx-redo', {}), **PICKS.get('39-sfx', {})}
    for name, take in sorted(picks.items()):
        for batch in ('19-sfx-redo', '19-sfx', '39-sfx'):
            src = SRC / batch / 'ogg' / f'{name}-{take}.ogg'
            if name in PICKS.get(batch, {}) and src.exists():
                dst = DST / f'sfx/{name}.ogg'
                dst.parent.mkdir(parents=True, exist_ok=True)
                if not dst.exists():
                    shutil.copyfile(src, dst)
                break
        else:
            print('нет звука', name)


STEPS = {'siege': siege, 'map': mapping, 'mounts': mounts, 'towns': towns, 'brand': brand, 'creatures': creatures, 'fields': fields, 'obstacles': obstacles, 'icons': icons, 'heroes': heroes, 'music': music, 'sfx': sfx}

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default=','.join(STEPS))
    for step in ap.parse_args().only.split(','):
        print('==', step, flush=True)
        STEPS[step]()
