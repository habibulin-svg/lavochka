"""Музыка через YuE2 в ComfyUI (ноды comfy_extras/nodes_yue2.py, веса Comfy-Org/YuE2 int8).

Лицензия: веса CC BY-NC 4.0 + разрешение YuE2 (2026-09-16) «индивидуальным авторам» монетизировать результаты —
пользователь самозанятый, действует как физлицо (решение пользователя 2026-11-01). Адаптер Mothersuperior
«instrumental» — CC BY-NC без такого разрешения, НЕ используем: инструментал получаем, заглушая голос
«Vocal» в партитуре ABC паузами (аккорды остаются).

Два шага на трек:
  1) YuE2GenerateABC → партитура (форма, аккорды, мелодии «Vocal» и «Ins»);
  2) голос Vocal → паузы; YuE2GenerateMusic + KSampler + VAEDecodeAudio → звук.
Можно подать свою партитуру (abc_file) — тогда шаг 1 пропускается.

G:/ai/venvs/3d/Scripts/python.exe studio/runners/yue2.py <задание.yaml>
Задание:
  out: G:/temp/studio/out/gops/12-yue2
  seeds: [1, 2]
  max_duration: 120
  tracks:
    - name: menu
      style: "eurodance, 136 bpm, ..."        # теги YuE2: жанр, инструменты, настроение, темп
      lyrics: "[intro]\n[verse]\n[chorus]"    # только теги частей
      abc_file: путь/к/партитуре.abc          # необязательно
      lora: ar_lora_inst_v3abc_comfyui.safetensors  # необязательно, в слот CLIP (этап партитуры); см. лицензию выше
Пишет <out>/<имя>-<сид>.flac, .abc (исходная), .inst.abc (с заглушённым вокалом), manifest.json.
"""
import json
import pathlib
import re
import sys
import urllib.parse

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from comfy import Comfy  # noqa: E402

CKPT = 'yue2_3b_int8_convrot.safetensors'
AI = json.loads(pathlib.Path('G:/ai/ai.json').read_text(encoding='utf-8'))


def loader(lora):
    """Чекпойнт (+ LoRA в CLIP — планировщик партитуры). Возвращает граф и ссылки на model/clip/vae."""
    g = {'1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': CKPT}}}
    if not lora:
        return g, ['1', 0], ['1', 1], ['1', 2]
    g['L'] = {'class_type': 'LoraLoader', 'inputs': {'model': ['1', 0], 'clip': ['1', 1], 'lora_name': lora,
                                                     'strength_model': 0.0, 'strength_clip': 1.0}}
    return g, ['1', 0], ['L', 1], ['1', 2]


def graph_abc(style, lyrics, seed, lora=None):
    g, _, clip, _ = loader(lora)
    return {
        **g,
        '2': {'class_type': 'YuE2GenerateABC', 'inputs': {
            'clip': clip, 'style': style, 'lyrics': lyrics, 'seed': seed, 'mode': 'full',
            'max_abc_tokens': 8192, 'temperature': 0.7, 'top_p': 0.9, 'top_k': 30,
            'repetition_penalty': 1.005, 'penalty_window': 100}},
        '3': {'class_type': 'PreviewAny', 'inputs': {'source': ['2', 0]}},
    }


def graph_music(style, lyrics, abc, seed, max_duration, prefix, lora=None):
    g, _, clip, _ = loader(lora)
    return {
        **g,
        '2': {'class_type': 'YuE2GenerateMusic', 'inputs': {
            'clip': clip, 'style': style, 'lyrics': lyrics, 'abc': abc, 'seed': seed, 'mode': 'full',
            'max_duration': max_duration, 'temperature': 1.0, 'top_p': 0.95, 'top_k': 100,
            'repetition_penalty': 1.2}},
        '3': {'class_type': 'ConditioningZeroOut', 'inputs': {'conditioning': ['2', 0]}},
        '4': {'class_type': 'EmptyYuE2LatentAudio', 'inputs': {'seconds': ['2', 1], 'batch_size': 1}},
        '5': {'class_type': 'KSampler', 'inputs': {
            'model': ['1', 0], 'positive': ['2', 0], 'negative': ['3', 0], 'latent_image': ['4', 0],
            'seed': seed, 'steps': 32, 'cfg': 1.0, 'sampler_name': 'dpm_2', 'scheduler': 'sgm_uniform', 'denoise': 1.0}},
        '6': {'class_type': 'VAEDecodeAudio', 'inputs': {'samples': ['5', 0], 'vae': ['1', 2]}},
        '7': {'class_type': 'SaveAudio', 'inputs': {'audio': ['6', 0], 'filename_prefix': prefix}},
    }


def bar_units(abc):
    """Длина такта в единицах L: (M числитель/знаменатель) / L."""
    m = re.search(r'^M:\s*(\d+)/(\d+)', abc, re.M)
    l_ = re.search(r'^L:\s*1/(\d+)', abc, re.M)
    num, den = (int(m.group(1)), int(m.group(2))) if m else (4, 4)
    unit = int(l_.group(1)) if l_ else 8
    return num * unit // den


def silence_vocal(abc):
    """В строках голоса Vocal каждый такт → паузы той же длины; аккорды «"Dm"» сохраняются."""
    L = bar_units(abc)
    out, voice = [], None
    for line in abc.split('\n'):
        mv = re.match(r'^V:\s*(\S+)', line)
        if mv:
            voice = mv.group(1)
            out.append(line)
            continue
        if voice == 'Vocal' and line and not line.startswith(('%', 'X:', 'T:', 'M:', 'L:', 'Q:', 'K:')):
            bars = line.split('|')
            new = []
            for b in bars:
                if not b.strip():
                    new.append(b)
                    continue
                if b.strip().startswith('Z'):
                    new.append(b)   # многотактовая пауза
                    continue
                chords = re.findall(r'"[^"]*"', b)
                if not chords:
                    new.append(f'z{L}')
                else:
                    k = len(chords)
                    parts = [L // k] * k
                    parts[-1] += L - sum(parts)
                    new.append(''.join(f'{c}z{p}' for c, p in zip(chords, parts)))
            out.append('|'.join(new))
        else:
            out.append(line)
    return '\n'.join(out)


def text_output(entry):
    for out in entry.get('outputs', {}).values():
        for key in ('text', 'string', 'STRING'):
            if key in out:
                v = out[key]
                return v[0] if isinstance(v, list) else v
    raise RuntimeError(f'нет текста в выходах: {list(entry.get("outputs", {}).values())[:1]}')


def audio_files(comfy, entry):
    for out in entry.get('outputs', {}).values():
        for a in out.get('audio', []):
            q = urllib.parse.urlencode({'filename': a['filename'], 'subfolder': a['subfolder'], 'type': a['type']})
            yield a['filename'], comfy._get('/view?' + q)


def main():
    job_path = pathlib.Path(sys.argv[1]).resolve()
    job = yaml.safe_load(job_path.read_text(encoding='utf-8'))
    out = pathlib.Path(job['out'])
    out.mkdir(parents=True, exist_ok=True)
    comfy = Comfy(AI['servers'][job.get('server', 'comfy-big')])
    if not comfy.alive():
        sys.exit('ComfyUI не запущен (G:/ai/start/comfy-big.cmd)')
    manifest_path = out / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else []
    for t in job['tracks']:
        for seed in t.get('seeds', job.get('seeds', [1])):
            name = f"{t['name']}-{seed}"
            if (out / f'{name}.flac').exists():
                continue
            if t.get('abc_file'):
                abc = pathlib.Path(t['abc_file']).read_text(encoding='utf-8')
            else:
                abc = text_output(comfy.wait(comfy.submit(graph_abc(t['style'], t['lyrics'], seed, t.get('lora'))), timeout=1800))
            (out / f'{name}.abc').write_text(abc, encoding='utf-8')
            inst = silence_vocal(abc) if t.get('silence_vocal', True) else abc
            (out / f'{name}.inst.abc').write_text(inst, encoding='utf-8')
            entry = comfy.wait(comfy.submit(graph_music(t['style'], t['lyrics'], inst, seed,
                                                        t.get('max_duration', job.get('max_duration', 150)),
                                                        f'studio/yue2/{name}', t.get('lora'))), timeout=3600)
            fn, data = next(audio_files(comfy, entry))
            (out / f'{name}{pathlib.Path(fn).suffix}').write_bytes(data)
            manifest.append({'file': f'{name}{pathlib.Path(fn).suffix}', 'style': t['style'], 'lyrics': t['lyrics'],
                             'seed': seed, 'model': 'YuE2-3B int8 (Comfy-Org)', 'lora': t.get('lora'),
                             'license': 'CC BY-NC 4.0 + YuE2 individual creator permission'})
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')
            print('готово', name, flush=True)


if __name__ == '__main__':
    main()
