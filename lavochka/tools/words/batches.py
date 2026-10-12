"""Пакеты слов для агентов, которые пишут вопросы кроссворда.

Запуск: python tools/words/batches.py   (пути — materials/words/ рядом с репозиторием)
Нарицательные: словарь существительных сборника ∩ толкования Викисловаря, частотность wordfreq (zipf) ≥ MIN_ZIPF.
Имена собственные: выборки Викиданных (wikidata.py) с порогом известности по виду.
Пишет materials/words/batches/in_NNN.tsv: id, слово, вид (обычное слово / город / река …), подсказка смысла, известность.
"""
import glob
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', '..')
W = os.path.join(ROOT, 'materials', 'words')
sys.path.insert(0, os.path.join(W, 'pylib'))
from wordfreq import zipf_frequency  # noqa: E402

MIN_ZIPF = 1.5
SIZE = 250

# порог известности (статей в Википедиях) по выборкам Викиданных; людям — фамилия
MIN_SL = {
    'capital': 60, 'city': 110, 'city_ru': 45, 'country': 0, 'country_hist': 60, 'lake': 60, 'river': 60, 'sea': 30,
    'mountain': 50, 'range': 45, 'island': 60, 'peninsula': 40, 'desert': 30, 'volcano': 50, 'element': 0, 'constellation': 0,
    'planet': 0, 'deity': 50, 'myth': 50, 'character': 50, 'film': 80, 'film_su': 15, 'cartoon': 40, 'book': 70, 'opera': 35,
    'ballet': 20, 'brand': 70, 'carmaker': 50, 'band': 80, 'dog_breed': 40, 'language': 120, 'people': 70, 'currency': 50,
    'person_world': 130, 'person_ru': 45,
}


def main():
    nouns = [w.strip() for w in open(os.path.join(ROOT, 'lavochka', 'public', 'dict', 'nouns.txt'), encoding='utf-8') if w.strip()]
    gl = json.load(open(os.path.join(W, 'wikt_glosses.json'), encoding='utf-8'))
    rows = []
    for w in nouns:
        if not 3 <= len(w) <= 12 or w not in gl:
            continue
        z = zipf_frequency(w, 'ru')
        if z < MIN_ZIPF:
            continue
        hint = ' | '.join(g for g in gl[w] if len(g) > 4)[:220]
        rows.append((w, 'слово', hint, f'{z:.1f}'))
    rows.sort(key=lambda r: -float(r[3]))
    common = len(rows)
    seen = {}
    for f in sorted(glob.glob(os.path.join(W, 'wikidata', '*.json'))):
        name = os.path.splitext(os.path.basename(f))[0]
        for it in json.load(open(f, encoding='utf-8')):
            if it['sl'] < MIN_SL.get(name, 0 if name.startswith('person') else 999) or not 3 <= len(it['word']) <= 12:
                continue
            hint = f"{it['name']} — {it['desc']}".strip(' —')[:200]
            seen.setdefault((it['word'], it['kind']), []).append((it['sl'], hint))
    proper = 0
    for (word, kind), lst in seen.items():
        lst.sort(reverse=True)
        hint = ' | '.join(h for _, h in lst[:2])
        rows.append((word, kind, hint, f'sl{lst[0][0]}'))
        proper += 1
    out = os.path.join(W, 'batches')
    os.makedirs(out, exist_ok=True)
    for k in range(0, len(rows), SIZE):
        with open(os.path.join(out, f'in_{k // SIZE:03d}.tsv'), 'w', encoding='utf-8') as f:
            for j, r in enumerate(rows[k:k + SIZE]):
                f.write('\t'.join([str(k + j), *[x.replace('\t', ' ').replace('\n', ' ') for x in r]]) + '\n')
    print(f'нарицательных {common}, собственных {proper}, пакетов {(len(rows) + SIZE - 1) // SIZE}')


if __name__ == '__main__':
    main()
