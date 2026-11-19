"""Симулятор дирижёра: музыкант — человек MakeHuman (MPFB2, CC0) в концертном чёрном.

blender -b --factory-startup --python studio/blender/dirizher_people.py -- <вид> <выход.glb> <сцена.blend>

Виды (LOOKS): m1…m5, f1…f5 — музыканты, maestro — дирижёр. Мужчины — костюм male_elegantsuit01, перекрашенный в чёрный
(рубашка остаётся белой, галстук — чёрный), женщины — female_elegantsuit01 целиком в чёрном. Кожа, глаза, брови,
причёска, возраст, рост — у каждого свои. Скелет game_engine с исходными именами костей (позы и анимации под инструменты
делает dirizher_anims.py по сохранённой сцене). Рост — по LOOKS, подошва на z = 0, лицом к −Y.
Ассеты MPFB — как в gorodki_mpfb.py (G:/ai/models/3d/mpfb/data, аддон mpfb 2.0.18).
"""
import importlib
import os
import shutil
import sys

import addon_utils
import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
NAME, OUT, BLEND = args[0], args[1], args[2]
ASSETS = 'G:/ai/models/3d/mpfb/data'

LOOKS = {
    'm1': dict(g=1, macro=dict(muscle=0.5, weight=0.5, height=0.5, proportions=0.6, age=0.45), race=(1, 0, 0), h=1.78,
               skin='young_caucasian_male', eyes='blue', brows='eyebrow001', hair='short02', hair_rgb=(70, 50, 36), shoes='shoes01'),
    'm2': dict(g=1, macro=dict(muscle=0.45, weight=0.7, height=0.4, proportions=0.5, age=0.7), race=(1, 0, 0), h=1.74,
               skin='middleage_caucasian_male', eyes='grey', brows='eyebrow007', hair='short04', hair_rgb=(150, 146, 140), shoes='shoes01'),
    'm3': dict(g=1, macro=dict(muscle=0.5, weight=0.45, height=0.6, proportions=0.6, age=0.4), race=(0.1, 0.9, 0), h=1.76,
               skin='young_asian_male', eyes='brown', brows='eyebrow010', hair='short01', hair_rgb=(20, 18, 18), shoes='shoes02'),
    'm4': dict(g=1, macro=dict(muscle=0.55, weight=0.55, height=0.7, proportions=0.6, age=0.5), race=(0, 0, 1), h=1.84,
               skin='young_african_male', eyes='brown', brows='eyebrow004', hair='short03', hair_rgb=(16, 14, 14), shoes='shoes02'),
    'm5': dict(g=1, macro=dict(muscle=0.4, weight=0.35, height=0.55, proportions=0.7, age=0.33), race=(1, 0, 0), h=1.80,
               skin='young_caucasian_male', eyes='lightblue', brows='eyebrow002', hair='short02', hair_rgb=(190, 150, 96), shoes='shoes01'),
    'f1': dict(g=0, macro=dict(muscle=0.4, weight=0.45, height=0.5, proportions=0.6, age=0.4), race=(1, 0, 0), h=1.68,
               skin='young_caucasian_female', eyes='brown', brows='eyebrow009', hair='ponytail01', hair_rgb=(92, 60, 36), shoes='shoes03'),
    'f2': dict(g=0, macro=dict(muscle=0.4, weight=0.5, height=0.4, proportions=0.5, age=0.65), race=(1, 0, 0), h=1.64,
               skin='middleage_caucasian_female', eyes='bluegreen', brows='eyebrow011', hair='bob02', hair_rgb=(120, 80, 60), shoes='shoes03'),
    'f3': dict(g=0, macro=dict(muscle=0.4, weight=0.4, height=0.45, proportions=0.6, age=0.35), race=(0, 1, 0), h=1.62,
               skin='young_asian_female', eyes='brown', brows='eyebrow012', hair='bob01', hair_rgb=(18, 16, 16), shoes='shoes04'),
    'f4': dict(g=0, macro=dict(muscle=0.45, weight=0.5, height=0.6, proportions=0.6, age=0.45), race=(0, 0, 1), h=1.72,
               skin='young_african_female', eyes='brown', brows='eyebrow005', hair='afro01', hair_rgb=(18, 14, 12), shoes='shoes04'),
    'f5': dict(g=0, macro=dict(muscle=0.35, weight=0.4, height=0.5, proportions=0.7, age=0.3), race=(1, 0, 0), h=1.70,
               skin='young_caucasian_female2', eyes='blue', brows='eyebrow003', hair='braid01', hair_rgb=(210, 170, 110), shoes='shoes03'),
    'maestro': dict(g=1, macro=dict(muscle=0.5, weight=0.5, height=0.6, proportions=0.65, age=0.62), race=(1, 0, 0), h=1.80,
                    skin='middleage_caucasian_male', eyes='grey', brows='eyebrow007', hair='short04', hair_rgb=(176, 172, 166), shoes='shoes01'),
}
L = LOOKS[NAME]
SUIT = 'male_elegantsuit01' if L['g'] else 'female_elegantsuit01'

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
macro.update(gender=float(L['g']), cupsize=0.5, firmness=0.5, **L['macro'])
c, a, f = L['race']
macro['race'] = {'caucasian': c, 'asian': a, 'african': f}
human = HS.create_human(macro_detail_dict=macro)
HS.set_character_skin(AS.find_asset_absolute_path(L['skin'] + '.mhmat', asset_subdir='skins'), human, skin_type='GAMEENGINE')
HS.add_builtin_rig(human, 'game_engine')
for sub, fname, kind in [('eyes', 'high-poly.mhclo', 'Eyes'), ('eyebrows', L['brows'] + '.mhclo', 'Eyebrows'),
                         ('eyelashes', 'eyelashes01.mhclo', 'Eyelashes'), ('hair', L['hair'] + '.mhclo', 'Hair'),
                         ('clothes', SUIT + '.mhclo', 'Clothes'), ('clothes', L['shoes'] + '.mhclo', 'Clothes')]:
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


def part(key):
    return next((o for o in parts if key in o.name), None)


eyes = part('high-poly')
if eyes:
    img_path = os.path.join(ASSETS, 'eyes', 'materials', L['eyes'] + '_eye.png')
    for m in eyes.data.materials:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE':
                n.image = bpy.data.images.load(img_path)


def pixels(img):
    w_, h_ = img.size
    return np.array(img.pixels[:], np.float32).reshape(h_, w_, 4)


def put(img, px):
    img.pixels.foreach_set(px.ravel())
    img.pack()


def recolor(img, rgb):
    px = pixels(img)
    lum = px[..., :3].mean(-1)
    mask = px[..., 3] > 0.5
    mean = float(np.median(lum[mask])) if mask.any() else float(lum.mean())
    tgt = np.array(rgb, np.float32) / 255.0
    px[..., :3] = np.clip(lum[..., None] / max(mean, 1e-3) * tgt, 0, 1)
    put(img, px)


def suit_black(img, male):
    """Костюм → концертный чёрный: ткань — угольно-чёрная с сохранённой светотенью; у мужчин белая рубашка остаётся,
    галстук (насыщенный цвет) — чёрный."""
    px = pixels(img)
    rgb = px[..., :3]
    lum = rgb.mean(-1)
    sat = rgb.max(-1) - rgb.min(-1)
    shade = np.clip(lum / max(float(np.median(lum)), 1e-3), 0.4, 1.6)
    black = np.stack([0.035 * shade, 0.035 * shade, 0.04 * shade], -1)
    if male:
        shirt = (lum > 0.62) & (sat < 0.12)
        out = np.where(shirt[..., None], rgb, black)
    else:
        out = black
    px[..., :3] = out
    put(img, px)


for o in parts:
    for m in o.data.materials:
        if not m or not m.use_nodes:
            continue
        for n in m.node_tree.nodes:
            if n.type != 'TEX_IMAGE' or not n.image or n.image.get('_done'):
                continue
            nm = (n.image.name + ' ' + o.name).lower()
            if 'elegantsuit' in nm and 'diffuse' in n.image.name.lower():
                suit_black(n.image, bool(L['g']))
                n.image['_done'] = 1
            elif L['hair'] in nm and 'normal' not in n.image.name.lower() and 'ao' not in n.image.name.lower():
                recolor(n.image, L['hair_rgb'])
                n.image['_done'] = 1
            elif 'eyebrow' in nm:
                recolor(n.image, tuple(int(c_ * 0.8) for c_ in L['hair_rgb']))
                n.image['_done'] = 1
            elif 'shoe' in nm and not any(k_ in n.image.name.lower() for k_ in ('normal', '_ao', 'bump', 'spec')):
                recolor(n.image, (20, 20, 22))
                n.image['_done'] = 1

for o in parts:
    for m in o.data.materials:
        if not m or not m.use_nodes:
            continue
        cut = any(k in o.name for k in ('eyebrow', 'eyelash', 'high-poly', L['hair']))
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue
        if not cut:
            for lk in list(nt.links):
                if lk.to_socket == bsdf.inputs['Alpha']:
                    nt.links.remove(lk)
            bsdf.inputs['Alpha'].default_value = 1.0
        m.surface_render_method = 'DITHERED'
        if 'shoe' in o.name.lower():
            # концертные туфли — чёрные, лаковые (текстура у части моделей белая)
            for lk in list(nt.links):
                if lk.to_socket == bsdf.inputs['Base Color']:
                    nt.links.remove(lk)
            bsdf.inputs['Base Color'].default_value = (0.015, 0.015, 0.017, 1)
            bsdf.inputs['Roughness'].default_value = 0.3
        if 'high-poly' in o.name:
            bsdf.inputs['Roughness'].default_value = 0.25
        elif 'elegantsuit' in o.name.lower():
            bsdf.inputs['Roughness'].default_value = 0.75
        elif not cut:
            bsdf.inputs['Roughness'].default_value = 0.55
    if o.data.shape_keys:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
        o.select_set(False)

# одна сетка
for o in parts:
    me = o.data
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[1])
    if me.uv_layers:
        me.uv_layers[0].name = 'UVMap'
    for g in list(o.vertex_groups):
        if g.name not in rig.data.bones:
            o.vertex_groups.remove(g)
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = base
bpy.ops.object.join()
body = base
body.name = 'musician'
print('треугольников:', sum(len(p.vertices) - 2 for p in body.data.polygons))
# полегче: оркестр — полсотни человек на сцене (лицо и кисти страдают меньше всего при равномерном схлопывании)
RATIO = float(os.environ.get('DZ_DECIMATE', '0.42'))
if RATIO < 1:
    dm = body.modifiers.new('dec', 'DECIMATE')
    dm.ratio = RATIO
    dm.use_symmetry = True
    dm.symmetry_axis = 'X'
    bpy.context.view_layer.objects.active = body
    arm_mods = [m for m in body.modifiers if m.type == 'ARMATURE']
    for m in arm_mods:
        body.modifiers.remove(m)
    bpy.ops.object.modifier_apply(modifier='dec')
    am = body.modifiers.new('rig', 'ARMATURE')
    am.object = rig
    print('после упрощения:', sum(len(p.vertices) - 2 for p in body.data.polygons))

# рост и подошва
co = np.array([v.co[:] for v in body.data.vertices])
mn, mx = co.min(0), co.max(0)
k = L['h'] / (mx[2] - mn[2])
rig.scale = (k, k, k)
rig.location = (0, 0, -mn[2] * k)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
rig.name = 'rig'

for im in bpy.data.images:
    if im.size[0] > 1024:
        im.scale(1024, 1024)
    nm = im.name.lower()
    if any(k_ in nm for k_ in ('eye', 'brow', 'lash')) and im.size[0] > 256:
        im.scale(256, 256)

bpy.ops.wm.save_as_mainfile(filepath=BLEND)
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
rig.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format='GLB', export_animations=False, export_skins=True,
                          export_morph=False, export_image_format='WEBP', export_image_quality=80, export_yup=True, export_def_bones=False)
print('готово', OUT, os.path.getsize(OUT) // 1024, 'КБ')
