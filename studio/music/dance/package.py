"""Упаковка кита для сайта: WAV из G:/temp/studio/out/music-studio/<источник>/<bpm> → Opus в
lavochka/public/music-studio/dance/<bpm>/<группа>/<имя>.ogg и общий kit.json.

G:/ai/venvs/music/Scripts/python.exe studio/music/dance/package.py [источник=kit]
Старые .ogg, которых нет в новом ките, удаляются.
"""
import json
import pathlib
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parents[3]
FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
DST = ROOT / 'lavochka/public/music-studio/dance'
BPMS = (128, 140)
GROUPS = ['loop', 'drum', 'bass', 'layer', 'keys', 'seq', 'synth', 'fx', 'rap', 'voice']
STARS = {'Am': 1, 'F': 2, 'C': 3, 'G': 4}


def slug(name):
    s = name.lower().replace('*', 's').replace('&', 'and')
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def enc(src, dst, kbps):
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', str(src), '-c:a', 'libopus', '-b:a', f'{kbps}k',
                    '-vbr', 'on', '-application', 'audio', str(dst)], check=True)


def main(source='kit'):
    src = pathlib.Path('G:/temp/studio/out/music-studio') / source
    mans = {b: json.loads((src / str(b) / 'manifest.json').read_text(encoding='utf-8')) for b in BPMS}
    names = [e['name'] for e in mans[BPMS[0]]]
    assert all([e['name'] for e in mans[b]] == names for b in BPMS), 'наборы темпов разошлись'
    samples, jobs = [], []
    for i, e in enumerate(mans[BPMS[0]]):
        fam = e.get('family', re.sub(r' \*+$', '', e['name']) if e['chord'] else None)
        sid = slug(e['name'])
        extra = {k: e[k] for k in ('style', 'theme', 'text', 'lang') if e.get(k)}
        samples.append(dict(id=sid, name=e['name'], group=e['group'], bars=e['bars'], loop=e['loop'],
                            chord=e['chord'], star=STARS.get(e['chord'], 0), family=fam, **extra))
        for b in BPMS:
            m = mans[b][i]
            kb = 64 if m['group'] in ('rap', 'fx', 'drum') else 96
            jobs.append((src / str(b) / m['file'], DST / str(b) / m['group'] / f'{sid}.ogg', kb))
    ids = [x['id'] for x in samples]
    assert len(ids) == len(set(ids)), sorted({x for x in ids if ids.count(x) > 1})
    keep = {j[1].resolve() for j in jobs}
    for p in DST.rglob('*.ogg'):
        if p.resolve() not in keep:
            p.unlink()
    jobs = [j for j in jobs if not j[1].exists() or j[1].stat().st_mtime < j[0].stat().st_mtime]
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda j: enc(*j), jobs))
    samples.sort(key=lambda s: (GROUPS.index(s['group']), s['family'] or s['name'], s['star']))
    kit = dict(id='dance', title='Dance With Me!', key='Am', chords=['Am', 'F', 'C', 'G'], bpms=list(BPMS),
               groups=GROUPS, samples=samples)
    (DST / 'kit.json').write_text(json.dumps(kit, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    size = sum(p.stat().st_size for p in DST.rglob('*.ogg'))
    by = {}
    for x in samples:
        by[x['group']] = by.get(x['group'], 0) + 1
    print(f'{len(samples)} сэмплов × {len(BPMS)} темпа, {size / 1e6:.1f} МБ → {DST}', by)


if __name__ == '__main__':
    main(*sys.argv[1:])
