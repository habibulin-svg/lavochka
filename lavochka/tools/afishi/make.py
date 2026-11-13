"""Афиши больших игр во дворе: public/afishi/<игра>.webp (картинка 640×360) и <игра>-logo.webp (логотип на прозрачном).

  python tools/afishi/make.py [logos] [art]       по умолчанию — всё

Логотипы снимаются безголовым Chrome со страницы tools/afishi/logos.html (шрифты самих игр), у «Заколдованной
страны» — оригинальная надпись с обложки (чёрный фон уходит в прозрачность). Картинки: «Герои» и ГОПС — их
обложки, «Заколдованная страна» — обложка коробки, «Коммерсы» — ключевой арт Z-Image (studio/jobs/site/01-afishi.yaml),
«Вкладыши» — настоящие сканы вкладышей на парте (фон — тот же job).
"""
import os
import random
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[2]
PUB = ROOT / 'public'
OUT = PUB / 'afishi'
TMP = Path('G:/temp/afishi')
GEN = Path('G:/temp/studio/out/site/01-afishi')
MS_GEN = Path('G:/temp/studio/out/site/03-music-studio')  # Lavochka Music Studio: studio/jobs/site/03-music-studio.yaml
CHROME = next((p for p in [r'C:\Program Files\Google\Chrome\Application\chrome.exe', os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe')] if os.path.exists(p)), 'chrome')
W, H = 640, 360
LOGO_H = 220  # высота логотипа в файле (на афише ~70–90 px — запас под ретину)


def save(img: Image.Image, name: str, q=82):
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / name, 'WEBP', quality=q, method=6)
    print('→', OUT / name, img.size)


def trim(img: Image.Image, pad=6) -> Image.Image:
    box = img.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    l, t, r, b = box
    return img.crop((max(0, l - pad), max(0, t - pad), min(img.width, r + pad), min(img.height, b + pad)))


def fit_h(img: Image.Image, h: int) -> Image.Image:
    return img.resize((round(img.width * h / img.height), h), Image.LANCZOS)


def logos():
    TMP.mkdir(parents=True, exist_ok=True)
    page = (ROOT / 'tools/afishi/logos.html').as_uri()
    for gid in ['gops', 'geroi', 'kommersy', 'vkladyshi', 'musicstudio']:
        png = TMP / f'logo-{gid}.png'
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', f'--user-data-dir={TMP / "chrome"}',
                        '--default-background-color=00000000', '--window-size=1600,700', '--virtual-time-budget=6000',
                        f'--screenshot={png}', f'{page}?id={gid}'], check=True, capture_output=True)
        save(fit_h(trim(Image.open(png).convert('RGBA')), LOGO_H), f'{gid}-logo.webp', 90)
    # «Заколдованная страна»: надпись с обложки, чёрное — в прозрачность (альфа по яркости)
    cov = Image.open(PUB / 'zakoldovannaya/art/cover.webp').convert('RGB')
    txt = cov.crop((20, 962, 604, 1125))
    # альфа — по «красноте» (свечение вокруг надписи синее, фон чёрный), цвет — тот же красный, ярче
    px = [(r, g, b) for r, g, b in txt.getdata()]
    lg = Image.new('RGBA', txt.size)
    lg.putdata([(min(255, int(r * 1.25)), int(g * 0.9), int(b * 0.9), max(0, min(255, (r - max(g, b) - 25) * 3))) for r, g, b in px])
    save(fit_h(trim(lg), LOGO_H), 'zakoldovannaya-logo.webp', 90)


def cover(img: Image.Image, fx=0.5, fy=0.5) -> Image.Image:
    """Заполнить W×H, центр кадра — в долях (fx, fy) исходника."""
    s = max(W / img.width, H / img.height)
    im = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    x = min(max(0, round(im.width * fx - W / 2)), im.width - W)
    y = min(max(0, round(im.height * fy - H / 2)), im.height - H)
    return im.crop((x, y, x + W, y + H))


def vkladyshi(bg: Image.Image) -> Image.Image:
    rnd = random.Random(1993)
    base = cover(bg).convert('RGBA')
    picks = ['final90/003', 'turbo1/002', 'love1/004', 'bomb1/001', 'turbo3/005', 'love3/002', 'final94/001', 'lazer/002', 'turbo2/004']
    spots = [(110, 90), (250, 70), (390, 95), (530, 80), (170, 230), (320, 220), (470, 235), (590, 250), (60, 300)]
    for p, (cx, cy) in zip(picks, spots):
        f = PUB / 'vkladyshi' / f'{p}.webp'
        if not f.exists():
            continue
        card = Image.open(f).convert('RGBA')
        card.thumbnail((128, 128), Image.LANCZOS)
        card = ImageOps.expand(card, border=4, fill=(250, 248, 240, 255))
        card = card.rotate(rnd.uniform(-24, 24), resample=Image.BICUBIC, expand=True)
        sh = Image.new('RGBA', card.size, (0, 0, 0, 0))
        sh.putalpha(card.getchannel('A').point(lambda a: a * 0.55))
        sh = sh.filter(ImageFilter.GaussianBlur(6))
        x, y = cx - card.width // 2, cy - card.height // 2
        base.alpha_composite(sh, (x + 6, y + 8))
        base.alpha_composite(card, (x, y))
    return base.convert('RGB')


def art():
    pick = lambda name: next(iter(sorted(GEN.glob(f'{name}*.png')) or sorted(GEN.glob(f'{name}*'))), None)
    save(cover(Image.open(PUB / 'geroi/a/brand/title.webp').convert('RGB'), 0.5, 0.62), 'geroi.webp')
    save(cover(Image.open(PUB / 'gops/a/20-brand/title-keyart-1.webp').convert('RGB'), 0.5, 0.42), 'gops.webp')
    # обложка коробки вертикальная — берём верх: лица в грозовом облаке
    save(cover(Image.open(PUB / 'zakoldovannaya/art/cover.webp').convert('RGB'), 0.5, 0.2), 'zakoldovannaya.webp')
    k = Path(os.environ.get('KOMMERSY_ART', '')) if os.environ.get('KOMMERSY_ART') else GEN / 'kommersy-kiosk-222.png'
    if k:
        save(cover(Image.open(k).convert('RGB'), 0.55, 0.5), 'kommersy.webp')
    v = Path(os.environ.get('VKL_BG', '')) if os.environ.get('VKL_BG') else GEN / 'vkladyshi-table-111.png'
    if v:
        save(vkladyshi(Image.open(v).convert('RGB')), 'vkladyshi.webp')
    if (MS_GEN / 'ms-keyart-222.png').exists():
        save(cover(Image.open(MS_GEN / 'ms-keyart-222.png').convert('RGB'), 0.6, 0.5), 'musicstudio.webp')


def studio_ui():
    """Оформление секвенсора Lavochka Music Studio: public/music-studio/ui/ — хром пульта, клубный фон, логотип для шапки."""
    ui = PUB / 'music-studio/ui'
    ui.mkdir(parents=True, exist_ok=True)
    ch = Image.open(MS_GEN / 'ms-chrome-222.png').convert('RGB')
    # середина панели без винтов и краёв; тянется по ширине шапки и библиотеки
    ch = ch.crop((120, 120, ch.width - 120, ch.height - 140)).resize((1200, 300), Image.LANCZOS)
    ch.save(ui / 'chrome.webp', 'WEBP', quality=78, method=6)
    club = Image.open(MS_GEN / 'ms-club-111.png').convert('RGB').resize((1600, 686), Image.LANCZOS)
    club.save(ui / 'club.webp', 'WEBP', quality=70, method=6)
    lg = Image.open(OUT / 'musicstudio-logo.webp')
    fit_h(lg, 120).save(ui / 'logo.webp', 'WEBP', quality=90, method=6)
    for f in ('chrome.webp', 'club.webp', 'logo.webp'):
        print('→', ui / f, Image.open(ui / f).size)


if __name__ == '__main__':
    what = sys.argv[1:] or ['logos', 'art']
    if 'logos' in what:
        logos()
    if 'art' in what:
        art()
    if 'studio' in what or what == ['logos', 'art']:
        studio_ui()
