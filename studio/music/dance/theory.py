"""Гармония кита «Dance With Me!»: ля минор, последовательность Am – F – C – G = звёздочки * ** *** ****.

Ноты в описаниях сэмплов: (midi, vel, start_beat, dur_beats).
"""
import random

STARS = ['*', '**', '***', '****']
CHORDS = [  # имя, корень баса (MIDI), аккорд в средней октаве (плавное ведение голосов)
    ('Am', 33, [57, 60, 64]),
    ('F', 29, [57, 60, 65]),
    ('C', 36, [55, 60, 64]),
    ('G', 31, [55, 59, 62]),
]
SCALE = [9, 11, 0, 2, 4, 5, 7]  # ля минор, классы высоты
SAFE = [9, 4]  # A и E — «нейтральные» звуки: ложатся на все четыре аккорда (Am, F maj7, C 6, G 9/6)


def root_pc(ci):
    return CHORDS[ci][1] % 12


def chord_pcs(ci):
    r = root_pc(ci)
    third = 3 if CHORDS[ci][0].endswith('m') else 4
    return [r, (r + third) % 12, (r + 7) % 12]


def tones(ci):
    """Звуки аккорда по возрастанию в одной октаве от корня: [корень, терция, квинта] (полутоны от C)."""
    r = root_pc(ci)
    third = 3 if CHORDS[ci][0].endswith('m') else 4
    return [r, r + third, r + 7]


def chord_notes(ci, lo, hi):
    """Все звуки аккорда в диапазоне [lo, hi] (MIDI), по возрастанию."""
    pcs = chord_pcs(ci)
    return [m for m in range(lo, hi + 1) if m % 12 in pcs]


def scale_notes(lo, hi):
    return [m for m in range(lo, hi + 1) if m % 12 in SCALE]


def nearest(pool, m):
    return min(pool, key=lambda x: (abs(x - m), x))


def voicing(ci, center=60, size=3, spread=0):
    """Аккорд из size звуков вокруг center (плавное ведение голосов), spread — разнос на октаву для верхнего."""
    pool = chord_notes(ci, center - 9, center + 12)
    start = nearest(pool, center - 4)
    i = pool.index(start)
    v = pool[i:i + size]
    if spread and len(v) >= 3:
        v[1] += 12
    return v


def bass_root(ci, octave=1):
    """Корень баса: octave=1 → 33..44 (A1..G#2), 2 → октавой выше."""
    r = CHORDS[ci][1]
    return r + 12 * (octave - 1)


def rnd(seed):
    return random.Random(seed)


def melody(ci, seed, beats, rhythm, lo=67, hi=84, leap=5, chord_on_strong=True):
    """Мелодия по аккорду: на восьмых и долгие — звуки аккорда, короткие на шестнадцатых — звуки лада рядом.
    rhythm: [(start_beat, dur_beats)] на 2 такта (8 долей); повторяется."""
    r = rnd(seed)
    ch = chord_notes(ci, lo, hi)
    sc = scale_notes(lo, hi)
    out, prev = [], r.choice(ch)
    base = []
    for t, d in rhythm:
        strong = abs(t * 2 - round(t * 2)) < 1e-6  # на восьмых — звук аккорда, проходящие — только на шестнадцатых
        pool = ch if (strong or d > 0.3 or not chord_on_strong) else sc  # долгий звук — тоже из аккорда
        if abs(t % 4) < 1e-6:  # первая доля такта — корень аккорда: гармония читается однозначно
            pool = [m for m in ch if m % 12 == root_pc(ci)] or ch
        cands = [m for m in pool if abs(m - prev) <= leap] or pool
        m = r.choice(cands)
        base.append((m, t, d))
        prev = m
    # мелодия зависит только от сида и аккорда — одинакова в 2-тактовом сэмпле и его нарезке
    period = 8
    k = 0
    while k * period < beats:
        for m, t, d in base:
            tt = t + k * period
            if tt < beats:
                out.append((m, 100 if abs(t - round(t)) < 1e-6 else 85, tt, min(d, beats - tt)))
        k += 1
    return out
