"""Озвучка реплик бойцов: Qwen3-TTS (Apache-2.0) — для сравнения с Chatterbox (runners/tts.py), выход в отдельную папку.

G:/ai/venvs/qwentts/Scripts/python.exe -X utf8 studio/runners/tts_qwen.py <реплики.json> <выход> [--sets sipliy,maloy] [--only ситуация]
    [--takes 2] [--test] [--stress] [--device cuda:1]

Как у авторов («Voice Design then Clone»): 1.7B-VoiceDesign по описанию набора (INSTRUCT, по описанию_голоса из voices.json)
делает образец голоса studio/voices/qwen/<набор>.wav (раз и навсегда; удалить — сделает заново), затем 1.7B-Base клонирует
его на все фразы — голос набора не плывёт от фразы к фразе. Выход: <выход>/<набор>/<ключ>-<NN>-<дубль>.wav + ogg/
(Opus 64k, −16 LUFS, тишина срезана) + manifest.json, как у Chatterbox. Готовое не пересчитывается.
--stress — ударения ruaccent знаком U+0301 (как для Chatterbox); по умолчанию текст как есть.
Веса — локально G:/ai/models/tts/qwen3 (ModelScope), видеокарта по умолчанию — 5060 (cuda:1).
"""
import argparse
import json
import pathlib
import subprocess
import sys
import time

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

sys.path.insert(0, str(pathlib.Path(__file__).parent))

W = pathlib.Path('G:/ai/models/tts/qwen3')
VOICES = pathlib.Path(__file__).parent.parent / 'voices' / 'qwen'
FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'

# Описание голоса для VoiceDesign (по «описанию_голоса» из voices.json; по-английски модель слушается точнее).
INSTRUCT = {
    'sipliy': 'Male, 18 years old, husky raspy tenor, hoarse from cold wind and sunflower seeds. Slow, laid-back, cocky street drawl, '
              'stretches vowels, careless "nothing scares me" attitude. Never shouts, slightly hoarse half-whisper. Russian.',
    'intelligent': 'Male, 28 years old, soft warm baritone, very clear diction, slightly mocking politeness, a bespectacled intellectual '
                   'who accidentally ended up in a rough yard. Medium pace, small pause before a joke, no pathos. Russian.',
    'maloy': 'Boy, 11 years old, high ringing child voice, curious and excited, sometimes squeaks; fast pace, breathless enthusiasm, '
             'lots of exclamations. Russian.',
    'batya': 'Man, 48 years old, deep low bass, calm and thick, tired of life; slow, weighty speech with pauses, grumbling fatherly '
             'warmth, "I have seen it all" tone. Russian.',
    'sibiryak': 'Man, 32 years old, medium voice, kind-hearted Siberian villager, sing-song drawling rural accent, rounds and stretches '
                'the "o" sounds, unhurried and good-natured. Russian.',
    'botan': 'Teenage boy, 15 years old, slightly nasal tenor, speaks fast and very precisely like a know-it-all, sometimes stumbles '
             'from excitement, "let me explain" tone, quiet nerdy chuckle. Russian.',
}
# Что говорит образец (8–12 с, по-русски, в характере набора).
REF_TEXT = {
    'sipliy': 'Слышь, братан, ты чё, с другого района? Да ладно, не кипишуй. Сейчас разберёмся, кто тут главный во дворе.',
    'intelligent': 'Позвольте заметить, коллеги, что траектория была рассчитана безупречно. Ну, почти безупречно. Ветер, знаете ли.',
    'maloy': 'Ого-го! Вы видели, как я его? Вот это да! Пацаны, а можно мне ещё раз? Ну пожалуйста, ну один разочек!',
    'batya': 'Значит так, сынки. Я в этом дворе тридцать лет живу. Видал и не такое. Без суеты, по-взрослому. Пошли.',
    'sibiryak': 'Однако, паря, хорошо пошло! У нас в деревне так-то на медведя ходят, а тут, вишь, на соседей. Ядрёна вошь!',
    'botan': 'Так, секундочку, я вам сейчас объясню. По законам баллистики, хе-хе, снаряд должен... ой. Ну, в общем, попал.',
}


def finish(src: pathlib.Path, dst: pathlib.Path):
    """Срез тишины, громкость, Opus — как у Chatterbox, чтобы сравнивать на равных."""
    af = ('silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,'
          'loudnorm=I=-16:TP=-1.5:LRA=7')
    subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(src), '-af', af, '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', str(dst)], check=True)


def load(name: str, device: str) -> Qwen3TTSModel:
    return Qwen3TTSModel.from_pretrained(str(W / name), device_map=device, dtype=torch.bfloat16, attn_implementation='sdpa')


def make_refs(sets: list[str], device: str):
    """Образцы голосов наборов через VoiceDesign (только недостающие)."""
    need = [s for s in sets if not (VOICES / f'{s}.wav').exists()]
    if not need:
        return
    VOICES.mkdir(parents=True, exist_ok=True)
    model = load('Qwen3-TTS-12Hz-1.7B-VoiceDesign', device)
    for s in need:
        torch.manual_seed(7)
        t0 = time.time()
        wavs, sr = model.generate_voice_design(text=REF_TEXT[s], language='Russian', instruct=INSTRUCT[s])
        sf.write(str(VOICES / f'{s}.wav'), wavs[0], sr)
        print(f'образец {s}: {len(wavs[0]) / sr:.1f} с за {time.time() - t0:.0f} с', flush=True)
    del model
    torch.cuda.empty_cache()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('lines')
    ap.add_argument('out')
    ap.add_argument('--sets')
    ap.add_argument('--only')
    ap.add_argument('--takes', type=int, default=2)
    ap.add_argument('--test', action='store_true')
    ap.add_argument('--stress', action='store_true')
    ap.add_argument('--device', default='cuda:1')
    a = ap.parse_args()

    data = json.loads(pathlib.Path(a.lines).read_text(encoding='utf-8'))
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else []
    done = {m['file'] for m in manifest}
    sets = a.sets.split(',') if a.sets else [k for k in data if not k.startswith('_')]
    make_refs(sets, a.device)

    stress = None
    if a.stress:
        from tts import stress  # ruaccent, общий с Chatterbox

    model = load('Qwen3-TTS-12Hz-1.7B-Base', a.device)
    for s in sets:
        prompt = model.create_voice_clone_prompt(ref_audio=str(VOICES / f'{s}.wav'), ref_text=REF_TEXT[s])
        d = out / s
        (d / 'ogg').mkdir(parents=True, exist_ok=True)
        for key, phrases in data[s]['ситуации'].items():
            if a.only and key not in a.only.split(','):
                continue
            for i, text in enumerate(phrases[:1] if a.test else phrases):
                for take in range(1 if a.test else a.takes):
                    file = f'{s}/{key}-{i + 1:02d}-{take + 1}.wav'
                    if file in done:
                        continue
                    torch.manual_seed(1000 * i + take)
                    said = stress(text) if stress else text
                    t0 = time.time()
                    wavs, sr = model.generate_voice_clone(text=said, language='Russian', voice_clone_prompt=prompt)
                    sf.write(str(out / file), wavs[0], sr)
                    finish(out / file, d / 'ogg' / (pathlib.Path(file).stem + '.ogg'))
                    manifest.append({'file': file, 'set': s, 'key': key, 'text': text, 'said': said, 'take': take + 1,
                                     'ref': f'qwen/{s}.wav', 'license': 'Apache-2.0 (Qwen3-TTS)'})
                    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')
                    print(f'готово {file} ({len(wavs[0]) / sr:.1f} с за {time.time() - t0:.1f} с) {text}', flush=True)
            if a.test:
                break


if __name__ == '__main__':
    main()
