"""Сборка кита «Dance With Me!»: рендер всех сэмплов из kit/*.py в двух темпах + случайные миксы по правилам.

G:/ai/venvs/music/Scripts/python.exe studio/music/dance/build.py [--bpm 128,140] [--only имя,имя] [--group bass]
    [--force] [--jobs 6] [--mixes 4] [--mix-only]
Пишет G:/temp/studio/out/music-studio/kit/<bpm>/<группа>/<имя>.wav и manifest.json. Готовые WAV не пересчитываются
(кроме --force и --only). Голоса (группы rap, voice) добавляет voices.py — их строки в manifest.json сохраняются.
"""
import argparse
import json
import pathlib
import random
import sys
import time
from multiprocessing import Pool

import numpy as np
import soundfile as sf
from pedalboard import Compressor, Limiter, Pedalboard

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
OUT = pathlib.Path('G:/temp/studio/out/music-studio/kit')
SR = 44100
VOICE_GROUPS = ('rap', 'voice')


def slug(name):
    import re
    s = name.lower().replace('*', 's').replace('&', 'and')
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def entry(s, d=None):
    from kit import chord_name
    e = dict(group=s['group'], name=s['name'], bars=s['bars'], loop=s['loop'], chord=chord_name(s['star']),
             family=s['family'], theme=s['theme'], style=s['style'], file=f"{s['group']}/{slug(s['name'])}.wav")
    return e


def _work(job):
    i, bpm, force = job
    from kit import all_samples
    from render import LUFS, loudnorm, render_one
    s = all_samples()[i]
    e = entry(s)
    f = OUT / str(bpm) / e['file']
    if f.exists() and not force:
        return e, False, ''
    try:
        a = loudnorm(render_one(s, bpm), LUFS[s['group']])
    except Exception as ex:  # noqa: BLE001
        return e, False, f'{type(ex).__name__}: {ex}'
    f.parent.mkdir(parents=True, exist_ok=True)
    sf.write(f, a.T, SR, subtype='PCM_16')
    return e, True, ''


def build(bpm, only, groups, force, jobs):
    from kit import all_samples
    sams = all_samples()
    idx = [i for i, s in enumerate(sams) if (not only or s['name'] in only) and (not groups or s['group'] in groups)]
    d = OUT / str(bpm)
    d.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    errs = []
    with Pool(jobs) as pool:
        for k, (e, done, err) in enumerate(pool.imap(_work, [(i, bpm, force or bool(only)) for i in idx], chunksize=2)):
            if err:
                errs.append((e['name'], err))
                print('ОШИБКА', e['name'], err, flush=True)
            elif done and k % 25 == 0:
                print(f'{bpm} {k}/{len(idx)} {e["group"]} {e["name"]}  {time.time() - t0:.0f} с', flush=True)
    # манифест: все инструментальные сэмплы в порядке кита + голоса из прежнего манифеста
    man = [entry(s) for s in sams if (d / entry(s)['file']).exists()]
    mf = d / 'manifest.json'
    if mf.exists():
        man += [e for e in json.loads(mf.read_text(encoding='utf-8')) if e['group'] in VOICE_GROUPS]
    mf.write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'{bpm}: {len(man)} сэмплов в манифесте, ошибок {len(errs)}, {time.time() - t0:.0f} с')
    return man


# ── случайный микс по правилам: как собрал бы человек, гармония по 2 такта на аккорд ──
STARS = ['*', '**', '***', '****']


def mix(bpm, man, seed):
    r = random.Random(seed)
    d = OUT / str(bpm)
    beat = 60 / bpm
    bar_n = 4 * beat * SR
    total = 40
    out = np.zeros((2, int(bar_n * total) + 4 * SR), np.float32)
    style = ['euro', 'house', 'trance', 'dream'][(seed - 1) % 4]
    by = {e['name']: e for e in man}
    cache = {}

    def load(name):
        if name not in cache:
            a, _ = sf.read(d / by[name]['file'], dtype='float32')
            cache[name] = a.T if a.ndim > 1 else np.stack([a, a])
        return cache[name]

    def put(name, bar, gain=1.0, times=1):
        a = load(name)
        for k in range(times):
            s = int(round((bar + k * by[name]['bars']) * bar_n))
            m = min(a.shape[1], out.shape[1] - s)
            out[:, s:s + m] += a[:, :m] * gain

    def fam(group, cut=False):
        fams = sorted({e['family'] for e in man if e['group'] == group and e['chord'] and e['style'] == style
                       and (' Cut' in e['family']) == cut and 'Reverse' not in e['family']})
        if not fams:
            fams = sorted({e['family'] for e in man if e['group'] == group and e['chord'] and ' Cut' not in e['family']
                           and 'Reverse' not in e['family']})
        return r.choice(fams)

    def prog(family, start, bars, gain=1.0):
        for k in range(bars // 2):
            put(f'{family} {STARS[k % 4]}', start + 2 * k, gain)

    def pick(group, pred=lambda e: True):
        c = [e['name'] for e in man if e['group'] == group and pred(e)]
        return r.choice(c) if c else None

    loops = [e['name'] for e in man if e['group'] == 'loop' and e['loop'] and e['style'] == style]
    groove = r.choice([x for x in loops if 'Grp.5' in x or 'Grp.6' in x] or loops)
    intro = r.choice([x for x in loops if 'Grp.1' in x or 'Grp.2' in x] or loops)
    fill = pick('loop', lambda e: not e['loop'] and e['style'] == style)
    bass, pad, keys, seq, syn = fam('bass'), fam('layer'), fam('keys'), fam('seq'), fam('synth')
    crash = pick('drum', lambda e: e['name'].startswith('Crash') and 'Reverse' not in e['name'])
    riser = pick('fx', lambda e: e['name'].startswith('Riser') and e['bars'] == 4) or 'Riser Long'
    put(intro, 0, times=4)
    prog(pad, 0, 8, 0.9)
    put(riser, 4)
    put(crash, 8)
    put(groove, 8, times=8)
    prog(bass, 8, 16)
    prog(keys, 8, 16, 0.8)
    prog(pad, 16, 8, 0.8)
    if fill:
        put(fill, 23)
    put(crash, 24)
    prog(pad, 24, 8)
    prog(seq, 24, 8)
    put(riser, 28)
    put(crash, 32)
    put(groove, 32, times=4)
    prog(bass, 32, 8)
    prog(syn, 32, 8, 0.8)
    prog(seq, 32, 8, 0.8)
    raps = [e['name'] for e in man if e['group'] == 'rap']
    if raps:
        for bar in (7, 15, 31, 36):
            put(r.choice(raps), bar, 0.9)
    out = Pedalboard([Compressor(-12, 2, 10, 120), Limiter(-3.0)])(out, SR)
    out *= 0.93 / max(np.abs(out).max(), 1e-9)
    f = OUT / f'mix-{bpm}-{seed}-{style}.wav'
    sf.write(f, out.T, SR, subtype='PCM_16')
    print('mix', f.name, '|', groove, '|', bass, '|', pad, '|', keys, '|', seq, '|', syn)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--group', default='')
    ap.add_argument('--bpm', default='128,140')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--jobs', type=int, default=6)
    ap.add_argument('--mixes', type=int, default=4)
    ap.add_argument('--mix-only', action='store_true')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    only = set(x.strip() for x in a.only.split(',') if x.strip())
    groups = set(x.strip() for x in a.group.split(',') if x.strip())
    for bpm in [int(x) for x in a.bpm.split(',')]:
        if a.mix_only:
            man = json.loads((OUT / str(bpm) / 'manifest.json').read_text(encoding='utf-8'))
        else:
            man = build(bpm, only, groups, a.force, a.jobs)
        if not only and not groups:
            for k in range(a.mixes):
                mix(bpm, man, k + 1)


if __name__ == '__main__':
    main()
