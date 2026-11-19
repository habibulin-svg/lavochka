"""Симулятор дирижёра: сэмплы оркестра из VSCO 2 CE (CC0) → public/dirizher/s/<инструмент>/*.ogg + index.json.

python tools/dirizher/samples.py <папка VSCO-2-CE> [<выход>]   (Python 3.13 с numpy; ffmpeg — G:/ai/ffmpeg/bin)

По инструменту: приёмы (0 — тянуть, 1 — коротко, 2 — пиццикато), опорные ноты не чаще чем через 3 полутона,
две силы (самая тихая и самая громкая из записанных). Тянущиеся — 3,6 с с петлёй 1,3–3,4 с (шов сглажен
перекрёстным затуханием 0,25 с прямо в файле), короткие и ударные — до затухания (≤ 3 с). Моно, Opus 80 кбит/с.
Громкость каждой ноты выровнена по RMS (динамику даёт движок), баланс инструментов — поле gain в index.json.
Литавры и прочее без ноты в имени — высота по автокорреляции.
"""
import json
import os
import re
import subprocess
import sys

import numpy as np

FF = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
SR = 44100
NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}

SRC = sys.argv[1] if len(sys.argv) > 1 else 'G:/temp/dirizher/vsco'
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'dirizher', 's')

# инструмент: [(папка, приём)], gain, слоёв (секция из соло), сдвиг октавы для «родственника»
PLAN = {
    'vn1': ([('Strings/Violin Section/susVib', 0), ('Strings/Violin Section/Spic', 1), ('Strings/Violin Section/Pizz', 2)], 1.0, 1),
    'vn2': ([('Strings/Violin Section/susVib', 0), ('Strings/Violin Section/Spic', 1), ('Strings/Violin Section/Pizz', 2)], 0.9, 1),
    'va': ([('Strings/Viola Section/susvib', 0), ('Strings/Viola Section/spic', 1), ('Strings/Viola Section/pizz', 2)], 0.9, 1),
    'vc': ([('Strings/Cello Section/susvib', 0), ('Strings/Cello Section/spic', 1), ('Strings/Cello Section/pizzT', 2)], 0.95, 1),
    'cb': ([('Strings/Solo Contrabass/SusVib', 0), ('Strings/Solo Contrabass/Spic', 1), ('Strings/Solo Contrabass/Pizz', 2)], 0.75, 3),
    'fl': ([('Woodwinds/Flute/susvib', 0), ('Woodwinds/Flute/stac', 1)], 0.55, 1),
    'picc': ([('Woodwinds/Piccolo/Sus', 0), ('Woodwinds/Piccolo/Stac', 1)], 0.4, 1),
    'ob': ([('Woodwinds/Oboe/Vib', 0), ('Woodwinds/Oboe/Stacc', 1)], 0.5, 1),
    'cl': ([('Woodwinds/Clarinet/susLong', 0), ('Woodwinds/Clarinet/stac', 1)], 0.5, 1),
    'bn': ([('Woodwinds/Bassoon/sus', 0), ('Woodwinds/Bassoon/stac', 1)], 0.55, 1),
    'hn': ([('Brass/F Horn/sus', 0), ('Brass/F Horn/stac', 1)], 0.6, 1),
    'tp': ([('Brass/Trumpet/sus', 0), ('Brass/Trumpet/stac', 1)], 0.5, 1),
    'tb': ([('Brass/Tenor Trombone/sus', 0), ('Brass/Tenor Trombone/stac', 1)], 0.55, 1),
    'tu': ([('Brass/Tuba/sus', 0), ('Brass/Tuba/stac', 1)], 0.6, 1),
    'harp': ([('Strings/Harp', 1)], 0.6, 1),
    'cel': ([('Percussion/Glock', 1)], 0.35, 1),
    'timp': ([('Percussion/Timpani', 1)], 0.8, 1),
}
# родственники: те же сэмплы
ALIAS = {'eh': 'ob', 'bcl': 'cl', 'cbn': 'bn'}
# ударные: GM-нота → (папка, шаблон имени)
PERC = {35: ('Percussion', r'BDrumNewhit_v(\d)_rr1'), 38: ('Percussion', r'Snare2-HitSN_v(\d)_rr1'),
        49: ('VSCO 1 Percussion/varMetal/Cymbals/clash', r'crash|clash'), 81: ('Percussion', r'Triangle3-Hit_v(\d)_rr1')}


def note_of(name: str):
    m = re.search(r'(?<![A-Za-z])([A-G])(#|b)?(-?\d)(?!\d)', name)
    if not m:
        return None
    n = 12 * (int(m.group(3)) + 1) + NOTE[m.group(1)] + (1 if m.group(2) == '#' else -1 if m.group(2) == 'b' else 0)
    return n


def vel_of(name: str) -> int:
    m = re.search(r'_v(\d+)', name)
    if m:
        return int(m.group(1))
    for k, v in (('_pp', 1), ('_p', 2), ('_mp', 3), ('_mf', 4), ('_f', 5), ('_ff', 6)):
        if k in name:
            return v
    return 1


def rr_ok(name: str) -> bool:
    m = re.search(r'rr(\d)', name, re.I)
    return not m or m.group(1) == '1'


def decode(path: str) -> np.ndarray:
    raw = subprocess.run([FF, '-v', 'quiet', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def encode(x: np.ndarray, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    subprocess.run([FF, '-v', 'quiet', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'libopus', '-b:a', '80k', path],
                   input=x.astype(np.float32).tobytes(), check=True)


def pitch_of(x: np.ndarray) -> int:
    seg = x[int(0.05 * SR):int(0.45 * SR)]
    seg = seg - seg.mean()
    ac = np.correlate(seg, seg, 'full')[len(seg) - 1:]
    lo, hi = int(SR / 400), int(SR / 50)
    k = lo + int(np.argmax(ac[lo:hi]))
    f = SR / k
    return int(round(69 + 12 * np.log2(f / 440)))


def onset(x: np.ndarray) -> int:
    a = np.abs(x)
    th = a.max() * 0.02
    i = int(np.argmax(a > th))
    return max(0, i - int(0.004 * SR))


def prep_sustain(x: np.ndarray):
    x = x[onset(x):]
    ln = int(3.6 * SR)
    if len(x) < int(2.0 * SR):
        return prep_short(x), None
    x = x[:ln]
    ls, le = int(1.3 * SR), min(len(x), int(3.4 * SR))
    xf = int(0.25 * SR)
    y = x[:le].copy()
    # шов: конец петли плавно переходит в то, что стоит перед её началом
    t = np.linspace(0, 1, xf, dtype=np.float32)
    y[le - xf:le] = y[le - xf:le] * (1 - t) + x[ls - xf:ls] * t
    rms = float(np.sqrt(np.mean(y[int(0.3 * SR):le] ** 2)) + 1e-9)
    return y / rms * 0.12, (round(ls / SR, 4), round(le / SR, 4))


def prep_short(x: np.ndarray):
    x = x[onset(x):]
    a = np.abs(x)
    peak = a.max() + 1e-9
    # конец — где огибающая ниже −50 дБ
    env = np.convolve(a, np.ones(512) / 512, 'same')
    idx = np.where(env > peak * 0.003)[0]
    end = min(len(x), (idx[-1] if len(idx) else len(x)) + int(0.05 * SR), int(3.0 * SR))
    y = x[:end].copy()
    fade = min(int(0.05 * SR), len(y))
    y[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
    rms = float(np.sqrt(np.mean(y[:int(0.25 * SR)] ** 2)) + 1e-9)
    return y / rms * 0.12


def pick(files):
    """[(нота, сила, путь)] → опорные ноты через ≥ 3 полутона, у каждой — самая тихая и самая громкая сила."""
    by = {}
    for n, v, p in files:
        by.setdefault(n, []).append((v, p))
    notes = sorted(by)
    keep = []
    for n in notes:
        if not keep or n - keep[-1] >= 3:
            keep.append(n)
    if notes and keep[-1] != notes[-1] and notes[-1] - keep[-1] >= 2:
        keep.append(notes[-1])
    out = []
    for n in keep:
        vs = sorted(by[n])
        lo, hi = vs[0], vs[-1]
        out.append((n, 0, lo[1]))
        if hi[1] != lo[1]:
            out.append((n, 1, hi[1]))
    return out


def main():
    index = {}
    for instr, (folders, gain, layers) in PLAN.items():
        zones = []
        for folder, art in folders:
            d = os.path.join(SRC, folder)
            if not os.path.isdir(d):
                print('нет папки', d)
                continue
            files = []
            for f in os.listdir(d):
                if not f.lower().endswith('.wav') or not rr_ok(f):
                    continue
                n = note_of(f.replace('Timpani1', 'Timpani').replace('Timpani2', 'Timpani').replace('Timpani3', 'Timpani'))
                full = os.path.join(d, f)
                if instr == 'timp':
                    if 'Hit' not in f:
                        continue
                    n = None
                if n is None:
                    x = decode(full)
                    if len(x) < SR // 10:
                        continue
                    n = pitch_of(x)
                files.append((n, vel_of(f), full))
            for n, v, path in pick(files):
                x = decode(path)
                if len(x) < 2000:
                    continue
                if art == 0:
                    y, loop = prep_sustain(x)
                else:
                    y, loop = prep_short(x), None
                name = f'{art}_{n}_{v}.ogg'
                encode(y, os.path.join(OUT, instr, name))
                z = {'n': int(n), 'v': v, 'file': name}
                if art:
                    z['a'] = art
                if loop:
                    z['loop'] = list(loop)
                zones.append(z)
        index[instr] = {'zones': zones, 'rel': 0.35 if instr not in ('timp', 'harp', 'cel') else 1.2, 'gain': gain, **({'layers': layers} if layers > 1 else {})}
        print(instr, len(zones), 'зон')
    # ударные
    zones = []
    for gm, (folder, pat) in PERC.items():
        d = os.path.join(SRC, folder)
        if not os.path.isdir(d):
            continue
        cands = sorted(f for f in os.listdir(d) if f.lower().endswith('.wav') and re.search(pat, f, re.I))
        if not cands:
            continue
        for v, f in ((0, cands[0]), (1, cands[-1])):
            y = prep_short(decode(os.path.join(d, f)))
            name = f'1_{gm}_{v}.ogg'
            encode(y, os.path.join(OUT, 'perc', name))
            zones.append({'n': gm, 'v': v, 'file': name, 'a': 1})
    index['perc'] = {'zones': zones, 'rel': 1.5, 'gain': 0.55}
    print('perc', len(zones), 'зон')
    for a, b in ALIAS.items():
        index[a] = {**index[b], 'from': b}
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf8', newline='\n') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))
    total = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(OUT) for f in fs)
    print('всего', total // 1024, 'КБ')


if __name__ == '__main__':
    main()
