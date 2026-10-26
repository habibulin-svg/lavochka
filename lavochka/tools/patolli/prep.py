"""Патолли: фон доски — лист Флорентийского кодекса (XVI в., общественное достояние) без нарисованного креста.

Исходник — цветная копия листа (D:/temp/patolli-codex/1.png, 492×491). Увеличиваем вдвое, стираем крест (маска —
ломаные по лучам, как они нарисованы от руки) и закрашиваем стёртое бумагой (цвет чистой бумаги вокруг и мелкое зерно), крест
потом рисует view.ts. Запуск: python -I tools/patolli/prep.py [исходник] → public/patolli/codex.webp
"""
import sys
from pathlib import Path

import cv2
import numpy as np

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else 'D:/temp/patolli-codex/1.png')
OUT = Path(__file__).resolve().parents[2] / 'public' / 'patolli' / 'codex.webp'

# лучи креста на увеличенном вдвое листе (984×982): от руки они чуть изогнуты
A = [(150, 135), (290, 302), (452, 492), (628, 684), (800, 868)]
B = [(774, 108), (616, 292), (466, 476), (308, 668), (155, 852)]
W = 112

im = cv2.imread(str(SRC))
im = cv2.resize(im, (im.shape[1] * 2, im.shape[0] * 2), interpolation=cv2.INTER_LANCZOS4)
mask = np.zeros(im.shape[:2], np.uint8)
for P in (A, B):
    cv2.polylines(mask, [np.array(P, np.int32)], False, 255, W, cv2.LINE_AA)
    for p in (P[0], P[-1]):
        cv2.circle(mask, p, W // 2 - 2, 255, -1)
mask = cv2.dilate((mask > 0).astype(np.uint8) * 255, np.ones((3, 3), np.uint8))
# рамку листа не трогаем
frame = np.zeros_like(mask)
frame[72:906, 44:936] = 255
mask &= frame
# цвет бумаги под стёртым: размытие только по чистой бумаге (без линий и рисунка) — нормированная свёртка
gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
ok = ((mask == 0) & (gray > 175)).astype(np.float32)
num = cv2.GaussianBlur(im.astype(np.float32) * ok[..., None], (0, 0), 22)
den = cv2.GaussianBlur(ok, (0, 0), 22)[..., None]
bg = np.median(im[ok > 0], axis=0).astype(np.float32)
paper = (num + bg * 0.02) / (den + 0.02)
flat = np.where(mask[..., None] > 0, paper, im.astype(np.float32))
# зерно бумаги: мелкий шум, чтобы стёртое не было гладким пятном
rng = np.random.default_rng(7)
noise = cv2.GaussianBlur(rng.normal(0, 1, im.shape[:2]).astype(np.float32), (0, 0), 0.8)[..., None] * 6
m = cv2.GaussianBlur(mask, (0, 0), 2).astype(np.float32)[..., None] / 255
out = np.clip(flat + noise * m, 0, 255).astype(np.uint8)
# лёгкая резкость после увеличения
sharp = cv2.addWeighted(out, 1.35, cv2.GaussianBlur(out, (0, 0), 1.2), -0.35, 0)
OUT.parent.mkdir(parents=True, exist_ok=True)
cv2.imwrite(str(OUT), sharp, [cv2.IMWRITE_WEBP_QUALITY, 86])
print(OUT, sharp.shape, OUT.stat().st_size)
