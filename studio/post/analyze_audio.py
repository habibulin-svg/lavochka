"""Замер референсов: темп (автокорреляция огибающей атак), громкость LUFS, динамика по участкам.

python studio/post/analyze_audio.py <файл или папка> ...
Только цифры — сами треки в генерацию не идут.
"""
import pathlib
import re
import subprocess
import sys

import numpy as np

FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
SR = 11025


def pcm(path):
    raw = subprocess.run([FFMPEG, '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768


def tempo(x):
    hop = 256
    frames = len(x) // hop
    e = np.sqrt((x[:frames * hop].reshape(frames, hop) ** 2).mean(axis=1))
    flux = np.maximum(0, np.diff(np.log(e + 1e-4)))
    flux -= flux.mean()
    fps = SR / hop
    ac = np.correlate(flux, flux, mode='full')[len(flux) - 1:]
    lags = np.arange(len(ac))
    bpm = 60 * fps / np.maximum(lags, 1)
    ok = (bpm >= 95) & (bpm <= 175)
    best = lags[ok][np.argmax(ac[ok])]
    return 60 * fps / best


def lufs(path):
    err = subprocess.run([FFMPEG, '-v', 'info', '-i', str(path), '-af', 'ebur128', '-f', 'null', '-'],
                         capture_output=True, text=True, encoding='utf-8', errors='replace').stderr
    i = re.findall(r'I:\s+(-?[\d.]+) LUFS', err)
    lra = re.findall(r'LRA:\s+([\d.]+) LU', err)
    return float(i[-1]), float(lra[-1])


def main():
    files = []
    for a in sys.argv[1:]:
        p = pathlib.Path(a)
        files += sorted(p.glob('*.*')) if p.is_dir() else [p]
    for f in files:
        x = pcm(f)
        dur = len(x) / SR
        i, lra = lufs(f)
        # энергия по 8-секундным участкам: где вступления, брейки, кульминации
        seg = 8 * SR
        rms = [float(np.sqrt((x[k:k + seg] ** 2).mean())) for k in range(0, len(x) - seg, seg)]
        top = max(rms)
        shape = ''.join(' ▁▂▃▄▅▆▇█'[min(8, int(8 * r / top + 0.5))] for r in rms)
        print(f'{f.name[:52]:52s} {dur:5.0f}с {tempo(x):6.1f} BPM  {i:6.1f} LUFS  LRA {lra:4.1f}  {shape}')


if __name__ == '__main__':
    main()
