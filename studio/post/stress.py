"""Ударения для озвучки реплик: ruaccent + проверенные пользователем поправки (studio/voices/stress-fixes.json).

G:/ai/venvs/qwentts/Scripts/python.exe -X utf8 studio/post/stress.py <выход.json> [<выход.md>]

Берёт реплики ГОПС (docs/gops/texts/voices.json) и «Коммерсов» (studio/jobs/kommersy/10-kolyan-voice.json).
Выход: json {набор/ситуация-NN: {text, say, stress}} — stress с «+» перед ударной гласной (формат Silero и Яндекса);
md — для проверки глазами: ударная гласная заглавной, односложные без отметки, ⚠ — слова не из словаря ruaccent.
Правила: в слове с ё ударение на ё; слова из words — как в поправках; say — замены только для озвучки.
"""
import json
import os
import pathlib
import re
import sys

os.environ.setdefault('CUDA_VISIBLE_DEVICES', '')
from ruaccent import RUAccent

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = [('ГОПС', ROOT / 'docs/gops/texts/voices.json'), ('Коммерсы', ROOT / 'studio/jobs/kommersy/10-kolyan-voice.json')]
FIXES = json.loads((ROOT / 'studio/voices/stress-fixes.json').read_text(encoding='utf-8'))
WORDS, SAY = FIXES['words'], FIXES['say']
V = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ'
TOKEN = re.compile(r'[а-яёА-ЯЁ+]+(?:-[а-яёА-ЯЁ+]+)*')

acc = RUAccent()
acc.load(omograph_model_size='turbo3.1', use_dictionary=True, tiny_mode=False,
         custom_dict={k: v for k, v in WORDS.items() if '-' not in k})


def keep_case(src, marked):
    """Разметку из marked («+») — на буквы src (регистр и ё исходника)."""
    out, j = [], 0
    for ch in marked:
        if ch == '+':
            out.append('+')
            continue
        out.append(src[j] if j < len(src) else ch)
        j += 1
    return ''.join(out)


def fix_token(tok):
    bare = tok.replace('+', '')
    low = bare.lower()
    if low in WORDS:
        return keep_case(bare, WORDS[low])
    parts = bare.split('-'), tok.split('-')
    res = []
    for b, t in zip(*parts):
        if 'ё' in b.lower():  # ударение на ё
            i = b.lower().index('ё')
            t = b[:i] + '+' + b[i:]
        elif b.lower() in WORDS:
            t = keep_case(b, WORDS[b.lower()])
        res.append(t)
    return '-'.join(res)


def accent(text):
    say = text
    for a, b in SAY.items():
        say = say.replace(a, b)
    marked = keep_case(say, acc.process_all(say))
    return say, TOKEN.sub(lambda m: fix_token(m.group(0)), marked)


def caps(t):
    def w(m):
        x = m.group(0)
        bare = x.replace('+', '').lower()
        if sum(c in V for c in bare) <= 1:
            return x.replace('+', '')
        y = re.sub(r'\+([' + V + '])', lambda q: q.group(1).upper(), x)
        known = all(p in acc.accents or p.replace('ё', 'е') in acc.accents or 'ё' in p for p in bare.split('-'))
        if not known and bare not in WORDS:
            y = '⚠' + y
        return y
    return TOKEN.sub(w, t)


def main():
    out, md = {}, ['# Ударения в репликах — проверить глазами',
                   '', 'Ударная гласная — заглавная; односложные без отметки; ⚠ — слова не из словаря ruaccent. '
                   'Поправки — в studio/voices/stress-fixes.json.']
    for game, p in SRC:
        d = json.loads(p.read_text(encoding='utf-8'))
        for k, v in d.items():
            if k.startswith('_') or not isinstance(v, dict):
                continue
            md.append(f'\n## {game} — {v.get("название", k)} ({k})\n')
            for sit, lines in v['ситуации'].items():
                for i, t in enumerate(lines, 1):
                    say, st = accent(t)
                    out[f'{k}/{sit}-{i:02d}'] = {'text': t, 'say': say, 'stress': st}
                    md.append(f'- `{sit}-{i:02d}` {caps(st)}')
    pathlib.Path(sys.argv[1]).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    if len(sys.argv) > 2:
        pathlib.Path(sys.argv[2]).write_text('\n'.join(md) + '\n', encoding='utf-8')
    print(len(out))


if __name__ == '__main__':
    main()
