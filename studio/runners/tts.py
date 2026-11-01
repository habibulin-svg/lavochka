"""Озвучка реплик бойцов: Chatterbox Multilingual (MIT), русский, клонирование голоса по образцу.

G:/ai/venvs/tts/Scripts/python.exe -X utf8 studio/runners/tts.py <реплики.json> <выход> [--sets sipliy,maloy] [--only ситуация] [--takes 2] [--test]

Реплики — docs/gops/texts/voices.json: {набор: {ситуации: {ключ: [фразы]}}}.
Голос набора — образец studio/voices/<набор>.wav (5–15 с чистой речи); нет образца — ru_m.wav (русский мужской из демо Chatterbox)
и сдвиг высоты/темпа из PITCH (временно, до образцов). Выход: <выход>/<набор>/<ключ>-<NN>-<дубль>.wav
+ ogg/ (Opus 64k, −16 LUFS, тишина по краям срезана) + manifest.json. Готовое не пересчитывается.
--test — по одной фразе на набор, чтобы послушать.
Веса — локально G:/ai/models/tts/chatterbox (без Hugging Face).
"""
import argparse
import json
import pathlib
import subprocess

import torch
import torchaudio

from chatterbox.mtl_tts import ChatterboxMultilingualTTS
from ruaccent import RUAccent

VOWELS = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ'
_accent = None


def stress(text: str) -> str:
    """Ударения автоматически (ruaccent, омографы по контексту): «+» перед гласной → знак ударения U+0301 после неё,
    как в словаре Chatterbox. Ручное «+» в тексте реплики уважается."""
    global _accent
    if _accent is None:
        _accent = RUAccent()
        _accent.load(omograph_model_size='turbo3.1', use_dictionary=True, tiny_mode=False)
    t = text if '+' in text else _accent.process_all(text)
    out, i = [], 0
    while i < len(t):
        if t[i] == '+' and i + 1 < len(t) and t[i + 1] in VOWELS:
            out += [t[i + 1], '́']
            i += 2
        else:
            out.append(t[i])
            i += 1
    return ''.join(out)

CKPT = pathlib.Path('G:/ai/models/tts/chatterbox')
VOICES = pathlib.Path(__file__).parent.parent / 'voices'
FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
# временный характер без образца: (полутоны, темп, exaggeration)
PITCH = {
    'sipliy': (-2, 0.95, 0.6),
    'intelligent': (0, 1.0, 0.4),
    'maloy': (4, 1.1, 0.7),
    'batya': (-5, 0.9, 0.5),
    'sibiryak': (-3, 0.95, 0.6),
    'botan': (2, 1.05, 0.5),
}


def finish(src: pathlib.Path, dst: pathlib.Path, semitones: float, tempo: float):
    """Сдвиг высоты и темпа, срез тишины, громкость, Opus."""
    rate = 2 ** (semitones / 12)
    af = (f'asetrate=24000*{rate:.4f},aresample=24000,atempo={tempo / rate:.4f},'
          'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,'
          'loudnorm=I=-16:TP=-1.5:LRA=7')
    subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(src), '-af', af, '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', str(dst)], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('lines')
    ap.add_argument('out')
    ap.add_argument('--sets')
    ap.add_argument('--only')
    ap.add_argument('--takes', type=int, default=2)
    ap.add_argument('--test', action='store_true')
    a = ap.parse_args()

    data = json.loads(pathlib.Path(a.lines).read_text(encoding='utf-8'))
    out = pathlib.Path(a.out)
    manifest_path = out / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else []
    done = {m['file'] for m in manifest}
    model = ChatterboxMultilingualTTS.from_local(CKPT, 'cuda')

    sets = a.sets.split(',') if a.sets else [k for k in data if not k.startswith('_')]
    for s in sets:
        ref = VOICES / f'{s}.wav'
        semi, tempo, exag = PITCH.get(s, (0, 1.0, 0.5))
        if ref.exists():
            semi, tempo = 0, 1.0
        else:  # общий русский мужской образец из демо Chatterbox, характер — сдвигом высоты и темпа
            ref = VOICES / 'ru_m.wav'
        d = out / s
        (d / 'ogg').mkdir(parents=True, exist_ok=True)
        situations = data[s]['ситуации']
        for key, phrases in situations.items():
            if a.only and key not in a.only.split(','):
                continue
            for i, text in enumerate(phrases[:1] if a.test else phrases):
                for take in range(1 if a.test else a.takes):
                    file = f'{s}/{key}-{i + 1:02d}-{take + 1}.wav'
                    if file in done:
                        continue
                    torch.manual_seed(1000 * i + take)
                    wav = model.generate(stress(text), language_id='ru', audio_prompt_path=str(ref) if ref.exists() else None,
                                         exaggeration=exag, cfg_weight=0.5, temperature=0.8)
                    torchaudio.save(str(out / file), wav, model.sr)
                    finish(out / file, d / 'ogg' / (pathlib.Path(file).stem + '.ogg'), semi, tempo)
                    manifest.append({'file': file, 'set': s, 'key': key, 'text': text, 'stressed': stress(text), 'take': take + 1,
                                     'ref': ref.name if ref.exists() else None, 'license': 'MIT (Chatterbox Multilingual)'})
                    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')
                    print('готово', file, text, flush=True)
            if a.test:
                break


if __name__ == '__main__':
    main()
