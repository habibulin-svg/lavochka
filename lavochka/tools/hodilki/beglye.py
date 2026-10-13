"""«Беглые, или Вот тебе, бабушка, и Юрьев день» — данные игры из разметки агента.

Материалы: materials/nastolki/beglye/path.json (481 клетка: 479 пунктов + монастырь `mon` и устье Дона `fin`).
Ход здесь не по числам, а по знакам на кубике, но поле — тот же граф: пишем клетки со знаками и связями.

Пишем: lavochka/src/games/beglye/data.json и public/beglye/field.webp.

Запуск из lavochka/:  python -I tools/hodilki/beglye.py
"""
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(ROOT, 'materials', 'nastolki', 'beglye')
DST = os.path.join(ROOT, 'lavochka', 'src', 'games', 'beglye')
PUB = os.path.join(ROOT, 'lavochka', 'public', 'beglye')


def main():
    d = json.load(open(os.path.join(SRC, 'path.json'), encoding='utf8'))
    cells = d['cells']
    byid = {c['id']: c for c in cells}
    # 1) сшивка обрывов: часть пунктов агент не связал с графом (58 штук) — соединяем по ближайшим
    adj = {c['id']: set(c.get('next', [])) for c in cells}
    for a, ns in adj.items():
        for b in ns:
            adj.setdefault(b, set()).add(a)

    def components():
        seen, out = set(), []
        for cid in adj:
            if cid in seen:
                continue
            stack, group = [cid], []
            seen.add(cid)
            while stack:
                cur = stack.pop()
                group.append(cur)
                for n in adj.get(cur, ()):
                    if n not in seen:
                        seen.add(n)
                        stack.append(n)
            out.append(group)
        return out

    bridges = []
    while True:
        groups = components()
        if len(groups) <= 1:
            break
        main = max(groups, key=len)
        best = None
        for g in groups:
            if g is main:
                continue
            for a in g:
                for b in main:
                    ca, cb = byid[a], byid[b]
                    dist = (ca['x'] - cb['x']) ** 2 + (ca['y'] - cb['y']) ** 2
                    if best is None or dist < best[0]:
                        best = (dist, a, b)
        _, a, b = best
        adj[a].add(b)
        adj[b].add(a)
        bridges.append((a, b, round(best[0] ** 0.5)))
    # 2) клетки для игры
    out_cells = []
    for c in cells:
        sign = c.get('sign')
        signs = [] if not sign or sign in ('start', 'finish') else (list(sign) if isinstance(sign, list) else [sign])
        out_cells.append({
            'id': c['id'],
            'x': c['x'],
            'y': c['y'],
            'kind': sign if sign in ('start', 'finish') else 'point',
            'signs': signs,
            'next': sorted(adj[c['id']]),
        })
    data = {'w': d['w'], 'h': d['h'], 'start': d['start'], 'finish': d['finish'], 'cells': out_cells}
    os.makedirs(DST, exist_ok=True)
    json.dump(data, open(os.path.join(DST, 'data.json'), 'w', encoding='utf8'), ensure_ascii=False)
    # 3) картинка поля (скан 4729×6830 уменьшаем)
    os.makedirs(PUB, exist_ok=True)
    im = Image.open(os.path.join(SRC, 'field.webp')).convert('RGB')
    w = 2200
    im.resize((w, int(w * im.height / im.width)), Image.LANCZOS).save(os.path.join(PUB, 'field.webp'), 'WEBP', quality=82, method=6)
    no_sign = sum(1 for c in out_cells if not c['signs'] and c['kind'] == 'point')
    print('клеток %d, без знака %d, мостов %d: %s' % (len(out_cells), no_sign, len(bridges), bridges[:10]))
    print('поле:', w, int(w * im.height / im.width), '| данные:', os.path.join(DST, 'data.json'))


if __name__ == '__main__':
    main()
