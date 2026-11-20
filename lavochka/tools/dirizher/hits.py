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


# ---------------------------------------------------------------- Штраус-отец. «Марш Радецкого»
# Ноты сняты с полной партитуры (IMSLP #593660, набор Vasic; оригинал — общественное достояние): мелодия первых скрипок,
# гармония — по басам и средним голосам; переложение своё. Размер 2/2 (доля — половинная), половинная ≈ 116.
# Зал хлопает в теме A (в «да капо» — и в середине): особое место clap — палочка ведёт хлопки, громкость — динамика.
def radetzky():
    s = Score('radetzky', '«Марш Радецкого»', 'Иоганн Штраус-отец', 2, 2)
    BAR = PPQ * 4
    s.tempo = [[0, 232]]
    INTRO = 'D6/8 D6/8 D6/8 r/8 D6/8 D6/8 D6/8 r/8 | F#6/4 E6/4 D6/4. C#6/8 | B5/8 A#5/8 B5/8 C#6/8 D6/4 E6/4 | A5/4 r/4 r/4 F#5/8 E#5/8'
    INTRO_B = 'D3/8 D3/8 D3/8 r/8 D3/8 D3/8 D3/8 r/8 | D4/4 C#4/4 B3/4. A3/8 | G#3/4 r/4 r/4 E3/4 | A3/4 r/4 r/2'
    A1 = 'F#5/8 r/8 F#5/8 E#5/8 F#5/8 r/8 F#5/8 E#5/8'
    A2 = 'F#5/8 r/8 E5/8 r/8 D5/8 r/8 F#5/8 E#5/8'
    A4 = 'F#5/8 r/8 B5/8 r/8 A5/8 r/8 A5/8 F#5/8'
    A_TAIL = ['G#5/8 r/8 F#6/8 r/8 E6/2', 'r/4 E6/8 r/8 D6/2', 'A5/4. B5/8 A5/8 G5/8 F#5/8 E5/8']
    A_MEL = ' | '.join([A1, A2, A1, A4, 'G5/8 r/8 B5/8 r/8 A5/8 r/8 A5/8 E5/8', A4, 'E5/8 r/8 C#6/4 D5/8 r/8 B5/4',
                        'C#5/8 r/8 A5/8 G#5/8 A5/8 B5/8 A5/8 G5/8', A1, A2, A1, A4] + A_TAIL)
    A_END = 'D5/4 D5/4 D5/4 D6/8 C#6/8'      # перед серединой: затакт ре-до#
    A_END2 = 'D5/4 D5/4 D5/4 F#5/8 E#5/8'    # перед трио — затакт темы
    A_FINE = 'D5/4 D6/4 D6/4 r/4'
    A_HARM = [('D', 'D'), ('D', 'D'), ('D', 'D'), ('D', 'D'), ('A7c', 'A7c'), ('D', 'D'), ('E', 'E'), ('A', 'A7'),
              ('D', 'D'), ('D', 'D'), ('D', 'D'), ('D', 'Df'), ('E7', 'A'), ('D', 'Df'), ('G', 'A'), ('D', 'D')]
    B1 = 'D6/8 r/8 D6/8 C#6/8 D6/8 r/8 D6/8 C#6/8'
    B2 = 'D6/8 r/8 G6/8 r/8 G5/8 r/8 D6/8 C#6/8'
    B5 = 'F#5+A5/2 E5+G5/8 r/8 A4/16 G5+B5/16 r/8'
    B6 = 'G5+B5/2 F#5+A5/8 r/8 F#5/16 D6/16 r/8'
    B11 = 'C#6/8 r/8 C#6/8 A#5/8 B5/8 r/8 D6/8 r/8'
    B13 = 'F#5+F#6/4 F#5+F#6/8 F#5+F#6/8 F#5+F#6/4 F#5+F#6/8 F#5+F#6/8'
    B_MEL = ' | '.join([B1, B2, B1, 'D6/8 r/8 F#6/8 r/8 A5/8 r/8 A4/16 D5/16 r/8', B5, B6,
                        'A5+C#6/8 r/8 A5+C#6/8 G5+B5/8 F#5+A5/8 r/8 E5+G5/8 r/8', 'G5+B5/8 r/8 G5+B5/8 F#5+A5/8 E5+G5/8 r/8 D5+F#5/8 r/8',
                        B5, B6, B11, B11, B13, B13, 'F#5+F#6/4 r/4 r/2', 'r/2 r/4 F#5/8 E#5/8'])
    B_HARM = [('G', 'G'), ('G', 'G'), ('D', 'D'), ('D', 'D'), ('A7p', 'A7p'), ('Dp', 'Dp'), ('A7p', 'A7p'), ('Dp', 'Dp'), ('A7p', 'A7p'), ('Dp', 'Dp'),
              ('F#', 'Bm'), ('F#', 'Bm'), ('F#', 'Bm'), ('F#', 'Bm'), ('F#', None), (None, None)]
    T1 = 'E4/8 C#5/8 C#5/4. r/8 r/4'
    T2 = 'E4/8 C#5/8 C#5/2 C#5/8 D5/8'
    T3 = 'E5/8 A5/8 A5/8 r/8 A5/8 r/8 A5/8 r/8'
    T4 = 'C#5/2. B4/8 C#5/8'
    T5 = 'D5/8 G#5/8 B5/2 A5/4'
    T6 = 'G#5/4 F#5/8 r/8 F#5/8 r/8 F#5/8 r/8'
    T7B = 'E5/8 A5/8 C#6/8 r/8 D5/8 G#5/8 B5/8 r/8'
    F_PART = [T5, T6, T3, T4, T5, T6, 'C#5/8 E5/8 A5/8 C#6/8 E6/4 D6/8 C#6/8', 'B5/8 A5/8 G#5/8 F#5/8 E5/8 D5/8 C#5/8 B4/8']
    TRIO_IN = 'E5/2. B4/4 | G#5/4 E5/4 B5/4 G#5/4 | E6/4 r/4 r/2 | r/1'
    TRIO = ' | '.join([T1, T2, T3, T4, T5, T6, T3, 'C#5/2. r/4',                      # 1-я вольта
                       T1, T2, T3, T4, T5, T6, T7B, 'A5/2 r/4 B4/8 C#5/8'] + F_PART  # 2-я вольта, F
                      + [T1, T2, T3, T4, T5, T6, T7B, 'A5/4 A5/4 A5/4 r/4'])
    TH = [('A', 'A'), ('A', 'A'), ('A', 'A'), ('A', 'A'), ('E', 'E'), ('E7', 'E7'), ('A', 'A'), ('A', 'A')]
    F_HARM = [('E', 'E'), ('E7', 'E7'), ('A', 'A'), ('A', 'A'), ('E', 'E'), ('E7', 'E7'), ('A', 'A'), ('E7', 'E7')]
    TRIO_HARM = TH + TH[:6] + [('A', 'E'), ('A', 'A')] + F_HARM + TH[:6] + [('A', 'E'), ('A', 'A')]
    # аккорд: бас (корень, квинта) и «па» — средние голоса
    CH = {'D': ('D3', 'A2', 'F#4+A4+D5'), 'Df': ('D3', 'F#2', 'F#4+A4+D5'), 'Dp': ('A2', 'A3', 'F#4+A4+D5'),
          'A': ('A2', 'E2', 'E4+A4+C#5'), 'A7': ('A2', 'E2', 'E4+G4+C#5'), 'A7c': ('C#3', 'A2', 'E4+G4+A4'), 'A7p': ('A2', 'A3', 'E4+G4+C#5'),
          'E': ('E3', 'E3', 'E4+G#4+B4'), 'E7': ('E3', 'B2', 'D4+G#4+B4'), 'G': ('G2', 'B2', 'G4+B4+D5'),
          'F#': ('F#2', 'C#3', 'F#4+A#4+C#5'), 'Bm': ('B2', 'F#2', 'F#4+B4+D5')}

    def tr(text, k):
        return [(d, [p + k for p in ps]) for d, ps in seq(text)]

    def accomp(t0, harm, v, brass=False, drums=True):
        """Марш «ум-па»: бас на сильных четвертях (корень, квинта), аккорд на слабых; барабаны, литавры, медь на громком."""
        for b, (h1, h2) in enumerate(harm):
            for half, h in enumerate((h1, h2)):
                if h is None:
                    continue
                root, fifth, chord = CH[h]
                t = t0 + b * BAR + half * PPQ * 2
                bass = root if half == 0 else fifth
                s.put('cb', 'Contrabass', seq(f'{bass}/4 r/4'), t, v, 2 if v < 80 else 1, 0.7)
                s.put('vc', 'Violoncello', seq(f'{bass}/4 r/4'), t, v - 4, 2 if v < 80 else 1, 0.7)
                s.put('bn', 'Bassoon', seq(f'{bass}/4 r/4'), t, v - 10, 1, 0.6)
                s.put('vn2', 'Violin II', seq(f'r/4 {chord}/4'), t, v - 10, 1, 0.5)
                s.put('va', 'Viola', seq(f'r/4 {chord.split("+")[0]}/4'), t, v - 12, 1, 0.5)
                s.put('hn', 'Horn', seq(f'r/4 {chord}/4'), t, v - 14, 1, 0.6)
                if brass:
                    s.put('tb', 'Trombone', tr(f'{chord}/4 r/4', -12), t, v - 10, 1, 0.6)
                    s.put('tu', 'Tuba', seq(f'{root}/4 r/4'), t, v - 12, 1, 0.6)
                    if half == 0:
                        s.put('timp', 'Timpani', seq(f'{"D2" if root[0] in "DFB" else "A1"}/4 r/4'), t, v - 16, 1)
                if drums:
                    # малый — дробь на слабые, большой — на сильную, тарелки — с большим на громком
                    s.put('perc', 'Snare', seq('D2/8 r/8 D2/8 D2/8'), t, v - 30, 1)
                    s.put('perc', 'Bass drum', seq('B1/4 r/4'), t, v - 20, 1)
                    if brass and half == 0:
                        s.put('perc', 'Cymbals', seq('C#3/4 r/4'), t, v - 25, 1)

    def melody(t0, text, v, parts):
        for instr, name, k, dv in parts:
            s.put(instr, name, tr(text, k), t0, v + dv, 0 if instr in ('vn1', 'vc') else 1, 0.8)

    V1 = [('vn1', 'Violin I', 0, 0), ('fl', 'Flute', 0, -8), ('cl', 'Clarinet', 0, -10)]
    TUTTI = V1 + [('ob', 'Oboe', 0, -8), ('picc', 'Piccolo', 12, -18), ('tp', 'Trumpet', -12, -12)]

    def march(t, dc):
        """Вступление, A, B, A' — первый раз и «да капо»; возвращает конец."""
        s.marks.append([t, 'A' if not dc else 'E'])
        for instr, name, k, dv in TUTTI:
            s.put(instr, name, tr(INTRO, k), t, 112 + dv, 0 if instr == 'vn1' else 1, 0.85)
        for instr, name in (('vc', 'Violoncello'), ('cb', 'Contrabass'), ('bn', 'Bassoon'), ('tb', 'Trombone'), ('tu', 'Tuba')):
            s.put(instr, name, seq(INTRO_B), t, 110, 0, 0.85)
        s.put('perc', 'Snare', seq('D2/8 D2/8 D2/8 r/8 D2/8 D2/8 D2/8 r/8'), t, 100, 1)
        s.put('timp', 'Timpani', seq('D2/8 D2/8 D2/8 r/8 D2/8 D2/8 D2/8 r/8 | D2/2 A1/2 | E2/2 r/4 E2/4 | A1/4 r/4 r/2'), t, 104, 1)
        s.specials.append({'kind': 'sforzando', 'tick': t, 'len': PPQ})
        t += 4 * BAR
        for k in range(2):
            if k == 1:
                # середина B
                s.marks.append([t, 'C' if not dc else 'G'])
                melody(t, B_MEL, 100, TUTTI)
                s.put('vc', 'Violoncello', tr(' | '.join([B1, B2, B1, 'D6/8 r/8 F#6/8 r/8 A5/8 r/8 r/4']), -24), t, 104, 0, 0.8)
                accomp(t, B_HARM, 96, brass=True)
                s.specials.append({'kind': 'subito_p', 'tick': t + 4 * BAR, 'len': PPQ})
                s.specials.append({'kind': 'cresc', 'tick': t + 10 * BAR, 'len': PPQ * 2})
                if dc:
                    s.specials.append({'kind': 'clap', 'tick': t, 'len': 14 * BAR})
                t += 16 * BAR
            mel = A_MEL + ' | ' + (A_END if k == 0 else (A_FINE if dc else A_END2))
            s.marks.append([t, ('D' if k else 'B') if not dc else ('H' if k else 'F')])
            v = 76 if not dc else 84
            melody(t, mel, v, V1)
            accomp(t, A_HARM, v, brass=False)
            # громкий конец темы — тутти
            for instr, name, k2, dv in TUTTI[3:]:
                s.put(instr, name, tr(' | '.join(A_TAIL), k2), t + 12 * BAR, 106 + dv, 1, 0.8)
            s.put('tb', 'Trombone', seq('E3+G#3+D4/2 r/4 A2/4 | D3+F#3+A3/2 r/4 F#2/4 | G2/4 r/4 A2/4 r/4'), t + 12 * BAR, 104, 1, 0.8)
            s.specials.append({'kind': 'cresc', 'tick': t + 11 * BAR, 'len': PPQ * 2})
            s.specials.append({'kind': 'clap', 'tick': t, 'len': 15 * BAR})
            t += 16 * BAR
        return t

    t = march(0, False)
    # трио — без хлопков, тихо и певуче
    s.marks.append([t, 'Trio'])
    melody(t, TRIO_IN, 96, [('vn1', 'Violin I', 0, 0), ('vc', 'Violoncello', -12, 0), ('cb', 'Contrabass', -24, -6), ('hn', 'Horn', -12, -6), ('bn', 'Bassoon', -12, -6)])
    t += 4 * BAR
    melody(t, TRIO, 64, [('vn1', 'Violin I', 0, 0), ('vc', 'Violoncello', -12, -2), ('cl', 'Clarinet', 0, -10)])
    accomp(t, TRIO_HARM, 58, brass=False, drums=False)
    s.specials.append({'kind': 'subito_p', 'tick': t, 'len': PPQ})
    s.specials.append({'kind': 'solo', 'tick': t, 'len': 4 * BAR, 'instr': 'vc'})
    f = t + 16 * BAR
    s.specials.append({'kind': 'cresc', 'tick': f, 'len': PPQ * 2})
    melody(f, ' | '.join(F_PART), 96, [('fl', 'Flute', 0, -6), ('ob', 'Oboe', 0, -6), ('tp', 'Trumpet', -12, -10)])
    accomp(f, F_HARM, 92, brass=True)
    s.specials.append({'kind': 'subito_p', 'tick': f + 8 * BAR, 'len': PPQ})
    t += len(TRIO_HARM) * BAR
    # да капо
    t = march(t, True)
    s.end = t
    s.save('своё переложение по партитуре IMSLP #593660 (Штраус-отец, общественное достояние)')


# ---------------------------------------------------------------- Оффенбах. «Канкан» (Адский галоп из «Орфея в аду»)
# Мелодия и гармония сняты с набранной партитуры IMSLP #1005532 (мелодия Оффенбаха — общественное достояние; переложение
# той партитуры не берём — оркестровка своя). 2/4, четверть ≈ 170. Тема C — в соль мажоре (до-бекар), середина D — тише,
# с треугольником. Во второй раз тему C зал хлопает, в последний раз оркестр разгоняется за палочкой.
def cancan():
    s = Score('cancan', '«Канкан» (Адский галоп из «Орфея в аду»)', 'Жак Оффенбах', 2, 4)
    BAR = PPQ * 2
    s.tempo = [[0, 170]]
    C_MEL = ['G5/2', 'A5/8 C6/8 B5/8 A5/8', 'D6/4 D6/4', 'D6/8 E6/8 B5/8 C6/8', 'A5/4 A5/4', 'A5/8 C6/8 B5/8 A5/8',
             'G5/8 G6/8 F#6/8 E6/8', 'D6/8 C6/8 B5/8 A5/8', 'G5/2', 'A5/8 C6/8 B5/8 A5/8', 'D6/4 D6/4', 'D6/8 E6/8 B5/8 C6/8',
             'A5/4 A5/4', 'A5/8 C6/8 B5/8 A5/8', 'G5/8 D6/8 A5/8 B5/8']
    C_HARM = ['G', 'D7', 'G', 'G', 'D7', 'D7', 'G', 'D7', 'G', 'D7', 'G', 'G', 'D7', 'D7', 'GD']
    D_MEL = ['A4/8 E5/8 E5/8 F#5/8', 'E5/8 D5/8 D5/8 F#5/8', 'G5/8 B5/8 D6/8 B5/8', 'B5/8 A5/8 A5/4', 'B5/8 C#5/8 C#5/8 B5/8',
             'A5/8 D5/8 D5/8 F#5/8', 'F#5/8 E5/8 F#5/8 E5/8', 'F#5/8 E5/8 F#5/8 E5/8', 'A4/8 E5/8 E5/8 F#5/8', 'E5/8 D5/8 D5/8 F#5/8',
             'G5/8 B5/8 D6/8 B5/8', 'B5/8 A5/8 A5/4']
    D_HARM = ['A7', 'D', 'G', 'D', 'A7', 'D', 'E7', 'A', 'A7', 'D', 'G', 'D']
    CH = {'G': ('G2', 'D3', 'B3+D4+G4'), 'D7': ('D3', 'A2', 'A3+C4+F#4'), 'D': ('D3', 'A2', 'A3+D4+F#4'),
          'A7': ('A2', 'E3', 'C#4+E4+G4'), 'A': ('A2', 'E3', 'C#4+E4+A4'), 'E7': ('E2', 'B2', 'D4+G#4+B4')}

    def tr(text, k):
        return [(d, [p + k for p in ps]) for d, ps in seq(text)]

    def mel(t0, bars, v, parts):
        text = ' | '.join(bars)
        for instr, name, k, dv in parts:
            s.put(instr, name, tr(text, k), t0, v + dv, 0 if instr in ('vn1', 'vc') else 1, 0.75)

    def oompah(t0, harm, v, brass):
        """Галоп: бас восьмыми на долях, аккорд — на слабых восьмых; барабан на долях."""
        for b, h in enumerate(harm):
            for half, hh in enumerate(['G', 'D7'] if h == 'GD' else [h, h]):
                root, fifth, chord = CH[hh]
                t = t0 + b * BAR + half * PPQ
                s.put('cb', 'Contrabass', seq(f'{root}/8 r/8'), t, v, 1, 0.6)
                s.put('vc', 'Violoncello', seq(f'{root}/8 r/8'), t, v - 4, 1, 0.6)
                s.put('bn', 'Bassoon', seq(f'{root}/8 r/8'), t, v - 10, 1, 0.6)
                s.put('vn2', 'Violin II', seq(f'r/8 {chord}/8'), t, v - 10, 1, 0.5)
                s.put('va', 'Viola', seq(f'r/8 {chord.split("+")[0]}/8'), t, v - 12, 1, 0.5)
                s.put('hn', 'Horn', seq(f'r/8 {chord}/8'), t, v - 14, 1, 0.5)
                s.put('perc', 'Bass drum', seq('B1/8 r/8'), t, v - 22, 1)
                if brass:
                    s.put('tb', 'Trombone', seq(f'r/8 {chord}/8'), t, v - 12, 1, 0.5)
                    s.put('tu', 'Tuba', seq(f'{root}/8 r/8'), t, v - 12, 1, 0.6)
                    s.put('perc', 'Snare', seq('r/8 D2/16 D2/16'), t, v - 30, 1)
                    if half == 0:
                        s.put('timp', 'Timpani', seq(f'{"D2" if root[0] in "DA" else "G1"}/8 r/8'), t, v - 18, 1)

    TOP = [('vn1', 'Violin I', 0, 0), ('fl', 'Flute', 12, -10), ('ob', 'Oboe', 0, -8), ('cl', 'Clarinet', -12, -10)]
    LOUD = TOP + [('picc', 'Piccolo', 12, -16), ('tp', 'Trumpet', -12, -10)]

    def theme(t, v, parts, brass, last=False):
        for rep in range(2):
            ending = 'G5/4 D5/4' if rep == 0 else ('G5/4 G6/4' if not last else 'G5/4 r/4')
            mel(t, C_MEL + [ending], v + rep * 6, parts)
            oompah(t, C_HARM + ['G'], v + rep * 6, brass)
            t += 16 * BAR
        return t

    def middle(t):
        mel(t, D_MEL, 64, [('vn1', 'Violin I', 0, 0), ('fl', 'Flute', 12, -8)])
        for b, h in enumerate(D_HARM):
            root, fifth, chord = CH[h]
            bt = t + b * BAR
            for instr, name, text, dv in (('cb', 'Contrabass', f'{root}/2', 0), ('vc', 'Violoncello', f'{root}/2', -2),
                                          ('vn2', 'Violin II', f'{chord}/2', -8), ('va', 'Viola', f'{chord.split("+")[0]}/2', -10)):
                s.put(instr, name, seq(text), bt, 60 + dv, 1, 0.35)
            s.put('perc', 'Triangle', seq('A5/8 r/8 A5/8 r/8' if b % 2 else 'A5/8 r/8 r/4'), bt, 70, 1)
        return t + 12 * BAR

    t = 0
    # вступление: ре на точечном ритме, нарастание, доминанта
    s.marks.append([0, 'A'])
    for b in range(3):
        for instr, name, ch, v in (('vn1', 'Violin I', 'D5+D6', 70), ('vn2', 'Violin II', 'A4+D5', 66), ('va', 'Viola', 'F#4', 64),
                                   ('vc', 'Violoncello', 'D3', 68), ('cb', 'Contrabass', 'D2', 68), ('fl', 'Flute', 'D6', 60), ('hn', 'Horn', 'A3+D4', 60)):
            s.put(instr, name, seq(f'{ch}/8. {ch}/16 {ch}/8. {ch}/16'), b * BAR, v + b * 14, 1, 0.8)
    for instr, name, ch in (('vn1', 'Violin I', 'D5'), ('vn2', 'Violin II', 'A4+C5+F#5'), ('va', 'Viola', 'D4'), ('vc', 'Violoncello', 'D3'),
                            ('cb', 'Contrabass', 'D2'), ('fl', 'Flute', 'D6'), ('ob', 'Oboe', 'C5'), ('hn', 'Horn', 'F#4'), ('tp', 'Trumpet', 'A4'),
                            ('tb', 'Trombone', 'D3+A3'), ('timp', 'Timpani', 'D2')):
        s.put(instr, name, seq(f'r/8 r/8 {ch}/4'), 3 * BAR, 112, 1, 0.7)
    s.put('perc', 'Snare', seq('D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 | D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 | '
                                'D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 | r/4 C#3/4'), 0, 80, 1)
    s.specials.append({'kind': 'cresc', 'tick': 0, 'len': PPQ})
    s.specials.append({'kind': 'sforzando', 'tick': 3 * BAR + PPQ, 'len': PPQ})
    t = 4 * BAR
    s.marks.append([t, 'B'])
    t = theme(t, 92, TOP, False)
    s.marks.append([t, 'C'])
    s.specials.append({'kind': 'subito_p', 'tick': t, 'len': PPQ})
    t = middle(t)
    s.marks.append([t, 'D'])
    s.specials.append({'kind': 'clap', 'tick': t, 'len': 31 * BAR})
    s.specials.append({'kind': 'sforzando', 'tick': t, 'len': PPQ})
    t = theme(t, 102, LOUD, True)
    s.marks.append([t, 'E'])
    s.specials.append({'kind': 'subito_p', 'tick': t, 'len': PPQ})
    t = middle(t)
    # последний раз — разгон за палочкой (раз в такт)
    s.marks.append([t, 'F'])
    s.specials.append({'kind': 'sforzando', 'tick': t, 'len': PPQ})
    s.specials.append({'kind': 'accel', 'tick': t, 'len': 31 * BAR, 'to': 1.25, 'every': 2})
    s.tempo_ramp(t, t + 32 * BAR, 170, 205, BAR)
    t = theme(t, 108, LOUD, True, last=True)
    # кода: держат ре, бас спускается гаммой; точечный ритм; удары; последний аккорд
    s.marks.append([t, 'G'])
    s.tempo.append([t, 205])
    held = 'D6/2 | D6/2 | D6/2 | D6/2 | D6/2 | D6/2'
    for instr, name, k, v in (('vn1', 'Violin I', 0, 110), ('fl', 'Flute', 12, 100), ('picc', 'Piccolo', 12, 92), ('ob', 'Oboe', -12, 100),
                              ('vn2', 'Violin II', -5, 104), ('hn', 'Horn', -24, 100)):
        s.put(instr, name, tr(held, k), t, v, 0, 1.0)
    for instr, name, k in (('vc', 'Violoncello', 0), ('cb', 'Contrabass', -12), ('bn', 'Bassoon', 0), ('tb', 'Trombone', 0), ('tu', 'Tuba', -12)):
        s.put(instr, name, tr('A3/4 G3/4 | F#3/4 E3/4 | D3/4 D3/4 | C#3/4 B2/4 | A2/4 G2/4 | F#2/4 E2/4', k), t, 110, 0, 0.9)
    s.put('perc', 'Cymbals', seq('C#3/2 | r/2 | r/2 | r/2 | C#3/2 | r/2'), t, 100, 1)
    s.specials.append({'kind': 'cresc', 'tick': t, 'len': PPQ})
    t += 6 * BAR
    chord = 'D4+F#4+A4+D5'
    hits = f'{chord}/8. {chord}/16 {chord}/8. {chord}/16 | {chord}/8. {chord}/16 {chord}/8. {chord}/16 | {chord}/4 r/4 | {chord}/4 r/4 | A3+C#4+E4+A4/4 r/4 | {chord}/4 r/4 | {chord}/2 | {chord}/2 | {chord}/4 r/4'
    for instr, name, k, v in (('vn1', 'Violin I', 12, 118), ('vn2', 'Violin II', 0, 114), ('va', 'Viola', -12, 112), ('fl', 'Flute', 12, 108),
                              ('ob', 'Oboe', 0, 108), ('cl', 'Clarinet', 0, 106), ('hn', 'Horn', -12, 110), ('tp', 'Trumpet', 0, 114), ('tb', 'Trombone', -12, 112)):
        s.put(instr, name, tr(hits, k), t, v, 1, 0.85)
    for instr, name in (('vc', 'Violoncello'), ('cb', 'Contrabass'), ('tu', 'Tuba'), ('bn', 'Bassoon')):
        s.put(instr, name, seq('D3/8. D3/16 D3/8. D3/16 | D3/8. D3/16 D3/8. D3/16 | D3/4 r/4 | D3/4 r/4 | A2/4 r/4 | D3/4 r/4 | D2/2 | D2/2 | D2/4 r/4'), t, 116, 1, 0.85)
    s.put('timp', 'Timpani', seq('D2/8 D2/8 D2/8 D2/8 | D2/8 D2/8 D2/8 D2/8 | D2/4 r/4 | D2/4 r/4 | A1/4 r/4 | D2/4 r/4 | D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 | D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 D2/16 | D2/4 r/4'), t, 112, 1)
    s.put('perc', 'Cymbals', seq('r/2 | r/2 | C#3/4 r/4 | C#3/4 r/4 | C#3/4 r/4 | C#3/4 r/4 | C#3/2 | r/2 | C#3/4 r/4'), t, 110, 1)
    s.specials.append({'kind': 'fermata', 'tick': t + 6 * BAR, 'len': BAR * 2})
    s.end = t + 9 * BAR
    s.save('своё переложение (мелодия Оффенбаха — общественное достояние; ноты сверены с IMSLP #1005532)')


if __name__ == '__main__':
    mountain()
    morning()
    danube()
    radetzky()
    cancan()
