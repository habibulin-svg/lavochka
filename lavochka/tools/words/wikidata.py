"""Имена собственные для кроссвордов из Викиданных (CC0): русская метка, русское описание, число статей в Википедиях (известность).

Запуск: python tools/words/wikidata.py <папка вывода>   (по умолчанию ../materials/words/wikidata)
Пишет <класс>.json — список {id, word, desc, sl, kind}. Слово — одно, только буквы а–я (ё → е), 3–15 букв.
Для людей слово — фамилия (P734), а описание — «кто такой»; для остальных — сама метка.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ENDPOINT = 'https://query.wikidata.org/sparql'
UA = 'lavochka-crossword-builder/1.0 (https://github.com/habibulin-svg/lavochka)'

# класс → (условие на ?item, минимум статей, подпись вида)
QUERIES = {
    'country': ('?item wdt:P31 wd:Q3624078 .', 0, 'страна'),
    'country_hist': ('?item wdt:P31 wd:Q3024240 .', 40, 'историческое государство'),
    'capital': ('?item wdt:P31/wdt:P279? wd:Q5119 .', 30, 'столица'),
    'city': ('?item wdt:P31 wd:Q1549591 .', 60, 'город'),
    'city_ru': ('?item wdt:P31/wdt:P279? wd:Q7930989 ; wdt:P17 wd:Q159 .', 15, 'город России'),
    'river': ('?item wdt:P31 wd:Q4022 .', 25, 'река'),
    'lake': ('?item wdt:P31 wd:Q23397 .', 25, 'озеро'),
    'sea': ('?item wdt:P31/wdt:P279? wd:Q165 .', 15, 'море'),
    'mountain': ('?item wdt:P31 wd:Q8502 .', 30, 'гора'),
    'range': ('?item wdt:P31 wd:Q46831 .', 25, 'горная система'),
    'island': ('?item wdt:P31 wd:Q23442 .', 35, 'остров'),
    'peninsula': ('?item wdt:P31 wd:Q34763 .', 20, 'полуостров'),
    'desert': ('?item wdt:P31 wd:Q8514 .', 15, 'пустыня'),
    'volcano': ('?item wdt:P31/wdt:P279? wd:Q8072 .', 25, 'вулкан'),
    'element': ('?item wdt:P31 wd:Q11344 .', 0, 'химический элемент'),
    'constellation': ('?item wdt:P31 wd:Q8928 .', 0, 'созвездие'),
    'planet': ('?item wdt:P31/wdt:P279? wd:Q634 ; wdt:P361 wd:Q544 .', 0, 'планета'),
    'deity': ('?item wdt:P31/wdt:P279? wd:Q178885 .', 30, 'божество'),
    'myth': ('?item wdt:P31/wdt:P279? wd:Q4271324 .', 30, 'мифический персонаж'),
    'character': ('?item wdt:P31/wdt:P279? wd:Q95074 .', 30, 'персонаж'),
    'film': ('?item wdt:P31 wd:Q11424 .', 45, 'фильм'),
    'film_su': ('?item wdt:P31 wd:Q11424 ; wdt:P495 wd:Q15180 .', 8, 'советский фильм'),
    'cartoon': ('?item wdt:P31 wd:Q202866 .', 25, 'мультфильм'),
    'book': ('?item wdt:P31 wd:Q7725634 .', 40, 'литературное произведение'),
    'opera': ('?item wdt:P31 wd:Q1344 .', 20, 'опера'),
    'ballet': ('?item wdt:P31 wd:Q2742218 .', 12, 'балет'),
    'brand': ('?item wdt:P31/wdt:P279? wd:Q431289 .', 40, 'марка'),
    'carmaker': ('?item wdt:P31 wd:Q786820 .', 30, 'автопроизводитель'),
    'band': ('?item wdt:P31 wd:Q215380 .', 50, 'музыкальная группа'),
    'dog_breed': ('?item wdt:P31 wd:Q39367 .', 25, 'порода собак'),
    'language': ('?item wdt:P31 wd:Q34770 .', 80, 'язык'),
    'people': ('?item wdt:P31 wd:Q41710 .', 40, 'народ'),
    'currency': ('?item wdt:P31 wd:Q8142 .', 30, 'валюта'),
}

# люди: фамилия; по профессиям (вся выборка людей разом не укладывается в лимит времени сервера)
OCCUPATIONS = {
    'writer': ('Q36180', 60), 'poet': ('Q49757', 50), 'composer': ('Q36834', 50), 'painter': ('Q1028181', 60),
    'actor': ('Q33999', 70), 'director': ('Q2526255', 60), 'physicist': ('Q169470', 60), 'chemist': ('Q593644', 60),
    'mathematician': ('Q170790', 60), 'philosopher': ('Q4964182', 70), 'singer': ('Q177220', 70), 'astronaut': ('Q11631', 40),
    'explorer': ('Q11900058', 50), 'chess': ('Q10873124', 40), 'inventor': ('Q205375', 50), 'sculptor': ('Q1281618', 50),
    'military': ('Q189290', 60), 'monarch': ('Q116', 60), 'footballer': ('Q937857', 90), 'hockey': ('Q11774891', 50),
}
PEOPLE = {f'person_{k}': (f'?item wdt:P106 wd:{q} .', sl) for k, (q, sl) in OCCUPATIONS.items()}
# свои — с порогом ниже
PEOPLE.update({f'person_ru_{k}': (f'?item wdt:P106 wd:{q} ; wdt:P27 ?c . VALUES ?c {{ wd:Q159 wd:Q15180 wd:Q34266 }}', max(15, sl // 3)) for k, (q, sl) in OCCUPATIONS.items()})


LETTERS = re.compile(r'^[а-я]{3,15}$')


def norm(s: str) -> str:
    return s.lower().replace('ё', 'е').strip()


def run(query: str):
    url = ENDPOINT + '?' + urllib.parse.urlencode({'query': query, 'format': 'json'})
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/sparql-results+json'})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)['results']['bindings']
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(int(e.headers.get('Retry-After', '30')))
                continue
            print('  HTTP', e.code, file=sys.stderr)
            time.sleep(10)
        except Exception as e:  # таймаут — попробуем ещё
            print('  ', e, file=sys.stderr)
            time.sleep(10)
    return []


def things(cond: str, min_sl: int):
    return f"""SELECT ?item ?label ?desc ?sl WHERE {{
  {cond}
  ?item wikibase:sitelinks ?sl . FILTER(?sl >= {min_sl})
  ?item rdfs:label ?label . FILTER(LANG(?label) = "ru")
  OPTIONAL {{ ?item schema:description ?desc . FILTER(LANG(?desc) = "ru") }}
}}"""


def persons(cond: str, min_sl: int):
    return f"""SELECT ?item ?label ?fam ?desc ?sl WHERE {{
  {cond}
  ?item wikibase:sitelinks ?sl . FILTER(?sl >= {min_sl})
  ?item wdt:P734 ?f . ?f rdfs:label ?fam . FILTER(LANG(?fam) = "ru")
  ?item rdfs:label ?label . FILTER(LANG(?label) = "ru")
  OPTIONAL {{ ?item schema:description ?desc . FILTER(LANG(?desc) = "ru") }}
}}"""


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', '..', 'materials', 'words', 'wikidata')
    os.makedirs(out, exist_ok=True)
    jobs = [(k, things(c, m), kind, False) for k, (c, m, kind) in QUERIES.items()]
    jobs += [(k, persons(c, m), 'человек', True) for k, (c, m) in PEOPLE.items()]
    for name, q, kind, person in jobs:
        path = os.path.join(out, name + '.json')
        if os.path.exists(path):
            continue
        rows = run(q)
        seen = {}
        for b in rows:
            label = b['label']['value']
            word = norm(b['fam']['value'] if person else label)
            if not LETTERS.match(word):
                continue
            qid = b['item']['value'].rsplit('/', 1)[-1]
            sl = int(b['sl']['value'])
            if qid in seen and seen[qid]['sl'] >= sl:
                continue
            seen[qid] = {'id': qid, 'word': word, 'name': label, 'desc': b.get('desc', {}).get('value', ''), 'sl': sl, 'kind': kind}
        items = sorted(seen.values(), key=lambda x: -x['sl'])
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(items, f, ensure_ascii=False, indent=0)
        print(f'{name}: {len(rows)} строк → {len(items)} слов')
        time.sleep(2)


if __name__ == '__main__':
    main()
