"""Дворовый спорт: реквизит «Пекаря» — консервная банка и биты-палки — Blender → glTF для three.js.

blender -b --factory-startup --python studio/blender/dvor_pekar.py -- <папка текстур> <папка выхода>

Текстуры — те же, что у двора городков (G:/temp/gk3d/tex: concrete, rodwood, batwood, dirt).
Выход: pekar.glb — «can» (жестяная банка из-под тушёнки Ø 10 × 12 см: рёбра жёсткости, загнутые края, выцветшая
бумажная этикетка, вмятина), «palka» (бита-палка 75 см: чуть кривая, со снятой корой у рукояти и сучками,
дочерний «palka-tape» — изолента на рукояти, игра перекрашивает её в цвет игрока).
Оси: Blender z — вверх; glTF → three (x, z, −y).
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
rnd = random.Random(11)

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


def obj(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    props.objects.link(o)
    return o


# ------------------------------------------------------------------ банка
# профиль по высоте: (z, радиус) — загнутый край, рёбра жёсткости на боку, край сверху; этикетка — полоса посередине
R = 0.05
H = 0.12
prof = [(0.0, R - 0.004), (0.003, R + 0.0015), (0.007, R)]
for i in range(9):
    z = 0.016 + i * 0.011
    prof += [(z, R), (z + 0.0035, R - 0.0018), (z + 0.007, R)]
prof += [(H - 0.007, R), (H - 0.003, R + 0.0015), (H, R - 0.004)]
SEG = 40
bm = bmesh.new()
uvl = bm.loops.layers.uv.verify()
rings = []
for z, r in prof:
    ring = []
    for k in range(SEG):
        a = 2 * math.pi * k / SEG
        rr = r
        # вмятина сбоку — по этой банке уже попадали
        da = math.atan2(math.sin(a - 0.7), math.cos(a - 0.7))
        if abs(da) < 0.6 and 0.04 < z < 0.09:
            rr -= 0.006 * (1 - abs(da) / 0.6) * math.sin((z - 0.04) / 0.05 * math.pi)
        ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
    rings.append(ring)
LABEL0, LABEL1 = 0.02, 0.1
for j in range(len(rings) - 1):
    zc = (prof[j][0] + prof[j + 1][0]) / 2
    for k in range(SEG):
        f = bm.faces.new((rings[j][k], rings[j][(k + 1) % SEG], rings[j + 1][(k + 1) % SEG], rings[j + 1][k]))
        # этикетка — не по всему кругу: оборвана с одной стороны
        f.material_index = 1 if LABEL0 < zc < LABEL1 and not (14 <= k <= 21) else 0
        for lp in f.loops:
            c = lp.vert.co
            u = (math.atan2(c.y, c.x) / (2 * math.pi) + 0.5)
            lp[uvl].uv = (u * 2.0, c.z / H)
# дно и крышка (крышка вскрыта ножом и отогнута — сверху темно внутри)
bot = bm.faces.new(rings[0][::-1])
top = bm.faces.new(rings[-1])
bot.material_index = 0
top.material_index = 2
for f in (bot, top):
    for lp in f.loops:
        lp[uvl].uv = (lp.vert.co.x * 5 + 0.5, lp.vert.co.y * 5 + 0.5)
tin = mat('can-tin', 'concrete', rough=0.32, metal=0.85, tint=(0.82, 0.8, 0.74, 1))
label = mat('can-label', 'dirt', rough=0.9, tint=(0.95, 0.42, 0.26, 1))
inside = mat('can-inside', color=(0.08, 0.07, 0.06, 1), rough=0.6, metal=0.4)
can = obj('can', bm, [tin, label, inside])
# отогнутая крышка
bm = bmesh.new()
uvl = bm.loops.layers.uv.verify()
lid = [bm.verts.new((0.047 + 0.047 * math.cos(2 * math.pi * k / 24), 0.047 * math.sin(2 * math.pi * k / 24), 0)) for k in range(24)]
f = bm.faces.new(lid)
for lp in f.loops:
    lp[uvl].uv = (lp.vert.co.x * 5 + 0.5, lp.vert.co.y * 5 + 0.5)
bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.0012)
lido = obj('can-lid', bm, [tin])
lido.parent = can
# петля — на краю банки со стороны −x: крышка отогнута вверх
lido.location = (-0.047, 0, H + 0.001)
lido.rotation_euler = (0, -1.25, 0)

# ------------------------------------------------------------------ палка-бита
# 75 см, от рукояти (z = 0) к концу; ось чуть гуляет — палка из ветки, кривизна по синусу; кора к концу темнее
L = 0.75
N = 18
SEGP = 12
bm = bmesh.new()
uvl = bm.loops.layers.uv.verify()
rings = []
for i in range(N + 1):
    t = i / N
    z = t * L - L / 2
    r = 0.017 + 0.007 * t + 0.0015 * math.sin(t * 17)
    ox = 0.012 * math.sin(t * math.pi * 1.3) + 0.004 * math.sin(t * 9)
    oy = 0.006 * math.sin(t * math.pi * 2.1 + 0.4)
    ring = []
    for k in range(SEGP):
        a = 2 * math.pi * k / SEGP
        rr = r * (1 + 0.06 * math.sin(a * 3 + i))
        ring.append(bm.verts.new((ox + rr * math.cos(a), oy + rr * math.sin(a), z)))
    rings.append(ring)
for j in range(N):
    for k in range(SEGP):
        f = bm.faces.new((rings[j][k], rings[j][(k + 1) % SEGP], rings[j + 1][(k + 1) % SEGP], rings[j + 1][k]))
        # кора на дальней половине, у рукояти — ошкурено
        f.material_index = 1 if j > N * 0.45 else 0
        for lp in f.loops:
            c = lp.vert.co
            lp[uvl].uv = (math.atan2(c.y - 0, c.x) / (2 * math.pi) + 0.5, (c.z + L / 2) / L * 3)
for ring, idx in ((rings[0][::-1], 2), (rings[-1], 2)):
    f = bm.faces.new(ring)
    f.material_index = idx
    for lp in f.loops:
        lp[uvl].uv = (lp.vert.co.x * 20 + 0.5, lp.vert.co.y * 20 + 0.5)
wood = mat('palka-wood', 'batwood', rough=0.7, tint=(1.0, 0.88, 0.7, 1))
bark = mat('palka-bark', 'rodwood', rough=0.85, tint=(0.62, 0.5, 0.38, 1))
endg = mat('palka-end', 'batwood', rough=0.8, tint=(0.9, 0.75, 0.55, 1))
palka = obj('palka', bm, [wood, bark, endg])
# сучки — короткие обрубки
for zt, a in ((0.62, 0.8), (0.8, 3.6)):
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.008, radius2=0.005, depth=0.025)
    k = bpy.context.active_object
    k.name = f'palka-knot{zt}'
    k.data.materials.append(bark)
    for c in k.users_collection:
        c.objects.unlink(k)
    props.objects.link(k)
    k.parent = palka
    z = zt * L - L / 2
    r = 0.017 + 0.007 * zt
    k.location = (0.012 * math.sin(zt * math.pi * 1.3) + r * math.cos(a), r * math.sin(a), z)
    k.rotation_euler = (math.sin(a) * -1.4, math.cos(a) * 1.4, 0)
# изолента на рукояти — свой материал, игра красит её в цвет игрока
bpy.ops.mesh.primitive_cylinder_add(radius=0.0195, depth=0.11, vertices=16, location=(0, 0, 0))
tape = bpy.context.active_object
tape.name = 'palka-tape'
tape.data.materials.append(mat('palka-tape', color=(0.1, 0.1, 0.12, 1), rough=0.45))
for p in tape.data.polygons:
    p.use_smooth = True
for c in tape.users_collection:
    c.objects.unlink(tape)
props.objects.link(tape)
tape.parent = palka
tape.location = (0.012 * math.sin(0.08 * math.pi * 1.3), 0, -L / 2 + 0.07)

for o in props.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT / 'pekar.glb'), use_selection=True, export_format='GLB', export_image_format='WEBP',
                          export_image_quality=80, export_yup=True, export_apply=True)
print('готово:', OUT)
