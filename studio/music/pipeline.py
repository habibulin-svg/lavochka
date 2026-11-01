"""Ночной конвейер музыки ГОПС v2: композиции → демо → мастеринг → проверка → LISTEN.md.
Этап cover (ACE-Step) убран 2026-11-02 вместе с ACE-Step: музыка игры — YuE2 (runners/yue2.py); старые cover-файлы
мастеринг ещё подхватывает, если они лежат в cover/.

G:/ai/venvs/3d/Scripts/python.exe studio/music/pipeline.py [demo|master|all]
Каждый этап пропускает уже сделанное — после обрыва просто запустить снова.
Выход: G:/ai/out/studio/gops/music-v2/{mid,demo,cover,ogg}/ и LISTEN.md.
"""
import json
import os
import pathlib
import subprocess
import sys

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(__file__))
from check import chroma_beats, load, similarity  # noqa: E402
from compose import PLANS, compose, write_midi  # noqa: E402
from synth import SR, render  # noqa: E402

OUT = pathlib.Path('G:/ai/out/studio/gops/music-v2')
FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
NAMES = 'C C# D D# E F F# G G# A A# B'.split()
COUNT = {'menu': 6, 'battle': 6, 'battle-calm': 4, 'brigade-select': 4, 'sudden-death': 4,
         'time-attack': 4, 'victory': 6, 'defeat': 6}


def items():
    for sit, n in COUNT.items():
        for seed in range(1, n + 1):
            yield sit, seed


def stage_demo():
    for d in ('mid', 'demo'):
        (OUT / d).mkdir(parents=True, exist_ok=True)
    meta = {}
    for sit, seed in items():
        song, pl = compose(sit, seed)
        name = f'{sit}-{seed}'
        line = [n.pitch for n in song.notes if n.track == pl.lead][:12] if sit == 'defeat' else [p for _, _, p in song.hook[:12]]
        hook = ' '.join(f'{NAMES[p % 12]}{p // 12 - 1}' for p in line)
        meta[name] = {'bpm': song.bpm, 'key': NAMES[song.key % 12] + ' minor', 'prog': [str(c) for c in song.prog],
                      'bars': song.bars, 'form': [f'{s}:{n}' for s, _, n in song.sections], 'lead': pl.lead, 'hook': hook}
        wav = OUT / 'demo' / f'{name}.wav'
        if not wav.exists():
            write_midi(song, OUT / 'mid' / f'{name}.mid')
            audio = render(song)
            sf.write(wav, audio, SR)
            print('демо', name, f'{len(audio) / SR:.0f} c', flush=True)
        meta[name]['sec'] = round(sf.info(wav).duration, 1)
    (OUT / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')


def stage_master():
    meta = json.loads((OUT / 'meta.json').read_text(encoding='utf-8'))
    (OUT / 'ogg').mkdir(exist_ok=True)
    rows = []
    for name, m in meta.items():
        demo = OUT / 'demo' / f'{name}.wav'
        cover = OUT / 'cover' / f'{name}-1.flac'
        for src, tag in ((demo, 'demo'), (cover, 'cover')):
            if not src.exists():
                continue
            dst = OUT / 'ogg' / f'{name}-{tag}.ogg'
            if not dst.exists():
                subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(src), '-af', 'loudnorm=I=-14:TP=-1:LRA=9',
                                '-ar', '48000', '-c:a', 'libopus', '-b:a', '96k', str(dst)], check=True)
        a, _ = sf.read(demo)
        clip = float((np.abs(a) > 0.99).mean())
        sim = ''
        if cover.exists():
            A = chroma_beats(load(str(demo)), m['bpm'])
            C = chroma_beats(load(str(cover)), m['bpm'])
            sim = f'{max(similarity(A, np.roll(C, k, axis=1)) for k in range(12)):.2f}'
        rows.append((name, m, clip, sim))
    lines = ['# ГОПС — музыка v2 (ночной конвейер, 2026-11-01)', '',
             'Свои композиции по правилам евроданса (хук «мотив–ответ–повтор–каденция», минорные круги жанра), '
             'свой синтезатор 90-х. Файлы — `ogg/<имя>-demo.ogg` (основа) и `ogg/<имя>-cover.ogg` '
             '(ACE-Step XL cover — **мелодию не держит**, это вариант звучания «по мотивам»). MIDI — `mid/`.',
             'Громкость у всех −14 LUFS. «Сходство» — корреляция нот cover с демо (1 — те же ноты, ~0 — другая музыка).', '',
             '| Трек | BPM | Тональность | Круг | Форма | Лид | Начало хука | Длина | Cover: сходство |',
             '|---|---|---|---|---|---|---|---|---|']
    for name, m, clip, sim in rows:
        warn = ' ⚠ клиппинг' if clip > 0.001 else ''
        lines.append(f"| {name}{warn} | {m['bpm']:.0f} | {m['key']} | {'–'.join(m['prog'])} | {' '.join(m['form'])} | "
                     f"{m['lead']} | {m['hook']} | {m['sec']:.0f} с | {sim or '—'} |")
    (OUT / 'LISTEN.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('LISTEN.md:', len(rows), 'треков')


if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if what in ('demo', 'all'):
        stage_demo()
    if what in ('master', 'all'):
        stage_master()
