"""Распознавание текста на вкладышах локальной моделью со зрением (llama-server, OpenAI-совместимый API).

  python ocr.py G:\\temp\\vkladyshi G:\\temp\\vkladyshi-clean G:\\temp\\vkladyshi-ocr [--url http://127.0.0.1:8081] [--only Turbo]

Берёт картинку из обработанной папки (крупнее), если её нет — исходник. Результат — <коллекция>.json рядом,
по файлу: поля по типу коллекции (машины / футбол / Love is / техника). Готовое пропускает.
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

PROMPTS = {
    'car': ('This is a 1990s chewing-gum insert card with a car or motorcycle. Read the printed text exactly. '
            'Return JSON: {"name": brand and model as printed (e.g. "BMW M3"), "kind": "car"|"moto"|"f1"|"truck"|"plane"|"boat"|"other", '
            '"cc": engine displacement in cm3 as integer or null, "hp": horse power (HP/PS/Güç) as integer or null, '
            '"speed": max speed km/h as integer or null, "year": model year as integer or null, "number": the insert number printed on the card as integer or null}. '
            'Use null when a value is not printed. Do not guess.'),
    'football': ('This is a 1990s football chewing-gum insert card (Ülker Final). Read the printed text exactly. '
                 'Return JSON: {"player": player name as printed or null (null if it is a team photo), "team": national team / country as printed, '
                 '"team_en": that country in English, "club": club if printed or null, "is_team_photo": true|false, "number": insert number as integer or null}.'),
    'love': ('This is a "Love is..." chewing-gum insert (1990s). Read the caption exactly. '
             'Return JSON: {"ru": the Russian caption after "Любовь это..." (without that prefix) or null, '
             '"en": the English caption after "Love is..." or null, "tr": Turkish caption or null, "number": insert number as integer or null, '
             '"scene": 3-6 English words describing the picture}.'),
    'military': ('This is a 1990s chewing-gum insert with military equipment (Ülker Lazer). Read the printed text exactly. '
                 'Return JSON: {"name": name as printed, "kind": "ship"|"plane"|"helicopter"|"tank"|"submarine"|"missile"|"other", '
                 '"country": country as printed or null, "speed": speed km/h or knots as printed (string) or null, '
                 '"range": range as printed (string) or null, "number": insert number as integer or null}.'),
}


def kind_of(category: str, coll: str) -> str:
    s = f'{category} {coll}'.lower()
    if 'love' in s:
        return 'love'
    if 'final' in s:
        return 'football'
    if 'lazer' in s:
        return 'military'
    return 'car'


def ask(url: str, img: Path, prompt: str) -> dict:
    b64 = base64.b64encode(img.read_bytes()).decode()
    mime = 'image/webp' if img.suffix == '.webp' else 'image/jpeg'
    body = {
        'messages': [{'role': 'user', 'content': [
            {'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,{b64}'}},
            {'type': 'text', 'text': prompt}]}],
        'temperature': 0, 'max_tokens': 300,
        'response_format': {'type': 'json_object'},
        'chat_template_kwargs': {'enable_thinking': False},
    }
    req = urllib.request.Request(url.rstrip('/') + '/v1/chat/completions', data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as r:
        txt = json.loads(r.read())['choices'][0]['message']['content']
    m = re.search(r'\{.*\}', txt, re.S)
    return json.loads(m.group(0)) if m else {'_raw': txt}


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    p = argparse.ArgumentParser()
    p.add_argument('src')
    p.add_argument('clean')
    p.add_argument('out')
    p.add_argument('--url', default='http://127.0.0.1:8081')
    p.add_argument('--only')
    p.add_argument('--limit', type=int, default=0)
    a = p.parse_args()
    src, clean, out = Path(a.src), Path(a.clean), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    t0, n = time.time(), 0
    for m in sorted(src.glob('*/*/meta.json')):
        cat, coll = m.parent.parent.name, m.parent.name
        if a.only and a.only.lower() not in f'{cat} {coll}'.lower():
            continue
        kind = kind_of(cat, coll)
        res_path = out / f'{cat} — {coll}.json'
        try:
            res = json.loads(res_path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            res = {'category': cat, 'collection': coll, 'kind': kind, 'items': {}}
        items = json.loads(m.read_text(encoding='utf-8'))['items']
        items = [x for x in items if x['label'] not in ('0', '')]
        if a.limit:
            items = items[:a.limit]
        print(f'{cat} / {coll} [{kind}]: {len(items)}', flush=True)
        for it in items:
            if it['file'] in res['items']:
                continue
            cimg = clean / cat / coll / (Path(it['file']).stem + '.webp')
            img = cimg if cimg.exists() else m.parent / it['file']
            try:
                r = ask(a.url, img, PROMPTS[kind])
            except Exception as e:
                r = {'_error': str(e)}
            r['label'] = it['label']
            res['items'][it['file']] = r
            n += 1
            if n % 10 == 0:
                res_path.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
        res_path.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'Готово: {n} шт. за {time.time() - t0:.0f} с', flush=True)


if __name__ == '__main__':
    main()
