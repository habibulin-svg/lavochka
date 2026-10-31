"""Звуки через Stable Audio 3 Small SFX (Stability Community License: бесплатно при выручке < $1M — записано в PRODUCTION.md).

G:/ai/venvs/3d/Scripts/python.exe studio/runners/sfx.py <задание.yaml>

Задание:
  out: G:/temp/studio/out/gops/08-sfx
  seeds: [1, 2]
  sounds:
    - name: explosion-small
      duration: 2
      prompt: "..."
Пишет <out>/<имя>-<сид>.wav, <out>/ogg/<имя>-<сид>.ogg (тишина обрезана, громкость выровнена) и manifest.json.
Веса — локальные (G:/ai/models/audio): библиотека сама полезла бы на Hugging Face, а модели Stability из РФ — только через VPN.
"""
import json
import pathlib
import subprocess
import sys

import soundfile as sf
import yaml
from stable_audio_3.loading_utils import load_diffusion_cond
from stable_audio_3.model import StableAudioModel

MODEL = pathlib.Path('G:/ai/models/audio/stable-audio-3-small-sfx')
FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
# обрезать тишину в начале и конце, выровнять громкость
TRIM = ('silenceremove=start_periods=1:start_threshold=-50dB,areverse,'
        'silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-16:TP=-1.5')


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
    model, sr = load()
    manifest = []
    for s in job['sounds']:
        for seed in s.get('seeds', job.get('seeds', [1])):
            audio = model.generate(prompt=s['prompt'], duration=s.get('duration', 2), seed=seed)
            wav = out / f"{s['name']}-{seed}.wav"
            sf.write(wav, audio[0].cpu().numpy().T, sr)
            ogg = out / 'ogg' / f"{s['name']}-{seed}.ogg"
            subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(wav), '-af', TRIM, '-c:a', 'libopus', '-b:a', '64k', str(ogg)], check=True)
            manifest.append({'file': wav.name, 'prompt': s['prompt'], 'seed': seed, 'model': 'Stable Audio 3 Small SFX', 'license': 'Stability Community (< $1M)'})
            print('готово', wav.name, flush=True)
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
