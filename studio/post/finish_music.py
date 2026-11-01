"""Доводка музыки YuE2 до игрового вида: концовка, громкость, Opus.

python studio/post/finish_music.py <папка с flac> <папка библиотеки>

YuE2 часто упирается в max_duration и обрывает трек на громком месте — такие треки (длина = одному из
пределов) гасим затуханием FADE_CUT секунд, остальные — коротким FADE_END от щелчка. Громкость — двухпроходный
loudnorm до −14 LUFS, пик −1 dBTP (studio/bible/audio.md). Выход — Opus 96k, имена «<ситуация>-NN.ogg»
по SITUATIONS (варианты стиля «-b» — та же ситуация), список с источниками — sources.json.
"""
import json
import pathlib
import re
import subprocess
import sys

FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
FFPROBE = 'G:/ai/ffmpeg/bin/ffprobe.exe'
FADE_CUT = 3.0
FADE_END = 0.3
JINGLE_FADE = 1.5
LIMITS = (130, 120, 90, 20, 15)
SITUATIONS = {  # имя в задании → имя в библиотеке
    'menu': 'menu', 'menu-b': 'menu',
    'team-select': 'brigade-select',
    'calm': 'battle-calm',
    'battle': 'battle', 'battle-b': 'battle',
    'sudden-death': 'sudden-death',
    'timed': 'time-attack',
    'victory': 'victory', 'defeat': 'defeat',
}
JINGLES = {'victory', 'defeat'}


def duration(path):
    out = subprocess.run([FFPROBE, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(out)


def measure(path, pre):
    err = subprocess.run([FFMPEG, '-hide_banner', '-i', str(path), '-af',
                          pre + 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    return json.loads(err[err.rindex('{'):err.rindex('}') + 1])


def main():
    src, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)
    counters, sources = {}, []
    for f in sorted(src.glob('*.flac')):
        job, seed = re.fullmatch(r'(.+)-(\d+)', f.stem).groups()
        sit = SITUATIONS[job]
        d = duration(f)
        cut = any(abs(d - lim) < 0.05 for lim in LIMITS)
        fade = JINGLE_FADE if sit in JINGLES else FADE_CUT if cut else FADE_END
        pre = f'afade=t=out:st={d - fade:.3f}:d={fade},'
        m = measure(f, pre)
        norm = (f"loudnorm=I=-14:TP=-1:LRA=11:linear=true:measured_I={m['input_i']}:measured_TP={m['input_tp']}"
                f":measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}")
        counters[sit] = counters.get(sit, 0) + 1
        name = f'{sit}-{counters[sit]:02d}.ogg'
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(f), '-af', pre + norm, '-ar', '48000',
                        '-c:a', 'libopus', '-b:a', '96k', str(dst / name)], check=True)
        sources.append({'file': name, 'source': f.name, 'seconds': round(d, 1), 'cut_at_limit': cut, 'fade': fade})
        print(name, '←', f.name, f'{d:.0f}с', 'обрыв→затухание' if cut else '', flush=True)
    (dst / 'sources.json').write_text(json.dumps(sources, ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
