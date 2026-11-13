"""Рендер одного сэмпла кита по описанию (kit/*.py) в заданном темпе.

Правила стыковки (docs/music-studio/DESIGN.md §3):
  длина ровно 1/2/4/8 тактов; петли рендерятся двумя кругами и берётся второй — хвосты заворачиваются в начало,
  конец петли сводится в то, что звучало перед вторым кругом (без щелчка);
  бас, пэды, клавиши и секвенции «качаются» от бочки (сайдчейн вшит); громкость выровнена по группам (LUFS).
"""
import json
import pathlib

import numpy as np
import pyloudnorm
from pedalboard import (Chorus, Compressor, Delay, Distortion, HighpassFilter, LowpassFilter, Pedalboard, Phaser,
                        Reverb)
from scipy.signal import butter, lfilter

import drumsynth
import synths

SR = synths.SR
HERE = pathlib.Path(__file__).parent
LUFS = {'loop': -13, 'drum': -16, 'bass': -15, 'layer': -21, 'keys': -18, 'seq': -19, 'synth': -17, 'fx': -20,
        'rap': -16, 'voice': -17}
_patches = None


def patch_info(p):
    global _patches
    if _patches is None:
        f = HERE / 'patches.json'
        _patches = json.loads(f.read_text(encoding='utf-8')) if f.exists() else {}
    return _patches.get(p, {})


# ── эффекты по ролям (создаются заново на каждый сэмпл: у ревербов своё состояние) ──
def FX(kind):
    return {
        'bass': lambda: dict(chain=[HighpassFilter(30), Compressor(-18, 4), LowpassFilter(5000)], pump=0.55),
        'bass_dry': lambda: dict(chain=[HighpassFilter(30), Compressor(-18, 4), LowpassFilter(3500)], pump=0.35),
        'bass_acid': lambda: dict(chain=[HighpassFilter(35), Distortion(6), Compressor(-18, 4), LowpassFilter(7000)],
                                  pump=0.45),
        'pad': lambda: dict(chain=[HighpassFilter(180), Chorus(0.6, 0.25, 7, 0.1, 0.4),
                                   Reverb(0.8, 0.5, 0.35, 0.8, 1.0)], pump=0.6),
        'pad_soft': lambda: dict(chain=[HighpassFilter(150), Reverb(0.9, 0.6, 0.4, 0.75, 1.0)], pump=0.25),
        'pad_phase': lambda: dict(chain=[HighpassFilter(180), Phaser(0.2, 0.6, 1000, 0.4, 0.5),
                                         Reverb(0.8, 0.5, 0.35, 0.8, 1.0)], pump=0.5),
        'keys': lambda: dict(chain=[HighpassFilter(150), Reverb(0.45, 0.6, 0.18, 0.85, 0.9)], pump=0.3),
        'keys_dry': lambda: dict(chain=[HighpassFilter(120), Compressor(-16, 3), Reverb(0.25, 0.7, 0.1, 0.9, 0.8)],
                                 pump=0.15),
        'seq': lambda: dict(chain=[HighpassFilter(250), Delay(0.0, 0.3, 0.22), Reverb(0.5, 0.6, 0.2, 0.85, 1.0)],
                            pump=0.4, delay='dotted'),
        'seq_dry': lambda: dict(chain=[HighpassFilter(200), Reverb(0.3, 0.6, 0.12, 0.9, 0.9)], pump=0.35),
        'seq_wide': lambda: dict(chain=[HighpassFilter(250), Chorus(0.8, 0.2, 6, 0.1, 0.35), Delay(0.0, 0.35, 0.25),
                                        Reverb(0.6, 0.6, 0.25, 0.8, 1.0)], pump=0.45, delay='eighth'),
        'lead': lambda: dict(chain=[HighpassFilter(200), Delay(0.0, 0.35, 0.25), Reverb(0.6, 0.5, 0.25, 0.8, 1.0)],
                             pump=0.2, delay='dotted'),
        'stab': lambda: dict(chain=[HighpassFilter(150), Reverb(0.45, 0.6, 0.18, 0.85, 0.9)], pump=0.3),
        'fx': lambda: dict(chain=[HighpassFilter(120), Reverb(0.7, 0.5, 0.3, 0.8, 1.0)], pump=0),
        'fx_dry': lambda: dict(chain=[HighpassFilter(80)], pump=0),
        'none': lambda: dict(chain=[], pump=0),
    }[kind]()


def _hp(x, fc):
    b, a = butter(2, fc / (SR / 2), 'high')
    return lfilter(b, a, x)


def gen_fx(kind, n, beat, seed, p):
    """Синтетические эффекты: нарастания, спады, лазеры, свипы. p — параметры (вариант звучания)."""
    r = np.random.default_rng(seed)
    t = np.arange(n) / SR
    x = t / t[-1]
    noise = r.standard_normal((2, n))
    if kind == 'riser':
        lo = lfilter(*butter(2, 1200 / (SR / 2)), noise)
        hi = _hp(noise, 3000)
        f0 = p.get('f0', 220)
        tone = np.sin(2 * np.pi * np.cumsum(f0 * 2 ** (p.get('oct', 2) * x)) / SR)
        return ((lo * (1 - x) + hi * x) * p.get('noise', 0.5) + tone * p.get('tone', 0.15)) * x ** p.get('curve', 2.2)
    if kind == 'downer':
        f0 = p.get('f0', 880)
        tone = np.sin(2 * np.pi * np.cumsum(f0 * 2 ** (-p.get('oct', 4) * x)) / SR)
        return (tone * p.get('tone', 0.5) + _hp(noise, 2000) * p.get('noise', 0.3)) * (1 - x) ** p.get('curve', 1.5)
    if kind == 'laser':
        f0 = p.get('f0', 1800)
        ph = np.cumsum(f0 * 2 ** (-p.get('oct', 6) * x)) / SR
        tone = np.sign(np.sin(2 * np.pi * ph)) if p.get('square', True) else np.sin(2 * np.pi * ph)
        reps = p.get('reps', 1)
        if reps > 1:  # «пиу-пиу»: несколько выстрелов на долях
            seg = int(n / reps)
            xs = (np.arange(n) % seg) / seg
            tone = np.sign(np.sin(2 * np.pi * np.cumsum(f0 * 2 ** (-p.get('oct', 6) * xs)) / SR))
            env = np.exp(-xs * 6)
        else:
            env = np.exp(-x * p.get('decay', 4))
        return np.stack([tone, tone]) * env * 0.4
    if kind == 'sweep':  # шум через полосовой фильтр, частота едет вверх или вниз
        up = p.get('up', True)
        out = np.zeros((2, n))
        hop = 1024
        b0 = lfilter(*butter(1, 0.5), noise)
        for i in range(0, n, hop):
            xi = i / n if up else 1 - i / n
            fc = 200 * 2 ** (xi * 6)
            lo, hi = fc * 0.7, min(fc * 1.4, SR / 2 - 200)
            b, a = butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band')
            out[:, i:i + hop] = lfilter(b, a, b0[:, max(i - 4096, 0):i + hop])[:, -min(hop, n - i):]
        env = np.sin(np.pi * x) ** 0.7 if p.get('swell', True) else (x if up else 1 - x)
        return out * env * 3
    if kind == 'impact':
        sub = np.sin(2 * np.pi * np.cumsum(40 + 80 * np.exp(-t * 8)) / SR) * np.exp(-t * p.get('decay', 2.5))
        crack = _hp(noise, 1500) * np.exp(-t * 18) * 0.5
        return np.stack([sub, sub]) * 0.9 + crack
    if kind == 'bleep':  # писк-сигнал по звукам A/E (нейтральный)
        notes = p.get('notes', [81, 88])
        step = beat * p.get('step', 0.5)
        out = np.zeros(n)
        for i in range(int(n / (step * SR))):
            f = 440 * 2 ** ((notes[i % len(notes)] - 69) / 12)
            s = int(i * step * SR)
            m = min(int(step * SR * 0.6), n - s)
            tt = np.arange(m) / SR
            out[s:s + m] += np.sign(np.sin(2 * np.pi * f * tt)) * np.exp(-tt * 18) * 0.3
        return np.stack([out, out])
    if kind == 'noise_wash':
        return lfilter(*butter(2, p.get('fc', 3000) / (SR / 2)), noise) * np.sin(np.pi * x) * 0.6
    raise ValueError(kind)


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
    if 'grid' in s:
        a = drumsynth.drums(s['grid'], s['voices'], s.get('pans', {}), s.get('gains', {}), beat, s['bars'] * cycles,
                            swing=s.get('swing', 0), humanize=s.get('humanize', 0), seed=s.get('seed', 0))
        a = a[:, :n * cycles + int(tail * SR) + 64]
        a = Pedalboard([HighpassFilter(25), Compressor(-10, 3, 5, 80)])(a.astype(np.float32), SR)
    elif 'gen' in s:
        a = gen_fx(s['gen'], n if not s.get('gen_len') else int(s['gen_len'] * beat * SR), beat, s.get('seed', 1),
                   s.get('gp', {}))
        full = np.zeros((2, n * cycles + int(tail * SR) + 64))
        full[:, :min(a.shape[1], full.shape[1])] = a[:, :full.shape[1]]
        a = full
    else:
        beats = s['bars'] * 4
        notes = s['notes'](beats)
        tr = s.get('transpose', 0) + patch_info(s['patch']).get('transpose', 0)
        ev = [(m + tr, v, (t + c * beats) * beat, d * beat) for c in range(cycles) for m, v, t, d in notes]
        a = synths.render(synths.instrument('s', s['patch']), ev, length * cycles + tail + 0.05, bpm)
    a = a.astype(np.float32)
    fx = FX(s.get('fx', 'none'))
    if fx['chain']:
        for p in fx['chain']:
            if isinstance(p, Delay) and fx.get('delay'):
                p.delay_seconds = beat * {'dotted': 0.75, 'eighth': 0.5, 'quarter': 1.0}[fx['delay']]
        a = Pedalboard(fx['chain'])(a, SR)
    a = pump(a, beat, fx.get('pump', 0) * s.get('pump_k', 1.0))
    assert a.shape[1] >= n * cycles, (s['name'], a.shape, n)
    if s['loop']:
        out = a[:, n:2 * n].copy()
        m = int(0.02 * SR)
        w = np.linspace(0, 1, m) ** 0.5
        out[:, -m:] = out[:, -m:] * (1 - w) + a[:, n - m:n] * w
        a = out
    else:
        a = a[:, :n].copy()
        fade = int(0.01 * SR)
        a[:, -fade:] *= np.linspace(1, 0, fade)
    if s.get('reverse'):
        a = a[:, ::-1].copy()
        if not s['loop']:  # у обратного одиночного — мягкое начало (бывший хвост) и резкий конец: гасим щелчок
            f = int(0.005 * SR)
            a[:, -f:] *= np.linspace(1, 0, f)
    return a


def loudnorm(a, target):
    meter = pyloudnorm.Meter(SR, block_size=0.2)
    try:
        lv = meter.integrated_loudness(a.T)
    except ValueError:
        return a
    if not np.isfinite(lv):
        return a
    a = a * 10 ** ((target - lv) / 20)
    peak = np.abs(a).max()
    return a / peak * 0.98 if peak > 0.98 else a
