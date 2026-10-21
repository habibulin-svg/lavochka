"""Картинки аркад (Шарики, Клад, Яйца динозавров) из того, что нагенерировала утилита tools/videogen (набор «Аркада: …»):
вырезает ровный фон-хромакей в прозрачность, режет листы фишек на отдельные, ужимает всё в webp → public/arcade/<игра>/.

    python tools/arcade-art/build.py <папка videogen_out>

Какой файл куда — в PLAN ниже (выбранные варианты, имена вида frog_1.png). Исходники в git не кладём — только результат."""

import colorsys
import os
import sys

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "public", "arcade")


def key_color(im: Image.Image) -> tuple[int, int, int]:
    """Цвет фона — по углам картинки (медиана)."""
    w, h = im.size
    px = [im.getpixel((x, y))[:3] for x in (2, w // 2, w - 3) for y in (2, h - 3)]
    return tuple(sorted(p[i] for p in px)[len(px) // 2] for i in range(3))


def cut(im: Image.Image, soft=(60, 130)) -> Image.Image:
    """Хромакей → прозрачность: по расстоянию до цвета фона, мягкий край; у края убираем отсвет фона."""
    im = im.convert("RGB")
    k = key_color(im)
    green = k[1] > k[0] and k[1] > k[2]
    lo, hi = soft
    src = im.load()
    out = Image.new("RGBA", im.size)
    dst = out.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            d = ((r - k[0]) ** 2 + (g - k[1]) ** 2 + (b - k[2]) ** 2) ** 0.5
            a = 0 if d <= lo else 255 if d >= hi else int(255 * (d - lo) / (hi - lo))
            if 0 < a < 255 or d < hi * 1.6:
                # отсвет: зелёный — срезаем G до max(R,B); пурпурный — R и B до уровня G
                if green:
                    g = min(g, max(r, b))
                else:
                    m = max(g, min(r, b) - 40)
                    if r > m and b > m and abs(r - b) < 70:
                        r, b = min(r, m + (r - m) // 3), min(b, m + (b - m) // 3)
            dst[x, y] = (r, g, b, a)
    # чуть сжимаем край — убирает тонкую кайму
    a = out.getchannel("A").filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    out.putalpha(a)
    return out


def pieces(im: Image.Image, n: int) -> list[Image.Image]:
    """Лист → n фишек слева направо: столбцы, где есть непрозрачное, группируем в куски."""
    a = im.getchannel("A")
    w, h = im.size
    col = [max(a.crop((x, 0, x + 1, h)).getextrema()[1], 0) > 100 for x in range(w)]
    runs, start = [], None
    for x, c in enumerate(col + [False]):
        if c and start is None:
            start = x
        elif not c and start is not None:
            if x - start > 20:
                runs.append((start, x))
            start = None
    if len(runs) != n:
        raise SystemExit(f"на листе {len(runs)} кусков вместо {n}")
    return [im.crop((x0, 0, x1, h)).crop(im.crop((x0, 0, x1, h)).getbbox()) for x0, x1 in runs]


def square(im: Image.Image, size: int, pad: float = 0.04) -> Image.Image:
    """В квадрат size×size по центру, с небольшим полем."""
    w, h = im.size
    s = (1 - 2 * pad) * size / max(w, h)
    im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    c = Image.new("RGBA", (size, size))
    c.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    return c


def round_cut(im: Image.Image, size: int = 160) -> Image.Image:
    """Люк: асфальт вокруг по цвету близок к фону — вместо хромакея круг с мягким краем по центру картинки."""
    im = im.convert("RGB")
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((size, size), Image.LANCZOS)
    m = Image.new("L", (size, size))
    px = m.load()
    for y in range(size):
        for x in range(size):
            d = ((x - size / 2) ** 2 + (y - size / 2) ** 2) ** 0.5 / (size / 2)
            px[x, y] = 255 if d < 0.5 else 0 if d > 0.78 else int(255 * (0.78 - d) / 0.28)
    out = im.convert("RGBA")
    out.putalpha(m)
    return out


def recolor(im: Image.Image, hue: float | None, sat: float = 1.0, light: float = 0.0) -> Image.Image:
    """Перекраска фишки: новый тон (0..1), насыщенность ×sat, светлота +light. hue=None — тон прежний."""
    px = im.load()
    out = im.copy()
    o = out.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            hh, ll, ss = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            if hue is not None:
                hh = hue
            ll = min(1, ll + light * (1 - ll))
            r2, g2, b2 = colorsys.hls_to_rgb(hh, ll, min(1, ss * sat))
            o[x, y] = (round(r2 * 255), round(g2 * 255), round(b2 * 255), a)
    return out


def save(im: Image.Image, game: str, name: str, q: int = 82):
    d = os.path.join(OUT, game)
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".webp")
    im.save(p, "WEBP", quality=q, method=6)
    print(f"{game}/{name}.webp {im.size[0]}x{im.size[1]} {os.path.getsize(p) // 1024} КБ")


def fit(im: Image.Image, w: int, h: int) -> Image.Image:
    """Обрезать по центру под соотношение w:h и уменьшить."""
    iw, ih = im.size
    if iw / ih > w / h:
        nw = round(ih * w / h)
        im = im.crop(((iw - nw) // 2, 0, (iw - nw) // 2 + nw, ih))
    else:
        nh = round(iw * h / w)
        im = im.crop((0, (ih - nh) // 2, iw, (ih - nh) // 2 + nh))
    return im.convert("RGB").resize((w, h), Image.LANCZOS)


def main(src: str):
    op = lambda game, f: Image.open(os.path.join(src, game, f))

    # ---- Шарики: фоны 4:3 (поле 800×600), шары — перекраска одного (один стиль), лягушка, люк, карта
    for i, f in ((1, "bg1_1.png"), (2, "bg2.png"), (3, "bg3.png")):
        save(fit(op("shariki", f), 1024, 768), "shariki", f"bg{i}", 78)
    red, yellow, blue = pieces(cut(op("shariki", "marbles1_2.png")), 3)
    base = square(red, 128)
    balls = [  # порядок — как COLORS в игре: красный, жёлтый, зелёный, синий, фиолетовый, белый
        base,
        square(yellow, 128),
        recolor(square(blue, 128), 0.36),
        square(blue, 128),
        recolor(square(blue, 128), 0.78),
        recolor(square(blue, 128), None, 0.05, 0.72),
    ]
    for i, b in enumerate(balls):
        save(b, "shariki", f"ball{i}", 90)
    save(square(cut(op("shariki", "frog_1.png")), 256, 0.02), "shariki", "frog", 88)
    save(round_cut(op("shariki", "hole.png")), "shariki", "hole", 85)
    save(fit(op("shariki", "map.png"), 600, 800), "shariki", "map", 76)

    # ---- Клад: песочница, клетки песка и земли, кирпич, 7 сокровищ, 3 спецфишки, карта
    save(fit(op("klad", "bg.png"), 1024, 1024), "klad", "bg", 78)
    save(fit(op("klad", "sand.png"), 256, 256), "klad", "sand", 80)
    save(fit(op("klad", "dirt.png"), 256, 256), "klad", "dirt", 80)
    save(square(cut(op("klad", "stone.png"), (40, 90)), 128, 0.02), "klad", "stone", 85)
    gems = pieces(cut(op("klad", "gems1.png")), 4) + pieces(cut(op("klad", "gems2.png")), 3)
    for i, g in enumerate(gems):  # монета, рубин, изумруд, сапфир, аметист, жемчуг, перстень
        save(square(g, 128), "klad", f"gem{i}", 90)
    for name, g in zip(("shovel", "dynamite", "nugget"), pieces(cut(op("klad", "specials.png")), 3)):
        save(square(g, 128), "klad", name, 90)
    # слева на картинке край тетради — режем по бумаге
    save(fit(op("klad", "map_1.png").crop((44, 0, 768, 990)), 600, 800), "klad", "map", 76)

    # ---- Яйца: фоны 2:3, 6 яиц, динозаврик, каменный потолок, карта
    for i in (1, 2, 3):
        save(fit(op("eggs", f"bg{i}.png"), 640, 960), "eggs", f"bg{i}", 78)
    eggs = pieces(cut(op("eggs", "eggs1_2.png")), 3) + pieces(cut(op("eggs", "eggs2_2.png")), 3)
    order = [0, 1, 2, 3, 4, 5]  # зелёное, синее, красное, жёлтое, фиолетовое, оранжевое — как EGG в игре
    for i, j in enumerate(order):
        save(square(eggs[j], 128), "eggs", f"egg{i}", 90)
    save(square(cut(op("eggs", "dino.png")), 256, 0.02), "eggs", "dino", 88)
    c = cut(op("eggs", "ceiling.png"))
    c = c.crop(c.getbbox())
    save(c.resize((1024, round(c.height * 1024 / c.width)), Image.LANCZOS), "eggs", "ceiling", 85)
    # тетрадь лежит на подоконнике — режем по бумаге
    save(fit(op("eggs", "map.png").crop((60, 130, 690, 930)), 600, 800), "eggs", "map", 76)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "tools", "videogen", "dist", "videogen_out"))
