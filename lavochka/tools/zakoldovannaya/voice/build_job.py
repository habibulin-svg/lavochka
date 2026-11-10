"""Задание озвучки «Заколдованной страны» для studio/runners/tts_cosyvoice.py.
lines.json (extract.ts) + разметка агентов markup/out-*.jsonl (кто говорит, текст для синтеза) + образцы studio/voices/zs/cast.json
→ job.json. Строки без разметки — целиком рассказчику. Проверяет разметку: все ли ключи, голоса из списка, не потерян ли текст.
python -X utf8 lavochka/tools/zakoldovannaya/voice/build_job.py"""
import json, pathlib, re

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parents[3]
cast = json.loads((ROOT / 'studio/voices/zs/cast.json').read_text(encoding='utf-8'))
lines = json.loads((HERE / 'lines.json').read_text(encoding='utf-8'))
need = set()
for f in sorted((HERE / 'markup').glob('in-*.jsonl')):
    need |= {json.loads(s)['k'] for s in f.read_text(encoding='utf-8').splitlines() if s.strip()}
mark = {}
bad = []
for f in sorted((HERE / 'markup').glob('out-*.jsonl')):
    for i, s in enumerate(f.read_text(encoding='utf-8').splitlines(), 1):
        if not s.strip():
            continue
        try:
            o = json.loads(s)
            assert o['s'] and all(v in cast and isinstance(t, str) and t.strip() for v, t in o['s'])
            mark[o['k']] = [[v, t.strip()] for v, t in o['s']]
        except Exception as e:  # noqa: BLE001
            bad.append(f'{f.name}:{i} {e!r} {s[:80]}')

letters = lambda t: re.sub(r'[^а-яёa-z]', '', t.lower().replace('ё', 'е'))  # noqa: E731
job = {'voices': {k: {'wav': v['wav'], 'text': v['text']} for k, v in cast.items()}, 'lines': {}}
miss, drift = [], []
for l in lines:
    k, t = l['key'], l['text']
    if k in need and k not in mark:
        miss.append(k)
    segs = mark.get(k) or [['nar', t]]
    if k not in mark:
        segs = [['nar', re.sub(r'[*_#×]', '', t)]]
    a, b = letters(t), letters(' '.join(x for _, x in segs))
    if k in mark and not re.search(r'\d|\{|\b[А-ЯЁ]{2,}\b|×', t) and abs(len(a) - len(b)) > max(6, len(a) * 0.08):
        drift.append(f'{k}: {t[:70]} → {" | ".join(x for _, x in segs)[:70]}')
    job['lines'][k] = {'segs': segs}
(HERE / 'job.json').write_text(json.dumps(job, ensure_ascii=False, indent=0), encoding='utf-8')
roles = {}
for v in job['lines'].values():
    for x, t in v['segs']:
        roles[x] = roles.get(x, 0) + len(t)
print(f'строк {len(job["lines"])}, размечено {len(mark)}, нет разметки {len(miss)}, битых {len(bad)}, расхождений текста {len(drift)}')
print('символов по голосам:', dict(sorted(roles.items(), key=lambda x: -x[1])))
for x in bad[:20] + drift[:40]:
    print(' ', x)
if miss:
    print('нет разметки:', miss[:20])
