"""Музыка через ACE-Step 1.5 (MIT), в его собственном окружении:

G:/ai/bin/uv.exe run --no-sync --project G:/ai/ACE-Step-1.5 python studio/runners/music.py <задание.yaml>

Задание:
  out: G:/temp/studio/out/gops/07-music
  duration: 60
  seeds: [1, 2]
  lm: true            # языковая модель ACE-Step строит структуру трека (вступление, брейк, раскачка)
  lm_model: acestep-5Hz-lm-4B          # по умолчанию 1.7B
  dit: acestep-v15-xl-sft              # по умолчанию acestep-v15-turbo
  steps: 50                            # turbo — 8, base/sft — 32–64
  guidance: 7.0                        # CFG, только не-turbo
  offload: true                        # выгрузка в RAM между этапами + INT8 (XL на 12 ГБ)
  tracks:
    - name: menu
      caption: "..."
      bpm: 128          # необязательно
      keyscale: A minor # необязательно
      duration: 90      # необязательно
      reference: G:/temp/Music/x.mp3   # образец звучания: тембр, сведение, характер (мелодия и ритм не берутся)
      src: G:/.../demo.wav             # cover: взять из исходника мелодию, аккорды, ритм и форму
      strength: 0.5                    # cover: сила следования исходнику 0..1
Пишет <out>/<имя>-<сид>.flac, <out>/ogg/<имя>-<сид>.ogg (Opus 96k, −14 LUFS — все треки одной громкости,
динамика — за аранжировкой) и manifest.json. Только инструментал (вокал на русском у модели не проверен).
"""
import json
import os
import pathlib
import shutil
import sys

ACE = pathlib.Path('G:/ai/ACE-Step-1.5')
JOB = pathlib.Path(sys.argv[1]).resolve()  # до смены папки
sys.path.insert(0, str(ACE))
os.chdir(ACE)

import subprocess  # noqa: E402

import yaml  # noqa: E402
from acestep.handler import AceStepHandler  # noqa: E402
from acestep.constants import TASK_INSTRUCTIONS  # noqa: E402
from acestep.inference import GenerationConfig, GenerationParams, generate_music  # noqa: E402
from acestep.llm_inference import LLMHandler  # noqa: E402


def main():
    job_path = JOB
    job = yaml.safe_load(job_path.read_text(encoding='utf-8'))
    out = pathlib.Path(job['out'])
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / '_raw'

    offload = job.get('offload', False)
    dit_name = job.get('dit', 'acestep-v15-turbo')
    turbo = 'turbo' in dit_name
    dit = AceStepHandler()
    msg, ok = dit.initialize_service(project_root=str(ACE), config_path=dit_name, device='cuda',
                                     offload_to_cpu=offload, offload_dit_to_cpu=offload,
                                     quantization='int8_weight_only' if offload else None)
    if not ok:
        sys.exit(f'DiT не загрузился: {msg}')
    llm = LLMHandler()
    use_lm = job.get('lm', False)
    if use_lm:
        msg, ok = llm.initialize(checkpoint_dir=str(ACE / 'checkpoints'), lm_model_path=job.get('lm_model', 'acestep-5Hz-lm-1.7B'),
                                 backend='pt', device='cuda', offload_to_cpu=offload)
        if not ok:
            sys.exit(f'LM не загрузилась: {msg}')
    (out / 'ogg').mkdir(exist_ok=True)

    manifest = []
    for t in job['tracks']:
        for seed in t.get('seeds', job.get('seeds', [1])):
            if (out / f"{t['name']}-{seed}.flac").exists():
                continue   # уже сделано (перезапуск после обрыва)
            params = GenerationParams(
                caption=t['caption'], lyrics='[Instrumental]', instrumental=True,
                bpm=t.get('bpm'), keyscale=t.get('keyscale', ''), duration=t.get('duration', job.get('duration', 60)),
                inference_steps=job.get('steps', 8), seed=seed, thinking=use_lm,
                guidance_scale=job.get('guidance', 7.0), shift=3.0 if turbo else 1.0,
                reference_audio=t.get('reference'),
                task_type='cover' if t.get('src') else 'text2music', src_audio=t.get('src'),
                # инструкция — по задаче: по умолчанию в параметрах стоит инструкция text2music, и cover без неё не держит исходник
                instruction=TASK_INSTRUCTIONS['cover' if t.get('src') else 'text2music'],
                audio_cover_strength=t.get('strength', 1.0),
                use_cot_metas=False, use_cot_caption=False, use_cot_language=False,
            )
            cfg = GenerationConfig(batch_size=1, audio_format='flac')
            if tmp.exists():
                shutil.rmtree(tmp)
            res = generate_music(dit, llm, params, cfg, save_dir=str(tmp))
            files = sorted(tmp.glob('*.flac'))
            if not files:
                print('нет файла:', t['name'], seed, getattr(res, 'error', res))
                continue
            dst = out / f"{t['name']}-{seed}.flac"
            shutil.move(str(files[0]), dst)
            subprocess.run(['G:/ai/ffmpeg/bin/ffmpeg.exe', '-v', 'error', '-y', '-i', str(dst), '-af', 'loudnorm=I=-14:TP=-1:LRA=9',
                            '-ar', '48000', '-c:a', 'libopus', '-b:a', '96k', str(out / 'ogg' / (dst.stem + '.ogg'))], check=True)
            manifest.append({'file': dst.name, 'caption': t['caption'], 'seed': seed, 'model': f'ACE-Step 1.5 {dit_name}',
                             'reference': t.get('reference'), 'license': 'MIT'})
            print('готово', dst.name, flush=True)
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
