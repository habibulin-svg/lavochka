"""Коммерсы: отобранное с выхода конвейера → lavochka/public/kommersy/a/ (WebP, LFS).

Отбор — studio/bible/kolyan.md. Панорамы 1600×800; портреты — ключ по хромакею (зелёный → прозрачный), 512×512.
  G:/ai/ComfyUI/venv/Scripts/python.exe -I studio/post/pack_kommersy.py
"""
import pathlib

import numpy as np
from PIL import Image

OUT = pathlib.Path(__file__).resolve().parents[2] / 'lavochka/public/kommersy/a'
SRC = pathlib.Path('G:/temp/studio/out/kommersy')

PANO = {
    'dvor-soviet': ['1-222', '2-111', '3-111'], 'dvor-wild': ['1-111', '2-111', '3-111'],
    'kiosk-soviet': ['1-111', '2-111', '3-222'], 'kiosk-wild': ['1-111', '2-111', '3-111'],
    'bazar-wild': ['1-111', '2-111', '3-111'], 'bazar-new': ['1-111', '2-222', '3-111'],
    'center-wild': ['1-111', '2-111', '3-111'], 'center-new': ['1-111', '2-222', '3-111'],
    'oblast-wild': ['1-111', '2-111', '3-111'], 'oblast-new': ['1-111', '2-111', '3-222'],
    'moscow-new': ['1-111', '2-222', '3-111'], 'london-new': ['1-222', '2-111', '3-111'],
}
KOLYAN = {'1988': '01-concepts/kolyan-1988-demb-22', '1990': '01-concepts/kolyan-1990-coop-66', '1993': '03-kolyan-looks/1993-leather-22',
          '1996': '03-kolyan-looks/1996-blazer-33', '2003': '03-kolyan-looks/2003-suit-33'}
NPC = ['mother', 'girl', 'brigadir', 'byk', 'oper', 'uchastkovy', 'nalogovik', 'chinovnik', 'bankir', 'direktor', 'chelnochnitsa', 'konkurent', 'zhurnalist', 'reshala', 'yurist', 'drug']


def key(img: Image.Image) -> Image.Image:
    """Хромакей: насколько зелёный перевешивает красный и синий — настолько прозрачно; зелёный ореол гасим."""
    a = np.asarray(img.convert('RGB')).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    spill = g - np.maximum(r, b)
    alpha = np.clip(1 - (spill - 18) / 40, 0, 1)
    g2 = np.minimum(g, np.maximum(r, b) + 8)
    rgba = np.dstack([r, np.where(alpha < 1, g2, g), b, alpha * 255]).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')


def main():
    (OUT / 'pano').mkdir(parents=True, exist_ok=True)
    (OUT / 'people').mkdir(parents=True, exist_ok=True)
    for place, parts in PANO.items():
        for i, p in enumerate(parts, 1):
            part, seed = p.split('-')
            Image.open(SRC / '04-panoramas' / f'{place}-{part}-{seed}.png').convert('RGB').resize((1600, 800), Image.LANCZOS).save(OUT / 'pano' / f'{place}-{i}.webp', quality=80)
    for year, src in KOLYAN.items():
        key(Image.open(SRC / f'{src}.png')).resize((512, 512), Image.LANCZOS).save(OUT / 'people' / f'kolyan-{year}.webp', quality=85)
    for n in NPC:
        seed = '22' if n == 'nalogovik' else '11'
        key(Image.open(SRC / '05-npc' / f'{n}-{seed}.png')).resize((512, 512), Image.LANCZOS).save(OUT / 'people' / f'{n}.webp', quality=85)
    print('готово', sum(1 for _ in OUT.rglob('*.webp')), 'файлов,', round(sum(f.stat().st_size for f in OUT.rglob('*.webp')) / 1e6, 1), 'МБ')


main()
