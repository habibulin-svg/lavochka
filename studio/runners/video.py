"""Ролики: ключевой кадр (картинка) → Wan 2.2 TI2V-5B → mp4. Apache-2.0.

studio/run.cmd runners/video.py <задание.yaml> [--only имя] [--dry]

Задание:
  keys: G:/temp/studio/out/gops/20-cutscene-keys   # где лежат ключевые кадры (партия run.py)
  defaults: {width: 1280, height: 704, frames: 121, steps: 30}
  seeds: [1]
  style: "..."                                        # хвост промпта движения
  clips:
    - name: s01-garage
      keys: [s01-garage-11, s01-garage-12]            # имена файлов без .png; по ролику на каждый
      prompt: "..."
  per_clip: true                                      # необязательно: файлы <ролик>-<ключ>-v<сид>.mp4
Выход: G:/temp/studio/out/<игра>/<партия>/<ключ>-<сид>.mp4 + manifest.json.
"""
import argparse
import copy
import datetime
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request
import uuid

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from run import AI, OUT, ROOT, fill  # noqa: E402
from runners.comfy import Comfy, _opener  # noqa: E402

NEGATIVE = ('blurry, low quality, distorted faces, extra limbs, deformed hands, text, subtitles, watermark, logo, '
            'static frame, still image, jpeg artifacts, morphing, flicker, realistic photo, gore, blood')


def upload(comfy: Comfy, path: pathlib.Path) -> str:
    """Положить картинку во входную папку ComfyUI, вернуть её имя."""
    boundary = uuid.uuid4().hex
    name = f'studio_{path.stem}.png'
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
            f'Content-Type: image/png\r\n\r\n').encode() + path.read_bytes() + \
        f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(comfy.base + '/upload/image', body,
                                 {'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with _opener.open(req, timeout=60) as r:
        return json.loads(r.read())['name']


def files(comfy: Comfy, entry: dict):
    for out in entry.get('outputs', {}).values():
        for key in ('images', 'videos', 'gifs', 'animated'):
            for im in out.get(key, []) or []:
                if isinstance(im, dict) and 'filename' in im:
                    q = urllib.parse.urlencode({'filename': im['filename'], 'subfolder': im['subfolder'], 'type': im['type']})
                    yield im['filename'], comfy._get('/view?' + q)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('job')
    ap.add_argument('--only')
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()

    job_path = pathlib.Path(a.job).resolve()
    job = yaml.safe_load(job_path.read_text(encoding='utf-8'))
    game = job_path.parent.name
    out = OUT / game / job_path.stem
    out.mkdir(parents=True, exist_ok=True)
    keys = pathlib.Path(job['keys'])

    wf = json.loads((ROOT / 'workflows' / 'wan22_i2v.json').read_text(encoding='utf-8'))
    comfy = Comfy(AI['servers'][job.get('server', 'comfy-big')])
    if not a.dry and not comfy.alive():
        sys.exit('ComfyUI comfy-big не запущен')

    manifest_path = out / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else []
    done = {m['file'] for m in manifest}
    only = set(a.only.split(',')) if a.only else None

    for clip in job['clips']:
        if only and clip['name'] not in only:
            continue
        for key in clip['keys']:
            for seed in clip.get('seeds', job.get('seeds', [1])):
                # per_clip: один ключ на несколько роликов (реакции) — имя ролика в начало файла
                file = f"{clip['name'] + '-' if job.get('per_clip') else ''}{key}-v{seed}.mp4"
                if file in done:
                    continue
                src = keys / f'{key}.png'
                if not src.exists():
                    print('нет ключевого кадра', src, flush=True)
                    continue
                values = {**job.get('defaults', {}), **{k: v for k, v in clip.items() if k not in ('name', 'prompt', 'keys', 'seeds')}}
                values['prompt'] = clip['prompt'].replace('{style}', job.get('style', '')).strip()
                values['negative'] = job.get('negative', NEGATIVE)
                values['seed'] = seed
                values['prefix'] = f'studio/{game}/{job_path.stem}/{key}'
                if a.dry:
                    print(file, values['prompt'])
                    continue
                values['image'] = upload(comfy, src)
                t0 = time.time()
                entry = comfy.wait(comfy.submit(fill(copy.deepcopy(wf), values)), timeout=3600)
                name, data = next(files(comfy, entry))
                (out / file).write_bytes(data)
                manifest.append({
                    'file': file, 'clip': clip['name'], 'key': key, 'seed': seed, 'prompt': values['prompt'],
                    'workflow': 'wan22_i2v', 'license': 'Apache-2.0 (Wan 2.2 TI2V-5B)',
                    'frames': values.get('frames'), 'sec': round(time.time() - t0),
                    'made': datetime.datetime.now().isoformat(timespec='seconds'),
                })
                manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')
                print('готово', file, f'{time.time() - t0:.0f} c', flush=True)
    print('выход:', out)


if __name__ == '__main__':
    main()
