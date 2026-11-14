"""Площадки дворового спорта: glb → .gltf + .bin с общими текстурами.

python studio/post/gltf_share.py <выходная папка> <площадка.glb> [...]

Площадки (dvor_field.py, dvor_places.py) собраны из одних и тех же картинок (трава, бурьян, берёзы, земля, крыши, двери),
и в каждом glb они лежали копией — 75–80 % веса файла, при смене площадки браузер качал их заново. Здесь картинки
вынимаются в общую <выход>/tex/<имя>-<хеш>.webp (имя по содержимому — кэшируется навсегда, одинаковое не дублируется),
мелочь (бурьян, кусты, двери, мешковина, следы) ужимается до 512 px, остальное — до 1024; площадка → <имя>.gltf
(ссылки tex/…) + <имя>-<хеш>.bin (только геометрия). Старые .bin этой площадки удаляются; лишние картинки в tex/ — тоже,
если их не держит ни одна площадка в папке.
"""
import hashlib
import io
import json
import pathlib
import struct
import sys

from PIL import Image

SMALL = {'weeds', 'burlap', 'scuff', 'pebbles', 'door-green', 'door-blue', 'door-red', 'batwood', 'batwood2', 'endgrain',
         'rodwood', 'lilac-bush', 'picket', 'stog', 'planks', 'birch', 'brick-red', 'shingle', 'roof', 'concrete'}
QUALITY = 78


def read_glb(p: pathlib.Path):
    b = p.read_bytes()
    assert b[:4] == b'glTF'
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    off = 20 + n
    bl = struct.unpack('<I', b[off:off + 4])[0]
    return j, b[off + 8:off + 8 + bl]


def squeeze(name: str, data: bytes) -> bytes:
    im = Image.open(io.BytesIO(data))
    im.load()
    lim = 512 if name in SMALL else 1024
    if max(im.size) > lim:
        k = lim / max(im.size)
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    out = io.BytesIO()
    alpha = im.mode in ('RGBA', 'LA') or 'transparency' in im.info
    im.convert('RGBA' if alpha else 'RGB').save(out, 'WEBP', quality=QUALITY, method=6)
    return out.getvalue()


def main():
    out = pathlib.Path(sys.argv[1])
    tex = out / 'tex'
    tex.mkdir(parents=True, exist_ok=True)
    for src in map(pathlib.Path, sys.argv[2:]):
        j, binb = read_glb(src)
        stem = src.stem
        views = j['bufferViews']
        img_views = {im['bufferView'] for im in j.get('images', [])}
        for im in j.get('images', []):
            v = views[im['bufferView']]
            data = binb[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
            name = im.get('name') or 'tex'
            webp = squeeze(name, data)
            h = hashlib.sha1(webp).hexdigest()[:8]
            fn = f'{name}-{h}.webp'
            if not (tex / fn).exists():
                (tex / fn).write_bytes(webp)
            del im['bufferView']
            im['uri'] = f'tex/{fn}'
            im['mimeType'] = 'image/webp'
        # геометрия: остальные bufferView подряд, по 4 байта
        remap = {}
        nb = bytearray()
        new_views = []
        for i, v in enumerate(views):
            if i in img_views:
                continue
            while len(nb) % 4:
                nb.append(0)
            o = v.get('byteOffset', 0)
            chunk = binb[o:o + v['byteLength']]
            v2 = dict(v)
            v2['byteOffset'] = len(nb)
            v2['buffer'] = 0
            nb += chunk
            remap[i] = len(new_views)
            new_views.append(v2)
        for acc in j.get('accessors', []):
            if 'bufferView' in acc:
                acc['bufferView'] = remap[acc['bufferView']]
        j['bufferViews'] = new_views
        h = hashlib.sha1(bytes(nb)).hexdigest()[:8]
        for old in out.glob(f'{stem}-*.bin'):
            old.unlink()
        (out / f'{stem}-{h}.bin').write_bytes(bytes(nb))
        j['buffers'] = [{'byteLength': len(nb), 'uri': f'{stem}-{h}.bin'}]
        exts = set(j.get('extensionsUsed', [])) | {'EXT_texture_webp'}
        # картинки — обычные webp-ссылки; three читает их и без расширения, но оставляем как было
        j['extensionsUsed'] = sorted(exts)
        (out / f'{stem}.gltf').write_text(json.dumps(j, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        print(f'{stem}: геометрия {len(nb) // 1024} КБ, картинок {len(j.get("images", []))}')
    # картинки, которые не держит ни одна площадка в папке, — удалить
    used = set()
    for g in out.glob('*.gltf'):
        for im in json.loads(g.read_text(encoding='utf-8')).get('images', []):
            used.add(im['uri'].split('/', 1)[1])
    for f in tex.glob('*.webp'):
        if f.name not in used:
            f.unlink()
    total = sum(f.stat().st_size for f in tex.glob('*.webp'))
    print(f'общие текстуры: {len(used)} шт, {total // 1024} КБ')


if __name__ == '__main__':
    main()
