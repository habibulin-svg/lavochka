"""Разборчивость озвучки: Whisper распознаёт каждый дубль, доля ошибок по буквам (CER) против текста фразы.
Заодно — лучший дубль каждой фразы (меньше ошибок, при равенстве — первый).

G:/ai/venvs/qwentts/Scripts/python.exe -X utf8 studio/post/asr_score.py <озвучка> [<озвучка> ...] [--device cuda:0]
Озвучка — папка с manifest.json (runners/tts.py, runners/tts_qwen.py). Пишет туда asr.json и picks.json, печатает сводку по наборам.
Модель — локально G:/ai/models/asr/whisper-large-v3-turbo (ModelScope).
"""
import argparse
import json
import pathlib
import re
import statistics

import soundfile as sf
import torch
from transformers import pipeline

MODEL = 'G:/ai/models/asr/whisper-large-v3-turbo'


def norm(t: str) -> str:
    t = t.lower().replace('ё', 'е').replace('\u0301', '').replace('+', '')
    t = re.sub(r'\bсейчас\b', 'щас', t)
    t = re.sub(r'(.)\1{2,}', r'\1', t)  # «Мама-а-а» и протяжки — не ошибка
    return re.sub(r'[^а-яa-z0-9]+', '', t)


def dedup(t: str) -> str:
    """Whisper на коротких клипах повторяет фразу («Лови. Лови.») — это не ошибка озвучки: подряд одинаковое — один раз."""
    out: list[str] = []
    for p in re.split(r'(?<=[.!?…])\s+', t.strip()):
        if p and (not out or norm(p) != norm(out[-1])):
            out.append(p)
    return ' '.join(out)


def cer(ref: str, hyp: str) -> float:
    a, b = norm(ref), norm(dedup(hyp))
    if not a:
        return 0.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        prev = cur
    return min(1.0, prev[-1] / len(a))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dirs', nargs='+')
    ap.add_argument('--device', default='cuda:0')
    a = ap.parse_args()
    asr = pipeline('automatic-speech-recognition', model=MODEL, torch_dtype=torch.float16, device=a.device)
    for d in map(pathlib.Path, a.dirs):
        man = json.loads((d / 'manifest.json').read_text(encoding='utf-8'))
        out_path = d / 'asr.json'
        res = json.loads(out_path.read_text(encoding='utf-8')) if out_path.exists() else {}
        for r in res.values():  # пересчёт по сохранённому распознаванию — правила метрики могли поменяться
            r['cer'] = round(cer(r['text'], r['heard']), 3)
        for m in man:
            if m['file'] in res:
                continue
            wav, sr = sf.read(str(d / m['file']), dtype='float32')
            if wav.ndim > 1:
                wav = wav.mean(axis=1)
            heard = asr({'raw': wav, 'sampling_rate': sr}, generate_kwargs={'language': 'russian', 'task': 'transcribe'})['text'].strip()
            res[m['file']] = {'heard': heard, 'cer': round(cer(m['text'], heard), 3), 'set': m['set'], 'text': m['text']}
            if len(res) % 50 == 0:
                out_path.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
        out_path.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
        # лучший дубль фразы: файл без «-<дубль>.wav» — ключ фразы
        best: dict[str, tuple[float, str]] = {}
        for f, r in sorted(res.items()):
            phrase = f.rsplit('-', 1)[0]
            if phrase not in best or r['cer'] < best[phrase][0]:
                best[phrase] = (r['cer'], f)
        (d / 'picks.json').write_text(json.dumps({p: f for p, (_, f) in best.items()}, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f'== {d.name}: дублей {len(res)}, средний CER {statistics.mean(r["cer"] for r in res.values()):.3f}, '
              f'лучших дублей с CER > 0.3: {sum(1 for c, _ in best.values() if c > 0.3)} из {len(best)}')
        for s in sorted({r['set'] for r in res.values()}):
            cs = [r['cer'] for r in res.values() if r['set'] == s]
            print(f'   {s:12s} CER {statistics.mean(cs):.3f}  плохих (>0.3) {sum(c > 0.3 for c in cs)} из {len(cs)}')


if __name__ == '__main__':
    main()
