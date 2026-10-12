"""Собрать базу вопросов из пакетов агентов: materials/words/batches/out_NNN.tsv → public/dict/clues.tsv.

Запуск: python tools/words/build_clues.py
Проверки: строка из 6 полей, годится=1, сложность 1–3, короткий ≤ 24 символов, обычный не пустой,
в вопросе нет начала ответа (первые 4 буквы слова, для коротких слов — само слово целиком).
Вид слова берётся из входного пакета (in_NNN.tsv). Отчёт об отброшенном — в materials/words/rejected.tsv.
"""
import glob
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', '..')
W = os.path.join(ROOT, 'materials', 'words', 'batches')
OUT = os.path.join(ROOT, 'lavochka', 'public', 'dict', 'clues.tsv')


def norm(s: str) -> str:
    return s.lower().replace('ё', 'е')


def leaks(word: str, clue: str) -> bool:
    c = norm(clue)
    stem = word if len(word) <= 4 else word[:4]
    return re.search(r'(?<![а-я])' + re.escape(stem), c) is not None


def main():
    kinds = {}
    for f in glob.glob(os.path.join(W, 'in_*.tsv')):
        for line in open(f, encoding='utf-8'):
            p = line.rstrip('\n').split('\t')
            if len(p) >= 3:
                kinds[(p[0], p[1])] = p[2]
    rows = []
    rejected = []
    for f in sorted(glob.glob(os.path.join(W, 'out_*.tsv'))):
        for line in open(f, encoding='utf-8'):
            p = [x.strip() for x in line.rstrip('\n').split('\t')]
            if len(p) < 6:
                if len(p) >= 3 and p[2] == '0':
                    continue
                rejected.append((os.path.basename(f), line.strip(), 'полей < 6'))
                continue
            rid, word, ok, diff, short, long_ = p[:6]
            word = norm(word)
            if ok != '1':
                continue
            why = ''
            if (rid, word) not in kinds and (rid, p[1]) not in kinds:
                why = 'id и слово не совпадают со входом'
            elif not re.fullmatch(r'[а-я]{3,13}', word):
                why = 'слово'
            elif diff not in ('1', '2', '3'):
                why = 'сложность'
            elif not short or len(short) > 24:
                why = 'короткий'
            elif len(long_) < 4:
                why = 'обычный'
            elif leaks(word, short) or leaks(word, long_):
                why = 'ответ в вопросе'
            if why:
                rejected.append((os.path.basename(f), line.strip(), why))
                continue
            kind = kinds.get((rid, word)) or kinds.get((rid, p[1])) or 'слово'
            rows.append((word, diff, kind, short.replace('\t', ' '), long_.replace('\t', ' ')))
    # одинаковые слово+вопрос — один раз
    seen = set()
    uniq = []
    for r in sorted(rows):
        key = (r[0], r[3])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(r)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        for r in uniq:
            f.write('\t'.join(r) + '\n')
    with open(os.path.join(ROOT, 'materials', 'words', 'rejected.tsv'), 'w', encoding='utf-8') as f:
        for r in rejected:
            f.write('\t'.join(r) + '\n')
    words = len({r[0] for r in uniq})
    by = {}
    for r in uniq:
        by[r[1]] = by.get(r[1], 0) + 1
    print(f'вопросов {len(uniq)}, слов {words}, по сложности {dict(sorted(by.items()))}, отброшено {len(rejected)}')


if __name__ == '__main__':
    main()
