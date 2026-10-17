"""Корпус автомата «15 копеек» из фото пользователя (синий автомат ТИА-МЦ-1 «Конёк-Горбунок», снимок спереди):
рамка экрана (верх кинескопа на снимке срезан — достраиваем отражением низа), табличка, пульт с кнопками и монетоприёмником.
python tools/avtomaty/cabinet.py  (из lavochka/; фото — ../materials/avtomaty-photos/cab-front.jpg)"""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np, json

SRC = '../materials/avtomaty-photos/cab-front.jpg'
OUT = 'public/avtomaty/cab/'
im = Image.open(SRC).convert('RGB')
rot = im.rotate(2.9, resample=Image.BICUBIC)  # снимок завален на ~3°

# ---- рамка экрана: строки 180…700 как есть, сверху — отражение строк 180…502
X0, X1 = 112, 958
MID, PAN = 180, 503
low = rot.crop((X0, MID, X1, 700))
top = rot.crop((X0, MID, X1, PAN)).transpose(Image.FLIP_TOP_BOTTOM)
H = top.height + low.height
bez = Image.new('RGB', (X1 - X0, H))
bez.paste(top, (0, 0)); bez.paste(low, (0, top.height))
TRIM = 40  # над резинкой оставляем полоску панели
bez = bez.crop((0, TRIM, bez.width, H))
# шов посередине стекла — под экраном, не виден; стекло (внутренний край резинки)
# стекло — по внутренней кромке резинки (замерено по готовой рамке)
gl = (141, 60, 723, 505)
plate_in = (232 - X0, top.height + (523 - MID) - TRIM, 873 - X0, top.height + (633 - MID) - TRIM)
# прозрачное окно под экран (скругление как у резинки)
a = Image.new('L', bez.size, 255)
ImageDraw.Draw(a).rounded_rectangle(gl, radius=40, fill=0)
a = a.filter(ImageFilter.GaussianBlur(1.2))
bezA = bez.copy(); bezA.putalpha(a)
bezA.save(OUT + 'bezel-konek.webp', quality=88)
# табличка без текста — для остальных игр (цвет — медиана таблички)
arr = np.asarray(bez.crop(plate_in)).reshape(-1, 3)
col = tuple(int(v) for v in np.median(arr, axis=0))
blank = bez.copy()
ImageDraw.Draw(blank).rectangle(plate_in, fill=col)
blank.putalpha(a)
blank.save(OUT + 'bezel.webp', quality=88)

# ---- пульт: левая коробка с кнопками, правая с монетоприёмником; стену вырезаем по цвету
deck = im.crop((0, 915, 1080, 1165))
# отражение стены в глянцевой крышке левой коробки — притушить
dk = deck.copy()
shade = Image.new('L', deck.size, 0)
ImageDraw.Draw(shade).polygon([(0, 40), (105, 8), (140, 8), (120, 136), (0, 136)], fill=255)
deck = Image.composite(Image.eval(dk, lambda v: int(v * 0.22)), dk, shade.filter(ImageFilter.GaussianBlur(6)))
# контур коробок (стена сверху слева и над правой коробкой, пол под левой — прозрачные)
poly = [(8, 60), (30, 46), (100, 12), (480, 0), (850, 0), (862, 14), (1080, 14), (1080, 250), (8, 250)]
alI = Image.new('L', deck.size, 0)
ImageDraw.Draw(alI).polygon(poly, fill=255)
alI = alI.filter(ImageFilter.GaussianBlur(1))
deckA = deck.copy(); deckA.putalpha(alI)
deckA.save(OUT + 'deck.webp', quality=88)

json.dump({
  'bezel': {'w': bez.width, 'h': bez.height, 'glass': gl, 'plate': plate_in, 'plateColor': '#%02x%02x%02x' % col},
  'deck': {'w': deck.width, 'h': deck.height,
           'buttons': [[190, 975 - 915, 46], [357, 970 - 915, 46]],
           'stick': [458, 82], 'coin': [975, 1110 - 915, 44]},
}, open(OUT + 'layout.json', 'w'), indent=1)
print('ok', bez.size, deck.size, col)
