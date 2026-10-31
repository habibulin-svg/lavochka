"""Студия: python studio/run.py studio/jobs/<игра>/<партия>.yaml [--only имя] [--dry]

Задание — YAML:
  workflow: z_image_turbo        # studio/workflows/<имя>.json
  server: comfy-big              # порт берётся из G:/ai/ai.json
  license: Apache-2.0            # лицензия модели — попадает в манифест
  defaults: {width: 1024, height: 1024, steps: 8}
  style: "..."                   # общий хвост промпта (библия стиля)
  seeds: [101, 202]              # сиды на каждую позицию
  items:
    - name: chibi-a
      prompt: "..."              # {style} подставится сам
      width: 1152                # можно переопределить defaults

Выход: G:/temp/studio/out/<игра>/<партия>/<имя>-<сид>.png + manifest.json.
Запуск — питоном из venv ComfyUI (там есть yaml и Pillow): studio/run.cmd.
"""
import argparse
import copy
import datetime
import json
import pathlib
import sys

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from runners.comfy import Comfy  # noqa: E402

ROOT = pathlib.Path(__file__).parent
AI = json.loads(pathlib.Path('G:/ai/ai.json').read_text(encoding='utf-8'))
OUT = pathlib.Path('G:/temp/studio/out')


def fill(node, values: dict):
    """Подставить {{ключ}}: строка целиком → значение как есть (число остаётся числом)."""
    if isinstance(node, dict):
        return {k: fill(v, values) for k, v in node.items() if k != '_about'}
    if isinstance(node, list):
        return [fill(v, values) for v in node]
    if isinstance(node, str) and node.startswith('{{') and node.endswith('}}'):
        return values[node[2:-2]]
    return node


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('job')
    ap.add_argument('--only', help='только позиции с этим именем (через запятую)')
    ap.add_argument('--dry', action='store_true', help='показать промпты, не генерировать')
    a = ap.parse_args()

    job_path = pathlib.Path(a.job).resolve()
    job = yaml.safe_load(job_path.read_text(encoding='utf-8'))
    game = job_path.parent.name
    out = OUT / game / job_path.stem
    out.mkdir(parents=True, exist_ok=True)

    wf = json.loads((ROOT / 'workflows' / f"{job['workflow']}.json").read_text(encoding='utf-8'))
    comfy = Comfy(AI['servers'][job.get('server', 'comfy-big')])
    if not a.dry and not comfy.alive():
        sys.exit(f"ComfyUI {job.get('server', 'comfy-big')} не запущен (G:/ai/start/comfy-big.cmd)")

    manifest_path = out / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else []
    done = {m['file'] for m in manifest}
    only = set(a.only.split(',')) if a.only else None

    for item in job['items']:
        if only and item['name'] not in only:
            continue
        for seed in item.get('seeds', job.get('seeds', [1])):
            file = f"{item['name']}-{seed}.png"
            if file in done:
                continue
            values = {**job.get('defaults', {}), **{k: v for k, v in item.items() if k not in ('name', 'prompt', 'seeds')}}
            values['prompt'] = item['prompt'].replace('{style}', job.get('style', '')).strip()
            values['seed'] = seed
            values['prefix'] = f"studio/{game}/{job_path.stem}/{item['name']}"
            if a.dry:
                print(f'{file}: {values["prompt"]}')
                continue
            entry = comfy.wait(comfy.submit(fill(copy.deepcopy(wf), values)))
            name, data = next(comfy.images(entry))
            (out / file).write_bytes(data)
            manifest.append({
                'file': file, 'item': item['name'], 'seed': seed, 'prompt': values['prompt'],
                'workflow': job['workflow'], 'license': job.get('license', '?'),
                'size': [values.get('width'), values.get('height')],
                'made': datetime.datetime.now().isoformat(timespec='seconds'),
            })
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')
            print('готово', file, flush=True)
    print('выход:', out)


if __name__ == '__main__':
    main()
