"""Симулятор дирижёра: зритель — сидящий человек MakeHuman (MPFB2, CC0) в повседневной одежде, лёгкий (сотни треугольников).

blender -b --factory-startup --python studio/blender/dirizher_audience.py -- <вид a1…a8> <выход.glb>

Сажает в кресло (таз на сиденье 0,45 м, бёдра вперёд, голени вниз, ладони на коленях), запекает позу в сетку, убирает
скелет, глаза/брови/ресницы, упрощает до ~DZ_TRIS треугольников, текстуры — 256 px. Подошва на z = 0, лицом к −Y
(к сцене — в игре разворачивает зал). В игре — InstancedMesh на места из <зал>.seats.json (dirizher_halls.py).
"""
import importlib
import math
import os
import shutil
import sys

import addon_utils
import bpy
import numpy as np
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
NAME, OUT = args[0], args[1]
ASSETS = 'G:/ai/models/3d/mpfb/data'
TRIS = int(os.environ.get('DZ_TRIS', '900'))

LOOKS = {
    'a1': dict(g=1, age=0.5, w=0.55, race=(1, 0, 0), skin='middleage_caucasian_male', hair='short02', hair_rgb=(60, 46, 34), suit='male_casualsuit01', tint=(0.22, 0.24, 0.3)),
    'a2': dict(g=1, age=0.8, w=0.65, race=(1, 0, 0), skin='old_caucasian_male', hair='short04', hair_rgb=(185, 182, 176), suit='male_casualsuit03', tint=(0.35, 0.3, 0.24)),
    'a3': dict(g=1, age=0.35, w=0.45, race=(0, 0.2, 0.8), skin='young_african_male', hair='short03', hair_rgb=(16, 14, 14), suit='male_casualsuit04', tint=(0.12, 0.13, 0.16)),
    'a4': dict(g=1, age=0.45, w=0.5, race=(0.2, 0.8, 0), skin='young_asian_male', hair='short01', hair_rgb=(20, 18, 18), suit='male_casualsuit06', tint=(0.32, 0.12, 0.1)),
    'a5': dict(g=0, age=0.45, w=0.5, race=(1, 0, 0), skin='young_caucasian_female', hair='bob02', hair_rgb=(120, 70, 40), suit='female_casualsuit01', tint=(0.45, 0.08, 0.1)),
    'a6': dict(g=0, age=0.75, w=0.6, race=(1, 0, 0), skin='old_caucasian_female', hair='bob01', hair_rgb=(170, 160, 150), suit='female_casualsuit02', tint=(0.18, 0.22, 0.4)),
    'a7': dict(g=0, age=0.35, w=0.42, race=(0, 0, 1), skin='young_african_female', hair='afro01', hair_rgb=(18, 14, 12), suit='female_casualsuit01', tint=(0.1, 0.32, 0.22)),
    'a8': dict(g=0, age=0.4, w=0.45, race=(1, 0, 0), skin='young_caucasian_female2', hair='long01', hair_rgb=(205, 165, 100), suit='female_casualsuit02', tint=(0.12, 0.12, 0.13)),
}
L = LOOKS[NAME]

ext_data = bpy.utils.user_resource('EXTENSIONS', path='.user/user_default/mpfb/data', create=True)
if not os.path.exists(os.path.join(ext_data, 'skins', 'young_caucasian_male', 'young_caucasian_male.mhmat')):
    shutil.copytree(ASSETS, ext_data, dirs_exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
addon_utils.enable('bl_ext.user_default.mpfb', default_set=True)


def imp(path, key):
    for m in list(sys.modules):
        if m.endswith(path):
            return getattr(importlib.import_module(m), key)
    raise ValueError(path)


HS = imp('mpfb.services.humanservice', 'HumanService')
AS = imp('mpfb.services.assetservice', 'AssetService')
ES = imp('mpfb.services.exportservice', 'ExportService')
OS_ = imp('mpfb.services.objectservice', 'ObjectService')
TS = imp('mpfb.services.targetservice', 'TargetService')

macro = TS.get_default_macro_info_dict()
macro.update(gender=float(L['g']), cupsize=0.5, firmness=0.5, muscle=0.45, weight=L['w'], height=0.5, proportions=0.55, age=L['age'])
c, a, f = L['race']
macro['race'] = {'caucasian': c, 'asian': a, 'african': f}
human = HS.create_human(macro_detail_dict=macro)
HS.set_character_skin(AS.find_asset_absolute_path(L['skin'] + '.mhmat', asset_subdir='skins'), human, skin_type='GAMEENGINE')
HS.add_builtin_rig(human, 'game_engine')
for sub, fname, kind in [('hair', L['hair'] + '.mhclo', 'Hair'), ('clothes', L['suit'] + '.mhclo', 'Clothes'), ('clothes', 'shoes02.mhclo', 'Clothes')]:
    HS.add_mhclo_asset(AS.find_asset_absolute_path(fname, asset_subdir=sub), human, asset_type=kind, material_type='GAMEENGINE', subdiv_levels=0)

root = ES.create_character_copy(human, name_suffix='_x')
base = OS_.find_object_of_type_amongst_nearest_relatives(root, 'Basemesh')
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = base
base.select_set(True)
bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
base.select_set(False)
ES.bake_modifiers_remove_helpers(base, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=True)
rig = root if root.type == 'ARMATURE' else next(o for o in bpy.data.objects if o.type == 'ARMATURE' and o.name.endswith('_x'))
parts = [o for o in rig.children if o.type == 'MESH']
keep = set([rig] + parts)
for o in list(bpy.data.objects):
    if o not in keep:
        bpy.data.objects.remove(o, do_unlink=True)

# рост → метры, подошва на 0
co = np.array([v.co[:] for v in base.data.vertices])
k = (1.62 if not L['g'] else 1.75) / (co[:, 2].max() - co[:, 2].min())
rig.scale = (k, k, k)
rig.location = (0, 0, -co[:, 2].min() * k)
bpy.context.view_layer.update()


# ---------------------------------------------------------------- цвета
def pixels(img):
    w_, h_ = img.size
    return np.array(img.pixels[:], np.float32).reshape(h_, w_, 4)


def put(img, px):
    img.pixels.foreach_set(px.ravel())
    img.pack()


def recolor(img, rgb, keep_light=False):
    px = pixels(img)
    lum = px[..., :3].mean(-1)
    mask = px[..., 3] > 0.5
    mean = float(np.median(lum[mask])) if mask.any() else float(lum.mean())
    tgt = np.array(rgb, np.float32)
    if keep_light:
        tgt = tgt / 255.0
    px[..., :3] = np.clip(lum[..., None] / max(mean, 1e-3) * tgt, 0, 1)
    put(img, px)


for o in parts:
    for m in o.data.materials:
        if not m or not m.use_nodes:
            continue
        for n in m.node_tree.nodes:
            if n.type != 'TEX_IMAGE' or not n.image or n.image.get('_done'):
                continue
            nm = (n.image.name + ' ' + o.name).lower()
            low = n.image.name.lower()
            if any(k_ in low for k_ in ('normal', '_ao', 'bump', 'spec')):
                continue
            if 'casualsuit' in nm:
                recolor(n.image, L['tint'])
            elif L['hair'] in nm:
                recolor(n.image, L['hair_rgb'], keep_light=True)
            elif 'shoe' in nm:
                recolor(n.image, (0.03, 0.03, 0.035))
            n.image['_done'] = 1
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf and L['hair'] not in o.name:
            for lk in list(nt.links):
                if lk.to_socket == bsdf.inputs['Alpha']:
                    nt.links.remove(lk)
            bsdf.inputs['Alpha'].default_value = 1.0
            bsdf.inputs['Roughness'].default_value = 0.7
        m.surface_render_method = 'DITHERED'

# ---------------------------------------------------------------- поза: сидит, руки на коленях
PB = rig.pose.bones
REST = {b.name: (rig.matrix_world @ b.matrix_local) for b in rig.data.bones}


def bone_head(name):
    bpy.context.view_layer.update()
    return (rig.matrix_world @ PB[name].matrix).translation.copy()


def aim_bone(name, d):
    bpy.context.view_layer.update()
    pb = PB[name]
    M = rig.matrix_world @ pb.matrix
    cur = (M.to_3x3() @ Vector((0, 1, 0))).normalized()
    q = cur.rotation_difference(d.normalized())
    h = M.translation.copy()
    newM = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ M
    pb.matrix = rig.matrix_world.inverted() @ newM
    bpy.context.view_layer.update()


bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
height = 0.45
rootb = PB['Root'] if 'Root' in PB else PB['pelvis']
hip_rest = REST['thigh_l'].translation
thigh_len = (REST['calf_l'].translation - hip_rest).length
dz = (height + 0.085) - hip_rest.z
dy = 0.1 - hip_rest.y
rootb.matrix = rig.matrix_world.inverted() @ Matrix.Translation((0, dy, dz)) @ rig.matrix_world @ rootb.matrix
bpy.context.view_layer.update()
for s, sx in (('l', 1), ('r', -1)):
    hip = bone_head(f'thigh_{s}')
    aim_bone(f'thigh_{s}', Vector((sx * 0.1, -1, -(hip.z - 0.5) / max(thigh_len, 0.1))))
    aim_bone(f'calf_{s}', Vector((0, -0.1, -1)))
    aim_bone(f'foot_{s}', Vector((sx * 0.1, -1, -0.4)))
    # плечо вниз-вперёд, предплечье — к колену
    aim_bone(f'upperarm_{s}', Vector((sx * 0.12, -0.35, -1)))
    elbow = bone_head(f'lowerarm_{s}')
    knee = bone_head(f'calf_{s}')
    aim_bone(f'lowerarm_{s}', (knee + Vector((-sx * 0.06, 0.12, 0.1))) - elbow)
    aim_bone(f'hand_{s}', Vector((-sx * 0.2, -0.8, -0.5)))
sp = PB['spine_01']
sp.rotation_mode = 'XYZ'
sp.rotation_euler = (math.radians(-6), 0, 0)  # чуть откинулся на спинку
bpy.ops.object.mode_set(mode='OBJECT')

# запечь позу в сетки, скелет — прочь
for o in parts:
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        if m.type == 'ARMATURE':
            bpy.ops.object.modifier_apply(modifier=m.name)
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
for o in parts:
    o.vertex_groups.clear()
bpy.data.objects.remove(rig, do_unlink=True)

# одна сетка, упростить
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    me = o.data
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[1])
    if me.uv_layers:
        me.uv_layers[0].name = 'UVMap'
    o.select_set(True)
bpy.context.view_layer.objects.active = base
bpy.ops.object.join()
body = base
body.name = 'viewer'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
n0 = sum(len(p.vertices) - 2 for p in body.data.polygons)
dm = body.modifiers.new('dec', 'DECIMATE')
dm.ratio = min(1.0, TRIS / max(1, n0))
bpy.ops.object.modifier_apply(modifier='dec')
# рост сидящего: макушка (без выбросов) — 1,30 м у женщин, 1,38 м у мужчин (причёска сверху — как есть)
co = np.array([v.co[:] for v in body.data.vertices])
top = float(np.percentile(co[:, 2], 99.0))
kk = (1.38 if L['g'] else 1.30) / max(top, 0.1)
body.scale = (kk, kk, kk)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
co = np.array([v.co[:] for v in body.data.vertices])
print('треугольников:', n0, '→', sum(len(p.vertices) - 2 for p in body.data.polygons), 'высота', round(float(co[:, 2].max()), 2))
for im in bpy.data.images:
    if im.size[0] > 256:
        im.scale(256, 256)
bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format='GLB', export_animations=False, export_skins=False,
                          export_morph=False, export_image_format='WEBP', export_image_quality=75, export_yup=True)
print('готово', OUT, os.path.getsize(OUT) // 1024, 'КБ')
