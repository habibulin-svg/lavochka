"""Уровни ГОПС для игры: маска ландшафта + точки высадки и места предметов → lavochka/public/gops/levels/<id>.json.

python studio/post/export_levels.py                     — все 66 уровней из docs/gops/levels/missions.json
python studio/post/export_levels.py --only m01,m03

Маска — длины серий по всей карте построчно (сверху вниз, слева направо), первая серия — воздух (может быть 0),
дальше чередуются земля/воздух; каждая длина — uint32 little-endian, всё вместе в base64 (поле "rle").
Читает lavochka/src/gops/level.ts (decodeMask). Генератор один — terrain.py; в браузере маски кампании не считаются.
"""
import argparse
import base64
import json
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import terrain  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'lavochka/public/gops/levels'


def rle(mask: np.ndarray) -> str:
    flat = mask.ravel().astype(np.int8)
    change = np.flatnonzero(np.diff(flat)) + 1
    bounds = np.concatenate(([0], change, [flat.size]))
    runs = np.diff(bounds).astype(np.uint32)
    if flat[0]:  # первая серия по договорённости — воздух
        runs = np.concatenate(([0], runs)).astype(np.uint32)
    return base64.b64encode(runs.astype('<u4').tobytes()).decode('ascii')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--missions', default=str(ROOT / 'docs/gops/levels/missions.json'))
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    ms = json.loads(pathlib.Path(a.missions).read_text(encoding='utf-8'))
    only = set(filter(None, a.only.split(',')))
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for m in ms:
        if only and m['id'] not in only:
            continue
        mask, meta = terrain.generate(m['terrain'])
        meta['id'] = m['id']
        meta['rle'] = rle(mask)
        body = json.dumps(meta, ensure_ascii=False, separators=(',', ':'))
        (OUT / f"{m['id']}.json").write_text(body, encoding='utf-8')
        total += len(body)
        print(m['id'], m['terrain']['archetype'], 'точек', len(meta['spawns']), f'{len(body) // 1024} КБ')
    # список миссий для меню и выбора темы (без брифингов — их игра берёт из missions.json при кампании)
    idx = [{'id': m['id'], 'title': m['title'], 'mode': m['mode'], 'theme': m['theme'], 'time': m.get('time')} for m in ms]
    (OUT / 'missions-index.json').write_text(json.dumps(idx, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'итого {total // 1024} КБ -> {OUT}')


if __name__ == '__main__':
    main()
