"""«География»: названия, столицы, флаги и гербы из Викиданных (CC0) + картинки с Викисклада.

Запуск (из lavochka/, после node tools/geo/shapes.mjs):  python -I tools/geo/wiki.py [--no-images]
Читает tools/geo/data/raw.json, кэширует ответы в tools/geo/data/wd/ (повторный запуск ничего не перекачивает).
Пишет:
  src/games/geo/entities.json — список объектов (см. Entity в src/games/geo/data.ts);
  public/geo/f/<id>.webp — флаг (вписан в 480×240), public/geo/a/<id>.webp — герб (вписан в 180×180);
  tools/geo/data/report.txt — чего не нашлось.
"""
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

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
DATA = os.path.join(ROOT, 'tools', 'geo', 'data')
CACHE = os.path.join(DATA, 'wd')
OUT_JSON = os.path.join(ROOT, 'src', 'games', 'geo', 'entities.json')
OUT_IMG = os.path.join(ROOT, 'public', 'geo')
UA = 'lavochka-geo-quiz/1.0 (https://github.com/habibulin-svg/lavochka)'
API = 'https://www.wikidata.org/w/api.php'
COMMONS = 'https://commons.wikimedia.org/w/api.php'

os.makedirs(CACHE, exist_ok=True)
os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
for d in ('f', 'a'):
    os.makedirs(os.path.join(OUT_IMG, d), exist_ok=True)


def get(url, tries=6):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            wait = 5 * (k + 1)
            print(f'  ! {e} — повтор через {wait} с', file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError('не скачалось: ' + url)


def api(base, params, key):
    """Запрос к MediaWiki API с кэшем на диске."""
    # ключ — с отпечатком запроса: изменился список — новый файл
    digest = hashlib.md5(json.dumps(params, sort_keys=True).encode()).hexdigest()[:10]
    f = os.path.join(CACHE, f'{key}-{digest}.json')
    if os.path.exists(f):
        with open(f, encoding='utf-8') as fh:
            return json.load(fh)
    params = dict(params, format='json', formatversion=2)
    data = json.loads(get(base + '?' + urllib.parse.urlencode(params)))
    if 'error' in data:
        raise RuntimeError(f'{key}: {data["error"]}')
    with open(f, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False)
    time.sleep(0.3)
    return data


def entities(ids, key):
    out = {}
    for i in range(0, len(ids), 50):
        part = ids[i:i + 50]
        d = api(API, {'action': 'wbgetentities', 'ids': '|'.join(part), 'props': 'labels|claims|sitelinks', 'languages': 'ru|en', 'sitefilter': 'ruwiki|enwiki'}, f'{key}-{i}')
        for q, e in d.get('entities', {}).items():
            out[q] = e
    return out


def by_enwiki(titles):
    """enwiki-статья → QID (с переходом по перенаправлениям)."""
    out = {}
    for i in range(0, len(titles), 50):
        part = titles[i:i + 50]
        d = api('https://en.wikipedia.org/w/api.php', {'action': 'query', 'titles': '|'.join(part), 'prop': 'pageprops', 'ppprop': 'wikibase_item', 'redirects': 1}, f'enwiki-{i}-{len(titles)}')
        q = d.get('query', {})
        back = {}
        for n in q.get('normalized', []) + q.get('redirects', []):
            back[n['to']] = back.get(n['from'], n['from'])
        for p in q.get('pages', []):
            item = p.get('pageprops', {}).get('wikibase_item')
            if item:
                out[back.get(p['title'], p['title'])] = item
                out[p['title']] = item
    return out


def best(claims, prop):
    """Значение свойства: предпочтительное, иначе действующее (без даты окончания), иначе первое."""
    vals = [c for c in claims.get(prop, []) if c.get('mainsnak', {}).get('snaktype') == 'value' and c.get('rank') != 'deprecated']
    if not vals:
        return None
    pref = [c for c in vals if c.get('rank') == 'preferred']
    cur = [c for c in vals if 'P582' not in c.get('qualifiers', {})]
    c = (pref or cur or vals)[0]
    return c['mainsnak']['datavalue']['value']


def label(e):
    lab = e.get('labels', {})
    return (lab.get('ru') or lab.get('en') or {}).get('value')


def amount(v):
    try:
        return float(v['amount'])
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------- объекты

with open(os.path.join(DATA, 'raw.json'), encoding='utf-8') as fh:
    raw = json.load(fh)

# в Natural Earth у части объектов QID географического региона, а не государства (у региона нет флага)
QID_FIX = {'PSX': 'Q219060', 'SAH': 'Q40362', 'ABH': 'Q31354462', 'PMR': 'Q907112'}
for r in raw:
    if r['id'] in QID_FIX:
        r['qid'] = QID_FIX[r['id']]

missing = [r['enwiki'] for r in raw if not r.get('qid') and r.get('enwiki')]
resolved = by_enwiki(missing) if missing else {}
for r in raw:
    if not r.get('qid') and r.get('enwiki'):
        r['qid'] = resolved.get(r['enwiki'].replace('_', ' '))

report = []
for r in raw:
    if not r.get('qid'):
        report.append(f'нет QID: {r["id"]} ({r.get("enwiki")})')

qids = sorted({r['qid'] for r in raw if r.get('qid')})
wd = entities(qids, 'ent')

# столицы
caps = sorted({best(wd[q].get('claims', {}), 'P36')['id'] for q in qids if q in wd and best(wd[q].get('claims', {}), 'P36')})
capwd = entities(caps, 'cap')

# континенты: NE → наши; поправки для трансконтинентальных и «открытого океана»
CONT = {'Europe': 'eu', 'Asia': 'as', 'Africa': 'af', 'North America': 'na', 'South America': 'sa', 'Oceania': 'oc'}
CONT_FIX = {
    'RUS': ['eu', 'as'], 'TUR': ['as', 'eu'], 'GEO': ['as', 'eu'], 'ARM': ['as', 'eu'], 'AZE': ['as', 'eu'], 'KAZ': ['as', 'eu'],
    'CYP': ['eu', 'as'], 'CYN': ['eu', 'as'], 'ABH': ['as', 'eu'], 'OSS': ['as', 'eu'],
    'MDV': ['as'], 'MUS': ['af'], 'SYC': ['af'], 'SHN': ['af'], 'ATF': ['af'], 'IOT': ['as'], 'SGS': ['sa'], 'GRL': ['na'],
}
# одинаковые или неудачные названия
NAME_FIX = {'RU-ZAP': 'Запорожская область', 'RU-KHE': 'Херсонская область', 'PSX': 'Палестина', 'ABH': 'Абхазия', 'OSS': 'Южная Осетия', 'US-DC': 'Округ Колумбия', 'MX-MEX': 'Штат Мехико', 'MX-CMX': 'Мехико', 'TWN': 'Тайвань', 'KOS': 'Косово', 'CYN': 'Северный Кипр', 'PMR': 'Приднестровье', 'SAH': 'Западная Сахара', 'HKG': 'Гонконг', 'MAC': 'Макао'}
# столицы, у которых в Викиданных нет русской метки или она неудачна
CAP_FIX = {'RU-ZAP': 'Запорожье', 'RU-KHE': 'Херсон', 'MNP': 'Сайпан', 'AT-8': 'Брегенц', 'ES-MC': 'Мурсия', 'ES-RI': 'Логроньо', 'ES-CL': 'Вальядолид'}
UNREC = {'SOL', 'CYN', 'ABH', 'OSS', 'PMR'}
PARTIAL = {'KOS', 'TWN', 'SAH'}
OBSERVERS = {'VAT', 'PSX', 'DNK', 'NLD'}  # у Дании и Нидерландов в NE — QID «страны в составе королевства», не члена ООН
LAYER_PARENT = {'RUS': 'RUS', 'USA': 'USA', 'DEU': 'DEU', 'FRA': 'FRA', 'ITA': 'ITA', 'ESP': 'ESP', 'GBR': 'GBR', 'CHE': 'CHE', 'AUT': 'AUT', 'CAN': 'CAN', 'AUS': 'AUS', 'BRA': 'BRA', 'MEX': 'MEX'}

out = []
for r in raw:
    q = r.get('qid')
    e = wd.get(q, {}) if q else {}
    cl = e.get('claims', {})
    flag = best(cl, 'P41')
    arms = best(cl, 'P94')
    seal = None
    if not arms:
        seal = best(cl, 'P158')  # штаты США: печать вместо герба
    cap = best(cl, 'P36')
    capname = CAP_FIX.get(r['id']) or (label(capwd.get(cap['id'], {})) if cap else None)
    if capname and re.search('[A-Za-z]', capname):
        report.append(f'столица без русского названия: {r["id"]} {capname}')
        capname = None
    pop = best(cl, 'P1082')
    area = best(cl, 'P2046')
    un = any(c.get('mainsnak', {}).get('datavalue', {}).get('value', {}).get('id') == 'Q1065' for c in cl.get('P463', []))
    name = NAME_FIX.get(r['id']) or label(e) or r.get('ne') or r['en']
    ent = {'id': r['id'], 'n': name, 'q': q}
    if r['layer'] == 'world':
        if r['id'] in UNREC:
            kind = 'unrec'
        elif r['id'] in PARTIAL:
            kind = 'partial'
        elif un or r['id'] in OBSERVERS:
            kind = 'country'
        else:
            kind = 'dep'
        ent['k'] = kind
        ent['c'] = CONT_FIX.get(r['id']) or ([CONT[r['cont']]] if r['cont'] in CONT else [])
        if kind == 'dep':
            ent['p'] = r['sov']
        if r.get('overlay'):
            ent['ovl'] = 1
        ent['l'] = 'world'
        if not ent['c']:
            report.append(f'нет континента: {r["id"]} {name} ({r["cont"]})')
    else:
        ent['k'] = 'region'
        ent['p'] = LAYER_PARENT[r['layer']]
        ent['l'] = 'ru' if r['layer'] == 'RUS' else 'us' if r['layer'] == 'USA' else 'regions'
    if r.get('disputed'):
        ent['disp'] = 1
    if capname:
        ent['cap'] = capname
    if pop and amount(pop):
        ent['pop'] = int(amount(pop))
    if area and amount(area) and area.get('unit', '').endswith('Q712226'):
        ent['area'] = round(amount(area))
    rw = e.get('sitelinks', {}).get('ruwiki', {}).get('title')
    if rw:
        ent['w'] = rw
    ent['_flag'] = flag
    ent['_arms'] = arms or seal
    if seal:
        ent['seal'] = 1
    out.append(ent)

# ---------------------------------------------------------------- картинки

def thumbs(files, width):
    """Имя файла на Викискладе → URL миниатюры (растр) нужной ширины."""
    res = {}
    files = sorted(set(files))
    for i in range(0, len(files), 40):
        part = files[i:i + 40]
        d = api(COMMONS, {'action': 'query', 'titles': '|'.join('File:' + f for f in part), 'prop': 'imageinfo', 'iiprop': 'url', 'iiurlwidth': width}, f'img-{width}-{i}-{len(files)}')
        norm = {n['to']: n['from'] for n in d.get('query', {}).get('normalized', [])}
        for p in d.get('query', {}).get('pages', []):
            ii = p.get('imageinfo')
            if not ii:
                continue
            title = norm.get(p['title'], p['title'])
            res[title[5:]] = ii[0].get('thumburl') or ii[0]['url']
    return res


def save(url, dest, box):
    if os.path.exists(dest):
        return True
    try:
        im = Image.open(io.BytesIO(get(url)))
    except Exception as ex:  # noqa: BLE001
        report.append(f'картинка не открылась: {url} ({ex})')
        return False
    im = im.convert('RGBA')
    im.thumbnail(box, Image.LANCZOS)
    im.save(dest, 'WEBP', quality=86, method=6)
    time.sleep(0.15)
    return True


if '--no-images' not in sys.argv:
    furl = thumbs([e['_flag'] for e in out if e['_flag']], 500)
    aurl = thumbs([e['_arms'] for e in out if e['_arms']], 330)
    for n, e in enumerate(out):
        fid = e['id'].lower()
        if e['_flag']:
            u = furl.get(e['_flag'].replace('_', ' '))
            if u and save(u, os.path.join(OUT_IMG, 'f', fid + '.webp'), (480, 240)):
                e['f'] = 1
            else:
                report.append(f'нет флага: {e["id"]} {e["n"]} ({e["_flag"]})')
        else:
            report.append(f'флага нет в Викиданных: {e["id"]} {e["n"]}')
        if e['_arms']:
            u = aurl.get(e['_arms'].replace('_', ' '))
            if u and save(u, os.path.join(OUT_IMG, 'a', fid + '.webp'), (180, 180)):
                e['a'] = 1
            else:
                report.append(f'нет герба: {e["id"]} {e["n"]} ({e["_arms"]})')
        else:
            report.append(f'герба нет в Викиданных: {e["id"]} {e["n"]}')
        if n % 50 == 0:
            print(f'{n}/{len(out)}')
else:
    for e in out:
        fid = e['id'].lower()
        if os.path.exists(os.path.join(OUT_IMG, 'f', fid + '.webp')):
            e['f'] = 1
        if os.path.exists(os.path.join(OUT_IMG, 'a', fid + '.webp')):
            e['a'] = 1

# одна и та же картинка у нескольких объектов (регион под флагом страны) — оставляем только стране / первому
for key, mark in (('_flag', 'f'), ('_arms', 'a')):
    groups = {}
    for e in out:
        if e.get(mark) and e[key]:
            groups.setdefault(e[key], []).append(e)
    for file, g in groups.items():
        if len(g) < 2:
            continue
        keep = next((e for e in g if e['k'] == 'country'), g[0])
        for e in g:
            if e is not keep:
                e.pop(mark)
                report.append(f'{"флаг" if mark == "f" else "герб"} как у {keep["id"]}: {e["id"]} {e["n"]}')

for e in out:
    e.pop('_flag', None)
    e.pop('_arms', None)

with open(OUT_JSON, 'w', encoding='utf-8') as fh:
    fh.write('[\n' + ',\n'.join(json.dumps(e, ensure_ascii=False, separators=(',', ':')) for e in out) + '\n]\n')
with open(os.path.join(DATA, 'report.txt'), 'w', encoding='utf-8') as fh:
    fh.write('\n'.join(report) + '\n')
print('объектов:', len(out), '· с флагом:', sum(1 for e in out if e.get('f')), '· с гербом:', sum(1 for e in out if e.get('a')), '· замечаний:', len(report))
