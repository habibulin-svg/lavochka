"""Выкрики для кита «Dance With Me!»: ElevenLabs v4 (через RouterAI, раннер studio/runners/tts_eleven.py) → сетка тактов.

Каждый выкрик: обрезка тишины, начало ровно на доле, лёгкий дилей на точку и реверб, длина — 1 или 2 такта.
G:/ai/venvs/music/Scripts/python.exe studio/music/dance/voices.py
"""
import json
import pathlib
import subprocess
import sys

import numpy as np
import soundfile as sf
from pedalboard import Compressor, Delay, HighpassFilter, Pedalboard, Reverb

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'studio/runners'))
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import tts_eleven  # noqa: E402
from proto import OUT, SR, loudnorm  # noqa: E402

RAW = pathlib.Path('G:/temp/studio/out/music-studio/voices-raw')
LINES = [  # (имя сэмпла, голос, текст)
    ('Come On', 'kolyan', 'Come on!'),
    ('Hands Up', 'kolyan', 'Hands up!'),
    ('Lets Go', 'botan', "Let's go!"),
    ('Jump', 'botan', 'Jump! Jump!'),
    ('Davay', 'kolyan', 'Давай, давай!'),
    ('Diskoteka', 'botan', 'Дискотека!'),
    ('Dance With Me', 'intelligent', 'Dance with me!'),
    ('Vse Na Tantspol', 'sipliy', 'Все на танцпол!'),
]


def main():
    k = tts_eleven.key()
    RAW.mkdir(parents=True, exist_ok=True)
    for name, voice, text in LINES:
        mp3 = RAW / f'{name}.mp3'
        if not mp3.exists():
            tts_eleven.synth(k, text, tts_eleven.VOICES[voice], mp3)
            print('tts', name, flush=True)
    for bpm in (128, 140):
        d = OUT / str(bpm)
        man = json.loads((d / 'manifest.json').read_text(encoding='utf-8'))
        man = [e for e in man if e['group'] != 'rap']
        beat = 60 / bpm
        for name, voice, text in LINES:
            wav = RAW / f'{name}.wav'
            if not wav.exists():
                subprocess.run([tts_eleven.FFMPEG, '-y', '-loglevel', 'error', '-i', str(RAW / f'{name}.mp3'),
                                '-af', 'silenceremove=start_periods=1:start_threshold=-40dB,areverse,'
                                'silenceremove=start_periods=1:start_threshold=-40dB,areverse',
                                '-ar', str(SR), '-ac', '1', str(wav)], check=True)
            y, _ = sf.read(wav, dtype='float32')
            bars = 1 if len(y) / SR < 4 * beat * 0.8 else 2
            n = int(round(bars * 4 * beat * SR))
            a = np.zeros((2, n + 2 * SR), np.float32)
            a[:, :len(y)] = y
            fx = Pedalboard([HighpassFilter(120), Compressor(-20, 4, 2, 80), Delay(beat * 0.75, 0.25, 0.18),
                             Reverb(0.4, 0.5, 0.15, 0.9, 0.8)])
            a = fx(a, SR)[:, :n]
            f8 = int(0.01 * SR)
            a[:, -f8:] *= np.linspace(1, 0, f8)
            a = loudnorm(a, -16)
            f = d / 'rap' / f'{name.lower().replace(" ", "-")}.wav'
            f.parent.mkdir(parents=True, exist_ok=True)
            sf.write(f, a.T, SR, subtype='PCM_16')
            man.append(dict(group='rap', name=name, bars=bars, loop=False, chord=None, text=text, voice=voice,
                            file=str(f.relative_to(d))))
        (d / 'manifest.json').write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding='utf-8')
        print(bpm, 'ok')


if __name__ == '__main__':
    main()
