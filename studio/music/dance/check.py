"""Проверка кита Lavochka Music Studio: длина ровно в тактах, аккорд по хроме, стык петли, тишина, громкость.

G:/ai/venvs/music/Scripts/python.exe studio/music/dance/check.py G:/temp/studio/out/music-studio/proto/140 140
"""
import json
import pathlib
import sys

import librosa
import numpy as np
import pyloudnorm
import soundfile as sf

NAMES = 'C C# D D# E F F# G G# A A# B'.split()
CHORD_PC = {'Am': [9, 0, 4], 'F': [5, 9, 0], 'C': [0, 4, 7], 'G': [7, 11, 2]}
SCALE = [9, 11, 0, 2, 4, 5, 7]  # ля минор


def template(pcs):
    t = np.zeros(12)
    t[pcs] = 1
    return t / np.linalg.norm(t)


ROOT = {'Am': 9, 'F': 5, 'C': 0, 'G': 7}


def bass_root(y, sr):
    """Бас: хрома врёт на низах (обертоны пилы) — берём преобладающий звук по pyin."""
    f0, v, _ = librosa.pyin(y, fmin=30, fmax=400, sr=sr, frame_length=4096)
    f0 = f0[v]
    if not len(f0):
        return None, 0
    pc = np.round(librosa.hz_to_midi(f0)) % 12
    vals, cnt = np.unique(pc, return_counts=True)
    return int(vals[cnt.argmax()]), float(cnt.max() / cnt.sum())


def main(d, bpm):
    sys.stdout.reconfigure(encoding='utf-8')
    d = pathlib.Path(d)
    man = json.loads((d / 'manifest.json').read_text(encoding='utf-8'))
    bar = 4 * 60 / bpm
    meter = pyloudnorm.Meter(44100, block_size=0.2)
    bad = 0
    for e in man:
        a, sr = sf.read(d / e['file'], dtype='float32')
        a = a.T
        msg = []
        want = round(e['bars'] * bar * sr)
        if abs(a.shape[1] - want) > 1:  # при 128 BPM такт — 82687,5 отсчёта
            msg.append(f'длина {a.shape[1]} ≠ {want}')
        peak = float(np.abs(a).max())
        if peak < 0.01:
            msg.append('тишина')
        if e['loop']:
            # стык: скачок между последним и первым отсчётом против типичного шага внутри
            jump = float(np.abs(a[:, 0] - a[:, -1]).max())
            step = float(np.abs(np.diff(a[:, 8:-8], axis=1)).max())  # самый резкий перепад внутри (атаки)
            if jump > max(1.2 * step, 0.05):
                msg.append(f'щелчок на стыке {jump:.3f} (шаг {step:.3f})')
        tonal = e['group'] not in ('loop', 'drum', 'fx')
        info = ''
        if e['group'] == 'bass':
            tonal = False
            pc, share = bass_root(a.mean(0), sr)
            need = ROOT[e['chord']] if e['chord'] else 9
            info = f'бас {NAMES[pc] if pc is not None else "?"} ({share:.0%})'
            if pc is not None and pc != need:
                msg.append(f'бас на {NAMES[pc]}, нужен {NAMES[need]}')
        if tonal:
            y = a.mean(0)
            ch = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=2048).mean(1)
            ch = ch / (np.linalg.norm(ch) + 1e-9)
            outside = float(ch[[p for p in range(12) if p not in SCALE]].sum() / ch.sum())
            info = f'вне лада {outside:.0%}'
            if outside > 0.35:
                msg.append(f'вне ля минора {outside:.0%}')
            if e['chord']:
                score = {k: float(ch @ template(v)) for k, v in CHORD_PC.items()}
                best = max(score, key=score.get)
                info += f', аккорд {best} ({score[best]:.2f}, нужен {e["chord"]} {score[e["chord"]]:.2f})'
                if best != e['chord']:
                    msg.append(f'аккорд {best}, а не {e["chord"]}')
        lufs = meter.integrated_loudness(a.T) if a.shape[1] > sr * 0.4 else float('nan')
        status = 'ПЛОХО: ' + '; '.join(msg) if msg else 'ок'
        bad += bool(msg)
        print(f'{e["group"]:6} {e["name"]:26} {lufs:6.1f} LUFS  {info:48} {status}')
    print(f'\nвсего {len(man)}, с замечаниями {bad}')


if __name__ == '__main__':
    main(sys.argv[1], int(sys.argv[2]))
