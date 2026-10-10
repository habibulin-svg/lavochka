"""Словарь для «Балды» и «Эрудита»: из списка существительных Harrix/Russian-Nouns (MIT) — в public/dict/nouns.txt.
Только кириллица, нижний регистр, «ё» → «е», от 2 до 15 букв, без повторов. Запуск: python tools/dict/build.py <путь к russian_nouns.txt>"""
import re
import sys

src = sys.argv[1]
words = set()
with open(src, encoding='utf-8') as f:
    for line in f:
        w = line.strip().lower().replace('ё', 'е')
        if 2 <= len(w) <= 15 and re.fullmatch(r'[а-я]+', w):
            words.add(w)
out = sorted(words)
with open('public/dict/nouns.txt', 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(out) + '\n')
print(len(out), 'слов')
