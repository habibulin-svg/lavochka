"""Женский вокал кита «Dance With Me!» (группа voice): распевы ElevenLabs v4 (тег [sings]) с подтяжкой высоты.

YuE2 по своей партитуре отложен (см. docs/music-studio/DESIGN.md §7): здесь — короткие фразы, как «your love»,
«calling» у Dance eJay. Высоту каждого звука (участок между паузами / сменой ноты) сдвигаем к ближайшему звуку
аккорда: так из одной фразы получается семья `Фраза *…****` (Am F C G, 2 такта) и нейтральная `Фраза` на A/E.
Подтяжка — сдвиг высоты участками с перекрёстным сведением (эффект «автотюна» конца 90-х, без формант-коррекции).

G:/ai/venvs/music/Scripts/python.exe studio/music/dance/femvoice.py [--bpm 128,140]
"""
import argparse
import json
import pathlib
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import librosa
import numpy as np
import soundfile as sf
from pedalboard import Chorus, Compressor, Delay, HighpassFilter, Pedalboard, Reverb

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'studio/runners'))
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import tts_eleven  # noqa: E402
from build import OUT, slug  # noqa: E402
from render import SR, loudnorm  # noqa: E402
from theory import CHORDS, STARS, chord_pcs  # noqa: E402

RAW = pathlib.Path('G:/temp/studio/out/music-studio/voices-raw/fem')
FEM = {'sarah': 'EXAVITQu4vr4xnSDxMaL', 'rachel': '21m00Tcm4TlvDq8ikWAM'}  # женские голоса библиотеки ElevenLabs
PHRASES = [  # имя, текст (свой, не строки известных песен)
    ('Your Love', 'Your love, your love'),
    ('Calling', 'Calling, calling you'),
    ('Living In A Dream', 'Living in a dream'),
    ('Take Me Higher', 'Take me higher'),
    ('Dance Tonight', 'Dance with me tonight'),
    ('Feel The Music', 'Feel the music'),
    ('All Night Long', 'All night long'),
    ('In My Heart', 'In my heart'),
    ('Set Me Free', 'Set me free'),
    ('Never Let Go', 'Never let me go'),
    ('Fly Away', 'Fly away with me'),
    ('Ooh Yeah', 'Ooh, yeah'),
    ('Forever Young', 'Forever and ever'),
    ('Tanzuy So Mnoy', 'Танцуй со мной'),
    ('Ty I Ya', 'Только ты и я'),
    ('Leto', 'Лето, лето, лето'),
]


def fetch():
    k = tts_eleven.key()
    RAW.mkdir(parents=True, exist_ok=True)

    def one(i):
        name, text = PHRASES[i]
        wav = RAW / f'{slug(name)}.wav'
        if wav.exists():
            return name
        mp3 = RAW / f'{slug(name)}.mp3'
        if not mp3.exists():
            tts_eleven.synth(k, f'[sings] {text}', list(FEM.values())[i % 2], mp3)
        subprocess.run([tts_eleven.FFMPEG, '-y', '-loglevel', 'error', '-i', str(mp3), '-af',
                        'silenceremove=start_periods=1:start_threshold=-40dB,areverse,'
                        'silenceremove=start_periods=1:start_threshold=-40dB,areverse',
                        '-ar', str(SR), '-ac', '1', str(wav)], check=True)
        return name
    with ThreadPoolExecutor(4) as ex:
        for n in ex.map(one, range(len(PHRASES))):
            print('tts', n, flush=True)


def segments(y):
    """Участки-«ноты»: голос без пауз, разрезанный там, где высота уходит больше чем на 0,8 полутона надолго."""
    hop = 256
    f0, v, _ = librosa.pyin(y, fmin=120, fmax=1000, sr=SR, frame_length=2048, hop_length=hop)
    m = np.where(v, librosa.hz_to_midi(np.nan_to_num(f0, nan=1.0)), np.nan)
    segs, cur = [], []
    for i, x in enumerate(m):
        if np.isnan(x):
            if len(cur) > 3:
                segs.append(cur)
            cur = []
            continue
        if cur and abs(x - np.median(m[cur])) > 0.8 and len(cur) > 6:
            segs.append(cur)
            cur = []
        cur.append(i)
    if len(cur) > 3:
        segs.append(cur)
    return [(s[0] * hop, (s[-1] + 1) * hop, float(np.median(m[s]))) for s in segs]


def retune(y, segs, pcs, shift_all=0.0):
    """Сдвинуть каждый участок к ближайшему звуку из классов высоты pcs (перекрёстное сведение 12 мс)."""
    out = y.copy()
    x = int(0.012 * SR)
    for a, b, med in segs:
        cands = [o * 12 + p for o in range(3, 9) for p in pcs]
        tgt = min(cands, key=lambda c: abs(c - med - shift_all))
        steps = tgt - med
        a0, b0 = max(a - x, 0), min(b + x, len(y))
        seg = librosa.effects.pitch_shift(y[a0:b0], sr=SR, n_steps=steps, res_type='soxr_hq')
        w = np.ones(b0 - a0)
        r = min(x, (b0 - a0) // 2)
        w[:r] = np.linspace(0, 1, r)
        w[-r:] = np.linspace(1, 0, r)
        out[a0:b0] = out[a0:b0] * (1 - w) + seg * w
    return out


def place(y, bpm, bars=2):
    beat = 60 / bpm
    n = int(round(bars * 4 * beat * SR))
    dur = len(y) / SR
    if dur > bars * 4 * beat * 0.9:
        y = librosa.effects.time_stretch(y, rate=dur / (bars * 4 * beat * 0.88))
    a = np.zeros((2, n + 2 * SR), np.float32)
    a[:, :len(y)] = y
    a = Pedalboard([HighpassFilter(150), Compressor(-20, 3, 3, 100), Chorus(0.4, 0.15, 7, 0.1, 0.2),
                    Delay(beat * 0.75, 0.3, 0.2), Reverb(0.6, 0.5, 0.25, 0.8, 1.0)])(a, SR)[:, :n]
    f8 = int(0.01 * SR)
    a[:, -f8:] *= np.linspace(1, 0, f8)
    return loudnorm(a, -17)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bpm', default='128,140')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    fetch()
    takes = {}
    for name, text in PHRASES:
        y, _ = sf.read(RAW / f'{slug(name)}.wav', dtype='float32')
        segs = segments(y)
        # общий сдвиг фразы: середина пения → к A4 (69), чтобы все версии были в одном регистре
        med = np.median([s[2] for s in segs]) if segs else 69
        base = -round(med - 69) if abs(med - 69) > 3 else 0
        if base:
            y = librosa.effects.pitch_shift(y, sr=SR, n_steps=base, res_type='soxr_hq')
            segs = [(s0, s1, m + base) for s0, s1, m in segs]
        takes[name] = {None: retune(y, segs, [9, 4])}
        for ci in range(4):
            takes[name][ci] = retune(y, segs, chord_pcs(ci))
        print('распев', name, len(segs), 'звуков', flush=True)
    for bpm in [int(x) for x in a.bpm.split(',')]:
        d = OUT / str(bpm)
        mf = d / 'manifest.json'
        man = [e for e in json.loads(mf.read_text(encoding='utf-8')) if e['group'] != 'voice']
        for i, (name, text) in enumerate(PHRASES):
            for ci, y in takes[name].items():
                nm = name if ci is None else f'{name} {STARS[ci]}'
                f = d / 'voice' / f'{slug(nm)}.wav'
                f.parent.mkdir(parents=True, exist_ok=True)
                sf.write(f, place(y, bpm).T, SR, subtype='PCM_16')
                man.append(dict(group='voice', name=nm, bars=2, loop=False,
                                chord=None if ci is None else CHORDS[ci][0], family=None if ci is None else name,
                                theme=name, style=None, text=text, voice=list(FEM)[i % 2],
                                lang='ru' if any('а' <= c <= 'я' for c in text.lower()) else 'en',
                                file=f'voice/{slug(nm)}.wav'))
        mf.write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding='utf-8')
        print(bpm, 'женский вокал', sum(e['group'] == 'voice' for e in man))


if __name__ == '__main__':
    main()
