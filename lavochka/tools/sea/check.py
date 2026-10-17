# Проверка разметки: карта с точками на морских клетках, портами и стрелками течений. python check.py <piraty|kolonii> <out.png>
import sys, re, json
from PIL import Image, ImageDraw
sys.path.insert(0, 'tools/sea')
game, out = sys.argv[1], sys.argv[2]
rows = [l.rstrip('\n')[4:] for l in open(f'tools/sea/{game}-mask.txt', encoding='utf-8') if re.match(r'^\s*\d+ ', l)]
g = json.load(open(f'tools/sea/{game}-grid.json'))
if 'xs' in g: V = [[x, 0] for x in g['xs']]; H = [[y, 0] for y in g['ys']]
else: V = [v[:2] for v in g['v']]; H = [h[:2] for h in g['h']]
def corner(i, j):
    a, b = V[i]; c, d = H[j]; y = (c + d * a) / (1 - d * b); return a + b * y, y
def center(i, j):
    p = [corner(i + a, j + b) for a in (0, 1) for b in (0, 1)]; return sum(q[0] for q in p) / 4, sum(q[1] for q in p) / 4
src = open('src/games/sea/maps-data.ts', encoding='utf-8').read()
blk = src[src.index('export const ' + game.upper()):]
cur = json.loads(re.search(r'cur: (\[.*?\]) as', blk).group(1))
im = Image.open(f'public/{game}/field.webp').convert('RGB'); d = ImageDraw.Draw(im)
col = {'.': (0, 200, 255), 'P': (255, 0, 255), 'S': (255, 60, 0), 'N': (255, 200, 0), 'H': (0, 255, 0)}
for j, r in enumerate(rows):
    for i, ch in enumerate(r):
        if ch == '#': continue
        x, y = center(i, j); R = 7 if ch == '.' else 13
        d.ellipse((x - R, y - R, x + R, y + R), outline=col.get(ch, (0, 0, 0)), width=3)
ST = {'N': (0, -1), 'NE': (1, -1), 'E': (1, 0), 'SE': (1, 1), 'S': (0, 1), 'SW': (-1, 1), 'W': (-1, 0), 'NW': (-1, -1)}
for i, j, dd in cur:
    x, y = center(i, j); dx, dy = ST[dd]
    d.line((x, y, x + dx * 40, y + dy * 40), fill=(0, 140, 0), width=6)
    d.ellipse((x + dx * 40 - 7, y + dy * 40 - 7, x + dx * 40 + 7, y + dy * 40 + 7), fill=(0, 140, 0))
im.save(out)
