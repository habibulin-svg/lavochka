"""Кадры <анимация>_NN.png → атлас (строка на анимацию) + JSON для игры + увеличенный лист для просмотра.

python studio/post/atlas.py <папка кадров> <выход без расширения> [--crop]
Пишет <выход>.png, <выход>.json ({frameW, frameH, anims: {имя: {row, frames}}}), <выход>-preview.png (×2, на клетчатом фоне).
"""
import argparse
import json
import pathlib
import re

from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('frames')
    ap.add_argument('out')
    a = ap.parse_args()
    d = pathlib.Path(a.frames)
    anims: dict[str, list[pathlib.Path]] = {}
    for f in sorted(d.glob('*_[0-9][0-9].png')):
        name = re.sub(r'_\d\d$', '', f.stem)
        anims.setdefault(name, []).append(f)
    fw, fh = Image.open(next(iter(anims.values()))[0]).size
    cols = max(len(v) for v in anims.values())
    atlas = Image.new('RGBA', (cols * fw, len(anims) * fh), (0, 0, 0, 0))
    meta = {'frameW': fw, 'frameH': fh, 'anims': {}}
    for row, (name, files) in enumerate(anims.items()):
        for col, f in enumerate(files):
            atlas.paste(Image.open(f).convert('RGBA'), (col * fw, row * fh))
        meta['anims'][name] = {'row': row, 'frames': len(files)}
    out = pathlib.Path(a.out)
    atlas.save(out.with_suffix('.png'))
    out.with_suffix('.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')

    # лист для просмотра: клетчатый фон, ×2 без сглаживания
    bg = Image.new('RGBA', atlas.size, (200, 200, 200, 255))
    for y in range(0, atlas.height, 16):
        for x in range(0, atlas.width, 16):
            if (x // 16 + y // 16) % 2:
                bg.paste((230, 230, 230, 255), (x, y, x + 16, y + 16))
    bg.alpha_composite(atlas)
    bg.resize((atlas.width * 2, atlas.height * 2), Image.NEAREST).save(str(out) + '-preview.png')
    print(out.with_suffix('.png'), meta['anims'])


if __name__ == '__main__':
    main()
