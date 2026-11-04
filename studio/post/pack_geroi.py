"""Сборка ассетов «Героев» для игры: отобранное с выхода конвейера → lavochka/public/geroi/a/ (Git LFS).

G:/ai/ComfyUI/venv/Scripts/python.exe -X utf8 studio/post/pack_geroi.py [--only brand,creatures,fields,obstacles,icons,heroes,music,sfx,fonts]

Выбор — studio/jobs/geroi/picks.json (партия → пункт → сид; переделка <партия>-redo[N] важнее партии). Существа — один атлас на существо (кадр 240 px, анимации по строкам)
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
FRAME = 240
ORDER = ['idle', 'move', 'shoot', 'hit', 'defend', 'death']
# треки «Арены»: меню и бой (проба 02 + партия 18), имя в игре → файл на выходе конвейера
MUSIC = {
    'menu': '02-music-proba/menu', 'menu-vox': '02-music-proba/menu-vox', 'battle': '02-music-proba/battle',
    'battle-b': '18-music/battle-b', 'battle-c': '18-music/battle-c', 'victory': '18-music/victory', 'defeat': '18-music/defeat',
}


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
    for d in sorted((SRC / '20-creature-3d').iterdir()):
        meta_file = d / 'frames/meta.json'
        if not meta_file.exists():
            continue
        dst = out / f'{d.name}.webp'
        if dst.exists() and dst.stat().st_mtime >= meta_file.stat().st_mtime:
            continue
        meta = json.loads(meta_file.read_text(encoding='utf8'))
        k = FRAME / meta['frameW']
        rows = [a for a in ORDER if a in meta['anims']]
        cols = max(meta['anims'][a]['frames'] for a in rows)
        sheet = Image.new('RGBA', (cols * FRAME, len(rows) * FRAME), (0, 0, 0, 0))
        for y, a in enumerate(rows):
            for x in range(meta['anims'][a]['frames']):
                fr = Image.open(d / f'frames/{a}_{x:02d}.png').convert('RGBA').resize((FRAME, FRAME), Image.LANCZOS)
                sheet.paste(fr, (x * FRAME, y * FRAME))
        sheet.save(dst, 'WEBP', quality=88, method=6, alpha_quality=90)
        scale = lambda p: [round(p[0] * k, 1), round(p[1] * k, 1)]  # noqa: E731
        info = {'frame': FRAME, 'origin': scale(meta['origin']), 'muzzle': scale(meta['muzzle']), 'top': scale(meta['top']),
                'anims': {a: {'row': i, **meta['anims'][a]} for i, a in enumerate(rows)}}
        (out / f'{d.name}.json').write_text(json.dumps(info), encoding='utf8')
        print('существо', d.name, dst.stat().st_size // 1024, 'КБ', flush=True)


def fields() -> None:
    for name in ('meadow', 'swamp', 'ash', 'pine', 'ford', 'crater'):
        webp(pick_file('14-battle', f'field-{name}'), DST / f'fields/{name}.webp')


def obstacles() -> None:
    for i in range(1, 11):
        webp(pick_file('14-battle', f'obstacle-{i}', cut=True), DST / f'obstacles/{i}.webp', width=256)


def icons() -> None:
    for sc in ('fire', 'water', 'earth', 'air'):
        for i in range(1, 11):
            webp(pick_file('15-icons', f'spell-{sc}-{i:02d}'), DST / f'icons/spell-{sc}-{i:02d}.webp', width=128)
    for i in range(1, 11):
        webp(pick_file('15-icons', f'stat-{i:02d}'), DST / f'icons/stat-{i:02d}.webp', width=96)


def heroes() -> None:
    for name in PICKS['11-heroes']:
        webp(pick_file('11-heroes', name), DST / f'heroes/{name}.webp', width=320)


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
    picks = {**PICKS['19-sfx'], **PICKS.get('19-sfx-redo', {})}
    for name, take in sorted(picks.items()):
        for batch in ('19-sfx-redo', '19-sfx'):
            src = SRC / batch / 'ogg' / f'{name}-{take}.ogg'
            if name in PICKS.get(batch, {}) and src.exists():
                dst = DST / f'sfx/{name}.ogg'
                dst.parent.mkdir(parents=True, exist_ok=True)
                if not dst.exists():
                    shutil.copyfile(src, dst)
                break
        else:
            print('нет звука', name)


STEPS = {'brand': brand, 'creatures': creatures, 'fields': fields, 'obstacles': obstacles, 'icons': icons, 'heroes': heroes, 'music': music, 'sfx': sfx}

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default=','.join(STEPS))
    for step in ap.parse_args().only.split(','):
        print('==', step, flush=True)
        STEPS[step]()
