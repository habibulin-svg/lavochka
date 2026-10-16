# Шпион: картинки слов с Wikimedia Commons.
# Запуск из lavochka/:
#   python tools/spy/commons.py todo <тема>                  — слова темы без картинки (id, имя, подсказки)
#   python tools/spy/commons.py search "<запрос>" [N]        — файлы Commons со свободной лицензией: название, лицензия, размер
#   python tools/spy/commons.py get <тема>/<id> "File:…" [crop=л,в,п,н] — скачать (обрезка долями), вписать в 320×240 (webp q70), лицензию — в credits-b-<тема>.json
#   python tools/spy/commons.py peek out.png "File:…" …      — контактный лист кандидатов (по 3 в ряд), посмотреть глазами
#   python tools/spy/commons.py drop <тема>/<id>             — убрать картинку и запись
# Берём только общественное достояние, CC0, CC BY, CC BY-SA. После — node tools/spy/build.mjs.
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image

API = 'https://commons.wikimedia.org/w/api.php'
UA = 'lavochka-spy/1.0 (https://github.com/habibulin-svg; board games collection)'
PUB = 'public/spy'
FREE = re.compile(r'^(public domain|pd\b|pd-|cc0|cc[ -]by(-sa)?[ -]\d|cc[ -]by(-sa)?$)', re.I)


def call(params):
    params = {**params, 'format': 'json'}
    req = urllib.request.Request(API + '?' + urllib.parse.urlencode(params), headers={'User-Agent': UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # сеть иногда рвётся
            if attempt == 3:
                raise
            time.sleep(2 + attempt * 3)


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(3 + attempt * 5)


def strip(html):
    s = re.sub(r'<[^>]+>', '', html or '')
    s = re.sub(r'\s+', ' ', s).strip()
    return s[:120]


def license_of(meta):
    lic = (meta.get('LicenseShortName') or {}).get('value', '')
    lic = strip(lic)
    if re.match(r'^(pd|public domain)', lic, re.I):
        lic = 'Public domain'
    return lic


def infos(titles, width=640):
    d = call({'action': 'query', 'prop': 'imageinfo', 'titles': '|'.join(titles), 'iiprop': 'url|size|extmetadata|mime', 'iiurlwidth': width})
    out = {}
    for p in d.get('query', {}).get('pages', {}).values():
        ii = (p.get('imageinfo') or [None])[0]
        if ii:
            out[p['title']] = ii
    return out


def cmd_search(q, n=12):
    d = call({'action': 'query', 'list': 'search', 'srnamespace': 6, 'srlimit': 30, 'srsearch': q})
    titles = [x['title'] for x in d.get('query', {}).get('search', [])]
    titles = [t for t in titles if re.search(r'\.(jpe?g|png|svg|tiff?|webp|gif)$', t, re.I)]
    if not titles:
        print('ничего не найдено')
        return
    shown = 0
    for i in range(0, len(titles), 25):
        info = infos(titles[i:i + 25])
        for t in titles[i:i + 25]:
            ii = info.get(t)
            if not ii:
                continue
            lic = license_of(ii.get('extmetadata', {}))
            if not FREE.match(lic):
                continue
            print(f"{t} | {lic} | {ii.get('width')}x{ii.get('height')}")
            shown += 1
            if shown >= n:
                return
    if not shown:
        print('нет файлов со свободной лицензией')


def credits_path(theme):
    return f'{PUB}/credits-b-{theme}.json'


def load_credits(theme):
    p = credits_path(theme)
    return json.load(open(p, encoding='utf8')) if os.path.exists(p) else {}


def save_credits(theme, c):
    with open(credits_path(theme), 'w', encoding='utf8') as f:
        json.dump(dict(sorted(c.items())), f, ensure_ascii=False, indent=2)
        f.write('\n')


def cmd_get(key, title, crop=None):
    if not title.startswith('File:'):
        title = 'File:' + title
    theme, wid = key.split('/')
    info = infos([title]).get(title)
    if not info:
        # заголовок мог прийти в другом написании — спросим как есть
        d = infos([title])
        info = next(iter(d.values()), None)
    if not info:
        sys.exit(f'нет такого файла: {title}')
    meta = info.get('extmetadata', {})
    lic = license_of(meta)
    if not FREE.match(lic):
        sys.exit(f'лицензия не подходит: {lic}')
    data = fetch(info.get('thumburl') or info['url'])
    im = Image.open(io.BytesIO(data))
    if im.mode in ('P', 'LA', 'RGBA') or (im.mode == 'P' and 'transparency' in im.info):
        im = im.convert('RGBA')
        bg = Image.new('RGB', im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    im = im.convert('RGB')
    if crop:  # доли: левый, верх, правый, низ
        l, t, r, b = (float(v) for v in crop.split(','))
        im = im.crop((int(l * im.width), int(t * im.height), int(r * im.width), int(b * im.height)))
    im.thumbnail((320, 240), Image.LANCZOS)
    os.makedirs(f'{PUB}/{theme}', exist_ok=True)
    im.save(f'{PUB}/{theme}/{wid}.webp', 'WEBP', quality=70, method=6)
    c = load_credits(theme)
    c[key] = {
        'author': strip((meta.get('Artist') or {}).get('value', '')) or '—',
        'license': lic,
        'source': info.get('descriptionurl') or ('https://commons.wikimedia.org/wiki/' + urllib.parse.quote(title)),
    }
    save_credits(theme, c)
    print(f'ok {key} {im.size[0]}x{im.size[1]} {lic}')


def cmd_peek(out, titles):
    titles = [t if t.startswith('File:') else 'File:' + t for t in titles]
    info = infos(titles, 320)
    sheet = Image.new('RGB', (320 * min(3, len(titles)), 260 * ((len(titles) + 2) // 3)), 'white')
    for i, t in enumerate(titles):
        ii = info.get(t)
        if not ii:
            continue
        im = Image.open(io.BytesIO(fetch(ii.get('thumburl') or ii['url']))).convert('RGB')
        im.thumbnail((310, 240))
        sheet.paste(im, ((i % 3) * 320, (i // 3) * 260))
    sheet.save(out)
    print('лист', out)


def cmd_drop(key):
    theme, wid = key.split('/')
    p = f'{PUB}/{theme}/{wid}.webp'
    if os.path.exists(p):
        os.remove(p)
    c = load_credits(theme)
    c.pop(key, None)
    save_credits(theme, c)
    print('убрано', key)


def cmd_todo(theme):
    words = json.load(open(f'../docs/analysis/spy-{theme}.json', encoding='utf8'))
    seen = set()
    for x in words:
        if x['id'] in seen:
            continue
        seen.add(x['id'])
        if os.path.exists(f"{PUB}/{theme}/{x['id']}.webp"):
            continue
        extra = [str(x[k]) for k in ('year', 'author', 'hit', 'country', 'origin') if x.get(k)]
        print(f"{x['id']} | {x.get('name') or x.get('title')} | {' · '.join(extra)}")


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == 'search':
        cmd_search(a[1], int(a[2]) if len(a) > 2 else 12)
    elif a[0] == 'get':
        cmd_get(a[1], a[2], a[3][5:] if len(a) > 3 and a[3].startswith('crop=') else None)
    elif a[0] == 'peek':
        cmd_peek(a[1], a[2:])
    elif a[0] == 'drop':
        cmd_drop(a[1])
    elif a[0] == 'todo':
        cmd_todo(a[1])
    else:
        sys.exit('команды: todo, search, get, drop')
