"""Музыка через ACE-Step 1.5 (MIT), в его собственном окружении:

G:/ai/bin/uv.exe run --no-sync --project G:/ai/ACE-Step-1.5 python studio/runners/music.py <задание.yaml>

Задание:
  out: G:/temp/studio/out/gops/07-music
  duration: 60
  seeds: [1, 2]
  tracks:
    - name: menu
      caption: "..."
      bpm: 128          # необязательно
Пишет <out>/<имя>-<сид>.flac и manifest.json. Только инструментал (вокал на русском у модели не проверен).
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

import yaml  # noqa: E402
from acestep.handler import AceStepHandler  # noqa: E402
from acestep.inference import GenerationConfig, GenerationParams, generate_music  # noqa: E402
from acestep.llm_inference import LLMHandler  # noqa: E402


def main():
    job_path = JOB
    job = yaml.safe_load(job_path.read_text(encoding='utf-8'))
    out = pathlib.Path(job['out'])
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / '_raw'

    dit = AceStepHandler()
    dit.initialize_service(project_root=str(ACE), config_path='acestep-v15-turbo', device='cuda')
    llm = LLMHandler()  # без языковой модели: инструментал по подписи

    manifest = []
    for t in job['tracks']:
        for seed in t.get('seeds', job.get('seeds', [1])):
            params = GenerationParams(
                caption=t['caption'], lyrics='[Instrumental]', instrumental=True,
                bpm=t.get('bpm'), duration=t.get('duration', job.get('duration', 60)),
                inference_steps=8, seed=seed, thinking=False,
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
            manifest.append({'file': dst.name, 'caption': t['caption'], 'seed': seed, 'model': 'ACE-Step 1.5 turbo', 'license': 'MIT'})
            print('готово', dst.name, flush=True)
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
