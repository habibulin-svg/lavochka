"""Раскладка озвучки «Заколдованной страны»: G:/ai/out/studio/zakoldovannaya/voice/<ключ>.ogg → public/zakoldovannaya/voice/
+ index.json (список озвученных ключей для проигрывателя ui/voice.ts). Лишние файлы (строки, которых больше нет) — удаляет.
python -X utf8 lavochka/tools/zakoldovannaya/voice/pack.py"""
import json, pathlib, shutil

HERE = pathlib.Path(__file__).parent
SRC = pathlib.Path('G:/ai/out/studio/zakoldovannaya/voice')
DST = HERE.parents[2] / 'public/zakoldovannaya/voice'
DST.mkdir(parents=True, exist_ok=True)
job = json.loads((HERE / 'job.json').read_text(encoding='utf-8'))
keys = sorted(k for k in job['lines'] if (SRC / f'{k}.ogg').exists())
for k in keys:
    s, d = SRC / f'{k}.ogg', DST / f'{k}.ogg'
    if not d.exists() or d.stat().st_size != s.stat().st_size:
        shutil.copy2(s, d)
for f in DST.glob('*.ogg'):
    if f.stem not in set(keys):
        f.unlink()
(DST / 'index.json').write_text(json.dumps(keys, separators=(',', ':')), encoding='utf-8')
mb = sum(f.stat().st_size for f in DST.glob('*.ogg')) / 2**20
print(f'озвучено {len(keys)} из {len(job["lines"])}, {mb:.1f} МБ')
