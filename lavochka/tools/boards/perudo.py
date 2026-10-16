#!/usr/bin/env python3
"""Перудо — кости, стаканчики, сукно и дерево стола (Pillow + numpy):

    python tools/boards/perudo.py public/tex/perudo

  * d{c}{v}.webp — кость цвета c (0–5 — цвета мест, n — нейтральная «слоновая кость»), грань v 1–6:
    вид сверху на кубик со скруглёнными рёбрами, точки вдавлены; единица — «пако», звёздочка (джокер);
  * cup{c}.webp — кожаный стаканчик дном вверх: усечённый конус, фактура кожи, цветная полоса и прошивка у края;
  * felt.webp, wood.webp — бесшовные плитки сукна и тёмного дерева для стола (их же берёт Яхтзи);
  * ../yahtzee/paper.webp и d1…d6 — бумага и значки граней бланка Яхтзи.
"""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).parent))
from mancala import smooth_noise, wood  # noqa: E402

SEAT = [(179, 50, 42), (43, 92, 158), (47, 122, 62), (217, 165, 33), (122, 62, 158), (31, 138, 138)]
L = np.array([-0.45, -0.6, 0.66])
L /= np.linalg.norm(L)
HV = L + np.array([0, 0, 1.0])
HV /= np.linalg.norm(HV)
PIPS = {1: [], 2: [(0.27, 0.27), (0.73, 0.73)], 3: [(0.27, 0.27), (0.5, 0.5), (0.73, 0.73)],
        4: [(0.27, 0.27), (0.73, 0.27), (0.27, 0.73), (0.73, 0.73)],
        5: [(0.27, 0.27), (0.73, 0.27), (0.5, 0.5), (0.27, 0.73), (0.73, 0.73)],
        6: [(0.27, 0.25), (0.73, 0.25), (0.27, 0.5), (0.73, 0.5), (0.27, 0.75), (0.73, 0.75)]}


def lit(hgt, alb, mask, gloss=0.4, power=40, amb=0.42):
    gy, gx = np.gradient(hgt)
    n = np.dstack([-gx, -gy, np.ones_like(hgt)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    d = np.clip((n * L).sum(2), 0, 1)
    h = np.clip((n * HV).sum(2), 0, 1)
    col = alb * (amb + 0.72 * d)[..., None] + (h ** power * 255 * gloss)[..., None]
    a = (np.clip(mask, 0, 1) * 255).astype(np.uint8)
    return Image.fromarray(np.dstack([col.clip(0, 255).astype(np.uint8), a]), 'RGBA')


def die(color, v, size=96, paco=True):
    S = size * 3
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) / S
    m, r = 0.1, 0.17  # поле от края картинки (под тень), радиус скругления
    qx = np.abs(x - 0.5) - (0.5 - m - r)
    qy = np.abs(y - 0.5) - (0.5 - m - r)
    dist = r - (np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0))
    mask = np.clip(dist * S + 0.5, 0, 1)
    bevel = 0.08
    hgt = np.clip(dist / bevel, 0, 1) ** 0.5 * S * 0.06
    pip_mask = np.zeros_like(x)
    pr = 0.075
    for (px, py) in PIPS[v]:
        d = np.sqrt((x - (m + (1 - 2 * m) * px)) ** 2 + (y - (m + (1 - 2 * m) * py)) ** 2) / pr
        hgt -= np.clip(1 - d ** 2, 0, 1) ** 0.5 * S * 0.02
        pip_mask = np.maximum(pip_mask, np.clip((1 - d) * 6, 0, 1))
    ivory = color is None
    base = np.array((240, 232, 212) if ivory else color, np.float32)
    pip_col = np.array((30, 22, 16) if ivory else (250, 248, 240), np.float32)
    if v == 1 and not paco:  # обычная единица — одна точка посередине
        d = np.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2) / (pr * 1.25)
        hgt -= np.clip(1 - d ** 2, 0, 1) ** 0.5 * S * 0.02
        pip_mask = np.clip((1 - d) * 6, 0, 1)
        if color is None:
            pip_col = np.array((190, 40, 36), np.float32)
    if v == 1 and paco:  # «пако» — звёздочка
        img = Image.new('L', (S, S), 0)
        dr = ImageDraw.Draw(img)
        cx = cy = S / 2
        R = S * 0.25
        pts = [(cx + math.cos(-math.pi / 2 + i * math.pi / 5) * (R if i % 2 == 0 else R * 0.42), cy + math.sin(-math.pi / 2 + i * math.pi / 5) * (R if i % 2 == 0 else R * 0.42)) for i in range(10)]
        dr.polygon(pts, fill=255)
        star = np.asarray(img.filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255
        hgt -= star * S * 0.012
        pip_mask = star
        if ivory:
            pip_col = np.array((190, 40, 36), np.float32)
    grain = (smooth_noise(S, S, 20, 20, v + 7) - 0.5) * 0.06
    alb = base * (1 + grain)[..., None]
    alb = alb * (1 - pip_mask[..., None]) + pip_col * pip_mask[..., None]
    im = lit(hgt, alb, mask, gloss=0.35 if ivory else 0.5, power=30)
    # тень под кубиком
    sh = Image.fromarray((mask * 140).astype(np.uint8)).filter(ImageFilter.GaussianBlur(S * 0.03))
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    shadow = Image.new('RGBA', (S, S), (10, 6, 0, 0))
    shadow.putalpha(sh)
    out.alpha_composite(shadow, (round(S * 0.03), round(S * 0.045)))
    out.alpha_composite(im)
    return out.resize((size, size), Image.LANCZOS)


def cup(color, w=120, h=132):
    S = 3
    W, H = w * S, h * S
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    top, bot = H * 0.08, H * 0.9
    t = np.clip((y - top) / (bot - top), 0, 1)
    half = (0.31 + 0.09 * t) * W  # шире книзу
    cx = W / 2
    u = (x - cx) / half  # -1…1 поперёк
    body = (np.abs(u) <= 1) & (y >= top) & (y <= bot)
    # дно сверху — скруглённое: верхний край — дуга эллипса
    cap = ((x - cx) / (0.31 * W)) ** 2 + ((y - top) / (H * 0.05)) ** 2 <= 1
    mask = body | cap
    # цилиндрическая освещённость: нормаль поперёк
    nz = np.sqrt(np.clip(1 - u ** 2, 0, 1))
    d = np.clip(u * L[0] + nz * (L[2] + 0.2), 0, 1)
    spec = np.clip(u * HV[0] + nz * HV[2], 0, 1) ** 18
    leather = np.array((74, 44, 26), np.float32)
    grain = smooth_noise(W, H, 60, 70, 3) * 0.5 + smooth_noise(W, H, 160, 180, 4) * 0.5
    alb = leather * (0.82 + 0.3 * grain)[..., None]
    # цветная полоса у нижнего края и кант
    band = (y > bot - H * 0.16) & (y < bot - H * 0.04)
    alb = np.where(band[..., None], np.array(color, np.float32) * (0.9 + 0.2 * grain)[..., None], alb)
    rim = y > bot - H * 0.04
    alb = np.where(rim[..., None], leather * 0.7, alb)
    # прошивка — пунктир над полосой
    st = (np.abs(y - (bot - H * 0.19)) < H * 0.006) & ((((x - cx) / (W * 0.02)).astype(int) % 2) == 0)
    alb = np.where(st[..., None], np.array((226, 206, 160), np.float32), alb)
    col = alb * (0.35 + 0.85 * d)[..., None] + (spec * 70)[..., None]
    # дно — чуть светлее и плоское
    col = np.where((cap & ~body)[..., None] | ((y < top + H * 0.02) & cap)[..., None], leather * 1.1, col)
    a = np.where(mask, 255, 0).astype(np.uint8)
    im = Image.fromarray(np.dstack([col.clip(0, 255).astype(np.uint8), a]), 'RGBA').filter(ImageFilter.SMOOTH)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sh = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sh).ellipse((cx - W * 0.46, bot - H * 0.04, cx + W * 0.46, bot + H * 0.08), fill=150)
    shadow = Image.new('RGBA', (W, H), (10, 6, 0, 0))
    shadow.putalpha(sh.filter(ImageFilter.GaussianBlur(W * 0.03)))
    out.alpha_composite(shadow)
    out.alpha_composite(im)
    return out.resize((w, h), Image.LANCZOS)


def tile(img: np.ndarray) -> Image.Image:
    """Сделать плитку бесшовной: смешать со сдвинутой на полразмера копией по краям."""
    h, w = img.shape[:2]
    sh = np.roll(np.roll(img, h // 2, 0), w // 2, 1)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    k = np.minimum(np.minimum(x, w - 1 - x) / (w * 0.25), np.minimum(y, h - 1 - y) / (h * 0.25))
    k = np.clip(k, 0, 1)[..., None]
    return Image.fromarray((img * k + sh * (1 - k)).clip(0, 255).astype(np.uint8))


def main(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    for c, col in list(enumerate(SEAT)) + [('n', None)]:
        for v in range(1, 7):
            die(col, v).save(out / f'd{c}{v}.webp', 'WEBP', quality=90, method=6)
    for c, col in enumerate(SEAT):
        cup(col).save(out / f'cup{c}.webp', 'WEBP', quality=90, method=6)
    n = smooth_noise(512, 512, 128, 128, 9) * 0.5 + np.random.default_rng(3).random((512, 512)).astype(np.float32) * 0.5
    felt = np.array((34, 92, 60), np.float32) * (0.88 + 0.2 * n)[..., None]
    tile(felt).save(out / 'felt.webp', 'WEBP', quality=86)
    tile(wood(512, 512, (122, 72, 38), (70, 38, 18), 5, 'x', 30, 10)).save(out / 'wood.webp', 'WEBP', quality=86)
    n = smooth_noise(512, 512, 64, 64, 21) * 0.4 + smooth_noise(512, 512, 8, 8, 22) * 0.3 + np.random.default_rng(5).random((512, 512)).astype(np.float32) * 0.3
    (out.parent / 'yahtzee').mkdir(parents=True, exist_ok=True)
    tile(np.array((251, 247, 234), np.float32) * (0.965 + 0.05 * n)[..., None]).save(out.parent / 'yahtzee' / 'paper.webp', 'WEBP', quality=88)
    for v in range(1, 7):  # кости-значки бланка Яхтзи: слоновая кость, единица — точкой
        die(None, v, 64, paco=False).save(out.parent / 'yahtzee' / f'd{v}.webp', 'WEBP', quality=90, method=6)
    print('готово:', out)


if __name__ == '__main__':
    main(Path(sys.argv[1] if len(sys.argv) > 1 else 'public/tex/perudo'))
