"""Симулятор дирижёра: MusicXML (.mxl/.musicxml) → JSON партитуры игры (src/dirizher/core/score.ts, ScoreJson).

python tools/dirizher/score.py <файл.mxl> <выход.json> --id b5-1 --title "…" --composer "…" [--bars 1-124] [--source "…"]

Без music21 — свой разбор: части и инструменты (instrument-sound / имя части), такты с повторами и вольтами (развёртка
по первой части), divisions → 480 тиков на четверть, транспонирующие инструменты (transpose), лиги (tie) — склейка,
аккорды, голоса (backup/forward), форшлаги пропускаются, динамика (p … ff, sf, акценты) → сила, staccato и pizz./arco →
приём (сила + 128 × приём: 1 — коротко, 2 — пиццикато), темп из <sound tempo>, размер, буквы репетиций, ферматы
(тик, отмеченный ферматой хотя бы в трети частей). --bars — отрывок по номерам развёрнутых тактов (с 1), включительно.
"""
import argparse
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

PPQ = 480
STEP = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
DYN = {'pppp': 22, 'ppp': 30, 'pp': 40, 'p': 55, 'mp': 68, 'mf': 80, 'f': 95, 'ff': 110, 'fff': 120, 'ffff': 126,
       'sf': 112, 'sfz': 115, 'sffz': 120, 'fz': 110, 'rfz': 105, 'fp': 95, 'sfp': 105}


def instr_of(sound: str, name: str) -> str | None:
    s = (sound or '').lower()
    n = (name or '').lower()
    def has(*k):
        return any(x in s or x in n for x in k)
    if has('piccolo'):
        return 'picc'
    if has('flute', 'flauto'):
        return 'fl'
    if has('english horn', 'english-horn', 'cor anglais', 'english_horn', 'oboe.english'):
        return 'eh'
    if has('oboe'):
        return 'ob'
    if has('bass clarinet', 'clarinet.bass'):
        return 'bcl'
    if has('clarinet'):
        return 'cl'
    if has('contrabassoon', 'contrafagotto', 'contra-bassoon'):
        return 'cbn'
    if has('bassoon', 'fagott'):
        return 'bn'
    if has('horn', 'corno') and 'english' not in n:
        return 'hn'
    if has('trumpet', 'tromba', 'trompete'):
        return 'tp'
    if has('trombone', 'posaune'):
        return 'tb'
    if has('tuba'):
        return 'tu'
    if has('timpani', 'pauken'):
        return 'timp'
    if has('harp', 'arpa'):
        return 'harp'
    if has('celesta', 'glockenspiel', 'bells'):
        return 'cel'
    if has('cymbal', 'triangle', 'drum', 'percussion', 'tam'):
        return 'perc'
    if has('contrabass', 'double bass', 'kontrabass', 'basso'):
        return 'cb'
    if has('violoncell', 'cello'):
        return 'vc'
    if has('viola', 'viole', 'bratsche'):
        return 'va'
    if has('violin', 'violino', 'violine'):
        return 'vn2' if re.search(r'(\b2\b|\bii\b)', n) else 'vn1'
    return None


def load_root(path: str) -> ET.Element:
    if path.endswith('.mxl'):
        z = zipfile.ZipFile(path)
        cont = z.read('META-INF/container.xml').decode('utf8')
        m = re.search(r'full-path="([^"]+)"', cont)
        data = z.read(m.group(1))
    else:
        data = open(path, 'rb').read()
    return ET.fromstring(data)


def measure_order(measures: list[ET.Element]) -> list[int]:
    """Развёртка повторов по первой части: индексы тактов в порядке исполнения."""
    order = []
    i = 0
    start = 0
    passes = {}  # индекс обратного повтора → сколько раз уже повторили
    pass_no = 1
    guard = 0
    while i < len(measures) and guard < 20000:
        guard += 1
        m = measures[i]
        endings = [b.find('ending') for b in m.findall('barline') if b.find('ending') is not None]
        skip = False
        for e in endings:
            nums = [int(x) for x in re.findall(r'\d+', e.get('number', '1'))]
            if e.get('type') == 'start' and nums and pass_no not in nums:
                skip = True
        if skip:
            # пропустить всю вольту до её конца
            j = i
            while j < len(measures):
                ends = [b.find('ending') for b in measures[j].findall('barline') if b.find('ending') is not None]
                if any(e.get('type') in ('stop', 'discontinue') for e in ends):
                    break
                j += 1
            i = j + 1
            continue
        for b in m.findall('barline'):
            r = b.find('repeat')
            if r is not None and r.get('direction') == 'forward':
                if start != i:
                    pass_no = 1
                start = i
        order.append(i)
        back = next((b.find('repeat') for b in m.findall('barline') if b.find('repeat') is not None and b.find('repeat').get('direction') == 'backward'), None)
        if back is not None:
            times = int(back.get('times', '2'))
            done = passes.get(i, 1)
            if done < times:
                passes[i] = done + 1
                pass_no = done + 1
                i = start
                continue
            passes[i] = 1
            pass_no = 1
        i += 1
    return order


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--id', required=True)
    ap.add_argument('--title', required=True)
    ap.add_argument('--composer', required=True)
    ap.add_argument('--source', default='OpenScore Orchestra (CC0)')
    ap.add_argument('--bars', default='')
    ap.add_argument('--tempo', type=float, default=0, help='множитель темпа (если в партитуре темп странный)')
    a = ap.parse_args()

    root = load_root(a.src)
    names = {}
    sounds = {}
    for sp in root.iter('score-part'):
        pid = sp.get('id')
        names[pid] = (sp.findtext('part-name') or '').strip()
        sounds[pid] = (sp.findtext('.//instrument-sound') or '').strip()
    parts_xml = root.findall('part')
    m0 = parts_xml[0].findall('measure')
    order = measure_order(m0)

    # длина каждого такта (по первой части; divisions меняются)
    def measure_len(m, div):
        cur = mx = 0
        for el in m:
            if el.tag == 'attributes' and el.findtext('divisions'):
                div = int(el.findtext('divisions'))
            if el.tag == 'note':
                if el.find('chord') is not None or el.find('grace') is not None:
                    continue
                cur += int(el.findtext('duration') or 0)
            elif el.tag == 'backup':
                cur -= int(el.findtext('duration') or 0)
            elif el.tag == 'forward':
                cur += int(el.findtext('duration') or 0)
            mx = max(mx, cur)
        return mx, div

    lens = []
    div = 1
    time_sig = (4, 4)
    for m in m0:
        for at in m.findall('attributes'):
            if at.findtext('divisions'):
                div = int(at.findtext('divisions'))
            t = at.find('time')
            if t is not None and t.findtext('beats'):
                time_sig = (int(re.findall(r'\d+', t.findtext('beats'))[0]), int(t.findtext('beat-type')))
        ln, div = measure_len(m, div)
        nominal = round(time_sig[0] * 4 * PPQ / time_sig[1])
        lens.append(round(ln * PPQ / div) if ln else nominal)
    starts = []
    t = 0
    for idx in order:
        starts.append(t)
        t += lens[idx]
    total = t

    lo, hi = 1, len(order)
    if a.bars:
        x, y = a.bars.split('-')
        lo, hi = int(x), int(y)
    cut_a = starts[lo - 1]
    cut_b = starts[hi] if hi < len(starts) else total

    tempo = {}
    times = {}
    marks = {}
    fermatas = {}
    parts_out = []
    for pi, part in enumerate(parts_xml):
        pid = part.get('id')
        instr = instr_of(sounds.get(pid, ''), names.get(pid, ''))
        measures = part.findall('measure')
        div = 1
        transp = 0
        vel = 80
        pizz = False
        notes = []
        open_ties = {}
        for oi, idx in enumerate(order):
            if idx >= len(measures):
                continue
            m = measures[idx]
            base = starts[oi]
            cur = 0
            for el in m:
                if el.tag == 'attributes':
                    if el.findtext('divisions'):
                        div = int(el.findtext('divisions'))
                    tr = el.find('transpose')
                    if tr is not None:
                        transp = int(tr.findtext('chromatic') or 0) + 12 * int(tr.findtext('octave-change') or 0)
                    tm = el.find('time')
                    if tm is not None and pi == 0 and tm.findtext('beats'):
                        times[base + round(cur * PPQ / div)] = (int(re.findall(r'\d+', tm.findtext('beats'))[0]), int(tm.findtext('beat-type')))
                elif el.tag == 'direction':
                    tick = base + round(cur * PPQ / div)
                    snd = el.find('sound')
                    if snd is not None and snd.get('tempo') and pi == 0:
                        tempo[tick] = float(snd.get('tempo'))
                    for d in el.iter('dynamics'):
                        for k in d:
                            if k.tag in DYN and k.tag not in ('sf', 'sfz', 'sffz', 'fz', 'rfz'):
                                vel = DYN[k.tag]
                    for w in el.iter('words'):
                        s = (w.text or '').lower()
                        if 'pizz' in s:
                            pizz = True
                        elif 'arco' in s:
                            pizz = False
                    if pi == 0:
                        for r in el.iter('rehearsal'):
                            if r.text:
                                marks[tick] = r.text.strip()
                elif el.tag == 'backup':
                    cur -= int(el.findtext('duration') or 0)
                elif el.tag == 'forward':
                    cur += int(el.findtext('duration') or 0)
                elif el.tag == 'note':
                    if el.find('grace') is not None:
                        continue
                    chord = el.find('chord') is not None
                    dur = int(el.findtext('duration') or 0)
                    if chord:
                        cur -= last_dur
                    tick = base + round(cur * PPQ / div)
                    dt = round(dur * PPQ / div)
                    if el.find('.//fermata') is not None:
                        fermatas.setdefault(tick, set()).add(pi)
                        fermatas.setdefault(('len', tick), set()).add(dt)
                    p = el.find('pitch')
                    unp = el.find('unpitched')
                    if p is not None or (unp is not None and instr == 'perc'):
                        if p is not None:
                            midi = 12 * (int(p.findtext('octave')) + 1) + STEP[p.findtext('step')] + int(float(p.findtext('alter') or 0)) + transp
                        else:
                            midi = 49 if 'cymbal' in names.get(pid, '').lower() else 38 if 'snare' in names.get(pid, '').lower() else 35
                        ties = [x.get('type') for x in el.findall('tie')]
                        v = vel
                        nt = el.find('notations')
                        art = 2 if pizz and instr in ('vn1', 'vn2', 'va', 'vc', 'cb') else 0
                        if nt is not None:
                            arts = nt.find('articulations')
                            if arts is not None:
                                if arts.find('accent') is not None or arts.find('strong-accent') is not None:
                                    v = min(127, v + 15)
                                if (arts.find('staccato') is not None or arts.find('staccatissimo') is not None or arts.find('spiccato') is not None) and art == 0:
                                    art = 1
                            for d in nt.iter('dynamics'):
                                for k in d:
                                    if k.tag in DYN:
                                        v = max(v, DYN[k.tag])
                        if 'stop' in ties and midi in open_ties:
                            n = open_ties[midi]
                            n[1] = tick + dt - n[0]
                            if 'start' not in ties:
                                del open_ties[midi]
                        else:
                            n = [tick, dt, midi, v + 128 * art]
                            notes.append(n)
                            if 'start' in ties:
                                open_ties[midi] = n
                    if not chord:
                        cur += dur
                    last_dur = dur
        if instr is None:
            print('  ? часть без инструмента:', names.get(pid), sounds.get(pid), file=sys.stderr)
            continue
        flat = []
        for tk, d, mi, v in sorted(notes):
            if tk < cut_a or tk >= cut_b:
                continue
            flat += [tk - cut_a, min(d, cut_b - tk), mi, v]
        parts_out.append({'name': names.get(pid, ''), 'instr': instr, 'notes': flat})

    k = a.tempo or 1
    tl = sorted(tempo.items())
    # смена темпа в первом такте отрывка (надпись MuseScore чуть позже начала) — с самого начала
    head = cut_a + max(lens[order[lo - 1]] if order else 0, PPQ * 4)
    tempo_at_a = next((q for tk, q in reversed(tl) if tk < head), tl[0][1] if tl else 100)
    tempo_out = [[0, round(tempo_at_a * k, 2)]] + [[tk - cut_a, round(q * k, 2)] for tk, q in tl if head <= tk < cut_b]
    ts = sorted(times.items())
    ts_a = next((v for tk, v in reversed(ts) if tk <= cut_a), (4, 4))
    time_out = [[0, ts_a[0], ts_a[1]]] + [[tk - cut_a, n, d] for tk, (n, d) in ts if cut_a < tk < cut_b]
    nparts = len(parts_xml)
    specials = []
    for tk, who in fermatas.items():
        if isinstance(tk, tuple):
            continue
        if len(who) * 3 >= nparts and cut_a <= tk < cut_b:
            ln = max(fermatas[('len', tk)])
            specials.append({'kind': 'fermata', 'tick': tk - cut_a, 'len': ln})
    # динамика палочкой: резкий скачок громкости всего оркестра (p → f — «вверх», f → p — «вниз»), не чаще раза в 8 долей
    onsets = {}
    for p in parts_out:
        ns = p['notes']
        for j in range(0, len(ns), 4):
            b = ns[j] // PPQ
            onsets.setdefault(b, []).append(ns[j + 3] & 127)
    last_dyn = -99
    prev = None
    for b in sorted(onsets):
        vs = onsets[b]
        if len(vs) < 3:
            continue
        lvl = sorted(vs)[len(vs) // 2]
        if prev is not None and b - last_dyn >= 8:
            if prev <= 60 and lvl >= 95:
                specials.append({'kind': 'sforzando', 'tick': b * PPQ, 'len': PPQ})
                last_dyn = b
            elif prev >= 95 and lvl <= 55:
                specials.append({'kind': 'subito_p', 'tick': b * PPQ, 'len': PPQ})
                last_dyn = b
        prev = lvl
    specials.sort(key=lambda s: s['tick'])
    out = {
        'id': a.id, 'title': a.title, 'composer': a.composer, 'source': a.source,
        'time': time_out, 'tempo': tempo_out,
        'marks': [[tk - cut_a, s] for tk, s in sorted(marks.items()) if cut_a <= tk < cut_b],
        'end': cut_b - cut_a,
        'parts': [p for p in parts_out if p['notes']],
        'specials': specials,
    }
    with open(a.out, 'w', encoding='utf8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    nn = sum(len(p['notes']) // 4 for p in out['parts'])
    print(f"{a.id}: тактов {len(order)} (взято {lo}–{hi}), частей {len(out['parts'])}, нот {nn}, ферматы {len(specials)}, "
          f"темп {tempo_out[:3]}, {round((cut_b - cut_a) / PPQ * 60 / tempo_out[0][1])} с, {len(json.dumps(out)) // 1024} КБ")


if __name__ == '__main__':
    main()
