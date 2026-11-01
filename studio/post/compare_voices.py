"""Сравнение двух озвучек реплик (Chatterbox и Qwen3-TTS) на слух: по файлу на голосовой набор,
в нём несколько фраз парами «A — первая озвучка, пауза, B — вторая», между парами пауза подлиннее.

python studio/post/compare_voices.py <озвучка A> <озвучка B> <выход> [--keys hit_enemy,miss,hurt_big] [--take 1]
Озвучки — папки с manifest.json и <набор>/ogg/ (runners/tts.py, runners/tts_qwen.py). Выход: <набор>.ogg + список.txt с текстами.
"""
import argparse
import json
import pathlib
import subprocess
import tempfile

FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('a')
    ap.add_argument('b')
    ap.add_argument('out')
    ap.add_argument('--keys', default='turn_start,hit_enemy,hurt_big')
    ap.add_argument('--take', type=int, default=1)
    args = ap.parse_args()
    a, b, out = pathlib.Path(args.a), pathlib.Path(args.b), pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    man_b = json.loads((b / 'manifest.json').read_text(encoding='utf-8'))
    have_b = {m['file'] for m in man_b}
    text = {m['file']: m['text'] for m in man_b}
    keys = args.keys.split(',')
    sets = sorted({m['set'] for m in man_b})
    notes = []
    with tempfile.TemporaryDirectory(dir='G:/temp') as tmp:
        short = pathlib.Path(tmp) / 'short.wav'
        long = pathlib.Path(tmp) / 'long.wav'
        for f, d in ((short, 0.5), (long, 1.2)):
            subprocess.run([FFMPEG, '-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', str(d), str(f)], check=True)
        for s in sets:
            parts = []
            notes.append(f'== {s}')
            for key in keys:
                file = f'{s}/{key}-01-{args.take}.wav'
                ogg = f'{key}-01-{args.take}.ogg'
                pa, pb = a / s / 'ogg' / ogg, b / s / 'ogg' / ogg
                if file not in have_b or not pa.exists() or not pb.exists():
                    continue
                parts += [pa, short, pb, long]
                notes.append(f'  {key}: {text[file]}')
            if not parts:
                continue
            lst = pathlib.Path(tmp) / f'{s}.txt'
            # ffmpeg concat требует одинаковый формат — перегоняем всё в wav 48 кГц моно
            wavs = []
            for i, p in enumerate(parts):
                w = pathlib.Path(tmp) / f'{s}-{i}.wav'
                subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(p), '-ar', '48000', '-ac', '1', str(w)], check=True)
                wavs.append(w)
            lst.write_text(''.join(f"file '{w.as_posix()}'\n" for w in wavs), encoding='utf-8')
            subprocess.run([FFMPEG, '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst), '-c:a', 'libopus', '-b:a', '64k',
                            str(out / f'{s}.ogg')], check=True)
            print('готово', s, flush=True)
    (out / 'список.txt').write_text('В каждой паре сначала A, потом B.\n' + '\n'.join(notes) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
