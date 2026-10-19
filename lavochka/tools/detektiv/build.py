"""«Детективы»: собирает дела из размеченных пачек.

python tools/detektiv/build.py [папка_разметки] [папка_базы]
  разметка — D:/temp/detective/out/bNN.json (вычитка и версии, см. D:/temp/detective/TASK.md),
  база     — D:/danetki/detective (database.json + images/).
Пишет:
  src/games/detektiv/data/key.ts     — ключ: книга, сложность, верная версия, наводки, разгадка (импортирует движок);
  public/detektiv/cases/<книга>.json — условие, вопрос, версии (перемешаны), картинки (грузит вид);
  public/detektiv/img/*.webp         — картинки, до 900 px по длинной стороне.
"""
import glob, json, os, random, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = sys.argv[1] if len(sys.argv) > 1 else r'D:\temp\detective\out'
BASE = sys.argv[2] if len(sys.argv) > 2 else r'D:\danetki\detective'

BOOK = {
    'Инспектор Варнике': 'varnike', 'Людовик': 'ludovik', 'Анискин': 'aniskin', 'Инспектор Вернер': 'werner',
    'Сейтим': 'seitim', 'Инспектор Меридит': 'meridit', 'Квик': 'quick', 'Инспектор Борг': 'borg',
    'Шерлок Холмс': 'holmes',
}
db = {c['id']: c for c in json.load(open(os.path.join(BASE, 'database.json'), encoding='utf-8'))}
# у 786 и 787 в базе картинки перепутаны местами
db[786]['images'], db[787]['images'] = db[787]['images'], db[786]['images']
skip = set(json.load(open(os.path.join(os.path.dirname(__file__), 'skip.json'), encoding='utf-8'))) if os.path.exists(os.path.join(os.path.dirname(__file__), 'skip.json')) else set()

img_dir = os.path.join(ROOT, 'public', 'detektiv', 'img')
os.makedirs(img_dir, exist_ok=True)
os.makedirs(os.path.join(ROOT, 'public', 'detektiv', 'cases'), exist_ok=True)
os.makedirs(os.path.join(ROOT, 'src', 'games', 'detektiv', 'data'), exist_ok=True)


def image(rel: str) -> str | None:
    src = os.path.join(BASE, rel)
    if not os.path.exists(src):
        return None
    name = os.path.splitext(os.path.basename(rel))[0] + '.webp'
    dst = os.path.join(img_dir, name)
    if not os.path.exists(dst):
        try:
            im = Image.open(src)
            im.seek(0)
            im = im.convert('RGBA' if im.mode in ('RGBA', 'LA', 'P') else 'RGB')
            im.thumbnail((900, 900))
            im.save(dst, 'WEBP', quality=80)
        except Exception as e:  # avif без плагина и т. п.
            print('картинка не читается', rel, e)
            return None
    return name


keys, cases = [], {}
for f in sorted(glob.glob(os.path.join(OUT, 'b*.json'))):
    for c in json.load(open(f, encoding='utf-8')):
        i = c['id']
        if i in skip or i not in db:
            continue
        src = db[i]
        book = BOOK.get(src['category'], 'zagadki')
        imgs = [x for x in (image(p) for p in src.get('images', [])) if x]
        if c.get('picture') and not imgs:
            continue  # без картинки не решить
        opts = list(c['options'])
        right = opts[0]
        random.Random(i * 7919).shuffle(opts)
        keys.append({'id': i, 'book': book, 'lv': int(c['level']), 'pic': bool(c.get('picture')), 'ok': opts.index(right),
                     'hints': c['hints'][:2], 'short': c['short'], 'answer': c['answer']})
        cases.setdefault(book, {})[str(i)] = {'title': c['title'], 'text': c['text'], 'question': c['question'], 'options': opts, 'img': imgs}

keys.sort(key=lambda k: k['id'])
# строкой внутри .ts: из большого .json TypeScript выводит огромный литеральный тип и падает по памяти
NL = chr(10)
raw = json.dumps(keys, ensure_ascii=False, separators=(',', ':'))
with open(os.path.join(ROOT, 'src', 'games', 'detektiv', 'data', 'key.ts'), 'w', encoding='utf-8') as fh:
    fh.write('/* Сгенерировано tools/detektiv/build.py — не править руками. */' + NL + "import type { Key } from '../engine';" + NL + NL)
    fh.write('const KEY: Key[] = JSON.parse(' + json.dumps(raw, ensure_ascii=False) + ');' + NL + 'export default KEY;' + NL)
for b, m in cases.items():
    json.dump(m, open(os.path.join(ROOT, 'public', 'detektiv', 'cases', f'{b}.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
from collections import Counter
print('дел', len(keys), dict(Counter(k['book'] for k in keys)), 'уровни', dict(Counter(k['lv'] for k in keys)))
