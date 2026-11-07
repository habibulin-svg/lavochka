"""Brick Game 2026: отобранные фоны (05-fony) → lavochka/public/brick2026/fon/<имя>.webp; плитка (06-kirpich) → kirpich.webp.
Запуск питоном из venv ComfyUI: studio/run.cmd jobs/brick2026/export_fony.py
Плитка приводится к серому со средним ~128: в игре кладётся на цвет режимом hard-light (серое — цвет, светлее — блик, темнее — тень)."""
import pathlib

from PIL import Image, ImageOps, ImageStat

SRC = pathlib.Path('G:/temp/studio/out/brick2026')
DST = pathlib.Path(__file__).resolve().parents[3] / 'lavochka/public/brick2026'
# какой сид взят для каждого фона (смотрел глазами); орбита и салют — из переделки 07 (главное по краям, не за стаканом)
PICK = {
    'l0-dvor': 12, 'l1-bereza': 12, 'l2-zakat': 11, 'l3-zima': 12, 'l4-sad': 11,
    'l5-orbita': ('07-fony-kraya', 51), 'l6-salyut': ('07-fony-kraya', 52), 'l7-tumannost': 11, 'l8-metro': 11, 'l9-osen': 11,
}
TILE_SEED = 32


def main():
    (DST / 'fon').mkdir(parents=True, exist_ok=True)
    for name, pick in PICK.items():
        job, seed = pick if isinstance(pick, tuple) else ('05-fony', pick)
        f = SRC / job / f'{name}-{seed}.png'
        if not f.exists():
            print('нет', f)
            continue
        Image.open(f).convert('RGB').save(DST / 'fon' / f'{name}.webp', quality=74, method=6)
        print(name, (DST / 'fon' / f'{name}.webp').stat().st_size // 1024, 'КБ')
    t = SRC / '06-kirpich' / f'plitka-{TILE_SEED}.png'
    if t.exists():
        g = ImageOps.grayscale(Image.open(t))
        x0, y0, x1, y1 = g.point(lambda v: 255 if v > 40 else 0).getbbox()  # плитка на чёрном — режем по её краю
        g = g.crop((x0 + 2, y0 + 2, x1 - 2, y1 - 2)).resize((128, 128), Image.LANCZOS)
        m = ImageStat.Stat(g.crop((40, 40, 88, 88))).mean[0]
        g = g.point(lambda v: max(0, min(255, round(128 + (v * 128 / max(1, m) - 128) * 1.7))))  # фаска контрастнее
        g.save(DST / 'kirpich.webp', quality=90, method=6)
        print('kirpich', round(m))


if __name__ == '__main__':
    main()
