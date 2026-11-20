"""Симулятор дирижёра: свои переложения коротких хитов (мелодии — общественное достояние) → public/dirizher/scores/<id>.json.

python tools/dirizher/hits.py

Нотная запись: «B2/8 C#3/8 F#3/4 r/4 B2+F#3/2 A3/2.» — высота (буква, #/b, октава) / длительность (1, 2, 4, 8, 16; точка —
с точкой); r — пауза; + — аккорд. Партия = инструмент + ноты с тиком начала, силой и приёмом (0 тянуть, 1 коротко,
2 пиццикато). Темп — карта с плавными ускорениями (accel/rit пишутся шагами по долям), особые места — фермата,
ускорение/замедление (тапы палочкой по долям), крещендо, соло.
"""
import json
import os
import re

PPQ = 480
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'dirizher', 'scores')
STEP = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def pitch(s):
    m = re.fullmatch(r'([A-G])(#|b)?(-?\d)', s)
    return 12 * (int(m.group(3)) + 1) + STEP[m.group(1)] + (1 if m.group(2) == '#' else -1 if m.group(2) == 'b' else 0)


def dur(s):
    dot = s.endswith('.')
    base = 4 * PPQ // int(s.rstrip('.'))
    return base * 3 // 2 if dot else base


def seq(text, tr=0):
    """Текст → [(длит, [высоты])]."""
    out = []
    for tok in text.split():
        if tok == '|':
            continue
        p, d = tok.split('/')
        ps = [] if p == 'r' else [pitch(x) + tr for x in p.split('+')]
        out.append((dur(d), ps))
    return out


def seq_len(s):
    return sum(d for d, _ in s)


class Score:
    def __init__(self, sid, title, composer, num=4, den=4):
        self.sid, self.title, self.composer = sid, title, composer
        self.parts = {}
        self.time = [[0, num, den]]
        self.tempo = []
        self.specials = []
        self.marks = []
        self.end = 0

    def part(self, instr, name):
        key = (instr, name)
        if key not in self.parts:
            self.parts[key] = []
        return self.parts[key]

    def put(self, instr, name, s, at, vel, art=0, legato=0.95):
        """Ноты seq с тика at; legato — доля длительности (стаккато короче)."""
        p = self.part(instr, name)
        t = at
        for d, ps in s:
            for x in ps:
                p.append([t, max(30, int(d * legato)), x, min(127, vel) + 128 * art])
            t += d
        self.end = max(self.end, t)
        return t

    def tempo_ramp(self, t0, t1, q0, q1, step=PPQ):
        t = t0
        while t < t1:
            u = (t - t0) / max(1, t1 - t0)
            self.tempo.append([t, round(q0 + (q1 - q0) * u, 2)])
            t += step

    def save(self, source='своё переложение (мелодия — общественное достояние)'):
        parts = []
        for (instr, name), notes in self.parts.items():
            notes.sort()
            parts.append({'name': name, 'instr': instr, 'notes': [v for n in notes for v in n]})
        tempo = sorted({t: q for t, q in self.tempo}.items())
        out = {'id': self.sid, 'title': self.title, 'composer': self.composer, 'source': source, 'time': self.time,
               'tempo': [[t, q] for t, q in tempo], 'marks': self.marks, 'end': self.end, 'parts': parts,
               'specials': sorted(self.specials, key=lambda x: x['tick'])}
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, self.sid + '.json'), 'w', encoding='utf8', newline='\n') as f:
            json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        n = sum(len(p['notes']) // 4 for p in parts)
        bar = PPQ * 4 * self.time[0][1] // self.time[0][2]
        print(f'{self.sid}: частей {len(parts)}, нот {n}, тактов {self.end / bar:.1f}')


BAR4 = PPQ * 4


# ---------------------------------------------------------------- Григ. «В пещере горного короля»
def mountain():
    s = Score('mountain', '«В пещере горного короля» (из «Пер Гюнта»)', 'Эдвард Григ')
    # тема в си миноре (восьмыми): 4 такта
    T = seq('B2/8 C#3/8 D3/8 E3/8 F#3/8 D3/8 F#3/4 | E#3/8 C#3/8 E#3/4 E3/8 C3/8 E3/4 | '
            'B2/8 C#3/8 D3/8 E3/8 F#3/8 D3/8 F#3/8 B3/8 | A3/8 F#3/8 D3/8 F#3/8 A3/2')
    # ответ в фа-диез (на квинту выше), конец — назад к си
    A = seq('F#3/8 G#3/8 A#3/8 B3/8 C#4/8 A#3/8 C#4/4 | D4/8 A#3/8 D4/4 C#4/8 A#3/8 C#4/4 | '
            'F#3/8 G#3/8 A#3/8 B3/8 C#4/8 A#3/8 C#4/8 F#4/8 | E4/8 C#4/8 A#3/8 C#4/8 F#4/2')
    sec = T + T + A + T  # 16 тактов
    L = seq_len(sec)
    vel = [42, 58, 84, 112]
    tempo = [(76, 96), (96, 124), (124, 152), (152, 184)]
    t = 0
    for k in range(4):
        v = vel[k]
        s.marks.append([t, 'ABCD'[k]])
        s.tempo_ramp(t, t + L, tempo[k][0], tempo[k][1], PPQ)
        # мелодия: фаготы и виолончели пиццикато → скрипки → дерево → вся медь
        s.put('bn', 'Bassoon', sec, t, v, 1, 0.7)
        s.put('vc', 'Violoncello', sec, t, v, 2 if k < 2 else 1, 0.8)
        if k >= 1:
            s.put('vn1', 'Violin I', [(d, [x + 12 for x in ps]) for d, ps in sec], t, v, 2 if k == 1 else 1, 0.75)
            s.put('vn2', 'Violin II', sec, t, v - 6, 2 if k == 1 else 1, 0.75)
        if k >= 2:
            s.put('fl', 'Flute', [(d, [x + 24 for x in ps]) for d, ps in sec], t, v, 1, 0.6)
            s.put('ob', 'Oboe', [(d, [x + 12 for x in ps]) for d, ps in sec], t, v, 1, 0.6)
            s.put('cl', 'Clarinet', [(d, [x + 12 for x in ps]) for d, ps in sec], t, v - 4, 1, 0.6)
            s.put('va', 'Viola', sec, t, v - 4, 1, 0.75)
        if k >= 3:
            s.put('tp', 'Trumpet', [(d, [x + 12 for x in ps]) for d, ps in sec], t, v, 1, 0.6)
            s.put('tb', 'Trombone', sec, t, v - 6, 1, 0.6)
            s.put('hn', 'Horn', [(d, [x + 12 for x in ps]) for d, ps in sec], t, v - 8, 1, 0.6)
        # педаль: контрабасы пиццикато на 1 и 3, валторны держат квинту (в ответе — фа-диез)
        for bar in range(16):
            root = 'F#1' if 8 <= bar < 12 else 'B1'
            fifth = 'C#3+F#3' if 8 <= bar < 12 else 'F#2+B2'
            bt = t + bar * BAR4
            s.put('cb', 'Contrabass', seq(f'{root}/4 r/4 {root}/4 r/4'), bt, v, 2 if k < 3 else 1, 0.6)
            if k < 3:
                s.put('hn', 'Horn 2', seq(f'{fifth}/1'), bt, v - 14)
            if k >= 2:
                s.put('timp', 'Timpani', seq(f'{root[:-1]}2/4 r/4 {root[:-1]}2/4 r/4'), bt, v - 10, 1)
            if k == 3 and bar % 2 == 0:
                s.put('perc', 'Cymbals', seq('C#3/2'), bt, 100, 1)  # тарелки (GM 49 = C#3)
        t += L
    # кода: удары си минор, фермата на последнем
    s.marks.append([t, 'E'])
    s.tempo_ramp(t, t + BAR4 * 3, 184, 150, PPQ)
    hits = seq('B2+D3+F#3/4 r/4 B2+D3+F#3/4 r/4 | F#2+C#3+E#3/4 r/4 F#2+C#3+E#3/4 r/4 | B2+D3+F#3/2. r/4')
    for instr, name, tr, v in [('vn1', 'Violin I', 24, 120), ('vn2', 'Violin II', 12, 118), ('va', 'Viola', 12, 116), ('vc', 'Violoncello', 0, 118),
                               ('cb', 'Contrabass', -12, 118), ('fl', 'Flute', 24, 110), ('ob', 'Oboe', 12, 110), ('cl', 'Clarinet', 12, 110),
                               ('bn', 'Bassoon', -12, 112), ('hn', 'Horn', 0, 116), ('tp', 'Trumpet', 12, 120), ('tb', 'Trombone', 0, 118)]:
        s.put(instr, name, [(d, [x + tr for x in ps]) for d, ps in hits], t, v, 0, 0.9)
    s.put('timp', 'Timpani', seq('B1/8 B1/8 B1/8 B1/8 B1/8 B1/8 B1/8 B1/8 | F#2/4 r/4 F#2/4 r/4 | B1/2. r/4'), t, 120, 1)
    s.put('perc', 'Cymbals', seq('C#3/2 r/2 | r/1 | C#3/1'), t, 120, 1)
    s.specials.append({'kind': 'fermata', 'tick': t + 2 * BAR4, 'len': PPQ * 3})
    # темп за палочкой: от второго раздела до конца четвёртого — тап на каждые 2 доли
    s.specials.append({'kind': 'accel', 'tick': L, 'len': 3 * L, 'to': 184 / 96, 'every': 2})
    s.specials.append({'kind': 'cresc', 'tick': 2 * L, 'len': PPQ * 4})
    s.specials.append({'kind': 'sforzando', 'tick': 3 * L, 'len': PPQ})
    s.end = t + 3 * BAR4
    s.save()


# ---------------------------------------------------------------- Григ. «Утро»
def morning():
    s = Score('morning', '«Утро» (из «Пер Гюнта»)', 'Эдвард Григ', 6, 8)
    BAR = PPQ * 3
    # пентатонная тема флейты (ми мажор), четверть-восьмая
    M = seq('G#5/4 E5/8 D#5/4 C#5/8 | D#5/4 E5/8 G#5/4 E5/8 | D#5/4 C#5/8 D#5/4 E5/8 | D#5/4. E5/4.')
    M2 = seq('G#5/4 E5/8 D#5/4 C#5/8 | D#5/4 E5/8 G#5/4 E5/8 | G#5/4 A#5/8 E5/4 A#5/8 | G#5/2.')
    phr = M + M2  # 8 тактов
    L = seq_len(phr)
    s.tempo = [[0, 72 * 1.5]]  # пунктирная четверть ≈ 72
    t = 0
    # 1: флейта и гобой по очереди (по 2 такта), струнные держат ми мажор тихо
    def strings(t0, bars, v, chord='E3+G#3+B3', bass='E2'):
        for b in range(bars):
            bt = t0 + b * BAR
            s.put('va', 'Viola', seq(f'{chord}/2.'), bt, v)
            s.put('vc', 'Violoncello', seq(f'{bass}/2.'), bt, v)
            s.put('cb', 'Contrabass', seq(f'{bass[:-1]}1/2.'), bt, v - 6)

    s.marks.append([0, 'A'])
    # флейта — такты 1–2 и 5–6, гобой — 3–4 и 7–8 (каждый — своя половина фразы)
    s.put('fl', 'Flute', M[:8], 0, 62)
    s.put('ob', 'Oboe', [(d, [p - 12 for p in ps]) for d, ps in M[8:]], 2 * BAR, 60)
    s.put('fl', 'Flute', M2[:8], 4 * BAR, 64)
    s.put('ob', 'Oboe', [(d, [p - 12 for p in ps]) for d, ps in M2[8:]], 6 * BAR, 62)
    strings(0, 8, 40)
    s.put('hn', 'Horn', seq('E3+B3/2. | E3+B3/2. | E3+B3/2. | E3+B3/2.'), 4 * BAR, 40)
    t = 8 * BAR
    # 2: тема у скрипок, ответ у кларнетов и фаготов, растёт
    s.marks.append([t, 'B'])
    s.put('vn1', 'Violin I', phr, t, 70)
    s.put('vn2', 'Violin II', [(d, [p - 12 for p in ps]) for d, ps in phr], t, 62)
    s.put('cl', 'Clarinet', [(d, [p - 12 for p in ps]) for d, ps in phr], t + 4 * BAR, 64)
    s.put('bn', 'Bassoon', seq('E3/2. | B2/2. | C#3/2. | B2/2. | E3/2. | B2/2. | C#3/2. | E3/2.'), t, 60)
    strings(t, 8, 54)
    t += 8 * BAR
    # 3: кульминация — тутти, мелодия у скрипок и виолончелей, медь
    s.marks.append([t, 'C'])
    up = [(d, [p + 0 for p in ps]) for d, ps in phr]
    s.put('vn1', 'Violin I', up, t, 104)
    s.put('vn2', 'Violin II', [(d, [p - 12 for p in ps]) for d, ps in phr], t, 98)
    s.put('vc', 'Violoncello', [(d, [p - 24 for p in ps]) for d, ps in phr], t, 100)
    s.put('fl', 'Flute', [(d, [p + 12 for p in ps]) for d, ps in phr], t, 90)
    s.put('ob', 'Oboe', phr, t, 88)
    s.put('hn', 'Horn', seq('E3+G#3+B3/2. | E3+G#3+B3/2. | F#3+A3+C#4/2. | E3+B3/2. | E3+G#3+B3/2. | E3+G#3+B3/2. | F#3+A#3+C#4/2. | E3+G#3+B3/2.'), t, 98)
    s.put('tp', 'Trumpet', seq('B4/2. | B4/2. | C#5/2. | B4/2. | B4/2. | B4/2. | C#5/2. | B4/2.'), t + 4 * BAR, 92)
    for b in range(8):
        s.put('cb', 'Contrabass', seq('E1/2.'), t + b * BAR, 100)
        s.put('va', 'Viola', seq('E3+B3/2.'), t + b * BAR, 92)
    s.put('timp', 'Timpani', seq('E2/4. B1/4.'), t + 4 * BAR, 90, 1)
    s.specials.append({'kind': 'cresc', 'tick': t - BAR, 'len': BAR})
    s.specials.append({'kind': 'solo', 'tick': 0, 'len': 2 * BAR, 'instr': 'fl'})
    s.specials.append({'kind': 'solo', 'tick': 2 * BAR, 'len': 2 * BAR, 'instr': 'ob'})
    t += 8 * BAR
    # 4: тихий конец — флейта, замедление, фермата
    s.marks.append([t, 'D'])
    s.specials.append({'kind': 'subito_p', 'tick': t, 'len': PPQ})
    s.put('fl', 'Flute', M[:8], t, 56)
    strings(t, 4, 40)
    s.put('vn1', 'Violin I', seq('B4+E5/2.'), t + 4 * BAR, 40)
    s.put('vn2', 'Violin II', seq('G#4/2.'), t + 4 * BAR, 38)
    strings(t + 4 * BAR, 1, 36)
    s.tempo_ramp(t + 2 * BAR, t + 4 * BAR, 108, 70, PPQ * 3 // 2)
    s.specials.append({'kind': 'rit', 'tick': t + 2 * BAR, 'len': 2 * BAR, 'to': 0.65, 'every': 2})
    s.specials.append({'kind': 'fermata', 'tick': t + 4 * BAR, 'len': BAR})
    s.tempo.append([t + 4 * BAR, 70])
    s.end = t + 5 * BAR
    s.save()


# ---------------------------------------------------------------- Штраус. «На прекрасном голубом Дунае»
def danube():
    s = Score('danube', '«На прекрасном голубом Дунае», вальс', 'Иоганн Штраус', 3, 4)
    BAR = PPQ * 3
    # тема: у виолончелей и валторн, «отклики» скрипок на 2 и 3
    # низкий голос — виолончели и валторны (затакт ре), высокий — «отклики» скрипок на 2 и 3
    lo = seq('D3/4 | D3/4 F#3/4 A3/4 | A3/2. | r/2. | r/2 D3/4 | D3/4 F#3/4 A3/4 | A3/2. | r/2. | r/2 C#3/4 | C#3/4 E3/4 B3/4 | B3/2. | r/2. |'
             ' r/2 C#3/4 | C#3/4 E3/4 B3/4 | B3/2. | r/2. | r/2 D3/4 | D3/4 F#3/4 A3/4 | D4/2. | r/2. | r/2 D3/4 | D3/4 F#3/4 A3/4 | D4/2. | r/2. |'
             ' r/2 E3/4 | E3/4 G3/4 B3/4 | B3/2. | r/4 G#3/4 A3/4 | F#4/2 E4/4 | D4/2. | r/2.')
    hi = seq('r/4 | r/2. | r/2. | r/4 A4/4 A4/4 | r/4 F#4/4 F#4/4 | r/2. | r/2. | r/4 A4/4 A4/4 | r/4 G4/4 G4/4 | r/2. | r/2. | r/4 B4/4 B4/4 |'
             ' r/4 G4/4 G4/4 | r/2. | r/2. | r/4 B4/4 B4/4 | r/4 F#4/4 F#4/4 | r/2. | r/2. | r/4 D5/4 D5/4 | r/4 A4/4 A4/4 | r/2. | r/2. |'
             ' r/4 D5/4 D5/4 | r/4 B4/4 B4/4 | r/2. | r/2. | r/2. | r/2. | r/2. | r/2.')
    pick = PPQ  # затакт
    # вступление: тремоло скрипок на ля и раскачка вальса (темп за палочкой)
    s.marks.append([0, 'A'])
    intro = 4 * BAR
    for b in range(4):
        s.put('vn1', 'Violin I', seq('A5/2.'), b * BAR, 40 + b * 8)
        s.put('vn2', 'Violin II', seq('A4/2.'), b * BAR, 38 + b * 8)
        s.put('hn', 'Horn', seq('A3/2.' if b < 2 else 'D4+A3/2.'), b * BAR, 44 + b * 6)
    s.tempo_ramp(0, intro, 120, 168, PPQ)
    s.specials.append({'kind': 'accel', 'tick': 0, 'len': intro, 'to': 1.4, 'every': 3})
    t0 = intro - pick
    harm = ['D'] * 4 + ['A'] * 11 + ['D'] * 9 + ['Em', 'Em', 'A', 'A', 'D', 'D']
    CH = {'D': ('D2', 'F#3+A3+D4'), 'A': ('A1', 'E3+G3+C#4'), 'Em': ('E2', 'E3+G3+B3')}
    for rep in range(2):
        tt = t0 + rep * (len(harm) * BAR)
        v = 70 if rep == 0 else 100
        s.marks.append([tt + pick, 'BC'[rep]])
        s.put('vc', 'Violoncello', lo, tt, v)
        s.put('hn', 'Horn', lo, tt, v - 8)
        if rep:
            s.put('bn', 'Bassoon', lo, tt, v - 10)
            s.put('cl', 'Clarinet', [(d, [p + 12 for p in ps]) for d, ps in lo], tt, v - 10)
            s.put('tb', 'Trombone', lo, tt, v - 20)
        s.put('vn1', 'Violin I', [(d, [p + 12 for p in ps]) for d, ps in hi], tt, v, 1, 0.6)
        s.put('vn2', 'Violin II', hi, tt, v - 6, 1, 0.6)
        if rep:
            s.put('fl', 'Flute', [(d, [p + 12 for p in ps]) for d, ps in hi], tt, v - 6, 1, 0.6)
        # ум-па-па
        for b, hname in enumerate(harm):
            bass, ch = CH[hname]
            bt = tt + pick + b * BAR
            s.put('cb', 'Contrabass', seq(f'{bass}/4 r/2'), bt, v - 4, 2 if rep == 0 else 1, 0.7)
            s.put('va', 'Viola', seq(f'r/4 {ch}/4 {ch}/4'), bt, v - 16, 1, 0.5)
            if rep and b % 2 == 0:
                s.put('timp', 'Timpani', seq(f'{"D2" if hname == "D" else "A1"}/4 r/2'), bt, v - 20, 1)
    t = t0 + 2 * len(harm) * BAR + pick
    s.tempo.append([intro, 168])
    # конец: замедление и фермата на ре мажоре
    s.marks.append([t, 'D'])
    s.tempo_ramp(t - 2 * BAR, t + BAR, 168, 96, PPQ)
    s.specials.append({'kind': 'rit', 'tick': t - 2 * BAR, 'len': 2 * BAR, 'to': 0.6, 'every': 3})
    for instr, name, ch, v in [('vn1', 'Violin I', 'D5+F#5', 110), ('vn2', 'Violin II', 'A4+D5', 108), ('va', 'Viola', 'F#4', 106), ('vc', 'Violoncello', 'D3+A3', 108),
                               ('cb', 'Contrabass', 'D2', 108), ('hn', 'Horn', 'D4+F#4', 104), ('fl', 'Flute', 'D6', 100), ('cl', 'Clarinet', 'A5', 100),
                               ('tp', 'Trumpet', 'A4+D5', 104), ('tb', 'Trombone', 'D3+F#3', 100)]:
        s.put(instr, name, seq(f'{ch}/2.'), t, v)
    s.put('timp', 'Timpani', seq('D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 D2/16'), t, 104, 1)
    s.specials.append({'kind': 'fermata', 'tick': t, 'len': BAR})
    s.end = t + BAR
    s.save()


if __name__ == '__main__':
    mountain()
    morning()
    danube()
