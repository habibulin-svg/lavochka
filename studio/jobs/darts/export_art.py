"""Дартс: отобранные картинки 01-art → lavochka/public/darts/art/*.webp (раскладывает их lavochka/src/games/darts/art.ts).

G:/ai/venvs/3d/Scripts/python.exe studio/jobs/darts/export_art.py
(venv с torch: вырезка BiRefNet — studio/runners/cutout.py, вызывается отсюда же.)

Что делается (рисунок — модели, код только подгоняет и собирает):
- фон бара — лист целиком, уменьшен;
- шкафчик — вырезка BiRefNet; где в нём мишень и доски створок — числа BOARD_AT/DOORS (смотрел глазами), печатаются для art.ts;
- мишень — собирается по ТОЧНОЙ геометрии (board.ts: 20 секторов, кольца 6,35/15,9/99/107/162/170 мм, край 225,5 мм)
  из фактур сизаля четырёх цветов и проволоки, нарисованных моделью; цифры — шрифтом (модель цифры по кругу не напишет);
- дротики — вырезка, обрезка по содержимому; остриё — самая левая точка, печатается для art.ts.
"""
import math
import pathlib
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = pathlib.Path(__file__).resolve()
STUDIO = HERE.parents[2]
SRC = pathlib.Path('G:/temp/studio/out/darts/01-art')
CUT = pathlib.Path('G:/temp/studio/out/darts/cut')
DST = STUDIO.parent / 'lavochka/public/darts/art'

# какой сид взят (смотрел листы глазами)
PICK = {
    'bg-bar': 81,
    'cabinet': 81,
    'sisal-black': 83,
    'sisal-cream': 82,
    'sisal-red': 81,
    'sisal-green': 81,
    'wire': 81,
    'dart-red': 82,
    'dart-blue': 82,
    'dart-green': 81,
    'dart-yellow': 82,
}
# где в выбранной картинке шкафчика (px исходника) круг мишени: центр и радиус края мишени; доски створок — x, y, w, h
BOARD_AT = (791, 484, 227)
DOORS = {'left': (240, 190, 228, 650), 'right': (1100, 190, 196, 650), 'bounds': (180, 112, 1360, 878)}

ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]
R_BULL, R_OUTER, R_TIN, R_TOUT, R_DIN, R_DOUT, R_BOARD = 0.00635, 0.0159, 0.099, 0.107, 0.162, 0.17, 0.2255
WIRE_HALF = 0.0006

BOARD_PX = 1100  # сторона картинки мишени
BOARD_R = 540  # радиус края мишени в ней, px


def src(name: str) -> pathlib.Path:
    return SRC / f'{name}-{PICK[name]}.png'


def clean_alpha(im: Image.Image, lo: int = 40) -> Image.Image:
    a = np.asarray(im.split()[-1]).astype(np.float32)
    a = np.clip((a - lo) * 255 / (255 - lo), 0, 255).astype(np.uint8)
    out = im.copy()
    out.putalpha(Image.fromarray(a))
    bbox = out.split()[-1].point(lambda v: 255 if v > 16 else 0).getbbox()
    return out.crop(bbox) if bbox else out


def cut_all(names):
    files = [src(n) for n in names]
    need = [f for f in files if not (CUT / f.name).exists()]
    if need:
        subprocess.run([sys.executable, str(STUDIO / 'runners/cutout.py'), str(CUT), *map(str, need)], check=True)


def cut_raw(name: str) -> Image.Image:
    return Image.open(CUT / src(name).name).convert('RGBA')


def save(im: Image.Image, name: str, q: int = 86):
    im.save(DST / f'{name}.webp', quality=q, method=6)
    print(name, im.size)


def tex(name: str, target, contrast: float = 0.85) -> np.ndarray:
    """Фактура модели, сведённая к нужному среднему цвету с сохранением рисунка волокон."""
    a = np.asarray(Image.open(src(name)).convert('RGB'), dtype=np.float32)
    lum = a.mean(axis=2, keepdims=True)
    m = lum.mean()
    detail = 1 + (lum / max(m, 1) - 1) * contrast
    tint = a / np.maximum(lum, 1)  # оттенок модели
    tint = tint * 0.35 + 0.65  # оттенок — слегка
    out = np.asarray(target, dtype=np.float32)[None, None, :] * detail * tint
    return np.clip(out, 0, 255)


def build_board():
    S = 2  # сглаживание: считаем вдвое крупнее
    N = BOARD_PX * S
    rp = BOARD_R * S
    ppm = rp / R_BOARD
    yy, xx = np.mgrid[:N, :N].astype(np.float32)
    x = (xx - N / 2 + 0.5) / ppm
    y = (N / 2 - yy - 0.5) / ppm
    r = np.hypot(x, y)
    deg = (np.degrees(np.arctan2(x, y)) + 9) % 360
    idx = (deg // 18).astype(np.int32) % 20
    even = idx % 2 == 0
    black = tex('sisal-black', (34, 32, 30))
    cream = tex('sisal-cream', (232, 214, 172))
    red = tex('sisal-red', (178, 30, 34))
    green = tex('sisal-green', (22, 112, 58))
    T = black.shape[0]
    # фактура: 1024 px фактуры ≈ 9 см мишени
    k = T / (0.09 * ppm)
    # зеркальная укладка плиток — без швов
    def mirror(i):
        i = i % (2 * T)
        return np.where(i >= T, 2 * T - 1 - i, i)

    tu = mirror((xx * k).astype(np.int32))
    tv = mirror((yy * k).astype(np.int32))

    def sample(t):
        return t[tv, tu]

    img = np.zeros((N, N, 3), np.float32)
    single = (r > R_OUTER) & (r <= R_DOUT) & ~((r >= R_TIN) & (r <= R_TOUT)) & ~(r >= R_DIN)
    ring = ((r >= R_TIN) & (r <= R_TOUT)) | ((r >= R_DIN) & (r <= R_DOUT))
    surround = r > R_DOUT
    img[single & even] = sample(black)[single & even]
    img[single & ~even] = sample(cream)[single & ~even]
    img[ring & even] = sample(red)[ring & even]
    img[ring & ~even] = sample(green)[ring & ~even]
    ob = (r > R_BULL) & (r <= R_OUTER)
    img[ob] = sample(green)[ob]
    ib = r <= R_BULL
    img[ib] = sample(red)[ib]
    sur = sample(black) * 0.78
    img[surround] = sur[surround]

    # проволока: расстояние до колец и лучей
    d = np.full((N, N), 1.0, np.float32)
    for rr in (R_BULL, R_OUTER, R_TIN, R_TOUT, R_DIN, R_DOUT):
        d = np.minimum(d, np.abs(r - rr))
    off = deg % 18
    da = np.radians(np.minimum(off, 18 - off))
    radial = r * np.sin(da)
    radial[(r < R_OUTER) | (r > R_DOUT)] = 1.0
    d = np.minimum(d, radial)
    # тень от проволоки (свет сверху слева) — та же проволока, сдвинутая вниз вправо
    sh = 0.0007 * ppm
    dsh = np.roll(np.roll(d, int(sh), axis=0), int(sh), axis=1)
    shadow = np.clip(1 - dsh / (WIRE_HALF * 1.8), 0, 1) * 0.45
    img *= (1 - shadow)[..., None]
    wire_t = np.asarray(Image.open(src('wire')).convert('L'), dtype=np.float32)
    wt = wire_t[tv % wire_t.shape[0], tu % wire_t.shape[1]] / max(wire_t.mean(), 1)
    v = np.clip(1 - (d / WIRE_HALF) ** 2, 0, 1)
    prof = np.sqrt(v)
    metal = (150 + 105 * prof)[..., None] * np.array([1.0, 1.0, 1.03])[None, None, :] * (0.85 + 0.15 * wt)[..., None]
    a = np.clip((WIRE_HALF - d) * ppm + 0.5, 0, 1)[..., None]
    a[(r > R_DOUT + WIRE_HALF * 2)[..., None].repeat(1, axis=2)] = 0
    img = img * (1 - a) + np.clip(metal, 0, 255) * a

    # свет: чуть ярче сверху слева, к краю темнее; скос края
    light = 1.04 - 0.1 * ((x + y * -1) / R_BOARD + 1) / 2
    edge = np.clip((R_BOARD - r) / 0.006, 0, 1)
    bevel = 0.55 + 0.45 * edge
    img *= (light * bevel)[..., None]
    alpha = np.clip((R_BOARD - r) * ppm + 0.5, 0, 1)
    out = Image.fromarray(np.dstack([np.clip(img, 0, 255), alpha * 255]).astype(np.uint8), 'RGBA')

    # цифры по кругу — прямо стоящие, металлические
    draw = ImageDraw.Draw(out)
    font = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', int(0.023 * ppm))
    rn = 0.1985 * ppm
    for i, n in enumerate(ORDER):
        ang = math.radians(i * 18)
        cx = N / 2 + math.sin(ang) * rn
        cy = N / 2 - math.cos(ang) * rn
        t = str(n)
        bb = draw.textbbox((0, 0), t, font=font)
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        pos = (cx - w / 2 - bb[0], cy - h / 2 - bb[1])
        draw.text((pos[0] + 3, pos[1] + 3), t, font=font, fill=(0, 0, 0, 200))
        draw.text(pos, t, font=font, fill=(236, 236, 230, 255))
    out = out.resize((BOARD_PX, BOARD_PX), Image.LANCZOS)
    return out


def main():
    DST.mkdir(parents=True, exist_ok=True)
    darts = ['dart-red', 'dart-blue', 'dart-green', 'dart-yellow']
    cut_all(['cabinet', *darts])
    # фон
    save(Image.open(src('bg-bar')).convert('RGB').resize((1536, 1024), Image.LANCZOS), 'bg', 72)
    # шкафчик: вырезка без обрезки — числа BOARD_AT/DOORS в координатах исходника
    # cutout.py обрезает по содержимому — возвращаем вырезку на холст исходника (сдвиг ищем сличением)
    cut = cut_raw('cabinet')
    orig = Image.open(src('cabinet')).convert('RGB')
    oa = np.asarray(orig, dtype=np.float32)
    ca = np.asarray(cut.convert('RGB'), dtype=np.float32)
    py, px = ca.shape[0] // 2, ca.shape[1] // 2
    patch = ca[py - 24 : py + 24, px - 24 : px + 24]
    best = (1e18, 0, 0)
    for dy in range(0, oa.shape[0] - ca.shape[0] + 1):
        for dx in range(0, oa.shape[1] - ca.shape[1] + 1, 1):
            e = np.abs(oa[dy + py - 24 : dy + py + 24, dx + px - 24 : dx + px + 24] - patch).sum()
            if e < best[0]:
                best = (e, dx, dy)
    cab = Image.new('RGBA', orig.size, (0, 0, 0, 0))
    cab.paste(cut, (best[1], best[2]))
    print('сдвиг вырезки шкафчика', best[1:], 'ошибка', best[0])
    W, H = cab.size
    a = np.asarray(cab.split()[-1]).astype(np.float32)
    cab.putalpha(Image.fromarray(np.clip((a - 30) * 255 / 225, 0, 255).astype(np.uint8)))
    save(cab, 'cabinet', 84)
    print('META cabinet', {'w': W, 'h': H, 'cx': BOARD_AT[0], 'cy': BOARD_AT[1], 'r': BOARD_AT[2], 'doors': DOORS})
    # мишень
    save(build_board(), 'board', 88)
    print('META board', {'size': BOARD_PX, 'r': BOARD_R})
    # дротики
    for i, n in enumerate(darts):
        im = clean_alpha(cut_raw(n))
        al = np.asarray(im.split()[-1])
        cols = np.where(al.max(axis=0) > 60)[0]
        x0 = cols[0]
        rows = np.where(al[:, x0 : x0 + 6].max(axis=1) > 60)[0]
        tipv = float(rows.mean()) / im.height
        im = im.resize((640, max(8, round(im.height * 640 / im.width))), Image.LANCZOS)
        save(im, f'dart-{i}', 88)
        print('META dart', i, {'tipV': round(tipv, 3), 'aspect': round(im.height / im.width, 3)})
    total = sum(f.stat().st_size for f in DST.glob('*.webp'))
    print('итого', len(list(DST.glob('*.webp'))), 'файлов,', total // 1024, 'КБ')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'board':
        DST.mkdir(parents=True, exist_ok=True)
        save(build_board(), 'board', 88)
    else:
        main()
