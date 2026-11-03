"""Демо без видеокарты: рисует SVG-«картинки» с прогрессом по протоколу студии (@progress / @output)."""
import os
import pathlib
import random
import sys
import time

name, n = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 4
out = pathlib.Path(os.environ.get('LGS_OUT', '.'))
rnd = random.Random(name)
for i in range(n):
    print(f'@progress {i}/{n} рисую {name}-{i + 1}', flush=True)
    time.sleep(0.6)
    hue = rnd.randrange(360)
    shapes = ''.join(
        f'<circle cx="{rnd.randrange(40, 280)}" cy="{rnd.randrange(40, 200)}" r="{rnd.randrange(10, 60)}" '
        f'fill="hsl({(hue + rnd.randrange(80)) % 360},70%,{rnd.randrange(40, 70)}%)" opacity="0.85"/>' for _ in range(7))
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><rect width="320" height="240" '
           f'fill="hsl({hue},30%,92%)"/>{shapes}<text x="12" y="228" font-family="sans-serif" font-size="16">{name} #{i + 1}</text></svg>')
    f = out / f'{name}-{i + 1}.svg'
    f.write_text(svg, encoding='utf-8')
    print(f'@output {f} {{"item": "{name}", "seed": {i + 1}}}', flush=True)
print(f'@progress {n}/{n} готово', flush=True)
