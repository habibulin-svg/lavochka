"""Игровая колода таро: те же карты Уэйта — Смит с индексом в левом верхнем углу (как у колод для французского таро),
чтобы карты читались в руке веером: козыри — номер на золотой плашке, Эскюз — звезда, масти — буква и знак
(жезлы ♣, кубки ♥, мечи ♠, пентакли ♦ — как во французской колоде таро; К король, Д дама, Р рыцарь, П паж).

  python tools/tarot/index.py      (после tools/tarot/cards.py)

Вход — public/tarot/rws/big/<id>.webp (600 px), выход — public/tarot/rws/game/<id>.webp (300 px).
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'public' / 'tarot' / 'rws' / 'big'
OUT = ROOT / 'public' / 'tarot' / 'rws' / 'game'
FONTS = 'C:/Windows/Fonts/'
W = 300
SUIT = {'W': ('♣', '#1d1d1d'), 'C': ('♥', '#b8141c'), 'S': ('♠', '#1d1d1d'), 'P': ('♦', '#b8141c')}
COURT = {11: 'П', 12: 'Р', 13: 'Д', 14: 'К'}


def font(name: str, size: int):
    return ImageFont.truetype(FONTS + name, size)


def label(cid: str) -> tuple[str, str, str, bool]:
    """Верх, низ, цвет, козырь ли."""
    if cid.startswith('M'):
        n = int(cid[1:])
        return ('★' if n == 0 else str(n)), '', '#3a2306', True
    s, r = cid[0], int(cid[1:])
    sym, col = SUIT[s]
    return COURT.get(r, str(r)), sym, col, False


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    big = font('arialbd.ttf', 50)
    mid = font('arialbd.ttf', 40)
    sym = font('seguisym.ttf', 44)
    for src in sorted(SRC.glob('*.webp')):
        cid = src.stem
        im = Image.open(src).convert('RGBA')
        im = im.resize((W, round(W * im.height / im.width)), Image.LANCZOS)
        top, bottom, col, trump = label(cid)
        d = ImageDraw.Draw(im)
        bw, bh = 62, (70 if trump else 98)
        x0, y0 = 9, 9
        d.rounded_rectangle((x0, y0, x0 + bw, y0 + bh), radius=10, fill='#f2cf6e' if trump else '#fbf6ea', outline='#3a2306', width=3)
        f = mid if len(top) > 1 else big
        if top == '★':
            f = sym
        tw = d.textlength(top, font=f)
        d.text((x0 + (bw - tw) / 2, y0 + (8 if trump else 4)), top, font=f, fill=col)
        if bottom:
            sw = d.textlength(bottom, font=sym)
            d.text((x0 + (bw - sw) / 2, y0 + 46), bottom, font=sym, fill=col)
        im.save(OUT / f'{cid}.webp', 'WEBP', quality=84, method=6)
    print(len(list(OUT.glob('*.webp'))), 'карт')


if __name__ == '__main__':
    main()
