import sys, glob, os
from PIL import Image, ImageDraw
d = sys.argv[1]; out = sys.argv[2]; pat = sys.argv[3] if len(sys.argv) > 3 else '[0-9][0-9].png'
fs = sorted(glob.glob(os.path.join(d, pat)))
T = 170
cols = 9
sh = Image.new('RGB', (cols * T, ((len(fs) + cols - 1) // cols) * (T + 16)), (90, 120, 90))
dr = ImageDraw.Draw(sh)
for k, f in enumerate(fs):
    im = Image.open(f).convert('RGBA'); im.thumbnail((T - 6, T - 6))
    x = (k % cols) * T; y = (k // cols) * (T + 16)
    bgc = Image.new('RGBA', (T - 4, T - 4), (250, 248, 240, 255)); bgc.alpha_composite(im, ((T - 4 - im.width) // 2, (T - 4 - im.height) // 2))
    sh.paste(bgc.convert('RGB'), (x + 2, y + 2)); dr.text((x + 4, y + T), os.path.basename(f), fill=(255, 255, 255))
sh.save(out)
