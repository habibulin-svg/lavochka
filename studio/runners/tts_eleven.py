"""Озвучка реплик: ElevenLabs v4 через RouterAI (решение пользователя 2026-11-11, вместо Qwen3-TTS). Один дубль.

python -X utf8 studio/runners/tts_eleven.py <stress.json> <выход> [--sets sipliy,kolyan] [--only ключ] [--jobs 4]

<stress.json> — выход studio/post/stress.py (поле say — текст для озвучки с заменами).
Ударение знаком U+0301 ставится только в словах, проверенных пользователем (studio/voices/stress-fixes.json → words):
остальное ElevenLabs читает сам, а «+» он не понимает.
Выход: <выход>/<набор>/<ситуация>-NN.mp3 (сырой) и .ogg (Opus 64k, −16 LUFS, тишина срезана — как у Qwen).
Готовое не пересчитывается. Ключ — «Ключ RouterAI» из КЛЮЧИ.txt. Цена — 8606 ₽ за 1 млн символов.
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parents[2]
FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
URL = 'https://routerai.ru/api/v1/audio/speech'
MODEL = 'elevenlabs/eleven-v4'

# Голоса — выбор пользователя 2026-11-11 по пробам (русские голоса библиотеки ElevenLabs).
VOICES = {
    'sipliy': '2Zst4rvX5S2nMbiauLDN',       # Arty Grumson — хриплый, спокойный
    'intelligent': 'lxY8Pn0yWs1Ve9rBceah',  # Ivan Nazarov — мягкий, неторопливый
    'batya': 'RGy9Pi4dN4jZx6BL6lef',        # Tsar — глубокий
    'sibiryak': 'Vl27Cllkuw8BhyPqus2n',     # VASKO — низкий, тёплый
    'botan': 'u3pPktIMgx1Kt5EJ391v',        # Dimitri — молодой, бодрый
    'maloy': 'rSfuQoQ3FY8SVKeraMAp',        # Lunya — «Little Fairy»
    'kolyan': '6A9D8WSMm4rFsg2DWFeE',       # Egor Gadzhiyev — чёткий, командный
}
AF = ('silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,'
      'areverse,loudnorm=I=-16:TP=-1.5:LRA=7')
V = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ'


def key():
    t = (ROOT / 'КЛЮЧИ.txt').read_text(encoding='utf-8')
    return re.search(r'Ключ RouterAI.*?\n\s*(sk-[\w-]+)', t, re.S).group(1)


def acute(text, words):
    """Слова из поправок пользователя — с ударением U+0301 после ударной гласной."""
    def w(m):
        x = m.group(0)
        fix = words.get(x.lower())
        if not fix:
            return x
        i = fix.index('+')  # «+» стоит перед ударной гласной: её индекс в слове = индекс «+»
        return x[:i + 1] + '\u0301' + x[i + 1:]
    return re.sub(r'[а-яёА-ЯЁ]+(?:-[а-яёА-ЯЁ]+)*', w, text)


def synth(k, text, voice, out):
    body = json.dumps({'model': MODEL, 'input': text, 'voice': voice, 'response_format': 'mp3'}).encode()
    req = urllib.request.Request(URL, data=body, headers={'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json'})
    for attempt in range(3):
        try:
            out.write_bytes(urllib.request.urlopen(req, timeout=120).read())
            return
        except urllib.error.HTTPError as e:
            err = e.read()[:300].decode(errors='replace')
            if e.code < 500 and e.code != 429:
                raise RuntimeError(f'{e.code} {err}')
        except OSError as e:
            err = str(e)
    raise RuntimeError(err)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('stress')
    ap.add_argument('out')
    ap.add_argument('--sets')
    ap.add_argument('--only')
    ap.add_argument('--jobs', type=int, default=4)
    a = ap.parse_args()
    lines = json.loads(pathlib.Path(a.stress).read_text(encoding='utf-8'))
    words = json.loads((ROOT / 'studio/voices/stress-fixes.json').read_text(encoding='utf-8'))['words']
    sets = set(a.sets.split(',')) if a.sets else None
    k = key()
    todo = []
    for name, v in lines.items():
        s, phrase = name.split('/')
        if (sets and s not in sets) or (a.only and not phrase.startswith(a.only)):
            continue
        d = pathlib.Path(a.out) / s
        d.mkdir(parents=True, exist_ok=True)
        if not (d / f'{phrase}.ogg').exists():
            todo.append((s, phrase, acute(v['say'], words), d))
    chars = sum(len(t) for _, _, t, _ in todo)
    print(f'реплик {len(todo)}, символов {chars}, ≈{chars * 8606 / 1e6:.0f} ₽', flush=True)

    def one(job):
        s, phrase, text, d = job
        mp3 = d / f'{phrase}.mp3'
        try:
            if not mp3.exists():
                synth(k, text, VOICES[s], mp3)
            subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(mp3), '-af', AF, '-ar', '48000', '-c:a', 'libopus',
                            '-b:a', '64k', str(d / f'{phrase}.ogg')], check=True)
            return f'ok {s}/{phrase}'
        except Exception as e:  # noqa: BLE001 — доложить и идти дальше
            return f'FAIL {s}/{phrase}: {e}'

    fails = 0
    with ThreadPoolExecutor(a.jobs) as ex:
        for i, r in enumerate(ex.map(one, todo), 1):
            if r.startswith('FAIL'):
                fails += 1
                print(r, flush=True)
            elif i % 50 == 0:
                print(f'{i}/{len(todo)}', flush=True)
    print(f'готово, ошибок {fails}')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
