"""Сборка данных «Вкладышей»: распознанные факты (ocr.py) + обработанные картинки (upscale.py) →
src/games/vkladyshi/inserts.json и public/vkladyshi/<серия>/<номер>.webp (длинная сторона 512).

  python make_cards.py G:\\temp\\vkladyshi G:\\temp\\vkladyshi-clean G:\\temp\\vkladyshi-ocr

Номер берётся из подписи на wrappers.ru; номера вне диапазона серии (варианты из соседних) и записи «0» отбрасываются,
из повторов номера — первый полноразмерный. Боевые числа здесь не считаются — это формулы в cards.ts.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]  # lavochka/
OUT_JSON = ROOT / 'src' / 'games' / 'vkladyshi' / 'inserts.json'
OUT_IMG = ROOT / 'public' / 'vkladyshi'
LONG = 512

# wrappers id → (ключ серии, коллекция, название, подпись, диапазон номеров)
SETS = {
    55: ('turbo1', 'turbo', 'Turbo 1–50', 'чёрный логотип, 1986–87', (1, 50)),
    17: ('turbo2', 'turbo', 'Turbo 51–120', 'чёрный логотип, 1987–93', (51, 120)),
    18: ('turbo3', 'turbo', 'Turbo 121–190', 'чёрный логотип, 1987–93', (121, 190)),
    19: ('turbo4', 'turbo', 'Turbo 191–260', 'чёрный логотип, 1987–93', (191, 260)),
    20: ('turbo5', 'turbo', 'Turbo 261–330', 'жёлтый логотип, 1993–94', (261, 330)),
    1: ('bomb1', 'bomb', 'BomBibom, серия 1', 'Baycan, машины и мотоциклы', (1, 60)),
    5: ('bomb2', 'bomb', 'BomBibom, серия 2', 'Baycan, машины и мотоциклы', (1, 90)),
    7: ('final90', 'final', "Final '90", 'Ülker, чемпионат мира в Италии', (1, 70)),
    87: ('final92', 'final', "Final '92", 'Ülker, повтор 1990-го', (1, 70)),
    75: ('final94', 'final', "Final '94", 'Ülker, чемпионат мира в США', (1, 40)),
    102: ('final96', 'final', "Final '96", 'Ülker, чемпионат Европы в Англии', (1, 35)),
    59: ('finalred', 'final', 'Final, красные номера', 'Ülker, Final-86/88', (1, 170)),
    347: ('love1', 'love', 'Love is…, 1-я серия', '1992', (1, 110)),
    4370: ('love2', 'love', 'Love is…, 2-я серия', '1993', (1, 110)),
    5908: ('love3', 'love', 'Love is…, 3-я серия', '1993, Dandy Sakız', (1, 110)),
    350: ('love3b', 'love', 'Love is…, 3-я серия', '1994, Dandy A.Ş.', (1, 110)),
    351: ('love4', 'love', 'Love is…, 4-я серия', '1995', (1, 110)),
    352: ('love5', 'love', 'Love is…, 5-я серия', '1996', (1, 110)),
    354: ('love6', 'love', 'Love is…, 6-я серия', '1996', (1, 110)),
    6272: ('love7', 'love', 'Love is…, 7-я серия', '1997', (1, 110)),
    342: ('love8', 'love', 'Love is…, 8-я серия', '1998', (1, 110)),
    16: ('lazer', 'lazer', 'Lazer', 'Ülker, военная техника', (1, 70)),
}

KIND_RU = {'car', 'moto', 'f1', 'truck', 'plane', 'boat', 'other', 'ship', 'helicopter', 'tank', 'submarine', 'missile'}


def clean_int(v, lo, hi):
    try:
        v = int(re.sub(r'[^\d]', '', str(v))) if v is not None and not isinstance(v, int) else v
    except ValueError:
        return None
    return v if isinstance(v, int) and lo <= v <= hi else None


def title(s: str | None) -> str | None:
    if not s:
        return None
    s = re.sub(r'\s+', ' ', str(s)).strip()
    return s or None


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    src, clean, ocr = (Path(p) for p in sys.argv[1:4])
    facts, sets, n_img = [], [], 0
    for m in sorted(src.glob('*/*/meta.json')):
        cid = int(re.search(r'\[(\d+)\]$', m.parent.name).group(1))
        if cid not in SETS:
            continue
        key, coll, name, sub, (lo, hi) = SETS[cid]
        sets.append({'key': key, 'coll': coll, 'title': name, 'sub': sub, 'src': cid})
        cat = m.parent.parent.name
        try:
            o = json.loads((ocr / f'{cat} — {m.parent.name}.json').read_text(encoding='utf-8'))['items']
        except OSError:
            o = {}
        items = json.loads(m.read_text(encoding='utf-8'))['items']
        seen = {}
        for it in items:
            if not it['label'].isdigit():
                continue
            n = int(it['label'])
            if not lo <= n <= hi:
                continue
            if n in seen and (seen[n]['full'] or not it['full']):
                continue
            seen[n] = it
        (OUT_IMG / key).mkdir(parents=True, exist_ok=True)
        for n, it in sorted(seen.items()):
            stem = Path(it['file']).stem
            img_src = clean / cat / m.parent.name / f'{stem}.webp'
            if not img_src.exists():
                img_src = m.parent / it['file']
            rel = f'{key}/{n:03d}.webp'
            dst = OUT_IMG / rel
            if not dst.exists() or dst.stat().st_mtime < img_src.stat().st_mtime:
                im = Image.open(img_src).convert('RGB')
                k = LONG / max(im.size)
                if k < 1:
                    im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
                im.save(dst, 'WEBP', quality=80, method=6)
                n_img += 1
            r = o.get(it['file'], {})
            fid = f'turbo-{n}' if coll == 'turbo' else f'{key}-{n}'
            f = {'id': fid, 'set': key, 'n': n, 'img': rel}
            if coll in ('turbo', 'bomb'):
                kind = r.get('kind') if r.get('kind') in KIND_RU else 'car'
                f.update(name=title(r.get('name')), kind=kind, cc=clean_int(r.get('cc'), 49, 30000),
                         hp=clean_int(r.get('hp'), 3, 2000), speed=clean_int(r.get('speed'), 20, 600),
                         year=clean_int(r.get('year'), 1900, 2000))
                if kind in ('car', 'truck', 'f1') and f.get('cc') and f['cc'] < 600:
                    f['cc'] = None  # у легковой меньше 600 см³ не бывает — модель потеряла цифру
            elif coll == 'final':
                photo = bool(r.get('is_team_photo')) or not r.get('player')
                f.update(player=None if photo else title(r.get('player')), team=title(r.get('team_en')) or title(r.get('team')),
                         photo=photo, name=title(r.get('player')) if not photo else None)
            elif coll == 'love':
                f.update(ru=title(r.get('ru')), en=title(r.get('en')))
            elif coll == 'lazer':
                kind = r.get('kind') if r.get('kind') in KIND_RU else 'other'
                f.update(name=title(r.get('name')), kind=kind, spd=title(r.get('speed')), range=title(r.get('range')))
            facts.append({k: v for k, v in f.items() if v is not None})
    order = [v[0] for v in SETS.values()]  # порядок альбома — как в словаре SETS
    sets.sort(key=lambda s: order.index(s['key']))
    facts.sort(key=lambda f: (order.index(f['set']), f['n']))
    OUT_JSON.write_text(json.dumps({'sets': sets, 'facts': facts}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Серий {len(sets)}, вкладышей {len(facts)}, картинок обновлено {n_img}')
    for s in sets:
        k = sum(1 for f in facts if f['set'] == s['key'])
        miss = sum(1 for f in facts if f['set'] == s['key'] and not (f.get('name') or f.get('ru') or f.get('en') or f.get('team')))
        print(f"  {s['key']:9} {k:4}  без текста: {miss}")


if __name__ == '__main__':
    main()
