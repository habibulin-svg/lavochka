import sys
from PIL import Image, ImageDraw
src, out = sys.argv[1], sys.argv[2]
pts = [tuple(map(int, p.split(','))) for p in sys.argv[3:]]
im = Image.open(src).convert('RGB')
R = 40; S = 6
tiles = []
for (x, y) in pts:
    t = im.crop((x - R, y - R, x + R, y + R)).resize((2 * R * S, 2 * R * S), Image.NEAREST)
    d = ImageDraw.Draw(t)
    for k in range(-R, R + 1, 10):
        p = (k + R) * S
        d.line([(p, 0), (p, 2 * R * S)], fill=(255, 0, 0) if k == 0 else (0, 200, 255), width=1)
        d.line([(0, p), (2 * R * S, p)], fill=(255, 0, 0) if k == 0 else (0, 200, 255), width=1)
        d.text((p + 2, 2), str(x + k), fill=(255, 0, 0))
        d.text((2, p + 2), str(y + k), fill=(255, 0, 0))
    tiles.append(t)
W = 2 * R * S
c = Image.new('RGB', (W * min(2, len(tiles)), W * ((len(tiles) + 1) // 2)))
for i, t in enumerate(tiles):
    c.paste(t, ((i % 2) * W, (i // 2) * W))
c.save(out)
