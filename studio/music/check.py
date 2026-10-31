"""Держит ли cover музыку демо: хрома (12 нот) по долям, косинусное сходство демо↔версия.

python check.py <bpm> <демо.wav> <версия...>
Корреляция: ≥0,6 — ноты/гармония те же; 0,3–0,6 — частично; ~0 — другая музыка.
Сравнение со сдвигом ±2 доли (cover иногда чуть сдвигает начало).
"""
import subprocess
import sys

import numpy as np

FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
SR = 22050


def load(path):
    raw = subprocess.run([FFMPEG, '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)


def chroma_beats(x, bpm):
    n = 8192
    hop = int(SR * 60 / bpm)           # окно на долю
    fq = np.fft.rfftfreq(n, 1 / SR)
    ok = (fq > 180) & (fq < 2200)    # ноты лида и аккордов, без бочки и хэтов
    pc = (np.round(12 * np.log2(fq[ok] / 440)) % 12).astype(int)
    out = []
    for st in range(0, len(x) - n, hop):
        P = np.abs(np.fft.rfft(x[st:st + n] * np.hanning(n)))[ok]
        c = np.log1p(np.bincount(pc, P, minlength=12))
        c -= c.mean()                     # корреляция по отклонениям: шум даёт ~0
        out.append(c / (np.linalg.norm(c) + 1e-9))
    return np.array(out)


def similarity(a, b):
    best = 0
    for sh in range(-2, 3):
        aa, bb = (a[sh:], b) if sh >= 0 else (a, b[-sh:])
        m = min(len(aa), len(bb))
        best = max(best, float((aa[:m] * bb[:m]).sum(axis=1).mean()))
    return best


if __name__ == '__main__':
    bpm = float(sys.argv[1])
    ref = chroma_beats(load(sys.argv[2]), bpm)
    for f in sys.argv[3:]:
        print(f'{f.split("/")[-1]:40s} сходство с демо {similarity(ref, chroma_beats(load(f), bpm)):.2f}')
