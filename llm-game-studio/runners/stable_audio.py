"""Звуки и короткая музыка: Stable Audio 3 Small (SFX / Music), нормализация громкости по классам.

Единица: name, prompt, duration (с), seed, level (loud/normal/quiet/ui/ambience), max (потолок длины, с).
Выход: <key>.wav (сырое) + <key>.ogg (нормализованное, Opus 64k).
Нужны: torch, numpy, soundfile, stable_audio_3 (пакет авторов). Лицензия: Stability Community (< $1M выручки).
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import _lgs  # noqa: E402

LEVELS = {'loud': (-12, 3.5), 'normal': (-16, 1.5), 'quiet': (-20, 1.2), 'ui': (-20, 0.4), 'ambience': (-28, 600.0),
          'music': (-16, 600.0)}
PEAK = 10 ** (-1 / 20)


def normalize(np, a, sr, level, max_len=None):
    if a.ndim == 1:
        a = a[:, None]
    env = np.abs(a).max(axis=1)
    pk = env.max() or 1.0
    loud = np.where(env > pk * 10 ** (-40 / 20))[0]
    a = a[max(0, loud[0] - int(0.005 * sr)):] if len(loud) else a
    env = np.abs(a).max(axis=1)
    tail = np.where(env > pk * 10 ** (-50 / 20))[0]
    end = max(tail[-1] + int(0.02 * sr), int(0.12 * sr)) if len(tail) else len(a)
    target, cap = LEVELS.get(level, LEVELS['normal'])
    a = a[:min(end, int((max_len or cap) * sr))].copy()
    fi, fo = int(0.003 * sr), min(int(0.06 * sr), len(a) // 3)
    a[:fi] *= np.linspace(0, 1, fi)[:, None]
    a[-fo:] *= np.linspace(1, 0, fo)[:, None]
    win = max(1, int(0.3 * sr))
    sq = np.convolve((a ** 2).mean(axis=1), np.ones(win) / win, mode='valid') if len(a) > win else [(a ** 2).mean()]
    rms = np.sqrt(np.max(sq)) or 1e-6
    return a * min(10 ** (target / 20) / rms, PEAK / (np.abs(a).max() or 1e-6))


def main():
    j = _lgs.job()
    import numpy as np
    import soundfile as sf
    from stable_audio_3.loading_utils import load_diffusion_cond
    from stable_audio_3.model import StableAudioModel

    model_dir = pathlib.Path(j['model_dirs'][0])
    dev = 'cuda' if j['device'] == 'cuda' else 'cpu'
    cfg = json.loads((model_dir / 'model_config.json').read_text(encoding='utf-8'))
    for c in cfg['model']['conditioning']['configs']:
        if c['type'] == 't5gemma':
            c['config']['model_path'] = str(model_dir)
    print('загружаю', model_dir.name, flush=True)
    m = load_diffusion_cond(cfg, str(model_dir / 'model.safetensors'), device=dev, model_half=dev == 'cuda')
    m.use_lora, m.lora_names = False, []
    model, sr = StableAudioModel(m, cfg, dev, dev == 'cuda'), cfg['sample_rate']
    out = pathlib.Path(j['out'])
    units = j['units']
    for i, u in enumerate(units):
        _lgs.progress(i, len(units), u['key'])
        audio = model.generate(prompt=u['prompt'], duration=float(u.get('duration', 2)), seed=int(u.get('seed', 1)))
        wav = out / f"{u['key']}.wav"
        a = audio[0].cpu().numpy().T
        sf.write(wav, a, sr)
        level = u.get('level', 'music' if j['kind'] == 'music' else 'normal')
        norm = out / f"{u['key']}.norm.wav"
        sf.write(norm, normalize(np, a, sr, level, u.get('max')), sr)
        ogg = out / f"{u['key']}.ogg"
        _lgs.to_opus(norm, ogg, j['ffmpeg'])
        norm.unlink()
        _lgs.output(ogg, key=u['key'], item=u['name'], seed=u.get('seed'), prompt=u['prompt'], raw=wav.name)
        _lgs.progress(i + 1, len(units), u['key'])


if __name__ == '__main__':
    main()
