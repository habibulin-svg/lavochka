"""Дворовый спорт: реквизит «Чижа» — чиж и бита — Blender → glTF для three.js.

blender -b --factory-startup --python studio/blender/dvor_chizh.py -- <папка текстур> <папка выхода>

Текстуры — те же, что у двора городков (G:/temp/gk3d/tex: batwood, rodwood).
Выход: chizh.glb — «chizh» (чиж: обструганная палочка 14 см, Ø 2,6 см, оба конца заточены на конус ножом —
грани среза видны, на боку две зарубки), «bita» (бита для чижа 60 см: плоская дощечка-лопатка со скруглённым концом,
круглая рукоять с изолентой «bita-tape» — игра перекрашивает её в цвет игрока).
Оси: Blender z — вверх; glTF → three (x, z, −y). Чиж и бита лежат вдоль z (середина в нуле).
"""
import math
import random
import sys
from pathlib import Path

import bpy
import bmesh

argv = sys.argv[sys.argv.index('--') + 1:]
TEX = Path(argv[0])
OUT = Path(argv[1])
OUT.mkdir(parents=True, exist_ok=True)
rnd = random.Random(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
_imgs = {}


def image(name):
    if name not in _imgs:
        _imgs[name] = bpy.data.images.load(str(TEX / f'{name}.png'))
    return _imgs[name]


def mat(name, tex=None, color=(0.8, 0.8, 0.8, 1), rough=0.85, metal=0.0, tint=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if tex:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = image(tex)
        if tint:
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            nt.links.new(t.outputs['Color'], mix.inputs['A'])
            mix.inputs['B'].default_value = tint
            nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
        else:
            nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = color
    return m


props = bpy.data.collections.new('props')
scene.collection.children.link(props)


def obj(name, bm, mats, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = smooth
    o = bpy.data.objects.new(name, me)
    props.objects.link(o)
    return o


def lathe(bm, uvl, prof, seg, wob=0.0, mat_of=lambda j, zc: 0, flat=None):
    """Тело вращения по профилю [(z, r)]: кольца, бока, торцы (если r > 0). flat — сплющивание по y (доля)."""
    rings = []
    for i, (z, r) in enumerate(prof):
        if r <= 1e-5:
            rings.append([bm.verts.new((0, 0, z))])
            continue
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            rr = r * (1 + wob * math.sin(a * 3 + i * 1.7))
            ry = rr * (flat(z) if flat else 1)
            ring.append(bm.verts.new((rr * math.cos(a), ry * math.sin(a), z)))
        rings.append(ring)
    L = prof[-1][0] - prof[0][0]
    for j in range(len(rings) - 1):
        a, b = rings[j], rings[j + 1]
        zc = (prof[j][0] + prof[j + 1][0]) / 2
        faces = []
        if len(a) == 1:
            faces = [bm.faces.new((a[0], b[(k + 1) % seg], b[k])) for k in range(seg)]
        elif len(b) == 1:
            faces = [bm.faces.new((a[k], a[(k + 1) % seg], b[0])) for k in range(seg)]
        else:
            faces = [bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k])) for k in range(seg)]
        for f in faces:
            f.material_index = mat_of(j, zc)
            for lp in f.loops:
                c = lp.vert.co
                lp[uvl].uv = (math.atan2(c.y, c.x) / (2 * math.pi) + 0.5, (c.z - prof[0][0]) / L * 2)
    return rings


# ------------------------------------------------------------------ чиж
# 14 см, Ø 2,6 см; концы — конусы по 3,5 см, срезы ножом — гранёные (8 граней), середина круглая, кора местами
CL = 0.14
CR = 0.013
TIP = 0.035
bm = bmesh.new()
uvl = bm.loops.layers.uv.verify()
prof = [(-CL / 2, 0.0015)]
for i in range(1, 5):
    t = i / 4
    prof.append((-CL / 2 + TIP * t, CR * (0.12 + 0.88 * math.sqrt(t))))
for i in range(1, 6):
    prof.append((-CL / 2 + TIP + (CL - 2 * TIP) * i / 6, CR * (1 + 0.04 * math.sin(i * 2.1))))
for i in range(4, 0, -1):
    t = i / 4
    prof.append((CL / 2 - TIP * t, CR * (0.12 + 0.88 * math.sqrt(t))))
prof.append((CL / 2, 0.0015))
# конусы — заточка (светлое дерево), середина — кора (кроме полосы, где обструган)
lathe(bm, uvl, prof, 8, wob=0.05, mat_of=lambda j, zc: 0 if abs(zc) > CL / 2 - TIP - 0.002 else (1 if (zc < -0.01 or zc > 0.025) else 0))
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
wood = mat('chizh-wood', 'batwood', rough=0.75, tint=(1.0, 0.9, 0.72, 1))
bark = mat('chizh-bark', 'rodwood', rough=0.85, tint=(0.55, 0.42, 0.3, 1))
chizh = obj('chizh', bm, [wood, bark], smooth=False)
# зарубки на боку (метки двора) — тёмные плоские клинья
for zc in (-0.008, 0.008):
    bpy.ops.mesh.primitive_cube_add(size=1)
    k = bpy.context.active_object
    k.name = f'chizh-notch{zc}'
    k.scale = (0.004, 0.012, 0.0018)
    k.location = (CR - 0.0015, 0, zc)
    k.data.materials.append(mat(f'chizh-notch-m{zc}', color=(0.18, 0.12, 0.07, 1), rough=0.9))
    for c in k.users_collection:
        c.objects.unlink(k)
    props.objects.link(k)
    k.parent = chizh

# ------------------------------------------------------------------ бита
# 60 см: рукоять 22 см круглая (Ø 3 см), дальше — плоская лопатка 5,5 × 1,6 см со скруглённым концом
BL = 0.6
HAND = 0.22
bm = bmesh.new()
uvl = bm.loops.layers.uv.verify()
prof = [(-BL / 2, 0.0), (-BL / 2 + 0.003, 0.012), (-BL / 2 + 0.008, 0.0155)]
for i in range(1, 6):
    prof.append((-BL / 2 + HAND * i / 5, 0.015 + 0.0005 * math.sin(i)))
# переход к лопатке
for i in range(1, 4):
    prof.append((-BL / 2 + HAND + 0.03 * i / 3, 0.015 + 0.0125 * i / 3))
blade0 = -BL / 2 + HAND + 0.03
for i in range(1, 8):
    prof.append((blade0 + (BL / 2 - 0.03 - blade0) * i / 7, 0.0275))
# скруглённый конец
for i in range(1, 5):
    a = i / 4 * math.pi / 2
    prof.append((BL / 2 - 0.03 + 0.03 * math.sin(a), 0.0275 * math.cos(a) + 0.0005))
prof[-1] = (BL / 2, 0.0)


def flat(z):
    # лопатка сплющена: толщина 1,6 см против ширины 5,5 см; рукоять круглая
    t = min(1, max(0, (z - (-BL / 2 + HAND)) / 0.03))
    return 1 - t * (1 - 0.016 / 0.055)


lathe(bm, uvl, prof, 14, wob=0.015, flat=flat, mat_of=lambda j, zc: 1 if zc < -BL / 2 + HAND else 0)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
bwood = mat('bita-wood', 'batwood', rough=0.7, tint=(1.0, 0.86, 0.66, 1))
bhand = mat('bita-hand', 'batwood', rough=0.6, tint=(0.75, 0.6, 0.45, 1))
bita = obj('bita', bm, [bwood, bhand])
# изолента на рукояти — своим материалом
bpy.ops.mesh.primitive_cylinder_add(radius=0.0165, depth=0.09, vertices=16, location=(0, 0, 0))
tape = bpy.context.active_object
tape.name = 'bita-tape'
tape.data.materials.append(mat('bita-tape', color=(0.1, 0.1, 0.12, 1), rough=0.45))
for p in tape.data.polygons:
    p.use_smooth = True
for c in tape.users_collection:
    c.objects.unlink(tape)
props.objects.link(tape)
tape.parent = bita
tape.location = (0, 0, -BL / 2 + 0.07)

for o in props.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT / 'chizh.glb'), use_selection=True, export_format='GLB', export_image_format='WEBP',
                          export_image_quality=80, export_yup=True, export_apply=True)
print('готово:', OUT)
