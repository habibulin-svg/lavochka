"""Звук-прототип Lavochka Music Studio «Dance With Me!»: ~45 сэмплов в двух темпах (128 и 140) + случайные миксы.

Правила стыковки (docs/music-studio/DESIGN.md §3):
  ля минор, последовательность Am – F – C – G = звёздочки * ** *** ****;
  длина ровно 1/2/4/8 тактов; петли рендерятся двумя кругами и берётся второй — хвосты заворачиваются в начало;
  бас, пэды, клавиши и секвенции «качаются» от бочки (сайдчейн вшит); громкость выровнена по группам (LUFS).

G:/ai/venvs/music/Scripts/python.exe studio/music/dance/proto.py [--only имя,имя] [--bpm 128]
Пишет G:/temp/studio/out/music-studio/proto/<bpm>/<группа>/<имя>.wav, manifest.json, mix-*.wav.
"""
import argparse
import json
import pathlib
import random
import sys

import numpy as np
import pyloudnorm
import soundfile as sf
from pedalboard import (Chorus, Compressor, Delay, Gain, HighpassFilter, Limiter, LowpassFilter, Pedalboard,
                        Reverb)
from scipy.signal import butter, lfilter

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import synths  # noqa: E402

SR = synths.SR
OUT = pathlib.Path('G:/temp/studio/out/music-studio/proto')
rng = np.random.default_rng(1997)

# ── гармония ────────────────────────────────────────────────────────────────
STARS = ['*', '**', '***', '****']
CHORDS = [  # имя, корень баса (MIDI), аккорд в средней октаве (плавное ведение голосов)
    ('Am', 33, [57, 60, 64]),
    ('F', 29, [57, 60, 65]),
    ('C', 36, [55, 60, 64]),
    ('G', 31, [55, 59, 62]),
]


def tones(ci):
    """Звуки аккорда по возрастанию в одной октаве от корня: [корень, терция, квинта]."""
    root = CHORDS[ci][1] % 12
    third = 3 if CHORDS[ci][0].endswith('m') else 4
    return [root, root + third, root + 7]


# ── ударные: синтез 909-типа (бочка настроена в A1 — 55 Гц) ─────────────────
def _bp(x, f1, f2):
    b, a = butter(2, [f1 / (SR / 2), f2 / (SR / 2)], 'band')
    return lfilter(b, a, x)


def _hp(x, fc):
    b, a = butter(2, fc / (SR / 2), 'high')
    return lfilter(b, a, x)


def d_kick(v=1.0):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 55 + 140 * np.exp(-t * 30)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5.5)
    click = rng.standard_normal(n) * np.exp(-t * 1200) * 0.35
    return np.tanh((body + click) * 1.8) * v


def d_clap(v=1.0):
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    env = np.zeros(n)
    for off in (0, 0.009, 0.019, 0.027):
        k = t >= off
        env[k] += np.exp(-(t[k] - off) * (220 if off < 0.025 else 16))
    return _bp(rng.standard_normal(n) * env, 850, 2800) * 1.8 * v


def d_snare(v=1.0):
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * (180 + 40 * np.exp(-t * 60)) * t) * np.exp(-t * 30)
    noise = _bp(rng.standard_normal(n), 1800, 9000) * np.exp(-t * 22)
    return (tone * 0.6 + noise * 0.9) * v


def d_hat(v=1.0, decay=0.035):
    n = int(decay * 6 * SR)
    t = np.arange(n) / SR
    metal = sum(np.sign(np.sin(2 * np.pi * f * t)) for f in (205.3, 304.4, 369.6, 522.7, 540, 800))
    x = _hp(metal * 0.15 + rng.standard_normal(n) * 0.6, 7500)
    return x * np.exp(-t / decay) * v


def d_shaker(v=1.0):
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    env = np.minimum(t / 0.012, 1) * np.exp(-t * 45)
    return _bp(rng.standard_normal(n), 4500, 12000) * env * v


def d_tamb(v=1.0):
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    jingles = sum(np.sin(2 * np.pi * f * t) for f in (6100, 7350, 8900, 10400))
    return _hp(jingles * 0.3 + rng.standard_normal(n), 5000) * np.exp(-t * 14) * v


def d_crash(v=1.0):
    n = int(2.6 * SR)
    t = np.arange(n) / SR
    metal = sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) for f in rng.uniform(3000, 12000, 40))
    return _hp(metal * 0.05 + rng.standard_normal(n), 3500) * np.exp(-t / 0.8) * v


def d_conga(v=1.0, f0=220):
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * (f0 + 60 * np.exp(-t * 50)) * t) * np.exp(-t * 14) * v


DRUM = {'k': d_kick, 'c': d_clap, 's': d_snare, 'h': d_hat, 'o': lambda v: d_hat(v, 0.16), 'r': d_shaker,
        't': d_tamb, 'x': d_crash, 'g': lambda v: d_conga(v, 220), 'G': lambda v: d_conga(v, 330)}
DRUM_PAN = {'h': 0.25, 'o': -0.15, 'r': 0.35, 't': -0.3, 'g': -0.4, 'G': 0.4}


def drums(grid, beat, bars, swing=0.0):
    """grid: {'k': 'x...x...x...x...', ...} — 16 шагов на такт (строка повторяется до bars тактов).
    Знаки: x — удар, X — акцент, - — тихо. Возвращает моно-пары (L, R)."""
    n = int(round(bars * 4 * beat * SR))
    out = np.zeros((2, n + 3 * SR))
    for kind, pat in grid.items():
        steps = len(pat)
        total = bars * 16
        for i in range(total):
            ch = pat[i % steps]
            if ch == '.':
                continue
            v = {'x': 0.8, 'X': 1.0, '-': 0.45}[ch] * rng.uniform(0.93, 1.0)
            st = i * beat / 4 + (swing * beat / 4 if i % 2 else 0)
            hit = DRUM[kind](v)
            p = DRUM_PAN.get(kind, 0)
            s = int(round(st * SR))
            out[0, s:s + len(hit)] += hit * (1 - max(p, 0))
            out[1, s:s + len(hit)] += hit * (1 + min(p, 0))
    return out


# ── сэмплы кита ─────────────────────────────────────────────────────────────
# Каждый: group, name, bars, loop, star (индекс аккорда или None), how — функция → нот/звук.
SAMPLES = []


def sample(group, name, bars, loop=True, star=None, **kw):
    SAMPLES.append(dict(group=group, name=name, bars=bars, loop=loop, star=star, **kw))


# Ударные лупы (2 такта) и отдельные ударные (1 такт)
G = dict(
    house={'k': 'X...x...X...x...', 'c': '....x.......x...', 'o': '..x...x...x...x.', 'h': '-.-.-.-.-.-.-.-.'},
    euro={'k': 'X...x...X...x...', 'c': '....X.......X...', 's': '....x.......x...', 'h': 'x.x.x.x.x.x.x.x.',
          'o': '..-...-...-...-.'},
    trance={'k': 'X...x...X...x...', 'o': '..x...x...x...x.', 'h': '-x--x--x-x--x--x', 'c': '....-.......-...'},
    dream={'k': 'X...x...X...x...', 'o': '..x...x...x...x.', 'r': '-x-x-x-x-x-x-x-x', 't': '....x.......x...'},
    garage={'k': 'X......x..X.....', 'c': '....X.......X...', 'h': 'x.xxx.x.x.xxx.x.', 'o': '......x.......x.'},
    perc={'r': 'x-x-x-x-x-x-x-x-', 'g': 'x..x..x...x..x..', 'G': '..x...x.x...x...', 't': '....x.......x...'},
)
for nm, gr in G.items():
    sample('loop', f'Groove {nm.title()}', 2, drums=gr)
sample('loop', 'Fill Snare', 1, loop=False, drums={'s': '--x-x-xxxxXXXXXX', 'x': '................'})
sample('loop', 'Fill Toms', 1, loop=False, drums={'g': 'x.x.x.x.........', 'G': '........x.x.xxxx', 'k': '............x...'})
sample('drum', 'Kick 4-4', 1, drums={'k': 'X...x...X...x...'})
sample('drum', 'Clap 2-4', 1, drums={'c': '....X.......X...'})
sample('drum', 'Hihat 16', 1, drums={'h': 'x-x-x-x-x-x-x-x-'})
sample('drum', 'Open Hat', 1, drums={'o': '..x...x...x...x.'})
sample('drum', 'Shaker', 1, drums={'r': '-x-x-x-x-x-x-x-x'})
sample('drum', 'Crash', 2, loop=False, drums={'x': 'X' + '.' * 31})


def per_chord(group, name, bars, patch, fn, fx, **kw):
    for ci, st in enumerate(STARS):
        sample(group, f'{name} {st}', bars, star=ci, patch=patch, notes=lambda beats, ci=ci: fn(ci, beats), fx=fx, **kw)


def full(group, name, bars, patch, fn, fx, **kw):
    """Вся последовательность Am–F–C–G (по bars/4 такта на аккорд) — для новичка, без звёздочки."""
    def notes(beats):
        per = beats // 4
        out = []
        for ci in range(4):
            out += [(m, v, t + ci * per, d) for m, v, t, d in fn(ci, per)]
        return out
    sample(group, f'{name} Am-F-C-G', bars, patch=patch, notes=notes, fx=fx, **kw)


# ноты: (midi, vel, start_beat, dur_beats)
def bass_offbeat(ci, beats):
    r = CHORDS[ci][1] + 12
    return [(r + (12 if (b % 2) else 0), 110, b + 0.5, 0.42) for b in range(beats)]


def bass_rolling(ci, beats):
    r = CHORDS[ci][1] + 12
    return [(r, 100 if s % 2 else 90, s / 4, 0.2) for s in range(beats * 4) if s % 4]


def bass_house(ci, beats):
    r = CHORDS[ci][1] + 12
    out = []
    for bar in range(beats // 4):
        for t, o, d in ((0, 0, 0.5), (0.75, 12, 0.25), (1.5, 0, 0.5), (2.5, 12, 0.25), (3, 0, 0.4), (3.5, 7, 0.4)):
            out.append((r + o, 105, bar * 4 + t, d))
    return out


def pad_hold(ci, beats):
    return [(m, 80, 0, beats - 0.05) for m in CHORDS[ci][2]] + [(CHORDS[ci][2][0] - 12, 70, 0, beats - 0.05)]


def piano_stabs(ci, beats):
    ch = [m + 12 for m in CHORDS[ci][2]]
    out = []
    for bar in range(beats // 4):
        for t in (0, 0.75, 1.5, 2.5, 3.25):
            out += [(m, 100, bar * 4 + t, 0.4) for m in ch]
    return out


def organ_offbeat(ci, beats):
    ch = CHORDS[ci][2]
    return [(m, 105, b + 0.5, 0.3) for b in range(beats) for m in ch]


def arp_trance(ci, beats):
    tt = tones(ci)
    base = 69 - 12 if tt[0] > 4 else 69
    seq = [0, 1, 2, 3, 2, 1, 2, 3]
    pitch = [tt[0], tt[1], tt[2], tt[0] + 12]
    root = (CHORDS[ci][1] % 12) + 60
    return [(root + pitch[seq[s % 8]] - tt[0], 95 if s % 4 == 0 else 80, s / 4, 0.22) for s in range(beats * 4)]


def supersaw_chords(ci, beats):
    ch = [m + 12 for m in CHORDS[ci][2]] + [CHORDS[ci][2][0]]
    out = []
    for b in range(beats):
        out += [(m, 110, b + 0.5, 0.35) for m in ch]
    return out


def dream_piano(ci, beats):
    """«Пианино дрим-хауса»: восьмые по звукам аккорда, сверху — пение по ладу."""
    root = (CHORDS[ci][1] % 12) + 60
    tt = [x - tones(ci)[0] for x in tones(ci)]
    patt = [0, 2, 1, 2, 0, 2, 1, 2]
    out = []
    for e in range(beats * 2):
        m = root + tt[patt[e % 8]] + (12 if e % 8 in (1, 5) else 0)
        out.append((m, 90 if e % 2 == 0 else 75, e / 2, 0.45))
    return out


def acid_pedal(ci, beats):
    """Нейтральная (без звёздочки) — педаль A: ложится на любой аккорд последовательности."""
    patt = [0, 0, 12, 0, 0, 12, 0, 10, 0, 0, 12, 0, 7, 0, 12, 0]
    return [(45 + patt[s % 16], 110 if patt[s % 16] else 90, s / 4, 0.2) for s in range(beats * 4)]


def lead_hook(_ci, beats):
    """Нейтральный хук на A и E (тоника и квинта ля минора) — 2 такта."""
    m = [(76, 0, 0.5), (76, 0.75, 0.5), (74, 1.5, 0.5), (72, 2.25, 0.75), (69, 3.25, 0.5), (69, 4.5, 0.5),
         (72, 5, 0.5), (71, 5.75, 0.5), (69, 6.5, 1.2)]
    return [(p, 105, t, d) for p, t, d in m if t < beats]


FX_BASS = dict(chain=[HighpassFilter(30), Compressor(-18, 4), LowpassFilter(5000)], pump=0.55)
FX_PAD = dict(chain=[HighpassFilter(180), Chorus(0.6, 0.25, 7, 0.1, 0.4), Reverb(0.8, 0.5, 0.35, 0.8, 1.0)], pump=0.6)
FX_KEYS = dict(chain=[HighpassFilter(150), Reverb(0.45, 0.6, 0.18, 0.85, 0.9)], pump=0.3)
FX_SEQ = dict(chain=[HighpassFilter(250), Delay(0.0, 0.3, 0.22), Reverb(0.5, 0.6, 0.2, 0.85, 1.0)], pump=0.4, delay_dotted=True)
FX_LEAD = dict(chain=[HighpassFilter(200), Delay(0.0, 0.35, 0.25), Reverb(0.6, 0.5, 0.25, 0.8, 1.0)], pump=0.2,
               delay_dotted=True)

per_chord('bass', 'Euro Offbeat', 2, 'Basses/Bass 1', bass_offbeat, FX_BASS)
per_chord('bass', 'Rolling', 2, 'Basses/Sub 2', bass_rolling, FX_BASS)
per_chord('bass', 'House Pluck', 2, 'Basses/FM Bass 1', bass_house, FX_BASS)
sample('bass', 'Acid Pedal', 2, patch='Sequences/Acid Seq 1', notes=lambda b: acid_pedal(0, b), fx=FX_BASS)
per_chord('layer', 'Warm Strings', 2, 'Polysynths/Juno-60 Strings', pad_hold, FX_PAD)
full('layer', 'Choir', 8, 'Pads/MKS-70 Warm Pad', pad_hold, FX_PAD)
per_chord('keys', 'House Piano', 2, 'Keys/EP 1', piano_stabs, FX_KEYS)
per_chord('keys', 'Organ', 2, 'Keys/House Organ', organ_offbeat, FX_KEYS)
per_chord('seq', 'Trance Arp', 2, 'Plucks/Clean', arp_trance, FX_SEQ)
full('seq', 'Dream Piano', 8, 'Keys/EP 2', dream_piano, FX_SEQ)
per_chord('synth', 'Anthem Stab', 2, 'Polysynths/Anthemish 1', supersaw_chords, FX_KEYS)
sample('synth', 'Hook', 2, patch='Leads/Classic Lead 1', notes=lambda b: lead_hook(0, b), fx=FX_LEAD)

FX_FX = dict(chain=[HighpassFilter(120), Reverb(0.7, 0.5, 0.3, 0.8, 1.0)], pump=0)
sample('fx', 'Space Cadet', 2, loop=False, patch='FX/Space Cadet', notes=lambda b: [(57, 100, 0, 3)], fx=FX_FX)
sample('fx', 'Siren', 2, loop=False, patch='FX/Alarm', notes=lambda b: [(69, 100, 0, 6)], fx=FX_FX)
sample('fx', 'Fireworks', 2, loop=False, patch='FX/Fireworks', notes=lambda b: [(57, 100, 0, 4)], fx=FX_FX)
sample('fx', 'Riser 4', 4, loop=False, gen='riser', fx=FX_FX)
sample('fx', 'Downer 2', 2, loop=False, gen='downer', fx=FX_FX)
sample('fx', 'Laser', 1, loop=False, gen='laser', fx=FX_FX)

LUFS = {'loop': -13, 'drum': -16, 'bass': -15, 'layer': -21, 'keys': -18, 'seq': -19, 'synth': -17, 'fx': -20}


# ── рендер ──────────────────────────────────────────────────────────────────
def gen_fx(kind, n, beat):
    t = np.arange(n) / SR
    x = t / t[-1]
    noise = rng.standard_normal((2, n))
    if kind == 'riser':
        lo = lfilter(*butter(2, 1200 / (SR / 2)), noise)
        hi = _hp(noise, 3000)
        tone = np.sin(2 * np.pi * np.cumsum(220 * 2 ** (2 * x)) / SR)
        return ((lo * (1 - x) + hi * x) * 0.5 + tone * 0.15) * x ** 2.2
    if kind == 'downer':
        tone = np.sin(2 * np.pi * np.cumsum(880 * 2 ** (-4 * x)) / SR)
        return (tone * 0.5 + _hp(noise, 2000) * 0.3) * (1 - x) ** 1.5
    if kind == 'laser':
        tone = np.sign(np.sin(2 * np.pi * np.cumsum(1800 * 2 ** (-6 * x)) / SR))
        return np.stack([tone, tone]) * np.exp(-x * 4) * 0.4


def pump(a, beat, depth):
    """Сайдчейн «насос»: на каждую долю громкость проседает и за ~0,6 доли возвращается."""
    if not depth:
        return a
    t = np.arange(a.shape[1]) / SR
    ph = (t % beat) / beat
    g = 1 - depth * np.exp(-ph / 0.18) * np.minimum(ph / 0.01, 1)
    return a * g


def render_one(s, bpm):
    beat = 60 / bpm
    length = s['bars'] * 4 * beat
    n = int(round(length * SR))
    cycles = 2 if s['loop'] else 1
    tail = 0 if s['loop'] else 3.0
    if 'drums' in s:
        a = drums(s['drums'], beat, s['bars'] * cycles)
        a = a[:, :int(round((length * cycles + tail) * SR))]
        a = Pedalboard([HighpassFilter(25), Compressor(-10, 3, 5, 80)])(a.astype(np.float32), SR)
    elif 'gen' in s:
        a = gen_fx(s['gen'], n, beat)
        a = np.concatenate([a, np.zeros((2, int(tail * SR)))], 1)
    else:
        beats = s['bars'] * 4
        notes = s['notes'](beats)
        ev = [(m, v, (t + c * beats) * beat, d * beat) for c in range(cycles) for m, v, t, d in notes]
        a = synths.render(synths.surge('s', s['patch']), ev, length * cycles + tail)
    a = a.astype(np.float32)
    fx = s.get('fx')
    if fx:
        chain = list(fx['chain'])
        for p in chain:
            if isinstance(p, Delay) and fx.get('delay_dotted'):
                p.delay_seconds = beat * 0.75
        a = Pedalboard(chain)(a, SR)
        a = pump(a, beat, fx.get('pump', 0))
    if s['loop']:
        # второй круг: хвосты первого уже внутри. Конец петли (20 мс) плавно сводим в то, что звучало
        # перед началом второго круга, — тогда последний отсчёт переходит в первый без щелчка,
        # даже если хорус и LFO патча не кратны петле.
        out = a[:, n:2 * n].copy()
        m = int(0.02 * SR)
        w = np.linspace(0, 1, m) ** 0.5
        out[:, -m:] = out[:, -m:] * (1 - w) + a[:, n - m:n] * w
        a = out
    else:
        a = a[:, :n]
        fade = int(0.01 * SR)
        a[:, -fade:] *= np.linspace(1, 0, fade)
    return a


def loudnorm(a, target):
    meter = pyloudnorm.Meter(SR, block_size=0.2)
    try:
        l = meter.integrated_loudness(a.T)
    except ValueError:
        return a
    if not np.isfinite(l):
        return a
    a = a * 10 ** ((target - l) / 20)
    peak = np.abs(a).max()
    return a / peak * 0.98 if peak > 0.98 else a


def slug(s):
    return s.lower().replace(' ', '-').replace('*', 's')


def build(bpm, only):
    d = OUT / str(bpm)
    man = []
    for s in SAMPLES:
        if only and s['name'] not in only:
            continue
        a = loudnorm(render_one(s, bpm), LUFS[s['group']])
        f = d / s['group'] / f"{slug(s['name'])}.wav"
        f.parent.mkdir(parents=True, exist_ok=True)
        sf.write(f, a.T, SR, subtype='PCM_16')
        man.append(dict(group=s['group'], name=s['name'], bars=s['bars'], loop=s['loop'],
                        chord=None if s['star'] is None else CHORDS[s['star']][0], file=str(f.relative_to(d))))
        print(bpm, s['group'], s['name'], f'{a.shape[1] / SR:.2f}s', flush=True)
    (d / 'manifest.json').write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding='utf-8')
    return man


STYLES = [  # миксы-образцы: как собрал бы человек из одного кита
    dict(name='euro', groove='Groove Euro', bass='Euro Offbeat', pad='Warm Strings', keys='Organ', seq='Trance Arp',
         synth='Anthem Stab', dream=False),
    dict(name='house', groove='Groove House', bass='House Pluck', pad='Warm Strings', keys='House Piano',
         seq='Trance Arp', synth='Anthem Stab', dream=False),
    dict(name='dream', groove='Groove Dream', bass='Rolling', pad='Warm Strings', keys='House Piano', seq='Trance Arp',
         synth='Anthem Stab', dream=True),
]


# ── случайный микс (как собрал бы человек: по 8 тактов, гармония по 2 такта на аккорд) ──
def mix(bpm, man, seed):
    r = random.Random(seed)
    d = OUT / str(bpm)
    beat = 60 / bpm
    bar_n = int(round(4 * beat * SR))
    total = 40
    out = np.zeros((2, bar_n * total + 4 * SR), np.float32)

    def load(name):
        e = next(x for x in man if x['name'] == name)
        a, _ = sf.read(d / e['file'], dtype='float32')
        return a.T, e

    def put(name, bar, gain=1.0, times=1):
        a, e = load(name)
        for k in range(times):
            s = (bar + k * e['bars']) * bar_n
            m = min(a.shape[1], out.shape[1] - s)
            out[:, s:s + m] += a[:, :m] * gain

    def fam(group):
        names = sorted({x['name'].rsplit(' ', 1)[0] for x in man if x['group'] == group and x['chord']})
        return r.choice(names)

    def prog(family, start, bars, gain=1.0):
        for k in range(bars // 2):
            put(f'{family} {STARS[k % 4]}', start + 2 * k, gain)

    style = STYLES[(seed - 1) % len(STYLES)]
    groove, bass, pad, keys, seq, syn = (style[k] for k in ('groove', 'bass', 'pad', 'keys', 'seq', 'synth'))
    # 0–8 вступление: ритм + пэд; 8–24 куплет; 24–32 брейк; 32–40 кульминация
    put(groove, 0, times=4)
    put('Shaker', 0, times=8)
    prog(pad, 0, 8, 0.9)
    put('Riser 4', 4)
    put('Crash', 8)
    put(groove, 8, times=8)
    prog(bass, 8, 16)
    prog(keys, 8, 16, 0.8)
    prog(pad, 16, 8, 0.8)
    put('Fill Snare', 23)
    put('Crash', 24)
    prog(pad, 24, 8)
    prog(seq, 24, 8)
    put('Riser 4', 28)
    put('Laser', 31)
    put('Crash', 32)
    put(groove, 32, times=4)
    put('Kick 4-4', 32, 0.5, times=8)
    prog(bass, 32, 8)
    prog(syn, 32, 8, 0.8)
    prog(seq, 32, 8, 0.8)
    put('Hook', 32, 0.8, times=4)
    put('Downer 2', 40)
    raps = [x['name'] for x in man if x['group'] == 'rap']
    if raps:
        for bar in (7, 15, 31, 36):
            put(r.choice(raps), bar, 0.9)
    if style['dream']:  # дрим-хаус: пианино и хор по всей последовательности в брейке
        put('Dream Piano Am-F-C-G', 16, 0.7)
        put('Choir Am-F-C-G', 24, 0.7)
    out = Pedalboard([Compressor(-12, 2, 10, 120), Limiter(-3.0)])(out, SR)
    out *= 0.93 / max(np.abs(out).max(), 1e-9)
    f = OUT / f"mix-{bpm}-{style['name']}.wav"
    sf.write(f, out.T, SR, subtype='PCM_16')
    print('mix', f, style['name'])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--bpm', default='128,140')
    ap.add_argument('--mixes', type=int, default=2)
    ap.add_argument('--mix-only', action='store_true', help='не рендерить сэмплы, только миксы по manifest.json')
    a = ap.parse_args()
    only = set(x.strip() for x in a.only.split(',') if x.strip())
    for bpm in [int(x) for x in a.bpm.split(',')]:
        if a.mix_only:
            man = json.loads((OUT / str(bpm) / 'manifest.json').read_text(encoding='utf-8'))
        else:
            man = build(bpm, only)
        if not only:
            for k in range(a.mixes):
                mix(bpm, man, k + 1)


if __name__ == '__main__':
    main()
