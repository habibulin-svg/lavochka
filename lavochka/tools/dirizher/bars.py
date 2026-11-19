"""Симулятор дирижёра: сводка по тактам JSON-партитуры — темп, кто играет, громкость, ферматы (подбор отрывков).
python tools/dirizher/bars.py <партитура.json> <с> <по>"""
import json
import sys

PPQ = 480
FAM = {'vn1': '1', 'vn2': '2', 'va': 'a', 'vc': 'c', 'cb': 'b', 'fl': 'F', 'ob': 'O', 'cl': 'C', 'bn': 'B', 'hn': 'H', 'tp': 'T', 'tb': 'R',
       'tu': 'U', 'timp': 't', 'picc': 'p', 'cbn': 'X', 'perc': '%', 'eh': 'E', 'bcl': 'K', 'harp': 'h', 'cel': 'e'}


def bars(s):
    ts = sorted(s['time'])
    out, t, k = [], 0, 0
    while t < s['end']:
        while k + 1 < len(ts) and ts[k + 1][0] <= t:
            k += 1
        n, d = ts[k][1], ts[k][2]
        ln = n * 4 * PPQ // d
        out.append((t, ln, f'{n}/{d}'))
        t += ln
    return out


def main():
    s = json.load(open(sys.argv[1], encoding='utf8'))
    a, b = int(sys.argv[2]), int(sys.argv[3])
    bl = bars(s)
    tm = sorted(s['tempo'])
    sec = 0.0
    secs = []
    for t0, ln, _ in bl:
        secs.append(sec)
        q = [x for x in tm if x[0] <= t0][-1][1]
        sec += ln / PPQ * 60 / q
    for i in range(a - 1, min(b, len(bl))):
        t0, ln, sig = bl[i]
        act = set()
        vmax = 0
        for p in s['parts']:
            ns = p['notes']
            for j in range(0, len(ns), 4):
                if ns[j] < t0 + ln and ns[j] + ns[j + 1] > t0:
                    act.add(FAM.get(p['instr'], '?'))
                if t0 <= ns[j] < t0 + ln:
                    vmax = max(vmax, ns[j + 3] & 127)
        q = [x for x in tm if x[0] <= t0][-1][1]
        f = [sp for sp in s.get('specials', []) if t0 <= sp['tick'] < t0 + ln]
        mk = [m[1] for m in s.get('marks', []) if t0 <= m[0] < t0 + ln]
        print(f'{i + 1:4d} {secs[i]:6.1f}s {sig:5s} q={q:<5g} v={vmax:<3d} {"".join(sorted(act)):22s} {"FERM" if f else ""} {" ".join(mk)}')


if __name__ == '__main__':
    main()
