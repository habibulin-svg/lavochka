"""Гопник: собранная модель (.blend из gopnik_build.py) → скелет, анимации, toon-рендер сбоку по кадрам.

blender -b -P studio/blender/gopnik_sprites.py -- <модель.blend> <папка кадров> [высота кадра, px]

Кадры: <папка>/<анимация>_<NN>.png, фон прозрачный, персонаж смотрит вправо. Атлас собирает post/atlas.py.
Кости ставятся по долям роста H — та же разметка, что BODY в gopnik_build.py.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
FRAME_H = int(args[2]) if len(args) > 2 else 96

bpy.ops.wm.open_mainfile(filepath=SRC)
scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == 'MESH']
H = max(v.co.z for o in meshes for v in o.data.vertices)

# --- скелет (z, x — доли H; перёд −Y) ---
BONES = [
    # имя, голова, хвост, родитель
    ('root', (0, 0, 0), (0, 0, 0.12), None),
    ('hips', (0, 0, 0.24), (0, 0, 0.32), 'root'),
    ('spine', (0, 0, 0.32), (0, 0, 0.45), 'hips'),
    ('head', (0, 0, 0.45), (0, 0, 0.98), 'spine'),
]
for s, k in (('L', 1), ('R', -1)):
    BONES += [
        (f'upper_arm.{s}', (k * 0.19, 0, 0.43), (k * 0.215, 0, 0.335), 'spine'),
        (f'forearm.{s}', (k * 0.215, 0, 0.335), (k * 0.225, 0, 0.245), f'upper_arm.{s}'),
        (f'hand.{s}', (k * 0.225, 0, 0.245), (k * 0.225, 0, 0.16), f'forearm.{s}'),
        (f'thigh.{s}', (k * 0.085, 0, 0.25), (k * 0.088, 0, 0.145), 'hips'),
        (f'shin.{s}', (k * 0.088, 0, 0.145), (k * 0.09, 0, 0.055), f'thigh.{s}'),
        (f'foot.{s}', (k * 0.09, 0, 0.055), (k * 0.09, -0.07, 0.02), f'shin.{s}'),
    ]

arm_data = bpy.data.armatures.new('gopnik_rig')
rig = bpy.data.objects.new('gopnik_rig', arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name, h, t, parent in BONES:
    b = arm_data.edit_bones.new(name)
    b.head = Vector(h) * H
    b.tail = Vector(t) * H
    if parent:
        b.parent = arm_data.edit_bones[parent]
        b.use_connect = (b.head - b.parent.tail).length < 1e-4
bpy.ops.object.mode_set(mode='OBJECT')

# автовеса; кепка целиком на голову
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
# кепка и голова выше шеи — жёстко на кость головы, иначе между ними щель при наклоне
for o in meshes:
    vgs = {g.index: g for g in o.vertex_groups}
    head = o.vertex_groups.get('head') or o.vertex_groups.new(name='head')
    rigid = [v.index for v in o.data.vertices if o.name == 'slot_cap' or v.co.z > 0.47 * H]
    for g in o.vertex_groups:
        if g != head:
            g.remove(rigid)
    if rigid:
        head.add(rigid, 1.0, 'REPLACE')

# --- анимации: углы в градусах по локальной оси X кости (кость вниз: + — вперёд), позиция root ---
pb = rig.pose.bones
for p in pb:
    p.rotation_mode = 'XYZ'


def key(frame, pose, root_z=0.0, lean=0.0):
    scene.frame_set(frame)
    for p in pb:
        p.rotation_euler = (0, 0, 0)
    pb['root'].location = (0, 0, 0)
    for name, deg in pose.items():
        pb[name].rotation_euler = (math.radians(deg), 0, 0)
    pb['root'].location = (0, root_z * H, 0)  # у root локальный Y = вверх
    pb['spine'].rotation_euler.x += math.radians(lean)
    for p in pb:
        p.keyframe_insert('rotation_euler', frame=frame)
    pb['root'].keyframe_insert('location', frame=frame)


def sym(a, b, **extra):
    """Шаг: левая сторона a, правая b (бёдра, голени, руки)."""
    t, s, ar = a
    t2, s2, ar2 = b
    d = {'thigh.L': t, 'shin.L': s, 'upper_arm.R': ar, 'thigh.R': t2, 'shin.R': s2, 'upper_arm.L': ar2}
    d.update(extra)
    return d


ANIMS = {}

# стоит: дышит, голова чуть кивает, сутулится
start = 1
n = 16
for i in range(n + 1):
    ph = math.sin(2 * math.pi * i / n)
    key(start + i, {'head': 3 + 2 * ph, 'upper_arm.L': 2 * ph, 'upper_arm.R': 2 * ph}, root_z=-0.004 * (1 + ph), lean=6)
ANIMS['idle'] = (start, start + n - 1)

# идёт: вразвалку, 12 кадров
start = 30
n = 12
for i in range(n + 1):
    a = 2 * math.pi * i / n
    sw = math.sin(a)
    bob = abs(math.cos(a))
    key(start + i, {
        'thigh.L': -28 * sw, 'thigh.R': 28 * sw,
        'shin.L': 35 * max(0, -math.cos(a + 0.6)), 'shin.R': 35 * max(0, math.cos(a + 0.6)),
        'upper_arm.L': 22 * sw, 'upper_arm.R': -22 * sw,
        'forearm.L': -15, 'forearm.R': -15, 'head': 4,
    }, root_z=0.02 * bob - 0.01, lean=8)
ANIMS['walk'] = (start, start + n - 1)

# прыжок: присел — оттолкнулся — в воздухе — приземлился
start = 50
JUMP = [
    ({'thigh.L': -30, 'thigh.R': -30, 'shin.L': 55, 'shin.R': 55, 'upper_arm.L': 20, 'upper_arm.R': 20}, -0.05, 15),
    ({'thigh.L': 10, 'thigh.R': 10, 'shin.L': 5, 'shin.R': 5, 'upper_arm.L': -60, 'upper_arm.R': -60}, 0.06, -4),
    ({'thigh.L': -40, 'thigh.R': -20, 'shin.L': 60, 'shin.R': 40, 'upper_arm.L': -90, 'upper_arm.R': -80}, 0.22, 0),
    ({'thigh.L': -45, 'thigh.R': -35, 'shin.L': 70, 'shin.R': 60, 'upper_arm.L': -100, 'upper_arm.R': -95}, 0.28, 0),
    ({'thigh.L': -30, 'thigh.R': -25, 'shin.L': 50, 'shin.R': 45, 'upper_arm.L': -70, 'upper_arm.R': -60}, 0.2, 2),
    ({'thigh.L': -10, 'thigh.R': -10, 'shin.L': 15, 'shin.R': 15, 'upper_arm.L': -30, 'upper_arm.R': -30}, 0.07, 4),
    ({'thigh.L': -35, 'thigh.R': -35, 'shin.L': 60, 'shin.R': 60, 'upper_arm.L': 25, 'upper_arm.R': 25}, -0.06, 18),
    ({'thigh.L': -10, 'thigh.R': -10, 'shin.L': 15, 'shin.R': 15}, -0.01, 8),
]
for i, (pose, z, lean) in enumerate(JUMP):
    key(start + i, pose, root_z=z, lean=lean)
ANIMS['jump'] = (start, start + len(JUMP) - 1)
for fc in (rig.animation_data.action.fcurves if hasattr(rig.animation_data.action, 'fcurves') else []):
    for kp in fc.keyframe_points:
        kp.interpolation = 'LINEAR'

# --- повернуть персонажа лицом вправо (вперёд −Y → +X) ---
rig.rotation_euler = (0, 0, math.radians(90))

# --- toon-материалы: две ступени света + Freestyle-контур ---
for m in bpy.data.materials:
    if not m.name.startswith('gop_'):
        continue
    col = m.diffuse_color[:3]
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    dif = nt.nodes.new('ShaderNodeBsdfDiffuse')
    s2r = nt.nodes.new('ShaderNodeShaderToRGB')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    mix = nt.nodes.new('ShaderNodeMix')
    emi = nt.nodes.new('ShaderNodeEmission')
    ramp.color_ramp.interpolation = 'CONSTANT'
    ramp.color_ramp.elements[0].color = (0.62, 0.62, 0.7, 1)  # тень — чуть холоднее
    ramp.color_ramp.elements[1].position = 0.35
    ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1
    mix.inputs['A'].default_value = (*col, 1)
    nt.links.new(dif.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs['Color'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], emi.inputs['Color'])
    nt.links.new(emi.outputs[0], out.inputs[0])

sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 3
sun.rotation_euler = (math.radians(50), math.radians(-25), math.radians(-30))
scene.collection.objects.link(sun)

scene.render.engine = 'BLENDER_EEVEE'
scene.render.film_transparent = True
scene.render.use_freestyle = True
scene.render.line_thickness_mode = 'ABSOLUTE'
scene.render.line_thickness = 1.0
ls = scene.view_layers[0].freestyle_settings.linesets[0] if scene.view_layers[0].freestyle_settings.linesets else scene.view_layers[0].freestyle_settings.linesets.new('outline')
ls.select_by_visibility = True
ls.select_silhouette = True
ls.select_border = True
ls.select_crease = False
if ls.linestyle is None:
    ls.linestyle = bpy.data.linestyles.new('outline')
ls.linestyle.color = (0.04, 0.04, 0.05)
ls.linestyle.thickness = 1.0
scene.view_settings.view_transform = 'Standard'

# камера: орто сбоку, кадр с запасом под прыжок и руки вверх
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
cam.data.type = 'ORTHO'
span = 1.5 * H
cam.data.ortho_scale = span
cam.location = (0, -10 * H, span / 2 - 0.1 * H)
cam.rotation_euler = (math.radians(90), 0, 0)
scene.camera = cam
scene.render.resolution_x = FRAME_H
scene.render.resolution_y = FRAME_H
scene.render.resolution_percentage = 100
scene.render.filter_size = 0.8

os.makedirs(OUT, exist_ok=True)
for name, (a, b) in ANIMS.items():
    for k, f in enumerate(range(a, b + 1)):
        scene.frame_set(f)
        scene.render.filepath = os.path.join(OUT, f'{name}_{k:02d}.png')
        bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'rigged.blend'))
print('кадры:', {k: b - a + 1 for k, (a, b) in ANIMS.items()}, '→', OUT)
