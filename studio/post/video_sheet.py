"""Лист для выбора роликов: по строке на ролик — четыре кадра (начало, ⅓, ⅔, конец) и подпись.

python studio/post/video_sheet.py G:/temp/studio/out/gops/25-videos [--cell 200]
Пишет <партия>/sheet.jpg. Кадры достаёт ffmpeg из G:/ai/ffmpeg.
"""
import argparse
import pathlib
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont

FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
FFPROBE = 'G:/ai/ffmpeg/bin/ffprobe.exe'


def frames(path: pathlib.Path, n: int = 4):
    dur = float(subprocess.run([FFPROBE, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                               capture_output=True, text=True).stdout.strip() or 1)
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(n):
            t = dur * i / (n - 1) * 0.97
            subprocess.run([FFMPEG, '-v', 'error', '-y', '-ss', f'{t:.2f}', '-i', str(path), '-frames:v', '1',
                            f'{tmp}/{i}.png'], check=False)
            p = pathlib.Path(tmp) / f'{i}.png'
            if p.exists():
                yield Image.open(p).convert('RGB').copy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dir')
    ap.add_argument('--cell', type=int, default=200)
    a = ap.parse_args()
    d = pathlib.Path(a.dir)
    vids = sorted(d.glob('*.mp4'))
    if not vids:
        return
    h = a.cell
    rows = []
    for v in vids:
        ims = [im.resize((round(im.width * h / im.height), h)) for im in frames(v)]
        rows.append((v.stem, ims))
    w = max(sum(im.width for im in ims) for _, ims in rows) + 4 * 4
    sheet = Image.new('RGB', (w, len(rows) * (h + 26)), (24, 24, 28))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 16)
    except OSError:
        font = ImageFont.load_default()
    y = 0
    for name, ims in rows:
        draw.text((4, y + 4), name, fill=(230, 230, 230), font=font)
        x = 0
        for im in ims:
            sheet.paste(im, (x, y + 24))
            x += im.width + 4
        y += h + 26
    sheet.save(d / 'sheet.jpg', quality=85)
    print('лист:', d / 'sheet.jpg')


if __name__ == '__main__':
    main()
