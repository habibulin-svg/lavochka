"""Рисунки партий кита: fn(ci, beats) → [(midi, vel, start_beat, dur_beats)].

ci — индекс аккорда (0 Am, 1 F, 2 C, 3 G); beats — длина сэмпла в долях. Рисунок периодичен по 2 тактам (8 долей),
поэтому нарезка на 1 такт — это его первый такт. Высоты — звучащие (сдвиг октавы пресета добавляет рендер).
Хелперы-фабрики (bass(...), arp(...)) возвращают fn с зашитыми параметрами.
"""
from theory import CHORDS, bass_root, chord_notes, melody, nearest, rnd, scale_notes, tones, voicing


def _rep(base, beats, period=8):
    """base: [(m, v, t, d)] на period долей → повторить на beats долей (и обрезать)."""
    out = []
    k = 0
    while k * period < beats:
        for m, v, t, d in base:
            tt = t + k * period
            if tt < beats - 1e-6:
                out.append((m, v, tt, min(d, beats - tt)))
        k += 1
    return out


def _steps(pattern, notes_fn, dur=0.22, vel=(100, 85)):
    """pattern — строка 16-х шагов на 2 такта (32 знака): x — нота, X — акцент, . — пауза.
    notes_fn(i) → высота (или список высот) для i-го звучащего шага."""
    out = []
    j = 0
    for s, ch in enumerate(pattern):
        if ch == '.':
            continue
        ms = notes_fn(j, s)
        for m in (ms if isinstance(ms, (list, tuple)) else [ms]):
            out.append((m, vel[0] if ch == 'X' else vel[1], s / 4, dur))
        j += 1
    return out


# ── бас ─────────────────────────────────────────────────────────────────────
BASS = {
    # имя: (шаги на 2 такта, интервалы от корня по кругу, длительность)
    'offbeat': ('..x...x...x...x...x...x...x...x.', [0, 12], 0.42),
    'octave': ('..x...x...x...x...x...x...x...x.', [12], 0.4),
    'rolling': ('.xxx.xxx.xxx.xxx.xxx.xxx.xxx.xxx', [0], 0.2),
    'gallop': ('..xx..xx..xx..xx..xx..xx..xx..xx', [0, 0], 0.18),
    'hyper': ('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', [0, 12], 0.2),
    'house': ('x..x..x...x.x.x.x..x..x...x.x..x', [0, 12, 0, 12, 0, 7], 0.3),
    'walk': ('..x...x...x...x...x...x...x...x.', [0, 12, 0, 7], 0.4),
    'tresillo': ('x..x..x.x..x..x.x..x..x.x..x..x.', [0, 0, 12], 0.6),
    'disco': ('x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.', [0, 12], 0.28),
    'garage': ('x.....x...x.....x.....x..x..x...', [0, 12, 0, 7, 0, 12], 0.5),
    'pump': ('x...x...x...x...x...x...x...x...', [0], 0.9),
    'synco': ('...x..x....x..x....x..x....x.xx.', [0, 12, 0, 0, 12, 0, 7, 12], 0.3),
    'arp': ('..x.x.x...x.x.x...x.x.x...x.x.x.', ['r', '3', '5', 12], 0.25),
}


def bass(kind, octave=1):
    pat, iv, dur = BASS[kind]

    def fn(ci, beats):
        r = bass_root(ci, octave)
        th = 3 if CHORDS[ci][0].endswith('m') else 4

        def pitch(j, s):
            x = iv[j % len(iv)]
            return r + {'r': 0, '3': th, '5': 7}.get(x, x) if isinstance(x, str) else r + x
        return _rep(_steps(pat, pitch, dur, (115, 100)), beats)
    return fn


def acid(seed):
    """Кислотная линия по аккорду: корень, октава, квинта, акценты — рисунок от сида."""
    r0 = rnd(seed)
    pat = ''.join(r0.choice('xxx.X') for _ in range(32))
    pat = 'X' + pat[1:]
    choices = [r0.choice([0, 0, 0, 0, 0, 12, 12, 7, 'b']) for _ in range(32)]

    def fn(ci, beats):
        r = bass_root(ci, 2)

        def pitch(j, s):
            x = choices[s]
            # «b» — септима там, где она в ладу и не спорит (Am → G, G → F), иначе октава
            return r + (10 if ci in (0, 3) else 12) if x == 'b' else r + x
        return _rep(_steps(pat, pitch, 0.2, (120, 95)), beats)
    return fn


def acid_pedal(beats):
    patt = [0, 0, 12, 0, 0, 12, 0, 10, 0, 0, 12, 0, 7, 0, 12, 0]
    return [(45 + patt[s % 16], 110 if patt[s % 16] else 90, s / 4, 0.2) for s in range(int(beats * 4))]


def pedal(note, pat):
    """Нейтральная педаль (A или E) по рисунку шагов."""
    def fn(beats):
        return _rep(_steps(pat, lambda j, s: note, 0.3, (115, 100)), beats)
    return fn


# ── подложки ────────────────────────────────────────────────────────────────
def pad(center=60, size=3, low=True, spread=0, restrike=False, vel=80):
    def fn(ci, beats):
        v = voicing(ci, center, size, spread)
        if low:
            v = v + [CHORDS[ci][1] + 24]
        if restrike:  # каждый такт — новая атака
            return [(m, vel, b, 3.95) for b in range(0, int(beats), 4) for m in v]
        return [(m, vel, 0, beats - 0.05) for m in v]
    return fn


def gate(pattern, center=64, size=3, vel=90):
    """Транс-гейт: аккорд, рубленный по шагам (32 знака на 2 такта)."""
    def fn(ci, beats):
        v = voicing(ci, center, size)
        return _rep(_steps(pattern, lambda j, s: v, 0.2, (vel + 10, vel)), beats)
    return fn


# ── клавишные ───────────────────────────────────────────────────────────────
def stabs(pattern, center=72, size=3, dur=0.35, top=False, spread=0):
    """Аккорды по рисунку шагов. top — сверху добавить октаву верхнего голоса (пиано-хаус)."""
    def fn(ci, beats):
        v = voicing(ci, center, size, spread)
        if top:
            v = v + [v[0] + 12]
        return _rep(_steps(pattern, lambda j, s: v, dur, (105, 90)), beats)
    return fn


def stride(center=67):
    """Левая рука — корень на долю, правая — аккорд на «и»."""
    def fn(ci, beats):
        v = voicing(ci, center, 3)
        r = CHORDS[ci][1] + 24
        base = []
        for b in range(8):
            base.append((r + (12 if b % 2 else 0), 95, b, 0.45))
            base += [(m, 85, b + 0.5, 0.4) for m in v]
        return _rep(base, beats)
    return fn


def broken(center=64, order=(0, 2, 1, 2), step=0.5, dur=0.45, top=True):
    """Ломаный аккорд (альбертиев бас / «пианино дрим-хауса»)."""
    def fn(ci, beats):
        v = voicing(ci, center, max(order) + 1)
        base = []
        for e in range(int(8 / step)):
            m = v[order[e % len(order)]]
            if top and e % 8 in (1, 5):
                m += 12
            base.append((m, 90 if e % 2 == 0 else 75, e * step, dur))
        return _rep(base, beats)
    return fn


def riff(seed, center=72):
    """Пиано-хаус рифф: аккорды на синкопах, верхний голос гуляет по звукам аккорда."""
    r = rnd(seed)
    pat = r.choice(['x..x..x...x..x..x..x..x...x.x.x.', 'x..x..x.x..x..x.x..x..x...x..x..',
                    '..x..x..x..x.x....x..x..x..x.x..', 'x.x..x..x.x..x..x.x..x..x...x.x.'])
    tops = [r.randrange(3) for _ in range(32)]

    def fn(ci, beats):
        v = voicing(ci, center, 3)
        return _rep(_steps(pat, lambda j, s: v + [v[tops[j % 32]] + 12], 0.3, (110, 95)), beats)
    return fn


# ── секвенции ───────────────────────────────────────────────────────────────
ARP_ORDERS = {
    'up': [0, 1, 2, 3], 'down': [3, 2, 1, 0], 'updown': [0, 1, 2, 3, 2, 1], 'broken': [0, 2, 1, 3],
    'trance': [0, 1, 2, 3, 2, 1, 2, 3], 'pingpong': [0, 3, 1, 3, 2, 3], 'octave': [0, 3, 0, 2, 0, 3, 1, 3],
    'climb': [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5], 'thirds': [0, 2, 1, 3, 2, 4],
}


def arp(order, center=69, rate=0.25, dur=None, pattern=None, accent=4):
    """Арпеджио по звукам аккорда от ближайшего к center. rate — шаг в долях; pattern — маска шагов (32 знака)."""
    idx = ARP_ORDERS[order] if isinstance(order, str) else order

    def fn(ci, beats):
        pool = chord_notes(ci, center - 12, center + 24)
        roots = [m for m in pool if m % 12 == CHORDS[ci][1] % 12]
        start = pool.index(nearest(roots, center - 3))  # арпеджио — от корня аккорда
        notes = pool[start:start + 7]
        base = []
        n = int(8 / rate)
        k = 0
        for s in range(n):
            if pattern and pattern[int(s * rate * 4) % len(pattern)] == '.':
                continue
            m = notes[idx[k % len(idx)] % len(notes)]
            k += 1
            base.append((m, 100 if s % accent == 0 else 82, s * rate, dur or rate * 0.85))
        return _rep(base, beats)
    return fn


def seq_melody(seed, rhythm='16', lo=67, hi=84, leap=7, dur=None):
    """Мелодичная секвенция: на сильных шагах звуки аккорда, между ними — лада."""
    r = rnd(seed)
    if rhythm == '16':
        mask = [r.random() < 0.75 or s % 4 == 0 for s in range(32)]
        rh = [(s / 4, dur or 0.22) for s in range(32) if mask[s]]
    elif rhythm == '8':
        rh = [(s / 2, dur or 0.45) for s in range(16)]
    else:  # синкопы
        rh = [(t, dur or 0.5) for t in (0, 0.75, 1.5, 2, 2.75, 3.5, 4, 4.75, 5.5, 6, 6.5, 7, 7.5)]

    def fn(ci, beats):  # секвенция — только звуки аккорда (мелодичное арпеджио)
        return melody(ci, seed, beats, rh, lo, hi, leap, chord_on_strong=False)
    return fn


def neutral_seq(seed, notes=(69, 76, 81, 88), rate=0.25, density=0.8):
    """Нейтральная секвенция на A и E (в разных октавах) — ложится на любой аккорд."""
    r = rnd(seed)
    base = [(r.choice(notes), 100 if s % 4 == 0 else 80, s * rate, rate * 0.8) for s in range(int(8 / rate))
            if s % 4 == 0 or r.random() < density]

    def fn(beats):
        return _rep(base, beats)
    return fn


# ── синты ───────────────────────────────────────────────────────────────────
def hook(seed, lo=69, hi=88, rhythm=None):
    """Хук-мелодия лида по аккорду (одноголосая)."""
    r = rnd(seed)
    if rhythm is None:
        rhythm = r.choice([
            [(0, 0.5), (0.75, 0.5), (1.5, 0.5), (2.25, 0.75), (3.25, 0.5), (4.5, 0.5), (5, 0.5), (5.75, 0.5), (6.5, 1.2)],
            [(0, 1.5), (1.5, 0.5), (2, 1), (3, 1), (4, 0.75), (4.75, 0.75), (5.5, 2.3)],
            [(0.5, 0.5), (1, 0.5), (1.5, 0.5), (2.5, 0.5), (3, 1), (4.5, 0.5), (5, 0.5), (5.5, 0.5), (6.5, 0.5), (7, 0.8)],
            [(0, 0.75), (0.75, 0.75), (1.5, 1), (3, 0.5), (3.5, 0.5), (4, 0.75), (4.75, 0.75), (5.5, 1.5), (7.5, 0.4)],
        ])

    def fn(ci, beats):
        return melody(ci, seed, beats, rhythm, lo, hi, 5)
    return fn


def neutral_hook(seed):
    """Хук только на A/E и проходящих C/B на слабых долях не берём — только A, E разных октав."""
    r = rnd(seed)
    pool = [69, 76, 81, 88]
    rh = [(0, 0.5), (0.75, 0.5), (1.5, 0.5), (2.25, 0.75), (3.25, 0.5), (4.5, 0.5), (5, 0.5), (5.75, 0.5), (6.5, 1.2)]
    base = [(r.choice(pool), 105, t, d) for t, d in rh]

    def fn(beats):
        return _rep(base, beats)
    return fn


def scale_run(ci, beats, up=True):
    """Пробежка по ладу к звуку аккорда (для заходов)."""
    sc = scale_notes(64, 88)
    tgt = nearest(chord_notes(ci, 76, 88), 81)
    i = sc.index(tgt)
    run = sc[i - 7:i + 1] if up else sc[i:i + 8][::-1]
    return [(m, 90 + k * 2, k * 0.25, 0.22) for k, m in enumerate(run) if k * 0.25 < beats]


def tones_list(ci):
    return tones(ci)
