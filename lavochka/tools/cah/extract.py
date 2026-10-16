"""Карты против человечества: тексты карт из русского PDF с официального сайта.

PDF: https://img.cah.io/files/vc07edlh/production/b723eee31eed83d49b7cf926395987c0186eb98b.pdf
(Cards Against Humanity LLC, CC BY-NC-SA 2.0). Страница 0 — правила, 1–26 — белые
карты, 27–31 — чёрные; на странице сетка 4×5 квадратных карт по 143 pt.
Пропуск на чёрной карте в тексте PDF — табуляция; значок «PICK n» нарисован кривыми —
цифру узнаём по числу элементов контура.

    python -I tools/cah/extract.py D:/temp/cah/dl/cah-ru.pdf src/games/cah/cards.json
"""
import json
import re
import sys

import pymupdf

X = [19.9, 163.0, 306.1, 449.2, 592.1]
Y = [18.3 + 143.2 * k for k in range(6)]
DIGIT = {32: 2, 42: 3}  # число элементов контура цифры в значке PICK

# Переносы строк и опечатки вёрстки, которые машинно не угадать.
FIX = {
    'по- настоящему': 'по-настоящему',
    'футболс ': 'футбол с ',
    'я уби _.': 'я убил _.',
    'рэп- исп': 'рэп-исп',
    'секс- игр': 'секс-игр',
    'возбуждённый- возб': 'возбуждённый-возб',
    'зомби- апок': 'зомби-апок',
    'позднекапиталистиче- ском': 'позднекапиталистическом',
    '“Просто еще одна адаптация': '“Просто еще одна адаптация”.',
}


def cell_text(page, c, r):
    x0, x1, y0, y1 = X[c], X[c + 1], Y[r], Y[r + 1]
    clip = pymupdf.Rect(x0 + 2, y0 + 2, x1 - 2, y1 - 22)  # без логотипа внизу
    lines = []
    for b in page.get_text('dict', clip=clip)['blocks']:
        for ln in b.get('lines', []):
            s = ''.join(sp['text'] for sp in ln['spans'])
            if s.strip() or '\t' in s:
                lines.append(s)
    s = ' '.join(lines).replace('\t', ' _ ')
    s = s.replace('\u0301', '')  # ударения
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'(_\s*)+_', '_', s)  # одна черта на пропуск
    s = re.sub(r'_ ([.,:;!?»”"])', r'_\1', s)
    s = re.sub(r'([«“"]) _', r'\1_', s)
    s = re.sub(r'(\w) -(то|либо|нибудь)\b', r'\1-\2', s)  # «Какой -то»
    s = s.replace('[Chef Kiss Picture]', '👌')
    for a, b in FIX.items():
        s = s.replace(a, b)
    return s


def pick(page, c, r):
    x0, x1, y1 = X[c], X[c + 1], Y[r + 1]
    for g in page.get_drawings():
        R = g['rect']
        if R.x0 > x0 + 80 and R.x1 < x1 and R.y0 > y1 - 30 and R.y1 < y1 and R.width < 60:
            if g.get('fill') and g['fill'][0] < 0.5 and len(g['items']) in DIGIT:
                return DIGIT[len(g['items'])]
    return 1


def main(src, out):
    sys.stdout.reconfigure(encoding='utf-8')
    d = pymupdf.open(src)
    white, black = [], []
    for i in range(1, len(d)):
        page = d[i]
        for r in range(5):
            for c in range(4):
                t = cell_text(page, c, r)
                if not t:
                    continue
                if i <= 26:
                    if t not in white:  # одна карта в PDF повторяется
                        white.append(t)
                else:
                    n = pick(page, c, r)
                    blanks = t.count('_')
                    if n > 1 and blanks not in (0, n):
                        print('!! пропусков', blanks, 'а PICK', n, ':', t, file=sys.stderr)
                    card = {'t': t, 'pick': n}
                    if n == 3:  # в оригинале на таких картах «DRAW 2, PICK 3»
                        card['draw'] = 2
                    black.append(card)
    json.dump({'white': white, 'black': black}, open(out, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=0)
    print('белых', len(white), 'чёрных', len(black),
          'pick2', sum(b['pick'] == 2 for b in black), 'pick3', sum(b['pick'] == 3 for b in black))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
