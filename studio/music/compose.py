"""Композитор евроданса 90-х по правилам жанра → список нот по дорожкам (+ MIDI-файл).

Почему не нейросеть: аудио-модели «плывут» по мелодии и не держат хук (пользователь, 2026-11-01).
Здесь хук строится по формуле: мотив 2 такта → ответ (тот же ритм, ноты под следующие аккорды) →
точный повтор мотива → каденция на тонику; на сильных долях — только звуки аккорда; из ~400 кандидатов
по оценке (диапазон, скачки, вершина, повторы) берётся лучший. Гармония — минорные круги жанра.

Используется из synth.py / pipeline.py; сам по себе: python compose.py <ситуация> <сид> <выход.mid>
"""
import random
import struct
import sys
from dataclasses import dataclass, field

# натуральный минор: ступени в полутонах от тоники
MINOR = [0, 2, 3, 5, 7, 8, 10]
# аккорды по ступеням (0 = i): трезвучия из натурального минора; 'V' — мажорная доминанта (гармонический минор)
PROGRESSIONS = [
    [0, 5, 2, 6],   # i–VI–III–VII  (Am F C G) — главный круг жанра
    [0, 6, 5, 6],   # i–VII–VI–VII
    [5, 6, 0, 0],   # VI–VII–i–i
    [0, 3, 6, 2],   # i–iv–VII–III
    [0, 2, 6, 5],   # i–III–VII–VI
    [0, 5, 6, 'V'],  # i–VI–VII–V (с мажорной доминантой — «заводит» в начало)
]

# ритмы мотива на 2 такта в шестнадцатых: (начало, длина)
MOTIF_RHYTHMS = [
    [(0, 3), (3, 3), (6, 2), (8, 2), (10, 2), (12, 4), (16, 3), (19, 3), (22, 2), (24, 6)],
    [(0, 2), (2, 2), (4, 3), (7, 3), (10, 2), (12, 2), (14, 2), (16, 6), (22, 2), (24, 4), (28, 4)],
    [(0, 4), (4, 2), (6, 2), (8, 3), (11, 3), (14, 2), (16, 4), (20, 4), (24, 8)],
    [(0, 3), (3, 3), (6, 4), (10, 3), (13, 3), (16, 3), (19, 3), (22, 4), (26, 6)],
    [(2, 2), (4, 2), (6, 2), (8, 4), (12, 4), (18, 2), (20, 2), (22, 2), (24, 8)],
    [(0, 2), (3, 2), (6, 2), (8, 2), (11, 2), (14, 2), (16, 2), (19, 2), (22, 2), (24, 4), (28, 2), (30, 2)],
]

# GM-ноты ударных
KICK, CLAP, SNARE, HAT_C, HAT_O, CRASH = 36, 39, 38, 42, 46, 49


@dataclass
class Note:
    track: str
    start: float   # в долях (четвертях)
    dur: float
    pitch: int
    vel: float = 0.8


@dataclass
class Song:
    name: str
    bpm: float
    key: int        # MIDI-нота тоники (A3 = 57)
    bars: int
    notes: list = field(default_factory=list)
    sections: list = field(default_factory=list)  # (имя, первый такт, число тактов)
    hook: list = field(default_factory=list)       # ноты хука (для проверки cover)
    prog: list = field(default_factory=list)


def degree_pitch(key, deg, octave=0):
    """Высота ступени натурального минора (deg может выходить за 0..6)."""
    o, d = divmod(deg, 7)
    return key + MINOR[d] + 12 * (o + octave)


def chord_tones(key, ch):
    """Звуки аккорда (pitch class + опорные ноты в октаве тоники)."""
    if ch == 'V':
        root = key + 7
        return [root, root + 4, root + 7]
    return [degree_pitch(key, ch), degree_pitch(key, ch + 2), degree_pitch(key, ch + 4)]


def scale_pitches(key, lo, hi, leading=False):
    """Ноты натурального минора; вводный тон (+11) — только над мажорной доминантой."""
    deg = set(MINOR) - {10} | {11} if leading else set(MINOR)   # над V: си-бекар → вводный тон
    return [p for p in range(lo, hi + 1) if (p - key) % 12 in deg]


def build_hook(rng, key, prog, rhythm):
    """8 тактов: A (такты 1–2), A' (3–4, ритм тот же, ноты под аккорды 3–4), A (5–6), каденция (7–8)."""
    lo, hi = key + 12, key + 12 + 17      # лид — октава выше тоники, диапазон ~ децима

    def chord_at(step16, offset_bars):
        return prog[(offset_bars + step16 // 16) % 4]

    def fit(step16, offset_bars, prev, strong, target_dir):
        ch = chord_at(step16, offset_bars)
        tones = {p % 12 for p in chord_tones(key, ch)}
        cands = scale_pitches(key, lo, hi, leading=ch == 'V')
        if strong:
            cands = [p for p in cands if p % 12 in tones]
        if prev is None:
            cands = [p for p in cands if p % 12 in tones]
            return rng.choice(cands[len(cands) // 3:2 * len(cands) // 3] or cands)
        # ближайшие по ходу, с уклоном в выбранном направлении; повтор той же ноты — редко
        cands.sort(key=lambda p: abs(p - prev) + (0 if (p - prev) * target_dir >= 0 else 2)
                   + (3 if p == prev else 0) + rng.random() * 2.5)
        return cands[0] if rng.random() < 0.7 else cands[min(rng.randint(1, 2), len(cands) - 1)]

    def phrase(offset_bars, seed_pitch, contour):
        out = []
        prev = seed_pitch
        for i, (s, d) in enumerate(rhythm):
            strong = s % 4 == 0
            direction = contour[min(i * len(contour) // len(rhythm), len(contour) - 1)]
            p = fit(s, offset_bars, prev, strong, direction)
            out.append((s + offset_bars * 16, d, p))
            prev = p
        return out

    contour = rng.choice([[1, 1, -1, -1], [1, -1, 1, -1], [-1, 1, 1, -1], [1, 1, 1, -1]])
    a = phrase(0, None, contour)
    a2 = phrase(2, a[0][2], contour)                     # ответ: тот же ритм под аккорды 3–4
    a3 = [(s + 64, d, p) for s, d, p in a]               # точный повтор мотива — это и есть хук
    # каденция: ритм мотива, к концу — на тонику (или квинту) длинной нотой
    cad = phrase(6, a2[-1][2], [1, -1, -1, -1])
    last_s, last_d, _ = cad[-1]
    tonic = [p for p in range(lo, hi + 1) if (p - key) % 12 == 0]
    cad[-1] = (last_s, max(last_d, 6), min(tonic, key=lambda t: abs(t - cad[-2][2])))
    return a + a2 + a3 + cad


def score_hook(h, key):
    ps = [p for _, _, p in h]
    rng_ = max(ps) - min(ps)
    leaps = [abs(b - a) for a, b in zip(ps, ps[1:])]
    s = 0.0
    s -= max(0, rng_ - 14) * 3 + max(0, 7 - rng_) * 2        # диапазон 7–14 полутонов
    s -= sum(1 for l in leaps if l > 7) * 4                   # большие скачки — редко
    s -= sum(1 for l in leaps if l == 0) * 2.0                # топтание на месте
    motif = [p for st, _, p in h if st < 32]
    s -= max(0, 4 - len(set(motif))) * 5                      # в мотиве ≥ 4 разных нот
    ml = [abs(b - a) for a, b in zip(motif, motif[1:])]
    s += 3 if any(4 <= l <= 9 for l in ml) else -3            # один «хуковый» скачок в мотиве
    s -= max(0, sum(1 for l in ml if l > 5) - 2) * 2          # но не скачками сплошь
    s += sum(1 for l in leaps if 3 <= l <= 5) * 0.6           # терции/кварты — «хуковые» ходы
    top = max(ps)
    s -= (ps.count(top) - 1) * 1.5                            # вершина — одна-две
    s += 2 if ps[-1] % 12 == key % 12 else 0
    return s


@dataclass
class Plan:
    bpm: float
    key: int
    form: list           # [(секция, тактов)]
    lead: str            # тембр лида: supersaw / hoover / piano / pluck
    energy: float        # 0..1


PLANS = {
    'menu':           Plan(136, 57, [('intro', 8), ('build', 4), ('hook', 16), ('break', 8), ('build', 4), ('hook', 16), ('outro', 4)], 'supersaw', 0.9),
    'battle':         Plan(136, 52, [('hook', 16), ('groove', 8), ('break', 8), ('build', 4), ('hook', 16)], 'hoover', 1.0),
    'battle-calm':    Plan(132, 50, [('groove', 8), ('calm', 16), ('groove', 8), ('calm', 16)], 'pluck', 0.45),
    'brigade-select': Plan(130, 48, [('groove', 8), ('hook', 16), ('groove', 8)], 'piano', 0.7),
    'sudden-death':   Plan(145, 53, [('build', 4), ('hook', 16), ('break', 4), ('build', 4), ('hook', 16)], 'hoover', 1.0),
    'time-attack':    Plan(150, 55, [('hook', 16), ('groove', 8), ('hook', 16)], 'piano', 1.0),
    'victory':        Plan(136, 57, [('fanfare', 4)], 'supersaw', 1.0),
    'defeat':         Plan(110, 57, [('fall', 2)], 'pluck', 0.4),
}


def compose(situation, seed):
    pl = PLANS[situation]
    rng = random.Random(f'{situation}-{seed}')
    # внутри ситуации у каждого номера свой круг, своя тональность и свой ритм мотива — треки не повторяются
    i = seed - 1
    key = pl.key + [0, 3, -2, 2, 5, -3][i % 6]
    prog = PROGRESSIONS[i % len(PROGRESSIONS)]
    rhythm = MOTIF_RHYTHMS[(i * 5 + len(situation)) % len(MOTIF_RHYTHMS)]
    best = max((build_hook(random.Random(rng.random()), key, prog, rhythm) for _ in range(400)),
               key=lambda h: score_hook(h, key))
    bars = sum(n for _, n in pl.form)
    song = Song(f'{situation}-{seed}', pl.bpm, key, bars, prog=prog, hook=best)
    N = song.notes

    def add(track, start, dur, pitch, vel=0.8):
        N.append(Note(track, start, dur, pitch, vel))

    def chord_of(bar):
        return prog[bar % 4]

    if situation == 'defeat':
        # нисходящий мотив по звукам аккорда i с хроматикой вниз — «приехали»
        line = [key + 19, key + 15, key + 12, key + 11, key + 10, key + 7, key + 3, key]
        for i, p in enumerate(line):
            add(pl.lead, i * 0.5, 0.5 if i < 7 else 2.5, p, 0.85 - i * 0.04)
        add('pad', 0, 4, key - 12, 0.5)
        add('bass', 0, 4, key - 24, 0.7)
        song.sections = [('fall', 0, 2)]
        return song, pl

    bar0 = 0
    for sec, nbars in pl.form:
        song.sections.append((sec, bar0, nbars))
        for b in range(nbars):
            bar = bar0 + b
            t = bar * 4
            ch = chord_of(b)
            tones = chord_tones(key, ch)
            root = tones[0] - 12
            full = sec in ('hook', 'fanfare')
            drums = sec not in ('break', 'calm_soft', 'fall')
            # --- ударные ---
            if drums and sec != 'intro' or (sec == 'intro' and b >= 4):
                for beat in range(4):
                    add('kick', t + beat, 0.25, KICK, 1.0)
                    add('hat_o', t + beat + 0.5, 0.25, HAT_O, 0.55 if pl.energy > 0.6 else 0.35)
                if sec != 'calm' or b % 2:
                    add('clap', t + 1, 0.25, CLAP, 0.85)
                    add('clap', t + 3, 0.25, CLAP, 0.85)
                if pl.energy > 0.7:
                    for s16 in range(16):
                        if s16 % 4 != 2:
                            add('hat_c', t + s16 / 4, 0.1, HAT_C, 0.25 + 0.1 * (s16 % 2 == 0))
            elif sec == 'intro':
                for beat in range(4):
                    add('hat_c', t + beat + 0.5, 0.1, HAT_C, 0.4)
            if sec == 'build':
                # дробь малого: четверти → восьмые → шестнадцатые к концу
                step = 1 if b < nbars - 2 else (0.5 if b < nbars - 1 else 0.25)
                k = 0
                while k < 4:
                    add('snare', t + k, 0.2, SNARE, 0.5 + 0.5 * (b + k / 4) / nbars)
                    k += step
                add('riser', t, 4, 0, 0.3 + 0.7 * b / nbars)
            if b == 0 and sec in ('hook', 'groove', 'calm') and bar > 0:
                add('crash', t, 2, CRASH, 0.7)
            # --- бас: октавы на слабую долю (классика жанра) ---
            if sec not in ('break',) and not (sec == 'intro' and b < 2):
                for e in range(8):
                    p = root - 12 if e % 2 == 0 else root
                    if sec == 'calm' and e % 2 == 0:
                        continue
                    add('bass', t + e * 0.5, 0.45, p, 0.85 if e % 2 else 0.7)
            # --- аккорды: стэбы в хуке, пэд в брейке/спокойном ---
            if full or sec == 'groove':
                stab = [p for p in tones]
                for pos in ([0, 0.75, 1.5, 2.5, 3.25] if full else [0.5, 1.5, 2.5, 3.5]):
                    for p in stab:
                        add('stab' if sec != 'groove' or situation != 'brigade-select' else 'piano', t + pos, 0.25, p, 0.6)
            if sec in ('break', 'calm', 'intro', 'outro', 'fanfare', 'hook'):
                for p in tones:
                    add('pad', t, 4, p - (0 if sec != 'break' else 12), 0.35 if sec == 'hook' else 0.55)
            if sec == 'break':
                for p in tones:
                    add('piano', t, 1.5, p + 12, 0.5)
                    add('piano', t + 2.5, 1.0, p + 12, 0.4)
            # --- арпеджио в спокойном и груве ---
            if sec in ('calm', 'groove'):
                arp = tones + [tones[0] + 12]
                for s16 in range(16):
                    add('arp', t + s16 / 4, 0.22, arp[s16 % 4] + 12, 0.35 + 0.15 * (s16 % 4 == 0))
        # --- хук: 8 тактов, в секции из 16 — дважды ---
        if sec in ('hook', 'break', 'calm', 'fanfare'):
            reps = max(1, nbars // 8)
            for r in range(reps):
                for s16, d16, p in best:
                    st = (bar0 + r * 8) * 4 + s16 / 4
                    if st >= (bar0 + nbars) * 4:
                        continue
                    if sec == 'break' and r == 0 and s16 >= 64:
                        continue   # в брейке — только первая половина хука, тихо
                    if sec == 'fanfare' and s16 >= 64:
                        continue
                    vel = 0.9 if sec in ('hook', 'fanfare') else 0.45
                    track = pl.lead if sec in ('hook', 'fanfare') else 'pluck' if sec == 'calm' else 'piano'
                    add(track, st, d16 / 4 * 0.95, p, vel)
        bar0 += nbars

    if situation == 'victory':
        # финальный аккорд тоники, долгий
        end = bar0 * 4
        for p in chord_tones(key, 0):
            add('pad', end, 4, p, 0.6)
            add(pl.lead, end, 3, p + 12, 0.8)
        add('crash', end, 3, CRASH, 0.9)
        add('kick', end, 0.25, KICK, 1.0)
        add('bass', end, 3, key - 24, 0.8)
        song.bars += 1
    return song, pl


# ---------- MIDI ----------
GM = {'supersaw': 81, 'hoover': 87, 'piano': 0, 'pluck': 84, 'stab': 16, 'pad': 89, 'bass': 38, 'arp': 82}


def write_midi(song, path, ppq=480):
    tracks = {}
    for n in song.notes:
        tracks.setdefault(n.track, []).append(n)

    def vlq(x):
        out = [x & 0x7F]
        x >>= 7
        while x:
            out.insert(0, (x & 0x7F) | 0x80)
            x >>= 7
        return bytes(out)

    chunks = []
    tempo = int(60_000_000 / song.bpm)
    chunks.append(b'\x00\xff\x51\x03' + tempo.to_bytes(3, 'big') + b'\x00\xff\x2f\x00')
    for i, (name, ns) in enumerate(tracks.items()):
        drum = name in ('kick', 'clap', 'snare', 'hat_c', 'hat_o', 'crash', 'riser')
        if name == 'riser':
            continue
        ch = 9 if drum else min(i, 8)
        ev = []
        for n in ns:
            on = int(n.start * ppq)
            off = int((n.start + n.dur) * ppq)
            ev.append((on, 1, bytes([0x90 | ch, n.pitch, max(1, min(127, int(n.vel * 127)))])))
            ev.append((off, 0, bytes([0x80 | ch, n.pitch, 0])))
        ev.sort(key=lambda e: (e[0], e[1]))
        data = b'\x00\xff\x03' + vlq(len(name)) + name.encode()
        if not drum:
            data += b'\x00' + bytes([0xC0 | ch, GM.get(name, 81)])
        last = 0
        for t, _, msg in ev:
            data += vlq(t - last) + msg
            last = t
        data += b'\x00\xff\x2f\x00'
        chunks.append(data)
    with open(path, 'wb') as f:
        f.write(b'MThd' + struct.pack('>IHHH', 6, 1, len(chunks), ppq))
        for c in chunks:
            f.write(b'MTrk' + struct.pack('>I', len(c)) + c)


if __name__ == '__main__':
    s, pl = compose(sys.argv[1], int(sys.argv[2]))
    write_midi(s, sys.argv[3])
    print(s.name, s.bpm, 'BPM, тоника', s.key, 'круг', s.prog, 'тактов', s.bars, 'нот', len(s.notes))
