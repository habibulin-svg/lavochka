"""Раскладка озвучки ElevenLabs (runners/tts_eleven.py) по играм сборника.

python -X utf8 studio/post/pack_voices.py [<папка озвучки>]   (по умолчанию G:/ai/out/studio/voices-eleven)

ГОПС: <набор>/<ситуация>-NN.ogg → public/gops/a/34-voices-eleven/<набор>/ogg/<ситуация>-NN-1.ogg + picks.json
(формат прежних наборов: фраза → файл дубля; дубль один). «Коммерсы»: kolyan/<ситуация>-NN.ogg → public/kommersy/a/voice/.
"""
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'G:/ai/out/studio/voices-eleven')
PUB = ROOT / 'lavochka/public'
GOPS = ['sipliy', 'intelligent', 'maloy', 'batya', 'sibiryak', 'botan']

picks, n = {}, 0
dst = PUB / 'gops/a/34-voices-eleven'
for s in GOPS:
    for f in sorted((SRC / s).glob('*.ogg')):
        (dst / s / 'ogg').mkdir(parents=True, exist_ok=True)
        shutil.copyfile(f, dst / s / 'ogg' / f'{f.stem}-1.ogg')
        picks[f'{s}/{f.stem}'] = f'{s}/{f.stem}-1.wav'
        n += 1
(dst / 'picks.json').write_text(json.dumps(picks, ensure_ascii=False, indent=1), encoding='utf-8')
for f in sorted((SRC / 'kolyan').glob('*.ogg')):
    shutil.copyfile(f, PUB / 'kommersy/a/voice' / f.name)
    n += 1
print(f'разложено {n}')
