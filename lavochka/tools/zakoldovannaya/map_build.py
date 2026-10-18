"""Итоговый граф карты: автоматические дороги (map_edges.py) + разбиение прямых через промежуточные кружки
+ ручные правки по сверке с картой. Выход — src/games/zakoldovannaya/data/map.json.
Запуск: python -I map_build.py <graph.json> <map.json> [<карта.jpg> <проверка.jpg>]"""
import sys, json, math

src, out = sys.argv[1:3]
G = json.load(open(src))
W, H = G['size']
nodes = G['nodes']

# Дороги, которые автомат не увидел (тонкие или бледные линии, мосты) — сверено по увеличенным кускам карты.
ADD = [(6, 10), (13, 14), (13, 17), (17, 21), (18, 20), (22, 32), (24, 37), (44, 45), (50, 54), (95, 135),
       (68, 132), (82, 132), (90, 98), (57, 59), (63, 70), (137, 69), (76, 83), (109, 119), (119, 121),
       (115, 120), (106, 110),
       # кружок 12 на карте ни с чем не соединён (недорисовано при печати) — ведём к ближнему замку
       (12, 126)]
# Мосты (коричневые лесенки через реки)
BRIDGES = {(3, 8), (19, 23), (24, 37), (32, 39), (42, 53), (58, 64), (116, 122), (106, 110)}

edges = set()
for i, j, *_ in G['edges']:
    edges.add((min(i, j), max(i, j)))
for i, j in ADD:
    edges.add((min(i, j), max(i, j)))

# прямая через промежуточные кружки — цепочка
def split(e):
    i, j = e
    p, q = nodes[i], nodes[j]
    vx, vy = q['x'] - p['x'], q['y'] - p['y']
    d2 = vx * vx + vy * vy
    mids = []
    for k, o in enumerate(nodes):
        if k in e: continue
        t = ((o['x'] - p['x']) * vx + (o['y'] - p['y']) * vy) / d2
        if 0.02 < t < 0.98:
            px, py = p['x'] + vx * t, p['y'] + vy * t
            if math.dist((px, py), (o['x'], o['y'])) < o['r'] * 1.6: mids.append((t, k))
    if not mids: return [e]
    chain = [i] + [k for _, k in sorted(mids)] + [j]
    return [(min(a, b), max(a, b)) for a, b in zip(chain, chain[1:])]

changed = True
while changed:
    changed = False
    for e in list(edges):
        parts = split(e)
        if len(parts) > 1:
            edges.discard(e); edges.update(parts); changed = True
            print('split', e, '->', parts)

# порядок мест замков: сверху вниз, слева направо по полосам
castles = sorted([k for k, n in enumerate(nodes) if n['kind'] == 'castle'], key=lambda k: (nodes[k]['y'] // 500, nodes[k]['x']))
FORPOST = {'x': 4580, 'y': 470}
res_nodes = []
for k, n in enumerate(nodes):
    res_nodes.append({'id': k, 'x': round(n['x'] / W, 4), 'y': round(n['y'] / H, 4), 'kind': n['kind']})
res_nodes.append({'id': len(nodes), 'x': round(FORPOST['x'] / W, 4), 'y': round(FORPOST['y'] / H, 4), 'kind': 'forpost'})
edges.add((18, len(nodes)))
deg = {}
for a, b in edges: deg[a] = deg.get(a, 0) + 1; deg[b] = deg.get(b, 0) + 1
print('nodes', len(res_nodes), 'edges', len(edges), 'isolated', [k for k in range(len(res_nodes)) if k not in deg],
      'dead ends', sorted(k for k, v in deg.items() if v == 1))
# связность
adj = {k: set() for k in range(len(res_nodes))}
for a, b in edges: adj[a].add(b); adj[b].add(a)
seen, st = {len(nodes)}, [len(nodes)]
while st:
    for v in adj[st.pop()]:
        if v not in seen: seen.add(v); st.append(v)
print('reachable from forpost', len(seen), 'of', len(res_nodes))
json.dump({'note': 'Граф карты «Заколдованной страны»: x, y — доли ширины/высоты ZS_igrovoye_pole_karta.jpg. '
           'castle — розовые места замков (castles — их порядок), forpost — старт. Собрано tools/zakoldovannaya/map_build.py.',
           'size': [W, H], 'nodes': res_nodes, 'castles': castles, 'start': len(nodes),
           'edges': sorted([a, b, 1 if (a, b) in BRIDGES else 0] for a, b in edges)},
          open(out, 'w', encoding='utf-8'), ensure_ascii=False)

if len(sys.argv) > 4:
    from PIL import Image, ImageDraw
    Image.MAX_IMAGE_PIXELS = None
    im = Image.open(sys.argv[3]).convert('RGB'); d = ImageDraw.Draw(im)
    for a, b in edges:
        p, q = res_nodes[a], res_nodes[b]
        d.line([(p['x'] * W, p['y'] * H), (q['x'] * W, q['y'] * H)], fill=(160, 0, 255) if (a, b) in BRIDGES else (0, 255, 0), width=12)
    for n in res_nodes:
        d.text((n['x'] * W - 25, n['y'] * H - 25), str(n['id']), fill=(255, 0, 0), font_size=50)
    for i, k in enumerate(castles):
        d.text((nodes[k]['x'] - 30, nodes[k]['y'] + 30), f'#{i}', fill=(0, 0, 255), font_size=70)
    im.thumbnail((2400, 2400)); im.save(sys.argv[4], quality=80)
