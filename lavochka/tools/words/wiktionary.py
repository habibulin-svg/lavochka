"""Толкования русских слов из дампа Викисловаря (CC BY-SA) — как подсказка смысла для тех, кто пишет вопросы кроссворда.
Сами вопросы пишутся заново, толкования в игру не попадают.

Запуск: python tools/words/wiktionary.py <дамп .xml.bz2> <список слов .txt> <вывод .json>
Список слов — по слову в строке; берём только их (ё → е при сравнении). Вывод: {слово: [толкование, …]} (до трёх значений).
"""
import bz2
import json
import re
import sys
import xml.etree.ElementTree as ET

NS = '{http://www.mediawiki.org/xml/export-0.11/}'


def strip_templates(s: str) -> str:
    # убрать {{…}} с вложенностью
    out = []
    depth = 0
    i = 0
    while i < len(s):
        if s.startswith('{{', i):
            depth += 1
            i += 2
            continue
        if s.startswith('}}', i) and depth:
            depth -= 1
            i += 2
            continue
        if not depth:
            out.append(s[i])
        i += 1
    return ''.join(out)


LINK2 = re.compile(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]')
TAGS = re.compile(r'<[^>]+>')
LABEL = re.compile(r'\{\{(?:помета|п)\|([^}|]*)[^}]*\}\}')
SHORT_LABEL = re.compile(r'\{\{([а-яё]+\.)(?:\|[^}]*)?\}\}')


def clean(line: str) -> str:
    line = re.sub(r'\{\{пример\|.*$', '', line)  # пример до конца строки (часто незакрытый в одной строке)
    line = LABEL.sub(lambda m: m.group(1) + ' ', line)
    line = SHORT_LABEL.sub(lambda m: m.group(1) + ' ', line)
    line = strip_templates(line)
    line = LINK2.sub(lambda m: m.group(1), line)
    line = TAGS.sub('', line)
    line = re.sub(r"'''?", '', line)
    line = re.sub(r'\s+', ' ', line).strip(' ;,:—-')
    return line.strip()


def ru_section(text: str) -> str:
    """Русская секция статьи (с омонимами -ru-|I, -ru-|II) — до заголовка другого языка."""
    m = re.search(r'^=\s*\{\{-ru-(?:\|[^}]*)?\}\}\s*=\s*$', text, re.M)
    if not m:
        return ''
    rest = text[m.end():]
    stop = re.search(r'^=\s*\{\{-(?!ru-)[a-z-]+-(?:\|[^}]*)?\}\}\s*=\s*$', rest, re.M)
    return rest[: stop.start()] if stop else rest


def senses(sec: str):
    res = []
    for block in re.split(r'^=+\s*Значение\s*=+\s*$', sec, flags=re.M)[1:]:
        for line in block.splitlines():
            if line.startswith('='):
                break
            if not line.startswith('#') or line.startswith('#:') or line.startswith('#*'):
                continue
            t = clean(line.lstrip('#').strip())
            if len(t) >= 3 and t not in res:
                res.append(t)
    return res[:3]


def main():
    dump, wl, out = sys.argv[1:4]
    want = set(w.strip() for w in open(wl, encoding='utf-8') if w.strip())
    found = {}
    with bz2.open(dump, 'rb') as f:
        for _, el in ET.iterparse(f, events=('end',)):
            if el.tag != NS + 'page':
                continue
            title = el.findtext(NS + 'title') or ''
            key = title.lower().replace('ё', 'е')
            if key in want and key not in found and el.findtext(NS + 'ns') == '0':
                text = el.findtext(f'{NS}revision/{NS}text') or ''
                sec = ru_section(text)
                if sec:
                    s = senses(sec)
                    if s:
                        found[key] = s
            el.clear()
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(found, f, ensure_ascii=False, indent=0)
    print(f'толкований: {len(found)} из {len(want)}')


if __name__ == '__main__':
    main()
