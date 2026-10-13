"""«Шайба»: разметка двух треков (materials/nastolki/shayba/) → data/shayba.json,
а детали игры (15 квадратиков, 6 граней кубика, две шайбы-жетона) — в public/hodilki/shayba/.

Поле-гонка: два независимых трека по 30 клеток (клетка 1 — центр, 30 — ворота).
Тайлы поля делает tiles.py (shayba) — его можно запускать до или после: детали он больше не трёт.
Запуск из lavochka/:  python -I tools/hodilki/shayba.py
"""
import json
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(ROOT, 'materials', 'nastolki', 'shayba')
DATA = os.path.join(ROOT, 'lavochka', 'src', 'games', 'hodilki', 'data')
PUB = os.path.join(ROOT, 'lavochka', 'public', 'hodilki', 'shayba')


def track(raw):
    """Трек: координаты и подписи клеток в порядке хода (1…30)."""
    out = []
    for c in sorted(raw, key=lambda c: c['n']):
        out.append({'x': round(c['x']), 'y': round(c['y']), 'l': str(c['n'])})
    return out


def main():
    d = json.load(open(os.path.join(SRC, 'cells.json'), encoding='utf8'))
    tracks = [track(d['cells']), track(d['cells_b'])]
    for i, t in enumerate(tracks):
        assert len(t) == 30, f'трек {i}: {len(t)} клеток вместо 30'
    os.makedirs(DATA, exist_ok=True)
    out = {'w': int(d['w']), 'h': int(d['h']), 'tracks': tracks}
    with open(os.path.join(DATA, 'shayba.json'), 'w', encoding='utf8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))

    # детали: квадратики, грани кубика, жетоны-шайбы
    os.makedirs(PUB, exist_ok=True)
    n = 0
    for sub in ('cards', 'parts'):
        src_dir = os.path.join(SRC, sub)
        if not os.path.isdir(src_dir):
            continue
        dst_dir = os.path.join(PUB, sub) if sub == 'cards' else PUB
        os.makedirs(dst_dir, exist_ok=True)
        for name in sorted(os.listdir(src_dir)):
            if name.endswith('.webp'):
                shutil.copyfile(os.path.join(src_dir, name), os.path.join(dst_dir, name))
                n += 1
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(PUB) for f in fs)
    print(f'shayba: два трека по 30 клеток, деталей {n}, {size / 1e3:.0f} КБ без тайлов поля')


if __name__ == '__main__':
    main()
