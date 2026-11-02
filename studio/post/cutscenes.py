"""Ролики ГОПС со звуком: листы кадров → раскладка звуков (задание) → звуки → апскейл → монтаж.

G:/ai/ComfyUI/venv/Scripts/python.exe -X utf8 studio/post/cutscenes.py sheets      # листы кадров с метками времени (для раскладки)
G:/ai/ComfyUI/venv/Scripts/python.exe -X utf8 studio/post/cutscenes.py sfxjob      # задание раскладки → задание runners/sfx.py
G:/ai/venvs/3d/Scripts/python.exe studio/runners/sfx.py studio/jobs/gops/41-cutscene-sfx.yaml
G:/ai/ComfyUI/venv/Scripts/python.exe -X utf8 studio/post/cutscenes.py upscale [имя…] # Real-ESRGAN x4plus, 1920 px, без звука
G:/ai/venvs/3d/Scripts/python.exe -X utf8 studio/post/cutscenes.py edit  [имя…]    # зум, стоп-кадр, звук → lavochka/public/gops/a/40-cutscenes/

Раскладка — studio/jobs/gops/41-cutscene-mix.yaml (пишет агент по листам кадров):
  clips:
    - name: s05-sling
      beat: 2.6            # главный момент, с от начала ролика: резкий наезд; null — без наезда
      focus: [0.5, 0.35]   # куда наезжать (доли кадра)
      sounds:
        - {id: twang, at: 0.8, gain: 0, duration: 1, level: normal, max: 0.5, prompt: "..."}
      bed: {duration: 7, prompt: "..."}   # фон на весь ролик (тише)
Звуки генерируются по id как <ролик>--<id>; общие (sting — удар на наезде) — в shared.
Монтаж: 0,5 с вступление (стоп-кадр, отъезд 1,10 → 1,0, из черноты), ролик 1×, медленный наезд 1,0 → 1,06,
на beat — наезд +0,18 за 0,15 с, держим 0,6 с, отпускаем 0,4 с; в конце стоп-кадр 1,2 с с наездом и притемнением до 35 % (под кнопки повтора).
"""
import argparse
import json
import math
import pathlib
import subprocess
import sys

import numpy as np
import yaml
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = pathlib.Path('G:/temp/studio/out/gops')
WORK = SRC / '40-cutscenes'
SFX = SRC / '41-cutscene-sfx'
MIX = ROOT / 'studio/jobs/gops/41-cutscene-mix.yaml'
SFXJOB = ROOT / 'studio/jobs/gops/41-cutscene-sfx.yaml'
DST = ROOT / 'lavochka/public/gops/a/40-cutscenes'
FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
ESRGAN = 'G:/ai/ComfyUI/models/upscale_models/RealESRGAN_x4plus.pth'
FPS = 24
W, H = 1920, 1056
PRE, TAIL, FADE = 0.5, 1.2, 0.4

# отобранные ролики — как cutsceneUrl в lavochka/src/gops/assets.ts
CLIPS = {p.name.removesuffix('-1-v1.mp4'): p for p in sorted((SRC / '25-videos').glob('s[0-9][0-9]-*-1-v1.mp4'))}
CLIPS['logo-anim'] = SRC / '25-videos/logo-anim-1-v1.mp4'
CLIPS['s09-kvass'] = SRC / '25c-fix-videos/s09b-kvass-2-v1.mp4'


def frames(path: pathlib.Path, w: int, h: int):
    p = subprocess.Popen([FFMPEG, '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    n = w * h * 3
    while (buf := p.stdout.read(n)) and len(buf) == n:
        yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    p.wait()


def size(path: pathlib.Path) -> tuple[int, int]:
    out = subprocess.run([FFMPEG.replace('ffmpeg.exe', 'ffprobe.exe'), '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height',
                          '-of', 'csv=p=0', str(path)], capture_output=True, text=True, check=True).stdout
    w, h = map(int, out.strip().split(','))
    return w, h


def sheets():
    """Лист на ролик: кадр каждые 0,4 с, подпись — время."""
    d = WORK / 'sheets'
    d.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype('arial.ttf', 26)
    for name, path in CLIPS.items():
        w, h = size(path)
        picks = [f for i, f in enumerate(frames(path, w, h)) if i % round(0.4 * FPS) == 0]
        cw, ch = 384, round(384 * h / w)
        cols = 5
        sheet = Image.new('RGB', (cols * cw, math.ceil(len(picks) / cols) * ch), 'black')
        dr = ImageDraw.Draw(sheet)
        for i, f in enumerate(picks):
            x, y = i % cols * cw, i // cols * ch
            sheet.paste(Image.fromarray(f).resize((cw, ch)), (x, y))
            dr.rectangle((x, y, x + 76, y + 32), fill='black')
            dr.text((x + 6, y + 2), f'{i * 0.4:.1f}s', fill='yellow', font=font)
        sheet.save(d / f'{name}.jpg', quality=85)
        print('лист', name, flush=True)


def sfxjob():
    mix = yaml.safe_load(MIX.read_text(encoding='utf-8'))
    sounds = [dict(s, name=f"shared--{s['id']}") for s in mix.get('shared', [])]
    for c in mix['clips']:
        for s in c.get('sounds', []):
            sounds.append({'name': f"{c['name']}--{s['id']}", 'duration': s.get('duration', 2), 'level': s.get('level', 'normal'),
                           'max': s.get('max'), 'prompt': s['prompt']})
        if c.get('bed'):
            b = c['bed']
            sounds.append({'name': f"{c['name']}--bed", 'duration': b.get('duration', 7), 'level': 'ambience', 'max': 8.0, 'prompt': b['prompt']})
    for s in sounds:
        s.pop('id', None)
        s.pop('at', None)
        s.pop('gain', None)
        if s.get('max') is None:
            s.pop('max', None)
    job = {'out': str(SFX).replace('\\', '/'), 'seeds': [1], 'sounds': sounds}
    SFXJOB.write_text('# ГОПС, партия 41: звуки роликов. Сгенерировано cutscenes.py sfxjob из 41-cutscene-mix.yaml — правки вносить туда.\n'
                      + yaml.safe_dump(job, allow_unicode=True, sort_keys=False, width=200), encoding='utf-8')
    print('задание', SFXJOB, len(sounds), 'звуков')


def upscale(names):
    import spandrel
    import torch
    import torch.nn.functional as F
    model = spandrel.ModelLoader().load_from_file(ESRGAN).model.cuda().eval().half()
    d = WORK / 'up'
    d.mkdir(parents=True, exist_ok=True)
    for name in names:
        out = d / f'{name}.mp4'
        if out.exists():
            continue
        w, h = size(CLIPS[name])
        enc = subprocess.Popen([FFMPEG, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                                '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', str(out)], stdin=subprocess.PIPE)
        for f in frames(CLIPS[name], w, h):
            with torch.no_grad():
                x = torch.from_numpy(f.copy()).cuda().permute(2, 0, 1)[None].half() / 255
                x = F.interpolate(x, size=(H // 2, W // 2), mode='bicubic', antialias=True)  # 960 × 528 → ×4 → вниз до 1920
                y = model(x).clamp(0, 1)
                y = F.interpolate(y.float(), size=(H, W), mode='bicubic', antialias=True).clamp(0, 1)
            enc.stdin.write((y[0].permute(1, 2, 0) * 255).round().byte().cpu().numpy().tobytes())
        enc.stdin.close()
        enc.wait()
        print('апскейл', name, flush=True)


def ease(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def zoom_at(t: float, dur: float, beat):
    """Масштаб кадра в момент t выходного ролика (t=0 — начало вступления)."""
    total = PRE + dur + TAIL
    if t < PRE:
        z = 1.10 - 0.10 * ease(t / PRE)
    elif t < PRE + dur:
        z = 1.0 + 0.06 * (t - PRE) / dur
    else:
        z = 1.06 + 0.06 * ease((t - PRE - dur) / TAIL)
    p = 0.0  # доля резкого наезда: 0 — нет, 1 — во всю силу
    if beat is not None:
        b = PRE + beat
        if b <= t < b + 0.15:
            p = ease((t - b) / 0.15)
        elif b + 0.15 <= t < b + 0.75:
            p = 1.0
        elif b + 0.75 <= t < b + 1.15:
            p = 1 - ease((t - b - 0.75) / 0.4)
    return z + 0.18 * p, p, total


def crop(f: np.ndarray, z: float, fx: float, fy: float) -> np.ndarray:
    img = Image.fromarray(f)
    cw, ch = W / z, H / z
    x0 = min(max(fx * W - cw / 2, 0), W - cw)
    y0 = min(max(fy * H - ch / 2, 0), H - ch)
    return np.asarray(img.resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + cw, y0 + ch)))


def mix_audio(c, dur: float, total: float, wav: pathlib.Path, shared):
    import soundfile as sf
    sr = 48000
    buf = np.zeros((int(total * sr) + sr, 2))

    def put(path: pathlib.Path, at: float, gain_db: float):
        a, r = sf.read(SFX / 'ogg' / f'{path}-1.ogg', always_2d=True) if (SFX / 'ogg' / f'{path}-1.ogg').exists() else (None, 0)
        if a is None:
            print('  нет звука', path, file=sys.stderr)
            return
        if r != sr:
            idx = np.arange(0, len(a), r / sr)
            a = np.stack([np.interp(idx, np.arange(len(a)), a[:, ch]) for ch in range(a.shape[1])], 1)
        if a.shape[1] == 1:
            a = np.repeat(a, 2, 1)
        i = int(max(0.0, at) * sr)
        n = min(len(a), len(buf) - i)
        buf[i:i + n] += a[:n] * 10 ** (gain_db / 20)

    if c.get('bed'):
        bed = f"{c['name']}--bed"
        for k in range(math.ceil(total / 6)):  # фон петлёй, если короче ролика
            put(bed, k * 6.0, c['bed'].get('gain', -4))
    for s in c.get('sounds', []):
        put(f"{c['name']}--{s['id']}", PRE + s['at'], s.get('gain', 0))
    if c.get('beat') is not None and shared:
        put('shared--sting', PRE + c['beat'] - 0.05, c.get('sting_gain', -3))
    n = int(total * sr)
    buf = buf[:n]
    fi, fo = int(0.15 * sr), int(FADE * sr)
    buf[:fi] *= np.linspace(0, 1, fi)[:, None]
    buf[-fo:] *= np.linspace(1, 0, fo)[:, None]
    pk = np.abs(buf).max()
    if pk > 0.89:
        buf *= 0.89 / pk
    sf.write(wav, buf, sr)


def edit(names):
    mix = {c['name']: c for c in yaml.safe_load(MIX.read_text(encoding='utf-8'))['clips']}
    shared = bool(yaml.safe_load(MIX.read_text(encoding='utf-8')).get('shared'))
    DST.mkdir(parents=True, exist_ok=True)
    info = {}
    for name in names:
        c = mix.get(name, {'name': name})
        src = WORK / 'up' / f'{name}.mp4'
        if not src.exists():
            src = CLIPS[name]
        w, h = size(src)
        fr = [f if (w, h) == (W, H) else np.asarray(Image.fromarray(f).resize((W, H), Image.LANCZOS)) for f in frames(src, w, h)]
        dur = len(fr) / FPS
        beat = c.get('beat')
        fx, fy = c.get('focus') or (0.5, 0.5)
        _, _, total = zoom_at(0, dur, beat)
        wav = WORK / f'{name}.wav'
        WORK.mkdir(parents=True, exist_ok=True)
        mix_audio(c, dur, total, wav, shared)
        out = DST / f'{name}.mp4'
        enc = subprocess.Popen([FFMPEG, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                                '-i', str(wav), '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p',
                                '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', str(out)], stdin=subprocess.PIPE)
        for i in range(round(total * FPS)):
            t = i / FPS
            k = min(len(fr) - 1, max(0, round((t - PRE) * FPS)))
            z, p, _ = zoom_at(t, dur, beat)
            f = crop(fr[k], z, 0.5 + (fx - 0.5) * p, 0.5 + (fy - 0.5) * p)  # наезд на beat — к фокусу, остальное — к центру
            # из черноты в начале; в конце — притемнение до 35 %, не в черноту: поверх кадра кнопки «Ещё раз / Дальше»
            a = min(1.0, t / 0.3) * (1 - 0.65 * (1 - min(1.0, (total - t) / FADE)))
            if a < 1:
                f = (f * max(0.0, a)).astype(np.uint8)
            enc.stdin.write(np.ascontiguousarray(f).tobytes())
        enc.stdin.close()
        enc.wait()
        info[name] = round(total, 2)
        print('монтаж', name, f'{total:.1f} с', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('step', choices=['sheets', 'sfxjob', 'upscale', 'edit'])
    ap.add_argument('names', nargs='*')
    a = ap.parse_args()
    names = a.names or list(CLIPS)
    {'sheets': lambda: sheets(), 'sfxjob': lambda: sfxjob(), 'upscale': lambda: upscale(names), 'edit': lambda: edit(names)}[a.step]()


if __name__ == '__main__':
    main()
