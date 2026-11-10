"""Озвучка локально: Fun-CosyVoice3-0.5B-2512 (Apache-2.0; выбор пользователя 2026-11-11 для больших объёмов — «Заколдованная страна»).
Клонирование голоса по образцу (zero-shot): образец 8–12 с + его текст.

cd G:/ai/src/CosyVoice && G:/ai/venvs/cosyvoice/Scripts/python -X utf8 G:/Claude/Shish/studio/runners/tts_cosyvoice.py \
    <задание.json> <выход> [--only префикс]

Задание: {"voices": {"<голос>": {"wav": "образец.wav", "text": "текст образца"}},
          "lines": {"<ключ>": {"voice": "<голос>", "text": "что сказать"}}}
Строка из нескольких голосов (рассказчик + реплики): {"segs": [["<голос>", "текст"], ...]} — куски склеиваются с паузой 0,25 с.
Ключ может содержать «/» (подпапки). Выход: <выход>/<ключ>.ogg (Opus 64k, −16 LUFS, тишина срезана) — как у остальной озвучки.
Ударения «+» модель не понимает — в тексте их быть не должно (снимаются). Готовое не пересчитывается.
Окружение: venv G:/ai/venvs/cosyvoice (torch 2.7.1 cu128, numpy 1.26.4, pyarrow 18.1.0), код G:/ai/src/CosyVoice,
веса G:/ai/models/tts/cosyvoice3. Видеокарта — 4070 (одна, по очереди с остальным конвейером).
"""
import argparse
import json
import pathlib
import subprocess
import sys

sys.path[:0] = ['G:/ai/src/CosyVoice', 'G:/ai/src/CosyVoice/third_party/Matcha-TTS']
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import torch  # noqa: E402
from cosyvoice.cli.cosyvoice import AutoModel  # noqa: E402

FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
AF = ('silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,'
      'areverse,loudnorm=I=-16:TP=-1.5:LRA=7')
PROMPT = 'You are a helpful assistant.<|endofprompt|>'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('job')
    ap.add_argument('out')
    ap.add_argument('--only')
    ap.add_argument('--br', default='64k', help='битрейт Opus (рассказ «Заколдованной страны» — 32k)')
    a = ap.parse_args()
    job = json.loads(pathlib.Path(a.job).read_text(encoding='utf-8'))
    out = pathlib.Path(a.out)
    todo = [(k, v) for k, v in job['lines'].items()
            if (not a.only or k.startswith(a.only)) and not (out / f'{k}.ogg').exists()]
    segs = lambda v: v['segs'] if 'segs' in v else [[v['voice'], v['text']]]  # noqa: E731
    print(f'реплик {len(todo)}, символов {sum(len(t) for _, v in todo for _, t in segs(v))}', flush=True)
    if not todo:
        return
    cv = AutoModel(model_dir='G:/ai/models/tts/cosyvoice3')
    torch.manual_seed(7)
    for i, (k, v) in enumerate(todo, 1):
        parts = []
        for j, (voice, text) in enumerate(segs(v)):
            ref = job['voices'][voice]
            if j:
                parts.append(np.zeros(int(cv.sample_rate * 0.25), np.float32))
            parts += [o['tts_speech'].squeeze(0).cpu().numpy().astype(np.float32)
                      for o in cv.inference_zero_shot(text.replace('+', ''), PROMPT + ref['text'], ref['wav'], stream=False)]
        dst = out / f'{k}.ogg'
        dst.parent.mkdir(parents=True, exist_ok=True)
        wav = dst.with_suffix('.wav')
        sf.write(wav, np.concatenate(parts), cv.sample_rate)
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(wav), '-af', AF, '-ar', '48000', '-c:a', 'libopus', '-b:a', a.br,
                        str(dst)], check=True)
        wav.unlink()
        if i % 20 == 0:
            print(f'{i}/{len(todo)}', flush=True)
    print('готово')


if __name__ == '__main__':
    main()
