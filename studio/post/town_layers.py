"""«Герои»: город одной картиной → пустой фон + постройки слоями (проба на Затулье, 2026-11-23).

G:/ai/ComfyUI/venv/Scripts/python.exe -X utf8 studio/post/town_layers.py <целый.png> <пустой.png> <места.json> <фракция> <выход towns/> <townplace.ts>

Целый — отстроенный город (Klein по схеме расстановки), пустой — та же картина без построек (Klein-правка).
Пустой подгоняется по цвету к целому; маска построек — где картины расходятся. Каждый кусок маски отдаётся месту
из места.json (рамки схемы; при наложении — ближнему ряду). Фон = целый вне построек + пустой под ними, поэтому
постройка, вырезанная из целого, ложится на фон без шва: свет, земля и тени — из одной картины.
Пишет <фракция>-site.webp, <фракция>-<постройка>.webp и места в townplace.ts (left, top, width на кадре 1920×1080).
"""
import json
import pathlib
import re
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

W, H = 1920, 1080


def load(p):
    return np.asarray(Image.open(p).convert('RGB').resize((W, H), Image.LANCZOS)).astype(np.float32)


def main():
    whole_p, empty_p, boxes_p, fac, out_dir, ts_p = sys.argv[1:7]
    T = load(whole_p)
    B = load(empty_p)
    boxes = json.loads(pathlib.Path(boxes_p).read_text(encoding='utf-8'))
    # 1) цвет пустой картины — к целой по местам, где они и так совпадают
    d0 = np.sqrt(((T - B) ** 2).sum(2))
    same = d0 < np.percentile(d0, 50)
    for c in range(3):
        bt, bb = T[..., c][same], B[..., c][same]
        B[..., c] = (B[..., c] - bb.mean()) / (bb.std() + 1e-3) * bt.std() + bt.mean()
    B = np.clip(B, 0, 255)
    # 2) постройку в целой картине выделяет BiRefNet (по рамке места с запасом); спорное — месту, к центру которого ближе
    import torch
    from torchvision import transforms
    from transformers import AutoModelForImageSegmentation
    net = AutoModelForImageSegmentation.from_pretrained('G:/ai/models/birefnet', trust_remote_code=True).to('cuda').eval().half()
    tf = transforms.Compose([transforms.Resize((1024, 1024)), transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
    owner = np.full((H, W), -1, np.int16)
    best = np.full((H, W), np.inf, np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    names = list(boxes)
    alpha = {}
    for i, n in enumerate(names):
        x, y, w, h, row = boxes[n]
        cx, cy = x + w / 2, y + h * 0.6
        score = np.maximum(np.abs(xx - cx) / (w * 0.62), np.abs(yy - cy) / (h * 0.62))
        take = (score < 1) & (score < best)
        owner[take] = i
        best[take] = score[take]
        px, py = int(w * 0.15), int(h * 0.2)
        x0, y0, x1, y1 = max(0, x - px), max(0, y - py), min(W, x + w + px), min(H, y + h + py)
        crop = Image.fromarray(T[y0:y1, x0:x1].astype(np.uint8))
        with torch.no_grad():
            mm = net(tf(crop).unsqueeze(0).to('cuda').half())[-1].sigmoid()[0, 0].float().cpu().numpy()
        mm = np.asarray(Image.fromarray((mm * 255).astype(np.uint8)).resize(crop.size, Image.BILINEAR)).astype(np.float32) / 255
        full = np.zeros((H, W), np.float32)
        full[y0:y1, x0:x1] = mm
        alpha[n] = full
    out = pathlib.Path(out_dir)
    Image.fromarray(B.astype(np.uint8)).save(out / f'{fac}-site.webp', 'WEBP', quality=90, method=6)
    # 3) чей пиксель: из построек, чья вырезка его накрыла, — ближняя к зрителю (ряд), при равенстве — ближняя по центру
    claim = np.full((H, W), -1, np.int16)
    key = np.full((H, W), -np.inf, np.float32)
    for i, n in enumerate(names):
        x, y, w, h, row = boxes[n]
        cx, cy = x + w / 2, y + h * 0.6
        dist = np.maximum(np.abs(xx - cx) / w, np.abs(yy - cy) / h)
        k = row * 10 - dist
        take = (alpha[n] > 0.5) & (k > key)
        claim[take] = i
        key[take] = k[take]
    place = {}
    for i, n in enumerate(names):
        a = alpha[n] * (claim == i)
        core = a > 0.5
        lab, k = ndimage.label(core)
        if k:
            # куски, заметно лежащие в своей рамке (чужая постройка в кадре вырезки — мимо)
            inbox = ndimage.sum(owner == i, lab, range(1, k + 1)) / np.maximum(ndimage.sum(core, lab, range(1, k + 1)), 1)
            sizes = ndimage.sum(core, lab, range(1, k + 1))
            core = np.isin(lab, [j + 1 for j in range(k) if inbox[j] > 0.3 and sizes[j] > max(sizes) * 0.05])
            a = a * core
        if core.sum() < 0.25 * boxes[n][2] * boxes[n][3]:
            # вырезка взяла мелочь (тур вместо загона) — маска по разнице целой и пустой картин в своём месте
            dd = ndimage.gaussian_filter(np.sqrt(((T - B) ** 2).sum(2)), 2.0) > 38
            dd = ndimage.binary_fill_holes(ndimage.binary_closing(ndimage.binary_opening(dd, iterations=2), iterations=6)) & (owner == i)
            core = core | dd
            a = np.maximum(a, core.astype(np.float32))
            print('по разнице', n)
        if core.sum() < 400:
            print('пусто', n)
            continue
        skirt = ndimage.binary_dilation(core, iterations=10) & ((claim == i) | (claim < 0))
        a = np.maximum(a * core, ndimage.gaussian_filter(skirt.astype(np.float32), 5) * 0.9)
        a = np.maximum(a, ndimage.gaussian_filter(core.astype(np.float32), 0.8))
        ys, xs = np.nonzero(a > 0.02)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        rgba = np.dstack([T[y0:y1, x0:x1], np.clip(a[y0:y1, x0:x1, None], 0, 1) * 255]).astype(np.uint8)
        Image.fromarray(rgba, 'RGBA').save(out / f'{fac}-{n}.webp', 'WEBP', quality=90, method=6)
        place[n] = [int(x0), int(y0), int(x1 - x0), boxes[n][4]]
        print(n, place[n])
    # 5) места — в townplace.ts (по фракциям)
    ts = pathlib.Path(ts_p)
    cur = {}
    if ts.exists():
        mm = re.search(r'= (\{.*\});', ts.read_text(encoding='utf-8'), re.S)
        if mm:
            cur = json.loads(mm.group(1))
    cur[fac] = place
    ts.write_text('/* Сгенерировано studio/post/town_layers.py: город одной картиной — постройки на своих местах кадра 1920×1080 [left, top, width, ряд — порядок наложения]. */\n'
                  'export const PLACED: Record<string, Record<string, [number, number, number, number]>> = ' + json.dumps(cur, ensure_ascii=False) + ';\n',
                  encoding='utf-8')


if __name__ == '__main__':
    main()
