"""Картинки для сканвордов: фото с Викисклада (Wikimedia Commons) к словам базы вопросов.

Запуск: python tools/words/pictures.py [лимит]   (по умолчанию 600)
1) Кандидаты из Викиданных: животные/растения (таксоны), предметы (инструменты, транспорт, еда, одежда …), известные люди
   (их Q-номера — из materials/words/wikidata/person_*.json). Слово должно быть в public/dict/clues.tsv.
2) Через API Викисклада — уменьшенная копия, автор, лицензия; берём только свободные (CC0, PD, CC BY, CC BY-SA).
3) Квадрат 240×240 (у людей обрезка ближе к верху — лицо), webp → public/scan/<слово>.webp; подписи — public/dict/pics.json.
Скачанное уже не качается повторно (кэш оригиналов — materials/words/pics/).
"""
import glob
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', '..')
W = os.path.join(ROOT, 'materials', 'words')
PUB = os.path.join(ROOT, 'lavochka', 'public')
UA = 'lavochka-crossword-builder/1.0 (https://github.com/habibulin-svg/lavochka)'

# класс → вид для подписи; P279+ (подклассы) или P31 (экземпляры)
CLASSES = [
    ('?item wdt:P31 wd:Q16521 ; wdt:P105 wd:Q7432 .', 'вид', 25),  # таксон ранга «вид»
    ('?item wdt:P31 wd:Q16521 ; wdt:P105 wd:Q34740 .', 'род', 25),  # таксон ранга «род»
    ('?item wdt:P279+ wd:Q34379 .', 'инструмент', 5),  # музыкальный инструмент
    ('?item wdt:P279+ wd:Q39546 .', 'инструмент', 5),  # инструмент
    ('?item wdt:P279+ wd:Q42889 .', 'транспорт', 5),  # транспортное средство
    ('?item wdt:P279+ wd:Q2095 .', 'еда', 8),  # еда
    ('?item wdt:P279+ wd:Q14745 .', 'мебель', 3),
    ('?item wdt:P279+ wd:Q11460 .', 'одежда', 5),
    ('?item wdt:P279+ wd:Q728 .', 'оружие', 5),
    ('?item wdt:P279+ wd:Q987767 .', 'посуда', 5),  # сосуд
    ('?item wdt:P279+ wd:Q11436 .', 'самолёт', 5),
    ('?item wdt:P279+ wd:Q1420 .', 'машина', 5),
]

FREE = re.compile(r'(cc0|public domain|^pd|cc[ -]by(-sa)?(\s|-)?[0-9.]*|attribution|no restrictions)', re.I)


def get(url, tries=5):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(int(e.headers.get('Retry-After', '20')))
                continue
            if e.code == 404:
                return None
            time.sleep(5)
        except Exception:
            time.sleep(5)
    return None


def sparql(q):
    """Запрос с кэшем на диске; оборванный ответ (таймаут сервера) — повторяем."""
    import hashlib
    cdir = os.path.join(W, 'sparql_cache')
    os.makedirs(cdir, exist_ok=True)
    path = os.path.join(cdir, hashlib.md5(q.encode()).hexdigest() + '.json')
    if os.path.exists(path):
        return json.load(open(path, encoding='utf-8'))
    for attempt in range(3):
        raw = get('https://query.wikidata.org/sparql?' + urllib.parse.urlencode({'query': q, 'format': 'json'}))
        if not raw:
            continue
        try:
            rows = json.loads(raw)['results']['bindings']
        except Exception:
            time.sleep(10)
            continue
        json.dump(rows, open(path, 'w', encoding='utf-8'))
        return rows
    print('  запрос не удался', file=sys.stderr)
    return []


def norm(s):
    return s.lower().replace('ё', 'е').strip()


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 600
    base = {}
    for line in open(os.path.join(PUB, 'dict', 'clues.tsv'), encoding='utf-8'):
        p = line.rstrip('\n').split('\t')
        if len(p) >= 5:
            base.setdefault(p[0], p)
    cand = {}  # word → (sl, file, kind, person)

    def add(word, sl, img, kind, person=False):
        word = norm(word)
        if word not in base or not re.fullmatch(r'[а-я]{3,9}', word):
            return
        if word not in cand or cand[word][0] < sl:
            cand[word] = (sl, img.rsplit('/', 1)[-1], kind, person)

    for cond, kind, minsl in CLASSES:
        q = f"""SELECT ?item ?l ?img ?sl WHERE {{ {cond}
          ?item wdt:P18 ?img ; wikibase:sitelinks ?sl . FILTER(?sl >= {minsl})
          ?item rdfs:label ?l . FILTER(LANG(?l) = "ru" && !CONTAINS(?l, " ") && !CONTAINS(?l, "-")) }}"""
        rows = sparql(q)
        for b in rows:
            add(b['l']['value'], int(b['sl']['value']), urllib.parse.unquote(b['img']['value']), kind)
        print(kind, len(rows), '→ кандидатов всего', len(cand))
        time.sleep(2)
    # люди: по Q-номерам из выборок
    ids = {}
    for f in glob.glob(os.path.join(W, 'wikidata', 'person_*.json')):
        for it in json.load(open(f, encoding='utf-8')):
            if it['word'] in base:
                ids[it['id']] = (it['word'], it['sl'])
    qids = list(ids)
    for k in range(0, len(qids), 300):
        vals = ' '.join('wd:' + q for q in qids[k:k + 300])
        rows = sparql(f'SELECT ?item ?img WHERE {{ VALUES ?item {{ {vals} }} ?item wdt:P18 ?img . }}')
        for b in rows:
            qid = b['item']['value'].rsplit('/', 1)[-1]
            word, sl = ids[qid]
            # известность людей сравнима с прочими только грубо — поделим
            add(word, sl // 2, urllib.parse.unquote(b['img']['value']), 'человек', True)
        time.sleep(1)
    print('кандидатов', len(cand))

    chosen = sorted(cand.items(), key=lambda x: -x[1][0])[: limit * 2]
    # сведения о файлах с Викисклада (по 50)
    meta = {}
    files = [c[1][1] for c in chosen]
    for k in range(0, len(files), 50):
        titles = '|'.join('File:' + f for f in files[k:k + 50])
        url = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(
            {'action': 'query', 'titles': titles, 'prop': 'imageinfo', 'iiprop': 'url|extmetadata', 'iiurlwidth': 400, 'format': 'json'})
        raw = get(url)
        if not raw:
            continue
        data = json.loads(raw)
        norm_map = {n['to']: n['from'] for n in data.get('query', {}).get('normalized', [])}
        for page in data.get('query', {}).get('pages', {}).values():
            ii = (page.get('imageinfo') or [None])[0]
            if not ii:
                continue
            title = norm_map.get(page['title'], page['title'])
            em = ii.get('extmetadata', {})
            lic = em.get('LicenseShortName', {}).get('value', '')
            artist = re.sub(r'<[^>]+>', '', em.get('Artist', {}).get('value', '')).strip()
            meta[title.replace('File:', '').replace(' ', '_')] = {'thumb': ii.get('thumburl'), 'page': ii.get('descriptionurl'), 'license': lic, 'author': artist[:120]}
        time.sleep(1)

    os.makedirs(os.path.join(PUB, 'scan'), exist_ok=True)
    cache = os.path.join(W, 'pics')
    os.makedirs(cache, exist_ok=True)
    out = []
    for word, (sl, file, kind, person) in chosen:
        if len(out) >= limit:
            break
        m = meta.get(file.replace(' ', '_'))
        if not m or not m['thumb'] or not FREE.search(m['license'] or ''):
            continue
        src = os.path.join(cache, word + '.img')
        if not os.path.exists(src):
            raw = get(m['thumb'])
            if not raw:
                continue
            open(src, 'wb').write(raw)
            time.sleep(0.3)
        try:
            im = Image.open(src).convert('RGB')
        except Exception:
            continue
        w, h = im.size
        side = min(w, h)
        x0 = (w - side) // 2
        y0 = 0 if person else (h - side) // 2
        if person and h > w:
            y0 = int((h - side) * 0.15)
        im = im.crop((x0, y0, x0 + side, y0 + side)).resize((240, 240), Image.LANCZOS)
        # имя файла — не само слово (иначе ответ виден в адресе картинки)
        name = hashlib.md5(('lavochka:' + word).encode()).hexdigest()[:10]
        im.save(os.path.join(PUB, 'scan', name + '.webp'), 'WEBP', quality=68, method=6)
        out.append({'word': word, 'file': name, 'kind': kind, 'author': m['author'], 'license': m['license'], 'src': m['page']})
    out.sort(key=lambda x: x['word'])
    with open(os.path.join(PUB, 'dict', 'pics.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=0)
    by = {}
    for o in out:
        by[o['kind']] = by.get(o['kind'], 0) + 1
    print('картинок', len(out), by)


if __name__ == '__main__':
    main()
