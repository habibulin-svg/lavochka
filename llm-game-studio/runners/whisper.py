"""Распознавание речи (Whisper): текст каждого файла, а если задан expected — ошибка символов (CER).

Единица: input (путь к звуку), expected (необязательно), group (необязательно — для выбора лучшего дубля).
Выход: <key>.json {text, cer}; общий results.json и picks.json (лучший дубль в каждой группе по CER). MIT.
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import _lgs  # noqa: E402


def norm(s: str) -> str:
    return re.sub(r'[^\w]+', '', s.lower().replace('ё', 'е'))


def cer(ref: str, hyp: str) -> float:
    a, b = norm(ref), norm(hyp)
    if not a:
        return 0.0 if not b else 1.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for jj, cb in enumerate(b, 1):
            cur.append(min(prev[jj] + 1, cur[jj - 1] + 1, prev[jj - 1] + (ca != cb)))
        prev = cur
    return round(prev[-1] / len(a), 4)


def main():
    j = _lgs.job()
    import torch
    from transformers import pipeline

    dev = _lgs.device(j)
    asr = pipeline('automatic-speech-recognition', model=str(j['model_dirs'][0]), device=dev,
                   torch_dtype=torch.float16 if dev != 'cpu' else torch.float32)
    out = pathlib.Path(j['out'])
    lang = (j.get('language') or 'Russian').lower()
    res = []
    units = j['units']
    for i, u in enumerate(units):
        _lgs.progress(i, len(units), u['key'])
        r = asr(u['input'], generate_kwargs={'language': lang, 'task': 'transcribe'})
        rec = {'name': u['name'], 'file': u['input'], 'text': r['text'].strip()}
        if u.get('expected') and not str(u['expected']).startswith('${'):
            rec['cer'] = cer(u['expected'], rec['text'])
            rec['expected'] = u['expected']
        rec['group'] = u.get('group') or re.sub(r'-\d+$', '', u['name'])
        (out / f"{u['key']}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding='utf-8')
        _lgs.output(out / f"{u['key']}.json", key=u['key'], item=u['name'], source=u['input'], cer=rec.get('cer'))
        res.append(rec)
        _lgs.progress(i + 1, len(units), u['key'])
    (out / 'results.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    picks = {}
    for r in res:
        if 'cer' in r and (r['group'] not in picks or r['cer'] < picks[r['group']]['cer']):
            picks[r['group']] = r
    if picks:
        (out / 'picks.json').write_text(json.dumps(list(picks.values()), ensure_ascii=False, indent=1), encoding='utf-8')
        _lgs.output(out / 'picks.json', key='picks')


if __name__ == '__main__':
    main()
