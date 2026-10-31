"""Звуки через Stable Audio 3 Small SFX (Stability Community License: бесплатно при выручке < $1M — записано в PRODUCTION.md).

G:/ai/venvs/3d/Scripts/python.exe studio/runners/sfx.py <задание.yaml> [--renorm]

--renorm — не генерировать, а заново нормализовать уже готовые .wav (после правки уровней в задании).

Задание:
  out: G:/temp/studio/out/gops/08-sfx
  seeds: [1, 2]
  sounds:
    - name: explosion-small
      duration: 2
      level: loud        # loud / normal / quiet / ui / ambience — целевая громкость (LEVELS)
      max: 1.5           # потолок длины после обрезки, с (иначе — по классу)
      prompt: "..."
Пишет <out>/<имя>-<сид>.wav (сырое), <out>/ogg/<имя>-<сид>.ogg (нормализованное) и manifest.json.
Веса — локальные (G:/ai/models/audio): библиотека сама полезла бы на Hugging Face, а модели Stability из РФ — только через VPN.
"""
import json
import pathlib
import subprocess
import sys

import numpy as np
import soundfile as sf
import yaml
from stable_audio_3.loading_utils import load_diffusion_cond
from stable_audio_3.model import StableAudioModel

MODEL = pathlib.Path('G:/ai/models/audio/stable-audio-3-small-sfx')
FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
# класс → (RMS самого громкого окна 300 мс, dBFS; потолок длины, с)
LEVELS = {
    'loud': (-12, 3.5),      # взрывы
    'normal': (-16, 1.5),    # выстрелы, удары, броски, всплески
    'quiet': (-20, 1.2),     # шаги, шорохи, голуби
    'ui': (-20, 0.4),        # интерфейс
    'ambience': (-28, 8.0),  # фоновые петли
}
PEAK = 10 ** (-1 / 20)  # потолок пика −1 dBFS


def normalize(a, sr, level, max_len=None):
    """Обрезка тишины относительно пика, потолок длины, плавные края, громкость по классу."""
    if a.ndim == 1:
        a = a[:, None]
    env = np.abs(a).max(axis=1)
    pk = env.max() or 1.0
    loud = np.where(env > pk * 10 ** (-40 / 20))[0]
    a = a[max(0, loud[0] - int(0.005 * sr)):] if len(loud) else a
    env = np.abs(a).max(axis=1)
    tail = np.where(env > pk * 10 ** (-50 / 20))[0]
    end = max(tail[-1] + int(0.02 * sr), int(0.12 * sr)) if len(tail) else len(a)
    target, cap = LEVELS[level]
    a = a[:min(end, int((max_len or cap) * sr))].copy()
    fi, fo = int(0.003 * sr), min(int(0.06 * sr), len(a) // 3)
    a[:fi] *= np.linspace(0, 1, fi)[:, None]
    a[-fo:] *= np.linspace(1, 0, fo)[:, None]
    win = max(1, int(0.3 * sr))
    sq = np.convolve((a ** 2).mean(axis=1), np.ones(win) / win, mode='valid') if len(a) > win else [(a ** 2).mean()]
    rms = np.sqrt(np.max(sq)) or 1e-6
    gain = min(10 ** (target / 20) / rms, PEAK / (np.abs(a).max() or 1e-6))
    return a * gain


def encode(wav, ogg, level, max_len):
    a, sr = sf.read(wav)
    tmp = ogg.with_suffix('.norm.wav')
    sf.write(tmp, normalize(a, sr, level, max_len), sr)
    subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(tmp), '-c:a', 'libopus', '-b:a', '64k', str(ogg)], check=True)
    tmp.unlink()


def load():
    cfg = json.loads((MODEL / 'model_config.json').read_text(encoding='utf-8'))
    for c in cfg['model']['conditioning']['configs']:
        if c['type'] == 't5gemma':
            c['config']['model_path'] = str(MODEL)  # + subfolder t5gemma-b-b-ul2 из конфига
    model = load_diffusion_cond(cfg, str(MODEL / 'model.safetensors'), device='cuda', model_half=True)
    model.use_lora = False
    model.lora_names = []
    return StableAudioModel(model, cfg, 'cuda', True), cfg['sample_rate']


def main():
    job = yaml.safe_load(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
    out = pathlib.Path(job['out'])
    (out / 'ogg').mkdir(parents=True, exist_ok=True)
    if '--renorm' in sys.argv:
        for s in job['sounds']:
            for seed in s.get('seeds', job.get('seeds', [1])):
                encode(out / f"{s['name']}-{seed}.wav", out / 'ogg' / f"{s['name']}-{seed}.ogg", s.get('level', 'normal'), s.get('max'))
        print('перенормализовано:', out / 'ogg')
        return
    model, sr = load()
    manifest = []
    for s in job['sounds']:
        for seed in s.get('seeds', job.get('seeds', [1])):
            audio = model.generate(prompt=s['prompt'], duration=s.get('duration', 2), seed=seed)
            wav = out / f"{s['name']}-{seed}.wav"
            sf.write(wav, audio[0].cpu().numpy().T, sr)
            encode(wav, out / 'ogg' / f"{s['name']}-{seed}.ogg", s.get('level', 'normal'), s.get('max'))
            manifest.append({'file': wav.name, 'prompt': s['prompt'], 'seed': seed, 'model': 'Stable Audio 3 Small SFX', 'license': 'Stability Community (< $1M)'})
            print('готово', wav.name, flush=True)
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
