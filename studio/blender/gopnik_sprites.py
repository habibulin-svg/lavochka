"""Гопник: собранная модель (.blend из gopnik_build.py) → скелет, анимации, toon-рендер сбоку по кадрам.

blender -b -P studio/blender/gopnik_sprites.py -- <модель.blend> <папка кадров> [высота кадра, px] [--only имя,имя]

Кадры: <папка>/<анимация>_<NN>.png, фон прозрачный, персонаж смотрит вправо. Атлас собирает post/atlas.py.
Позы и тайминги — gopnik_anims.py (без bpy). Рядом с кадрами пишется meta.json: fps, loop и точки
каждого кадра — рука к камере — правая (для оружия), дальняя рука, голова (для кепки), в пикселях кадра.
Кости ставятся по долям роста H — та же разметка, что BODY в gopnik_build.py.
"""
import json
import math
import os
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
from gopnik_anims import ANIMS  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
ONLY = None
if '--only' in args:
    i = args.index('--only')
    ONLY = set(args[i + 1].split(','))
    del args[i:i + 2]
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
    b.roll = 0
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
    head = o.vertex_groups.get('head') or o.vertex_groups.new(name='head')
    rigid = [v.index for v in o.data.vertices if o.name == 'slot_cap' or v.co.z > 0.47 * H]
    for g in o.vertex_groups:
        if g != head:
            g.remove(rigid)
    if rigid:
        head.add(rigid, 1.0, 'REPLACE')

# --- позы: углы в градусах; кость вниз (руки, ноги): + — вперёд; кость вверх (корпус, голова): + — наклон вперёд ---
pb = rig.pose.bones
UP_ROT = {'root', 'hips', 'spine', 'head'}
for p in pb:
    # руки и ноги: сначала отведение (Z), потом взмах (X) — отведённая рука остаётся снаружи при любом взмахе,
    # иначе поднятая вверх рука уходит внутрь огромной головы
    p.rotation_mode = 'XYZ' if p.name in UP_ROT else 'ZYX'
UP = {'hips', 'spine', 'head'}
SLOTS = {o.name[5:]: o for o in meshes if o.name.startswith('slot_')}

# лёд для «заморожен»: полупрозрачный голубой брусок вокруг бойца
bpy.ops.mesh.primitive_cube_add(size=1)
ice = bpy.context.active_object
ice.name = 'ice'
ice.scale = (0.96 * H, 0.62 * H, 1.12 * H)
ice.location = (-0.05 * H, 0, 0.55 * H)
bev = ice.modifiers.new('bevel', 'BEVEL')
bev.width = 0.06 * H
bev.segments = 2
im = bpy.data.materials.new('ice')
im.use_nodes = True
im.surface_render_method = 'BLENDED'
nt = im.node_tree
nt.nodes.clear()
o_ = nt.nodes.new('ShaderNodeOutputMaterial')
mx = nt.nodes.new('ShaderNodeMixShader')
tr = nt.nodes.new('ShaderNodeBsdfTransparent')
em = nt.nodes.new('ShaderNodeEmission')
em.inputs['Color'].default_value = (0.55, 0.85, 1.0, 1)
mx.inputs['Fac'].default_value = 0.32
nt.links.new(tr.outputs[0], mx.inputs[1])
nt.links.new(em.outputs[0], mx.inputs[2])
nt.links.new(mx.outputs[0], o_.inputs[0])
ice.data.materials.append(im)
ice.hide_render = True


def side_vec(v):
    return v if isinstance(v, (tuple, list)) else (v, 0, 0)


def apply(pose):
    """Поза → кости. Ключи: кости (угол или (вперёд, кручение, наружу)), lean, reach.R/L (растяжка руки), z, fwd (доли H), rot (всё тело,
    + — вперёд, вокруг точки pivot по высоте), scale (число или (вширь, вверх, вперёд)), only/hide (слоты), ice."""
    for p in pb:
        p.rotation_euler = (0, 0, 0)
        p.location = (0, 0, 0)
        p.scale = (1, 1, 1)
    for name, v in pose.items():
        if name not in pb:
            continue
        x, y, z = side_vec(v)
        # «наружу» у левой и правой стороны — в разные стороны
        sgn = -1 if name.endswith('.L') else 1
        if name not in UP:
            x = -x  # у кости вниз (руки, ноги) локальная ось Z смотрит назад
        pb[name].rotation_euler = (math.radians(x), math.radians(y) * sgn, math.radians(z) * sgn)
    pb['spine'].rotation_euler.x += math.radians(pose.get('lean', 0))
    # «резиновая» рука: плечо тянется, кисть сжимается обратно, чтобы кулак не раздувался
    for s in ('L', 'R'):
        k = pose.get('reach.' + s, 1)
        pb['upper_arm.' + s].scale = (1, k, 1)
        pb['hand.' + s].scale = (1, 1 / k, 1)
    # root: локальные оси X — вбок (в глубину кадра), Y — вверх, Z — вперёд
    rot = math.radians(pose.get('rot', 0))
    sc = pose.get('scale', 1)
    sc = sc if isinstance(sc, (tuple, list)) else (sc, sc, sc)
    yaw = math.radians(pose.get('yaw', 0))
    M = Euler((rot, yaw, 0), 'XYZ').to_matrix() @ Matrix.Diagonal(sc)
    piv = Vector((0, pose.get('pivot', 0.5) * H, 0))
    loc = piv - M @ piv + Vector((0, pose.get('z', 0) * H, pose.get('fwd', 0) * H))
    pb['root'].location = loc
    pb['root'].rotation_euler = (rot, yaw, 0)
    pb['root'].scale = sc
    only, hide = pose.get('only'), set(pose.get('hide', ()))
    for s, o in SLOTS.items():
        o.hide_render = (only is not None and s not in only) or s in hide
    ice.hide_render = not pose.get('ice')
    bpy.context.view_layer.update()


# --- повернуть персонажа лицом вправо (перёд −Y → +X); к камере — правая сторона (.R) ---
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

# камера: орто сбоку, кадр с запасом под прыжок, сальто и руки вверх
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


def px(world):
    u = world_to_camera_view(scene, cam, world)
    return round(u.x * FRAME_H, 1), round((1 - u.y) * FRAME_H, 1)


def bone_point(name, t):
    """Точка на кости (t: 0 — начало, 1 — конец) и её угол в кадре: 0 — вправо, + — против часовой."""
    b = pb[name]
    a = rig.matrix_world @ b.head
    c = rig.matrix_world @ b.tail
    x0, y0 = px(a)
    x1, y1 = px(c)
    x, y = px(a.lerp(c, t))
    return [x, y, round(math.degrees(math.atan2(y0 - y1, x1 - x0)))]


os.makedirs(OUT, exist_ok=True)
meta_path = os.path.join(OUT, 'meta.json')
meta = json.load(open(meta_path, encoding='utf-8')) if os.path.exists(meta_path) and ONLY else {}
meta.setdefault('frameH', FRAME_H)
bpy.context.view_layer.update()
meta['origin'] = list(px(rig.matrix_world @ Vector((0, 0, 0))))  # точка подошв в покое
meta.setdefault('anims', {})
for name, a in ANIMS.items():
    if ONLY and name not in ONLY:
        continue
    for f in os.listdir(OUT):
        if f.startswith(name + '_') and f[len(name) + 1:-4].isdigit():
            os.remove(os.path.join(OUT, f))
    pts = []
    for k, pose in enumerate(a['frames']):
        apply(pose)
        scene.render.filepath = os.path.join(OUT, f'{name}_{k:02d}.png')
        bpy.ops.render.render(write_still=True)
        # кисть — середина кости hand: там кулак; голова — у верха лба, под кепку
        pts.append({'hand': bone_point('hand.R', 0.45), 'hand2': bone_point('hand.L', 0.45),
                    'head': bone_point('head', 0.62), 'foot': bone_point('foot.R', 0)})
    meta['anims'][name] = {'fps': a['fps'], 'loop': a['loop'], 'points': pts}
    print('готово', name, len(a['frames']), flush=True)
json.dump(meta, open(meta_path, 'w', encoding='utf-8'), ensure_ascii=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'rigged.blend'))
print('кадры:', {k: len(v['frames']) for k, v in ANIMS.items() if not ONLY or k in ONLY}, '→', OUT)
