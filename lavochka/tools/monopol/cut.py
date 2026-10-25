"""«Мо-но-пол» — поле из скана кооператива «МИЛАГ» → public/monopol/field.webp (2400 px) и field-mini.webp (480 px).

Запуск: python tools/monopol/cut.py "D:/temp/monopol/field_new/field.jpg"
Координаты клеток в src/games/monopol/board.ts — в пикселях поля шириной 1600 (картинка пропорциональна)."""
import os
import sys

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else 'D:/temp/monopol/field_new/field.jpg'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'monopol')
os.makedirs(OUT, exist_ok=True)
im = Image.open(SRC).convert('RGB')
for name, w, q in (('field', 2400, 80), ('field-mini', 480, 70)):
    h = round(im.size[1] * w / im.size[0])
    im.resize((w, h), Image.LANCZOS).save(os.path.join(OUT, name + '.webp'), quality=q, method=6)
    print(name, w, h)
