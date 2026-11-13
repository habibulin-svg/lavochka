"""Синтез ударных 808/909-типа с параметрами тембра + удары из пресетов Surge (Percussion/Drums).

Голос ударного — кортеж (вид, параметры). Удар кэшируется на процесс, громкость — умножением.
Сетка: {'k': 'X...x...', ...} — 16 шагов на такт, x — удар, X — акцент, - — тихо, . — пауза.
"""
import hashlib

import numpy as np
from scipy.signal import butter, lfilter

SR = 44100


def _bp(x, f1, f2):
    b, a = butter(2, [f1 / (SR / 2), min(f2, SR / 2 - 100) / (SR / 2)], 'band')
    return lfilter(b, a, x)


def _hp(x, fc):
    b, a = butter(2, fc / (SR / 2), 'high')
    return lfilter(b, a, x)


def _lp(x, fc):
    b, a = butter(2, fc / (SR / 2), 'low')
    return lfilter(b, a, x)


def _rng(kind, p):
    h = hashlib.md5(f'{kind}{sorted(p.items())}'.encode()).digest()
    return np.random.default_rng(int.from_bytes(h[:4], 'little'))


def kick(r, f0=55, punch=140, sweep=30, decay=5.5, click=0.35, drive=1.8, length=0.45):
    """f0 по умолчанию — A1 (55 Гц): бочка в строе кита."""
    n = int(length * SR)
    t = np.arange(n) / SR
    f = f0 + punch * np.exp(-t * sweep)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * decay)
    cl = _hp(r.standard_normal(n), 2000) * np.exp(-t * 900) * click
    return np.tanh((body + cl) * drive) / np.tanh(drive)


def clap(r, lo=850, hi=2800, taps=4, gap=0.009, tail=16, length=0.3):
    n = int(length * SR)
    t = np.arange(n) / SR
    env = np.zeros(n)
    for i in range(taps):
        off = i * gap * (1 + 0.15 * (i % 2))
        k = t >= off
        env[k] += np.exp(-(t[k] - off) * (220 if i < taps - 1 else tail))
    return _bp(r.standard_normal(n) * env, lo, hi) * 1.8


def snare(r, tone=180, tone_mix=0.6, noise_lo=1800, noise_hi=9000, decay=22, length=0.25):
    n = int(length * SR)
    t = np.arange(n) / SR
    tn = np.sin(2 * np.pi * (tone + 40 * np.exp(-t * 60)) * t) * np.exp(-t * 30)
    noise = _bp(r.standard_normal(n), noise_lo, noise_hi) * np.exp(-t * decay)
    return tn * tone_mix + noise * 0.9


def hat(r, decay=0.035, cut=7500, metal=0.15, freqs=(205.3, 304.4, 369.6, 522.7, 540, 800), mult=1.0):
    n = int(min(decay * 6, 1.2) * SR)
    t = np.arange(n) / SR
    m = sum(np.sign(np.sin(2 * np.pi * f * mult * t)) for f in freqs)
    x = _hp(m * metal + r.standard_normal(n) * 0.6, cut)
    return x * np.exp(-t / decay) * np.minimum(t / 0.0015, 1)


def shaker(r, lo=4500, hi=12000, attack=0.012, decay=45, length=0.09):
    n = int(length * SR)
    t = np.arange(n) / SR
    env = np.minimum(t / attack, 1) * np.exp(-t * decay)
    return _bp(r.standard_normal(n), lo, hi) * env


def tamb(r, decay=14, freqs=(6100, 7350, 8900, 10400), length=0.25):
    n = int(length * SR)
    t = np.arange(n) / SR
    j = sum(np.sin(2 * np.pi * f * t) for f in freqs)
    return _hp(j * 0.3 + r.standard_normal(n), 5000) * np.exp(-t * decay)


def cymbal(r, decay=0.8, cut=3500, length=2.6, ride=0.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    fs = r.uniform(3000, 12000, 40)
    m = sum(np.sin(2 * np.pi * f * t + r.uniform(0, 6)) for f in fs)
    bell = np.sin(2 * np.pi * 820 * t) * np.exp(-t * 6) * ride
    return _hp(m * 0.05 + r.standard_normal(n) * (1 - 0.6 * ride), cut) * np.exp(-t / decay) + bell


def tom(r, f0=220, bend=60, decay=14, noise=0.05, length=0.35):
    n = int(length * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * np.cumsum(f0 + bend * np.exp(-t * 50)) / SR) * np.exp(-t * decay)
    return x + _bp(r.standard_normal(n), 800, 5000) * np.exp(-t * 60) * noise


def cowbell(r, f1=540, f2=800, decay=12, length=0.3):
    n = int(length * SR)
    t = np.arange(n) / SR
    x = sum(np.sign(np.sin(2 * np.pi * f * t)) for f in (f1, f2))
    return _bp(x, 400, 3500) * np.exp(-t * decay) * 0.6


def rim(r, f0=1700, decay=90, length=0.08):
    n = int(length * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f0 * t) * np.exp(-t * decay) + _bp(r.standard_normal(n), 2000, 8000) * np.exp(-t * 200)
    return x


def clave(r, f0=2500, decay=40, length=0.12):
    n = int(length * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * f0 * t) * np.exp(-t * decay)


def snap(r, length=0.15):
    n = int(length * SR)
    t = np.arange(n) / SR
    return _bp(r.standard_normal(n), 1500, 5000) * np.exp(-t * 70) * 1.5


def zap(r, f0=3000, f1=80, decay=25, length=0.2):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 40)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * decay)


def noise_hit(r, lo=300, hi=6000, decay=20, length=0.3):
    n = int(length * SR)
    t = np.arange(n) / SR
    return _bp(r.standard_normal(n), lo, hi) * np.exp(-t * decay)


VOICES = dict(kick=kick, clap=clap, snare=snare, hat=hat, shaker=shaker, tamb=tamb, cymbal=cymbal, tom=tom,
              cowbell=cowbell, rim=rim, clave=clave, snap=snap, zap=zap, noise=noise_hit)

_cache = {}


def hit(voice):
    """voice = (вид, {параметры}) или ('surge', патч, нота, длина) → моно-удар (нормирован по пику)."""
    key = repr(voice)
    if key not in _cache:
        if voice[0] == 'surge':
            import synths
            _, patch, note, length = voice
            a = synths.render(synths.surge('drum', patch), [(note, 120, 0, min(length, 0.25))], length).mean(0)
            # срезаем отсчёты до атаки (у некоторых патчей задержка) и плавно гасим конец
            on = np.argmax(np.abs(a) > np.abs(a).max() * 0.05)
            a = a[on:]
            f = min(len(a) // 4, int(0.03 * SR))
            if f:
                a[-f:] *= np.linspace(1, 0, f)
        else:
            kind, p = voice
            a = VOICES[kind](_rng(kind, p), **p)
        pk = np.abs(a).max()
        _cache[key] = (a / pk if pk > 0 else a).astype(np.float32)
    return _cache[key]


def drums(grid, voices, pans, gains, beat, bars, swing=0.0, humanize=0.0, seed=0):
    """grid: {ключ: строка шагов}; voices: {ключ: голос}; pans: {ключ: -1..1}.
    Строка повторяется до bars тактов (16 шагов на такт, 32 — на два). Возвращает стерео (2, n + 3 с)."""
    r = np.random.default_rng(seed)
    n = int(round(bars * 4 * beat * SR))
    out = np.zeros((2, n + 3 * SR))
    for k, pat in grid.items():
        h = hit(voices[k])
        p = pans.get(k, 0)
        g = gains.get(k, 1.0)
        gl, gr = (1 - max(p, 0)) * g, (1 + min(p, 0)) * g
        for i in range(bars * 16):
            ch = pat[i % len(pat)]
            if ch == '.':
                continue
            v = {'x': 0.8, 'X': 1.0, '-': 0.45, 'o': 0.3}[ch] * r.uniform(0.94, 1.0)
            st = i * beat / 4 + (swing * beat / 4 if i % 2 else 0) + (r.normal(0, humanize) if humanize else 0)
            s = max(int(round(st * SR)), 0)
            m = min(len(h), out.shape[1] - s)
            out[0, s:s + m] += h[:m] * v * gl
            out[1, s:s + m] += h[:m] * v * gr
    return out
