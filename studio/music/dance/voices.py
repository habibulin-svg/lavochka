"""Выкрики и рэп кита «Dance With Me!» (группа rap): ElevenLabs v4 через RouterAI (studio/runners/tts_eleven.py) → сетка.

Каждый выкрик: обрезка тишины, начало ровно на доле, лёгкий дилей на точку и реверб, длина — 1, 2 или 4 такта
(самая короткая, куда влезает; длинный рэп слегка ужимается по времени). Часть выкриков — ещё и в версии Echo
(дилей на 3/8 с длинным хвостом, 2 такта). Сырьё — G:/temp/studio/out/music-studio/voices-raw (готовое не
перезаказывается). Строки голосов в manifest.json кита заменяются.

G:/ai/venvs/music/Scripts/python.exe studio/music/dance/voices.py [--bpm 128,140]
"""
import argparse
import json
import pathlib
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import librosa
import numpy as np
import soundfile as sf
from pedalboard import Compressor, Delay, HighpassFilter, Pedalboard, Reverb

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'studio/runners'))
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import tts_eleven  # noqa: E402
from build import OUT, slug  # noqa: E402
from render import SR, loudnorm  # noqa: E402

RAW = pathlib.Path('G:/temp/studio/out/music-studio/voices-raw')
V = ['kolyan', 'botan', 'intelligent', 'sipliy', 'batya', 'sibiryak', 'maloy']
SHOUTS_EN = ['Come on!', 'Hands up!', "Let's go!", 'Jump! Jump!', 'Dance with me!', 'Everybody!', 'Party people!',
             'Put your hands up!', 'Here we go!', 'Yeah!', 'Oh yeah!', 'Welcome to the house!', 'Here I am!',
             'Clap your hands!', 'Feel the beat!', 'Pump up the volume!', 'Move your body!', 'Can you feel it?',
             'Get down!', 'Turn it up!', 'Louder!', 'One more time!', 'Check it out!', 'Are you ready?',
             'Let me hear you say yeah!', 'Bring it on!', 'Rock the house!', 'Dance!', 'Party!', 'Music!', 'Freeze!',
             'Go, go, go!', 'All right!', 'Wow!', 'Everybody dance now!', 'Feel the rhythm!', 'Keep on moving!',
             'Higher!', 'Let the music play!', 'Stop!', 'One, two, three, four!', 'Say what?', 'Turn the lights down!',
             'In the house!', 'Make some noise!']
SHOUTS_RU = ['Давай, давай!', 'Дискотека!', 'Все на танцпол!', 'Руки вверх!', 'Громче!', 'Танцуют все!', 'Поехали!',
             'Эй, двор!', 'Вечером на лавочке!', 'Музыка!', 'Ещё раз!', 'Раз, два, три!', 'Не стоим!', 'Качает!',
             'Зажигай!', 'Вот это ритм!', 'Девчонки, где вы?', 'Пацаны, вперёд!', 'Все сюда!', 'Ну-ка, дружно!', 'Выше!',
             'Хлопаем!', 'Всем привет!', 'Стоп, музыка!', 'Танцуем до утра!', 'Включай погромче!', 'Ай да мы!']
RAPS = [
    "I got the rhythm, I got the flow, come on everybody, let's go!",
    'Bass is pumping, crowd is jumping, everybody in the house is moving.',
    "From the left to the right, we're gonna party all night!",
    'Hands in the air, wave them like you just don\'t care!',
    'Turn up the music, turn down the light, this is the place to be tonight!',
    'Это лавочка, это наш район, громче музыка — мы зажигаем в нём!',
    'Двор не спит, колонки гремят, танцуют все — и стар, и млад!',
    'Вечер, лето, магнитофон, весь подъезд выходит вон!',
    'Кассета крутится, бас качает, кто не танцует — тот скучает!',
    'Раз-два, раз-два, это дискотека, громче, громче — для каждого человека!',
]
ECHO = {'Come on!', 'Hands up!', "Let's go!", 'Here we go!', 'Yeah!', 'Everybody!', 'Dance!', 'Party!', 'Music!',
        'Higher!', 'Louder!', 'Freeze!', 'Wow!', 'Stop!', 'Давай, давай!', 'Дискотека!', 'Руки вверх!', 'Громче!',
        'Зажигай!', 'Качает!', 'Поехали!', 'Эй, двор!'}

TRANSLIT = str.maketrans({'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z',
                          'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r',
                          'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
                          'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'})


def title(text, rap=False):
    """Имя сэмпла латиницей (как в Dance eJay): «Давай, давай!» → «Davay Davay»."""
    t = text.lower().translate(TRANSLIT)
    words = ''.join(c if c.isalnum() or c in " '" else ' ' for c in t).split()
    if rap:
        words = words[:4]
    return ' '.join(w.capitalize() for w in words).replace("'", '')


def lines():
    out = []
    for i, t in enumerate(SHOUTS_EN):
        out.append((title(t), V[i % len(V)], t, 'shout'))
    for i, t in enumerate(SHOUTS_RU):
        out.append((title(t), V[(i + 3) % len(V)], t, 'shout'))
    for i, t in enumerate(RAPS):
        out.append(('Rap ' + title(t, True), V[(i * 2) % 6], t, 'rap'))
    names = [x[0] for x in out]
    assert len(names) == len(set(names)), [n for n in names if names.count(n) > 1]
    return out


def fetch(ls):
    k = tts_eleven.key()
    RAW.mkdir(parents=True, exist_ok=True)
    todo = [x for x in ls if not (RAW / f'{slug(x[0])}.wav').exists()]
    print(f'заказ {len(todo)} строк, {sum(len(x[2]) for x in todo)} знаков', flush=True)

    def one(x):
        name, voice, text, _ = x
        mp3 = RAW / f'{slug(name)}.mp3'
        if not mp3.exists():
            tts_eleven.synth(k, text, tts_eleven.VOICES[voice], mp3)
        subprocess.run([tts_eleven.FFMPEG, '-y', '-loglevel', 'error', '-i', str(mp3), '-af',
                        'silenceremove=start_periods=1:start_threshold=-40dB,areverse,'
                        'silenceremove=start_periods=1:start_threshold=-40dB,areverse',
                        '-ar', str(SR), '-ac', '1', str(RAW / f'{slug(name)}.wav')], check=True)
        return name
    with ThreadPoolExecutor(4) as ex:
        for n in ex.map(one, todo):
            print('tts', n, flush=True)


def place(y, bpm, echo=False):
    beat = 60 / bpm
    bar = 4 * beat
    dur = len(y) / SR
    bars = next((b for b in (1, 2, 4) if dur <= b * bar * 0.92), 4)
    if dur > 4 * bar * 0.92:  # длинный рэп ужимаем по времени
        y = librosa.effects.time_stretch(y, rate=dur / (4 * bar * 0.9))
    if echo:
        bars = max(bars, 2)
    n = int(round(bars * bar * SR))
    a = np.zeros((2, n + 2 * SR), np.float32)
    a[:, :len(y)] = y
    chain = [HighpassFilter(120), Compressor(-20, 4, 2, 80)]
    chain += [Delay(beat * 0.75, 0.55, 0.45), Reverb(0.6, 0.5, 0.25, 0.8, 1.0)] if echo else \
        [Delay(beat * 0.75, 0.25, 0.18), Reverb(0.4, 0.5, 0.15, 0.9, 0.8)]
    a = Pedalboard(chain)(a, SR)[:, :n]
    f8 = int(0.01 * SR)
    a[:, -f8:] *= np.linspace(1, 0, f8)
    return loudnorm(a, -16), bars


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bpm', default='128,140')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    ls = lines()
    fetch(ls)
    for bpm in [int(x) for x in a.bpm.split(',')]:
        d = OUT / str(bpm)
        mf = d / 'manifest.json'
        man = [e for e in json.loads(mf.read_text(encoding='utf-8')) if e['group'] != 'rap']
        for name, voice, text, kind in ls:
            y, _ = sf.read(RAW / f'{slug(name)}.wav', dtype='float32')
            lang = 'ru' if any('а' <= c <= 'я' for c in text.lower()) else 'en'
            for echo in ((False, True) if text in ECHO else (False,)):
                nm = name + (' Echo' if echo else '')
                out, bars = place(y, bpm, echo)
                f = d / 'rap' / f'{slug(nm)}.wav'
                f.parent.mkdir(parents=True, exist_ok=True)
                sf.write(f, out.T, SR, subtype='PCM_16')
                man.append(dict(group='rap', name=nm, bars=bars, loop=False, chord=None, family=None, theme=name,
                                style=None, text=text, voice=voice, lang=lang, kind=kind, file=f'rap/{slug(nm)}.wav'))
        mf.write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding='utf-8')
        print(bpm, 'выкриков', sum(e['group'] == 'rap' for e in man))


if __name__ == '__main__':
    main()
