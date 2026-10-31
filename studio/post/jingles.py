"""Джинглы из готовых треков: самый яркий кусок ровно по тактам + концовка.

python studio/post/jingles.py <трек> <выход.ogg> <bpm> victory|defeat [тактов=4] [сдвиг тактов=0]

victory — самые громкие N тактов (начало — по сильной доле), последний такт затихает, хвост 1,5 с;
defeat  — N тактов, во второй половине «зажёванная плёнка»: скорость и высота падают до нуля.
Питон из venv ComfyUI или G:/ai/venvs/3d (numpy). Выход — Opus 96k, −14 LUFS, как остальная музыка.
"""
import subprocess
import sys

import numpy as np

FFMPEG = 'G:/ai/ffmpeg/bin/ffmpeg.exe'
SR = 48000


def load(path):
    raw = subprocess.run([FFMPEG, '-v', 'error', '-i', path, '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def save(a, path):
    subprocess.run([FFMPEG, '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-',
                    '-af', 'loudnorm=I=-14:TP=-1', '-ar', str(SR), '-c:a', 'libopus', '-b:a', '96k', path],
                   input=a.astype(np.float32).tobytes(), check=True)


def downbeat_grid(x, bpm):
    """Сдвиг сетки тактов: фаза, на которую чаще всего приходятся атаки (бочка на сильной доле)."""
    mono = np.abs(x).mean(axis=1)
    hop = 480
    env = np.sqrt(np.convolve(mono ** 2, np.ones(hop) / hop, mode='same')[::hop])
    flux = np.maximum(0, np.diff(env, prepend=env[0]))
    bar = 4 * 60 / bpm
    fps = SR / hop
    phases = np.arange(0, bar, 0.01)
    t = np.arange(len(flux)) / fps
    score = [flux[(np.abs(((t - p) % bar)) < 0.02) | (np.abs(((t - p) % bar) - bar) < 0.02)].sum() for p in phases]
    return phases[int(np.argmax(score))], bar


def main():
    src, out, bpm, kind = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
    bars = int(sys.argv[5]) if len(sys.argv) > 5 else 4
    shift = int(sys.argv[6]) if len(sys.argv) > 6 else 0
    x = load(src)
    phase, bar = downbeat_grid(x, bpm)
    n = int(bars * bar * SR)
    # самый громкий отрезок из N тактов по сетке (не первые и не последние 10 % трека)
    starts = np.arange(phase, len(x) / SR - bars * bar, bar)
    starts = starts[(starts > 0.1 * len(x) / SR) & (starts + bars * bar < 0.9 * len(x) / SR)]
    rms = [np.sqrt((x[int(s * SR):int(s * SR) + n] ** 2).mean()) for s in starts]
    order = np.argsort(rms)[::-1]
    s = starts[order[min(shift, len(order) - 1)]]
    a = x[int(s * SR):int(s * SR) + n]
    a[:int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))[:, None]
    if kind == 'victory':
        tail = x[int(s * SR) + n:int(s * SR) + n + int(1.5 * SR)]
        a = np.concatenate([a, tail])
        fade = int(bar * SR) + len(tail)
        a[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 1.5
    else:
        # вторая половина: скорость падает от 1 до 0 («плёнку зажевало»)
        k = len(a) // 2
        head, rest = a[:k], a[k:]
        speed = np.linspace(1, 0.05, len(rest))
        pos = np.cumsum(speed)
        pos = pos[pos < len(rest) - 1]
        stop = np.stack([np.interp(pos, np.arange(len(rest)), rest[:, c]) for c in (0, 1)], axis=1)
        stop *= np.linspace(1, 0, len(stop))[:, None] ** 0.7
        a = np.concatenate([head, stop, np.zeros((int(0.3 * SR), 2))])
    save(a, out)
    print(f'{out}: с {s:.2f} c, {len(a) / SR:.1f} c')


if __name__ == '__main__':
    main()
