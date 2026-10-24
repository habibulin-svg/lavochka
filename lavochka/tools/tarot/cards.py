"""Колода таро Уэйта — Смит (рисунок Памелы Колман Смит, 1909; скан тиража Pam-A, вычищенный для цифры) с Wikimedia Commons,
категория «Rider-Waite-Smith tarot deck (Geldard)», лицензия {{PD-old-70}} (Смит ум. 1951, Уэйт ум. 1942) →
public/tarot/rws/<id>.webp (стол, 300×514) и public/tarot/rws/big/<id>.webp (крупно, 600×1029). Рубашку рисуем сами (back.svg).

  python tools/tarot/cards.py [D:/temp/tarot-dl/geldard]

Исходники (PNG со скруглёнными прозрачными углами, оригинал 2100×3600, качаем копию 1400 px) кэшируются в папке-аргументе.
id — как в src/cards/tarot.ts (tarotFile): старшие M00…M21, младшие <масть><ранг>, масти W (жезлы), C (кубки), S (мечи),
P (пентакли), ранги 1 (туз) … 10, 11 паж, 12 рыцарь, 13 королева, 14 король.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public' / 'tarot' / 'rws'
CACHE = Path(sys.argv[1] if len(sys.argv) > 1 else 'D:/temp/tarot-dl/geldard')
UA = 'lavochka-games/1.0 (https://lavochka-games.ru; tarot deck build)'
API = 'https://commons.wikimedia.org/w/api.php'
CATEGORY = 'Category:Rider-Waite-Smith tarot deck (Geldard)'
SIZES = [('', 300), ('big', 600)]

MAJORS = ['The Fool', 'The Magician', 'The High Priestess', 'The Empress', 'The Emperor', 'The Hierophant', 'The Lovers',
          'The Chariot', 'Strength', 'The Hermit', 'Wheel of Fortune', 'Justice', 'The Hanged Man', 'Death', 'Temperance',
          'The Devil', 'The Tower', 'The Star', 'The Moon', 'The Sun', 'Judgement', 'The World']
SUITS = {'Wands': 'W', 'Cups': 'C', 'Swords': 'S', 'Pentacles': 'P'}
RANKS = {'Ace': 1, 'One': 1, 'Two': 2, 'Three': 3, 'Four': 4, 'Five': 5, 'Six': 6, 'Seven': 7, 'Eight': 8, 'Nine': 9,
         'Ten': 10, 'Page': 11, 'Knight': 12, 'Queen': 13, 'King': 14}


def api(**params) -> dict:
    url = API + '?' + urllib.parse.urlencode({**params, 'format': 'json'})
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def card_id(title: str) -> str:
    name = title.removeprefix('File:').removesuffix(' (Rider-Waite Smith tarot deck).png')
    if name in MAJORS:
        return f'M{MAJORS.index(name):02d}'
    rank, _, suit = name.partition(' of ')
    return f'{SUITS[suit]}{RANKS[rank]}'


def files() -> dict[str, str]:
    """id → адрес оригинала; заодно проверяем лицензию каждого файла."""
    out: dict[str, str] = {}
    cont: dict = {}
    while True:
        d = api(action='query', generator='categorymembers', gcmtitle=CATEGORY, gcmtype='file', gcmlimit=50,
                prop='imageinfo', iiprop='url|extmetadata', iiurlwidth=1400, iiextmetadatafilter='LicenseShortName', **cont)
        for p in d['query']['pages'].values():
            ii = p['imageinfo'][0]
            lic = ii['extmetadata'].get('LicenseShortName', {}).get('value', '')
            if lic != 'Public domain':
                raise SystemExit(f'{p["title"]}: лицензия «{lic}», не PD')
            # уменьшенная копия Commons (1400 px) — оригиналы по 14 МБ качаются часами, а нам нужно 600 px
            out[card_id(p['title'])] = ii['thumburl']
        if 'continue' not in d:
            return out
        cont = {k: v for k, v in d['continue'].items()}


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    urls = files()
    assert len(urls) == 78, len(urls)
    for sub, _ in SIZES:
        (OUT / sub).mkdir(parents=True, exist_ok=True)
    for cid, url in sorted(urls.items()):
        src = CACHE / f'{cid}.png'
        for attempt in range(5):
            if src.exists():
                break
            try:
                req = urllib.request.Request(url, headers={'User-Agent': UA})
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = r.read()
                src.write_bytes(data)
            except OSError as e:
                print(cid, 'повтор:', e)
                time.sleep(3 + attempt * 3)
            time.sleep(0.5)
        im = Image.open(src).convert('RGBA')
        for sub, w in SIZES:
            h = round(w * im.height / im.width)
            im.resize((w, h), Image.LANCZOS).save(OUT / sub / f'{cid}.webp', 'WEBP', quality=82, method=6)
        print(cid, im.size)


if __name__ == '__main__':
    main()
