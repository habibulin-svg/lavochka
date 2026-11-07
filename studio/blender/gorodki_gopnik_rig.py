"""Городки: гопник во взрослых пропорциях — меш TripoSG → текстура проекцией с эталона → скелет → веса → glTF.

blender -b --factory-startup --python studio/blender/gorodki_gopnik_rig.py -- <меш.glb> <эталон.png> <выход.glb>

Эталон — анфас в A-позе на белом (studio/jobs/gorodki/04-gopniks.yaml); тот же кадр видел TripoSG, поэтому
передние грани берут цвет с эталона ортопроекцией (рамка фигуры на картинке ↔ рамка меша), задние — с «изнанки»:
та же картинка, но голова выше подбородка — цвет кепки/волос (лица на затылке быть не должно).
Скелет — по пропорциям взрослого (кисти ищутся по мешу), имена костей как у gopnik_rig ГОПС:
root, hips, spine, head, upper_arm/forearm/hand.L/R, thigh/shin/foot.L/R (L — +x; модель смотрит в −Y).
Веса — автоматические (тепловые), не вышло — по оболочкам. Рост — 1,78 м, подошва на z = 0.
"""
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
SRC, REF, OUT = args[0], args[1], args[2]
HEIGHT = 1.78

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = 'gopnik'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# убрать пустышки-родителей импорта
for o in list(bpy.context.scene.objects):
    if o.type == 'EMPTY':
        bpy.data.objects.remove(o, do_unlink=True)

# --- рост, подошва в ноль, середина по x/y
me = body.data
co = np.array([v.co[:] for v in me.vertices])
mn, mx = co.min(0), co.max(0)
k = HEIGHT / (mx[2] - mn[2])
cx, cy = (mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2
for v in me.vertices:
    v.co = Vector(((v.co.x - cx) * k, (v.co.y - cy) * k, (v.co.z - mn[2]) * k))
co = np.array([v.co[:] for v in me.vertices])
mn, mx = co.min(0), co.max(0)
H = HEIGHT

# прорежем до разумного числа граней
dec = body.modifiers.new('dec', 'DECIMATE')
dec.ratio = min(1.0, 24000 / max(1, len(me.polygons)))
bpy.ops.object.modifier_apply(modifier='dec')
me = body.data

# --- текстура: проекция с эталона. Рамку фигуры и «изнанку» готовит studio/post/gopnik_tex.py (Pillow — вне Blender):
# рядом с эталоном <имя>-front.png, <имя>-back.png и <имя>-box.json {w, h, x0, x1, y0, y1}.
import json  # noqa: E402

base = REF[:-len('.png')]
box = json.load(open(base + '-box.json', encoding='utf-8'))
W_, H_ = box['w'], box['h']
bx0, bx1, by0, by1 = box['x0'], box['x1'], box['y0'], box['y1']
tmp_front, tmp_back = base + '-front.png', base + '-back.png'


def to_px(x, z):
    u = bx0 + (x - mn[0]) / (mx[0] - mn[0]) * (bx1 - bx0)
    v = by1 - (z - mn[2]) / (mx[2] - mn[2]) * (by1 - by0)
    return u, v


def mat(name, path):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.82
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = bpy.data.images.load(path)
    t.interpolation = 'Linear'
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    return m


me.materials.clear()
me.materials.append(mat('front', tmp_front))
me.materials.append(mat('back', tmp_back))
bm = bmesh.new()
bm.from_mesh(me)
uv = bm.loops.layers.uv.new('UVMap') if not bm.loops.layers.uv else bm.loops.layers.uv.verify()
bm.normal_update()
for f in bm.faces:
    # голова выше подбородка: что смотрит назад (затылок, кепка сзади) — с «изнанки» (кепка, волосы);
    # щёки и виски — с лица (иначе на лице тёмные пятна волос)
    head = f.calc_center_median().z > 0.865 * H
    f.material_index = 1 if (f.normal.y > 0.2 or (head and f.normal.y > 0.05)) else 0
    # грани вбок берут цвет чуть внутри силуэта (против нормали): там основной цвет ткани, а не край и не фон
    shift = -f.normal.x * 0.035 if abs(f.normal.x) > 0.5 else 0.0
    for lp in f.loops:
        x, _, z = lp.vert.co
        u, v = to_px(x + shift, z)
        # задние грани — зеркально по x (картинка «со спины»)
        if f.material_index == 1:
            u = bx0 + bx1 - u
        lp[uv].uv = (u / W_, 1 - v / H_)
bm.to_mesh(me)
bm.free()
for p in me.polygons:
    p.use_smooth = True

# --- скелет
co = np.array([v.co[:] for v in me.vertices])


def extreme_hand(sign):
    """Кончики пальцев: самая дальняя по |x| точка руки (A-поза: руки вниз-в-стороны под 45°)."""
    sel = co[(co[:, 2] > 0.35 * H) & (co[:, 2] < 0.85 * H) & (np.sign(co[:, 0]) == sign)]
    i = np.argmax(np.abs(sel[:, 0]))
    p = sel[i]
    near = sel[np.linalg.norm(sel[:, [0, 2]] - p[[0, 2]], axis=1) < 0.03]
    return near.mean(0)


arm_obj = bpy.data.armatures.new('rig')
rig = bpy.data.objects.new('gopnik_rig', arm_obj)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_obj.edit_bones


def bone(name, head, tail, parent=None, connect=False):
    b = eb.new(name)
    b.head = Vector(head)
    b.tail = Vector(tail)
    if parent:
        b.parent = eb[parent]
        b.use_connect = connect
    return b


yb = float(np.median(co[(co[:, 2] > 0.55 * H) & (co[:, 2] < 0.7 * H), 1]))  # середина тела по глубине
bone('root', (0, yb, 0), (0, yb, 0.12 * H))
bone('hips', (0, yb, 0.5 * H), (0, yb, 0.58 * H), 'root')
bone('spine', (0, yb, 0.58 * H), (0, yb, 0.8 * H), 'hips', True)
bone('head', (0, yb, 0.8 * H), (0, yb, 1.0 * H), 'spine', True)
for side, s in (('L', 1), ('R', -1)):
    tipp = extreme_hand(s)
    sh = Vector((s * 0.11 * H, yb, 0.81 * H))
    tip = Vector((tipp[0], yb, tipp[2]))
    along = (tip - sh).normalized()
    wrist = tip - along * (0.105 * H)
    elbow = sh.lerp(wrist, 0.5) + Vector((0, 0.015, 0))
    bone(f'upper_arm.{side}', sh, elbow, 'spine')
    bone(f'forearm.{side}', elbow, wrist, f'upper_arm.{side}', True)
    bone(f'hand.{side}', wrist, tip, f'forearm.{side}', True)
    hip = Vector((s * 0.06 * H, yb, 0.5 * H))
    knee = Vector((s * 0.065 * H, yb - 0.01, 0.28 * H))
    ankle = Vector((s * 0.068 * H, yb + 0.01, 0.05 * H))
    toe = Vector((s * 0.068 * H, yb - 0.09 * H * 0.8, 0.012 * H))
    bone(f'thigh.{side}', hip, knee, 'hips')
    bone(f'shin.{side}', knee, ankle, f'thigh.{side}', True)
    bone(f'foot.{side}', ankle, toe, f'shin.{side}', True)
bpy.ops.object.mode_set(mode='OBJECT')

# --- веса (сначала сварить вершины-дубли: с ними тепловые веса часто не считаются)
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.0005)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
weighted = sum(1 for v in body.data.vertices if any(g.weight > 0.01 for g in v.groups))
print('веса: вершин с весом', weighted, 'из', len(body.data.vertices))
if weighted < 0.9 * len(body.data.vertices):
    print('тепловые веса не легли — по ближайшим костям')
    for g in list(body.vertex_groups):
        body.vertex_groups.remove(g)
    segs = [(b.name, np.array(b.head_local[:]), np.array(b.tail_local[:])) for b in arm_obj.bones if b.name != 'root']
    groups = {n: body.vertex_groups.new(name=n) for n, _, _ in segs}
    for v in body.data.vertices:
        p = np.array(v.co[:])
        ds = []
        for n, h, t in segs:
            d = t - h
            k = np.clip(np.dot(p - h, d) / max(1e-9, np.dot(d, d)), 0, 1)
            ds.append((float(np.linalg.norm(p - (h + d * k))), n))
        ds.sort()
        (d0, n0), (d1, n1) = ds[0], ds[1]
        w0 = 1 / max(d0, 1e-3) ** 4
        w1 = 1 / max(d1, 1e-3) ** 4
        groups[n0].add([v.index], w0 / (w0 + w1), 'REPLACE')
        groups[n1].add([v.index], w1 / (w0 + w1), 'REPLACE')

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
rig.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format='GLB', export_animations=False, export_skins=True,
                          export_image_format='WEBP', export_image_quality=85, export_yup=True)
print('готово', OUT)
