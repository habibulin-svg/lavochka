"""Синтезатор евроданса 90-х на numpy: ноты из compose.py → стерео-демо (wav).

Тембры: суперпила (7 расстроенных пил), хувер (пила с «нырком» высоты и хорусом), хаус-пиано (аддитивное),
пиццикато/арпеджио, рейв-стэб, пэд, бас (пила + квадрат октавой ниже); ударные 909-типа синтезом.
Сайдчейн от бочки, реверб (свёртка с шумовым хвостом), дилей на лиде. Всё своё — лицензий нет.

python synth.py <ситуация> <сид> <выход.wav>
"""
import sys

import numpy as np
import soundfile as sf
from scipy.signal import butter, fftconvolve, lfilter

from compose import compose

SR = 44100
rng = np.random.default_rng(7)


def hz(p):
    return 440.0 * 2 ** ((p - 69) / 12)


def saw(f, n, phase=0.0):
    """Пила с polyBLEP (без грязного алиасинга). f — число или массив частот."""
    dt = np.broadcast_to(np.asarray(f, dtype=np.float64) / SR, (n,))
    t = (np.cumsum(dt) + phase) % 1.0
    y = 2 * t - 1
    m = t < dt
    x = t[m] / dt[m]
    y[m] -= x + x - x * x - 1
    m = t > 1 - dt
    x = (t[m] - 1) / dt[m]
    y[m] -= x * x + x + x + 1
    return y


def square(f, n):
    return saw(f, n) - saw(f, n, 0.5)


def lp(x, fc, order=2):
    b, a = butter(order, min(fc, SR * 0.45) / (SR / 2))
    return lfilter(b, a, x, axis=0)


def hp(x, fc, order=2):
    b, a = butter(order, fc / (SR / 2), 'high')
    return lfilter(b, a, x, axis=0)


def bp(x, f1, f2):
    b, a = butter(2, [f1 / (SR / 2), f2 / (SR / 2)], 'band')
    return lfilter(b, a, x, axis=0)


def adsr(n, a, d, s, r, dur_n):
    """Огибающая на n сэмплов: нота держится dur_n, потом релиз."""
    env = np.zeros(n)
    A, D, R = max(1, int(a * SR)), max(1, int(d * SR)), max(1, int(r * SR))
    k = np.arange(n)
    env = np.where(k < A, k / A, np.where(k < A + D, 1 - (1 - s) * (k - A) / D, s))
    rel = k >= dur_n
    env[rel] = env[min(dur_n, n - 1)] * np.exp(-(k[rel] - dur_n) / R * 4)
    return env


# ---------- инструменты: (частота, длительность в с, сила) → стерео [n, 2] ----------

def i_supersaw(p, dur, vel, voices=7, spread=0.18, cutoff=12000, a=0.004, r=0.18):
    f = hz(p)
    n = int((dur + r * 2) * SR)
    L = np.zeros(n)
    R = np.zeros(n)
    for v in range(voices):
        det = (v - (voices - 1) / 2) / ((voices - 1) / 2) * spread
        s = saw(f * 2 ** (det / 12), n, rng.random())
        if v % 2:
            L += s
        else:
            R += s
    sub = saw(f / 2, n) * 0.15
    st = np.stack([L + sub, R + sub], 1) / voices
    st = lp(st, cutoff)
    return st * adsr(n, a, 0.25, 0.7, r, int(dur * SR))[:, None] * vel


def i_hoover(p, dur, vel):
    f = hz(p)
    n = int((dur + 0.3) * SR)
    t = np.arange(n) / SR
    bend = 2 ** ((5 * np.exp(-t / 0.05)) / 12)           # «нырок» сверху
    L = sum(saw(f * bend * 2 ** (d / 12), n, rng.random()) for d in (-0.25, 0.0, 0.31))
    R = sum(saw(f * bend * 2 ** (d / 12), n, rng.random()) for d in (-0.33, 0.07, 0.22))
    sq = square(f * bend / 2, n) * 0.5
    st = np.stack([L + sq, R + sq], 1) / 3.5
    st = lp(st, 7000)
    return st * adsr(n, 0.003, 0.3, 0.75, 0.15, int(dur * SR))[:, None] * vel


def i_piano(p, dur, vel):
    """Хаус-пиано в духе M1: гармоники с быстрым спадом, лёгкая расстройка двух голосов."""
    f = hz(p)
    n = int((min(dur, 1.2) + 0.6) * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k, a in enumerate([1, 0.6, 0.35, 0.25, 0.15, 0.1, 0.06, 0.04], 1):
        out += a * np.sin(2 * np.pi * f * k * t * (1 + 0.0007 * k)) * np.exp(-t * (2.5 + k * 1.8))
    out2 = np.roll(out, 3) * 0.9
    click = np.zeros(n)
    click[:200] = rng.standard_normal(200) * np.exp(-np.arange(200) / 30) * 0.3
    st = np.stack([out + click, out2 + click], 1) / 2.2
    rel = np.ones(n)
    dn = int(dur * SR)
    if dn < n:
        rel[dn:] = np.exp(-np.arange(n - dn) / (0.08 * SR))
    return st * rel[:, None] * vel


def i_pluck(p, dur, vel):
    f = hz(p)
    n = int((min(dur, 0.6) + 0.4) * SR)
    t = np.arange(n) / SR
    s = saw(f, n) + 0.5 * saw(f * 1.005, n, 0.3)
    bright = lp(s, 9000) * np.exp(-t * 20)
    dark = lp(s, 900) * np.exp(-t * 6)
    m = (bright + dark) / 2
    st = np.stack([m, np.roll(m, 90)], 1)
    return st * vel


def i_stab(p, dur, vel):
    f = hz(p)
    n = int((dur + 0.25) * SR)
    s = 0.6 * square(f, n) + 0.5 * saw(f * 1.003, n) + 0.3 * saw(f * 2, n)
    s = lp(s, 8000)
    env = adsr(n, 0.002, 0.12, 0.35, 0.08, int(dur * SR))
    m = s * env * vel
    return np.stack([m, m], 1)


def i_pad(p, dur, vel):
    return i_supersaw(p, dur, vel, voices=5, spread=0.12, cutoff=4500, a=0.35, r=0.6)


def i_bass(p, dur, vel):
    f = hz(p)
    n = int((dur + 0.08) * SR)
    t = np.arange(n) / SR
    s = saw(f, n) + 0.3 * square(f / 2, n)
    s = lp(s, 900) * 0.6 + lp(s, 3500) * 0.5 * np.exp(-t * 14)
    m = s * adsr(n, 0.002, 0.1, 0.8, 0.03, int(dur * SR)) * vel
    return np.stack([m, m], 1)


def i_arp(p, dur, vel):
    return i_pluck(p, dur, vel * 0.8)


def d_kick(vel):
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    f = 48 + 120 * np.exp(-t * 32)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6.5)
    click = rng.standard_normal(n) * np.exp(-t * 900) * 0.4
    m = np.tanh((body + click) * 1.6) * vel
    return np.stack([m, m], 1)


def d_clap(vel):
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    env = np.zeros(n)
    for off in (0, 0.011, 0.022):
        k = t >= off
        env[k] += np.exp(-(t[k] - off) * (180 if off < 0.02 else 18))
    m = bp(noise * env, 900, 2600) * vel * 1.6
    return np.stack([m, np.roll(m, 40)], 1)


def d_snare(vel):
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    m = (bp(rng.standard_normal(n), 1500, 7000) * 0.8 + np.sin(2 * np.pi * 185 * t) * 0.5) * np.exp(-t * 28) * vel
    return np.stack([m, m], 1)


def d_hat(vel, decay):
    n = int((decay * 5) * SR)
    t = np.arange(n) / SR
    m = hp(rng.standard_normal(n), 7000) * np.exp(-t / decay) * vel
    return np.stack([m, np.roll(m, 25)], 1)


def d_crash(vel):
    n = int(1.8 * SR)
    t = np.arange(n) / SR
    m = hp(rng.standard_normal((n, 2)), 4000) * np.exp(-t / 0.6)[:, None] * vel
    return m


def d_riser(dur, vel):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal((n, 2))
    lo_ = lp(noise, 1500)
    hi_ = hp(noise, 3000)
    x = (t / dur)[:, None]
    return (lo_ * (1 - x) + hi_ * x) * (x ** 2) * vel


INSTR = {'supersaw': i_supersaw, 'hoover': i_hoover, 'piano': i_piano, 'pluck': i_pluck, 'stab': i_stab,
         'pad': i_pad, 'bass': i_bass, 'arp': i_arp}
GAIN = {'kick': 0.72, 'clap': 0.5, 'snare': 0.4, 'hat_c': 0.3, 'hat_o': 0.42, 'crash': 0.28, 'riser': 0.18,
        'bass': 0.38, 'supersaw': 0.7, 'hoover': 0.65, 'piano': 0.7, 'pluck': 0.6, 'stab': 0.4,
        'pad': 0.2, 'arp': 0.22}
SEND = {'supersaw': 0.25, 'hoover': 0.2, 'piano': 0.3, 'pluck': 0.3, 'stab': 0.2, 'pad': 0.45, 'arp': 0.35,
        'clap': 0.25, 'snare': 0.2}
DUCK = {'bass': 0.6, 'pad': 0.7, 'stab': 0.4, 'supersaw': 0.25, 'hoover': 0.25, 'arp': 0.4, 'piano': 0.2}


def render(song):
    spb = 60 / song.bpm
    total = int((song.bars * 4 * spb + 3) * SR)
    buses = {}
    for nt in song.notes:
        st = int(nt.start * spb * SR)
        if nt.track == 'kick':
            x = d_kick(nt.vel)
        elif nt.track == 'clap':
            x = d_clap(nt.vel)
        elif nt.track == 'snare':
            x = d_snare(nt.vel)
        elif nt.track == 'hat_c':
            x = d_hat(nt.vel, 0.018)
        elif nt.track == 'hat_o':
            x = d_hat(nt.vel, 0.07)
        elif nt.track == 'crash':
            x = d_crash(nt.vel)
        elif nt.track == 'riser':
            x = d_riser(nt.dur * spb, nt.vel)
        else:
            x = INSTR[nt.track](nt.pitch, nt.dur * spb, nt.vel)
        bus = buses.setdefault(nt.track, np.zeros((total, 2)))
        end = min(total, st + len(x))
        bus[st:end] += x[:end - st]

    # сайдчейн от бочки
    duck = np.ones(total)
    t_rel = np.arange(int(0.22 * SR)) / SR
    shape = np.exp(-t_rel / 0.07)
    for nt in song.notes:
        if nt.track == 'kick':
            st = int(nt.start * spb * SR)
            end = min(total, st + len(shape))
            duck[st:end] = np.minimum(duck[st:end], 1 - shape[:end - st])

    # дилей на лиде (точечная восьмая)
    dl = int(0.75 * spb * SR)
    for name in ('supersaw', 'hoover', 'piano', 'pluck'):
        if name in buses:
            b = buses[name]
            d = np.zeros_like(b)
            d[dl:] += b[:-dl] * 0.28
            d[2 * dl:] += b[:-2 * dl] * 0.12
            d[:, 0], d[:, 1] = d[:, 1].copy(), d[:, 0].copy()   # пинг-понг
            buses[name] = b + d

    mix = np.zeros((total, 2))
    send = np.zeros((total, 2))
    for name, b in buses.items():
        g = GAIN.get(name, 0.3)
        if name in DUCK:
            b = b * (1 - DUCK[name] * (1 - duck))[:, None]
        mix += b * g
        send += b * g * SEND.get(name, 0)
    # реверб: шумовой хвост 1,6 с
    ir_n = int(1.6 * SR)
    ti = np.arange(ir_n) / SR
    ir = rng.standard_normal((ir_n, 2)) * np.exp(-ti / 0.45)[:, None]
    ir = lp(ir, 6000) * 0.02
    wet = np.stack([fftconvolve(send[:, c], ir[:, c])[:total] for c in (0, 1)], 1)
    mix = hp(mix + wet, 30)
    mix = mix + bp(mix, 1000, 4500) * 0.8 + hp(mix, 2500) * 0.6 + hp(mix, 8000) * 0.8   # яркость и «присутствие»
    # мастер: мягкое насыщение + нормализация пика
    mix = np.tanh(mix * 1.3) / np.tanh(1.3)
    mix /= np.abs(mix).max() + 1e-9
    return (mix * 0.89).astype(np.float32)


if __name__ == '__main__':
    song, _ = compose(sys.argv[1], int(sys.argv[2]))
    audio = render(song)
    sf.write(sys.argv[3], audio, SR)
    print(sys.argv[3], f'{len(audio) / SR:.1f} c')
