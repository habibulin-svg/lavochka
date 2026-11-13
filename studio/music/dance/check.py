"""Проверка кита Lavochka Music Studio: длина ровно в тактах, аккорд по хроме, стык петли, тишина, громкость.

G:/ai/venvs/music/Scripts/python.exe studio/music/dance/check.py G:/temp/studio/out/music-studio/kit/140 140 [-v]
Без -v печатает только сэмплы с замечаниями и сводку по группам.
"""
import json
import pathlib
import sys
from multiprocessing import Pool

import librosa
import numpy as np
import pyloudnorm
import soundfile as sf

NAMES = 'C C# D D# E F F# G G# A A# B'.split()
CHORD_PC = {'Am': [9, 0, 4], 'F': [5, 9, 0], 'C': [0, 4, 7], 'G': [7, 11, 2]}
SCALE = [9, 11, 0, 2, 4, 5, 7]  # ля минор
OUT_MAX = 0.5  # доля хромы вне лада: у пилы и колоколов её дают обертоны 5-й и 7-й гармоник


def template(pcs):
    """Шаблон хромы аккорда с обертонами (1–6 гармоники, затухание 0,7): у ярких тембров хрома «видит» и их."""
    t = np.zeros(12)
    for p in pcs:
        for k in range(1, 7):
            t[(p + int(round(12 * np.log2(k)))) % 12] += 0.7 ** (k - 1)
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


def check_one(job):
    d, bpm, e = job
    bar = 4 * 60 / bpm
    a, sr = sf.read(pathlib.Path(d) / e['file'], dtype='float32')
    a = a.T if a.ndim > 1 else np.stack([a, a])
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
    tonal = e['group'] not in ('loop', 'drum', 'fx', 'rap')
    # вся последовательность «… Am-F-C-G» — проверяем по четвертям: Am, F, C, G
    parts = [(a, e['chord'])]
    if e['name'].endswith('Am-F-C-G'):
        q = a.shape[1] // 4
        # первую четверть каждого куска пропускаем: там ещё звучат хвосты прошлого аккорда (атака пэда, реверб)
        parts = [(a[:, k * q + q // 4:(k + 1) * q], ch) for k, ch in enumerate(['Am', 'F', 'C', 'G'])]
    info = []
    for part, chord in parts:
        if e['group'] == 'bass':
            pc, share = bass_root(part.mean(0), sr)
            need = ROOT[chord] if chord else 9
            info.append(f'бас {NAMES[pc] if pc is not None else "?"} ({share:.0%})')
            if pc is not None and pc != need:
                msg.append(f'бас на {NAMES[pc]}, нужен {NAMES[need]}')
        elif tonal:
            ch = librosa.feature.chroma_cqt(y=part.mean(0), sr=sr, hop_length=2048).mean(1)
            ch = ch / (np.linalg.norm(ch) + 1e-9)
            outside = float(ch[[p for p in range(12) if p not in SCALE]].sum() / ch.sum())
            inf = f'вне лада {outside:.0%}'
            if outside > OUT_MAX:
                msg.append(f'вне ля минора {outside:.0%}')
            if chord:
                score = {k: float(ch @ template(v)) for k, v in CHORD_PC.items()}
                best = max(score, key=score.get)
                inf += f', аккорд {best} ({score[best]:.2f}, нужен {chord} {score[chord]:.2f})'
                # мелодии и арпеджио неоднозначны (A и C есть и в Am, и в F): допуск — 92 % от лучшего
                if best != chord and score[chord] < 0.92 * score[best]:
                    msg.append(f'аккорд {best}, а не {chord}')
            info.append(inf)
    info = '; '.join(info)
    meter = pyloudnorm.Meter(sr, block_size=0.2)
    lufs = meter.integrated_loudness(a.T) if a.shape[1] > sr * 0.4 else float('nan')
    return e, msg, info, lufs


def main(d, bpm, verbose=False):
    sys.stdout.reconfigure(encoding='utf-8')
    man = json.loads((pathlib.Path(d) / 'manifest.json').read_text(encoding='utf-8'))
    bad, per, report = 0, {}, []
    with Pool(8) as pool:
        for e, msg, info, lufs in pool.imap(check_one, [(d, bpm, e) for e in man], chunksize=4):
            status = 'ПЛОХО: ' + '; '.join(msg) if msg else 'ок'
            bad += bool(msg)
            g = per.setdefault(e['group'], [0, 0])
            g[0] += 1
            g[1] += bool(msg)
            report.append(dict(name=e['name'], group=e['group'], lufs=round(lufs, 1) if lufs == lufs else None,
                               info=info, problems=msg))
            if msg or verbose:
                print(f'{e["group"]:6} {e["name"]:32} {lufs:6.1f} LUFS  {info:52} {status}', flush=True)
    (pathlib.Path(d) / 'check.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    print()
    print('по группам (всего / с замечаниями):', per)
    print(f'всего {len(man)}, с замечаниями {bad}')
    return bad


if __name__ == '__main__':
    main(sys.argv[1], int(sys.argv[2]), '-v' in sys.argv)
