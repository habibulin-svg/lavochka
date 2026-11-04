"""Существо «Героев»: меш TripoSG + эталон → цвет проекцией → простой скелет → toon-рендер кадров анимаций.

blender -b -P studio/blender/creature_sprites.py -- <меш.glb> <эталон-cut.png> <папка кадров> [размер кадра, px] [--dirs 8 --elev 40 --anims idle,move]

--dirs N — кадры в N направлениях (герой на коне по карте): <анимация>_d<направление>_<NN>.png, направление 0 — вправо, дальше против
часовой (1 — вправо-вверх, 2 — вверх…); --elev — камера сверху под углом (градусы), --anims — какие анимации снимать.

Эталон рисуется сразу в ракурсе поля боя (три четверти, лицом вправо, чуть сверху). TripoSG строит меш так,
будто эталон — вид спереди (перёд −Y, верх +Z), поэтому камера смотрит с −Y горизонтально, а цвет переносится
прямой проекцией эталона на меш: то, что видит камера, совпадает с картинкой. Тыл получает тот же цвет — его не видно.
Скелет — три кости по долям роста (корень, тело, голова): для пробы этапа 1 этого хватает на дыхание, прыжок,
выстрел, удар и гибель. Конечности — следующим шагом (как gopnik_sprites.py, но с разметкой на каждое существо).
Кадры: <папка>/<анимация>_<NN>.png, фон прозрачный; meta.json — fps, loop, точка подошв и точка выстрела.
"""
import json
import math
import os
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
opts = {}
while len(args) > 1 and args[-2].startswith('--'):
    opts[args[-2][2:]] = args[-1]
    args = args[:-2]
SRC, REF, OUT = args[0], args[1], args[2]
FRAME = int(args[3]) if len(args) > 3 else 256
DIRS = int(opts.get('dirs', 0))
ELEV = math.radians(float(opts.get('elev', 0)))
ONLY = opts['anims'].split(',') if 'anims' in opts else None
YAW = 0.0  # поворот на направление (DIRS)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in scene.objects if o.type == 'MESH']
for o in scene.objects:
    o.select_set(o in meshes)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(scene.objects):
    if o != body:
        bpy.data.objects.remove(o)

# мелкие оторванные куски (трава и камешки с эталона, мусор реконструкции) — прочь: меньше 2 % вершин
import bmesh  # noqa: E402

bm = bmesh.new()
bm.from_mesh(body.data)
seen, islands = set(), []
for v in bm.verts:
    if v in seen:
        continue
    stack, isl = [v], []
    seen.add(v)
    while stack:
        x = stack.pop()
        isl.append(x)
        for e in x.link_edges:
            o = e.other_vert(x)
            if o not in seen:
                seen.add(o)
                stack.append(o)
    islands.append(isl)
# и куски у самой земли до 12 % вершин (кочки и камни под ногами)
z0 = min(v.co.z for v in bm.verts)
z1 = max(v.co.z for v in bm.verts)
junk = [isl for isl in islands if len(isl) < 0.02 * len(seen)
        or (len(isl) < 0.12 * len(seen) and max(v.co.z for v in isl) < z0 + 0.12 * (z1 - z0))]
if junk:
    bmesh.ops.delete(bm, geom=[v for isl in junk for v in isl], context='VERTS')
    bm.to_mesh(body.data)
    print(f'убрано кусков: {len(junk)}', flush=True)
bm.free()

# подошвы на z=0, центр по x/y в ноль, рост H
me = body.data
xs = [v.co.x for v in me.vertices]
ys = [v.co.y for v in me.vertices]
zs = [v.co.z for v in me.vertices]
shift = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
for v in me.vertices:
    v.co -= shift

# --- поворот вокруг Z под силуэт эталона: TripoSG ставит животных и всадников «лицом к нам», а эталон — боком ---
import numpy as np  # noqa: E402

N = 64
img = bpy.data.images.load(REF)
w, h = img.size
alpha = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[:, :, 3] > 0.5  # строки снизу вверх, как z


def fit(mask_pts_x, mask_pts_z):
    """Точки → маска N×N: рамка вписана в квадрат с сохранением пропорций, по центру."""
    x0, x1, z0, z1 = mask_pts_x.min(), mask_pts_x.max(), mask_pts_z.min(), mask_pts_z.max()
    s = (N - 3) / max(x1 - x0, z1 - z0, 1e-6)
    ix = ((mask_pts_x - (x0 + x1) / 2) * s + N / 2).astype(int).clip(0, N - 1)
    iz = ((mask_pts_z - (z0 + z1) / 2) * s + N / 2).astype(int).clip(0, N - 1)
    m = np.zeros((N, N), bool)
    m[iz, ix] = True
    return m


def dilate(m):
    d = m.copy()
    d[1:] |= m[:-1]
    d[:-1] |= m[1:]
    d[:, 1:] |= m[:, :-1]
    d[:, :-1] |= m[:, 1:]
    return d


ry, rx = np.nonzero(alpha)
ref_m = fit(rx.astype(np.float32), ry.astype(np.float32))
co = np.array([v.co[:] for v in me.vertices], dtype=np.float32)
fc = np.array([p.center[:] for p in me.polygons], dtype=np.float32)
pts = np.concatenate([co, fc])
best = (-1, 0)
for deg in range(0, 360, 10):
    a = math.radians(deg)
    x = pts[:, 0] * math.cos(a) - pts[:, 1] * math.sin(a)
    m = dilate(dilate(fit(x, pts[:, 2])))
    iou = (m & ref_m).sum() / max((m | ref_m).sum(), 1)
    if iou > best[0]:
        best = (iou, deg)
iou0 = (dilate(dilate(fit(pts[:, 0], pts[:, 2]))) & ref_m).sum() / max((dilate(dilate(fit(pts[:, 0], pts[:, 2]))) | ref_m).sum(), 1)
TURN = best[1] if best[0] > iou0 + 0.04 else 0  # поворачиваем, только если заметно лучше «как есть»
print(f'поворот {TURN}° (совпадение {best[0]:.2f}, без поворота {iou0:.2f})', flush=True)
if TURN:
    a = math.radians(TURN)
    for v in me.vertices:
        x, y = v.co.x, v.co.y
        v.co.x, v.co.y = x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    c = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, 0))
    for v in me.vertices:
        v.co -= c
if DIRS:
    # для карты направление 0 — строго вбок: длинная ось тела (главная ось по x/y) — вдоль X; из двух вариантов —
    # ближайший к повороту под эталон, чтобы голова осталась справа
    xy = np.array([v.co[:2] for v in me.vertices], dtype=np.float64)
    xy -= xy.mean(0)
    ev, vec = np.linalg.eigh(np.cov(xy.T))
    phi = math.atan2(vec[1, 1], vec[0, 1])
    snap = min((-phi, -phi + math.pi, -phi - math.pi), key=abs)
    for v in me.vertices:
        x, y = v.co.x, v.co.y
        v.co.x, v.co.y = x * math.cos(snap) - y * math.sin(snap), x * math.sin(snap) + y * math.cos(snap)
    print(f'профиль: доворот {math.degrees(snap):.0f}°', flush=True)
me.update()

xs = [v.co.x for v in me.vertices]
zs = [v.co.z for v in me.vertices]
X0, X1, H = min(xs), max(xs), max(zs)
for p in me.polygons:
    p.use_smooth = True

# --- цвет: проекция эталона спереди (−Y). Рамка меша по x/z ↔ рамка непрозрачного в эталоне ---
img = bpy.data.images.load(REF)
w, h = img.size
px = list(img.pixels)
cols = [x for x in range(w) if any(px[(y * w + x) * 4 + 3] > 0.5 for y in range(0, h, 2))]
rows = [y for y in range(h) if any(px[(y * w + x) * 4 + 3] > 0.5 for x in range(0, w, 2))]
u0, u1 = min(cols) / w, (max(cols) + 1) / w
v0, v1 = min(rows) / h, (max(rows) + 1) / h  # пиксели Blender — снизу вверх, как z
uv = me.uv_layers.new(name='proj')
for loop in me.loops:
    co = me.vertices[loop.vertex_index].co
    uv.data[loop.index].uv = (u0 + (co.x - X0) / (X1 - X0) * (u1 - u0), v0 + co.z / H * (v1 - v0))

mat = bpy.data.materials.new('creature')
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputMaterial')
tex = nt.nodes.new('ShaderNodeTexImage')
tex.image = img
tex.interpolation = 'Linear'
dif = nt.nodes.new('ShaderNodeBsdfDiffuse')
s2r = nt.nodes.new('ShaderNodeShaderToRGB')
ramp = nt.nodes.new('ShaderNodeValToRGB')
mix = nt.nodes.new('ShaderNodeMix')
emi = nt.nodes.new('ShaderNodeEmission')
# эталон уже со светотенью — toon добавляет только мягкую ступень собственной тени, чтобы фигура держала объём в анимации
ramp.color_ramp.interpolation = 'CONSTANT'
ramp.color_ramp.elements[0].color = (0.8, 0.8, 0.86, 1)
ramp.color_ramp.elements[1].position = 0.3
ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
mix.data_type = 'RGBA'
mix.blend_type = 'MULTIPLY'
mix.inputs['Factor'].default_value = 1
nt.links.new(tex.outputs['Color'], mix.inputs['A'])
nt.links.new(dif.outputs[0], s2r.inputs[0])
nt.links.new(s2r.outputs['Color'], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], mix.inputs['B'])
nt.links.new(mix.outputs['Result'], emi.inputs['Color'])
nt.links.new(emi.outputs[0], out.inputs[0])
me.materials.clear()
me.materials.append(mat)

# --- скелет: корень, тело, голова ---
arm = bpy.data.armatures.new('rig')
rig = bpy.data.objects.new('rig', arm)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name, a, b, parent in (('root', 0.0, 0.08, None), ('body', 0.08, 0.6, 'root'), ('head', 0.6, 1.0, 'body')):
    e = arm.edit_bones.new(name)
    e.head = Vector((0, 0, a * H))
    e.tail = Vector((0, 0, b * H))
    if parent:
        e.parent = arm.edit_bones[parent]
        e.use_connect = True
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
try:
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    weighted = any(len(v.groups) for v in me.vertices)
except RuntimeError:
    weighted = False
if not weighted:  # автовеса не взялись — по высоте с плавным переходом
    bpy.ops.object.parent_set(type='ARMATURE_NAME')
    for g in ('root', 'body', 'head'):
        body.vertex_groups.get(g) or body.vertex_groups.new(name=g)
    for v in me.vertices:
        t = v.co.z / H
        hw = min(1, max(0, (t - 0.52) / 0.16))
        rw = min(1, max(0, (0.12 - t) / 0.1))
        body.vertex_groups['head'].add([v.index], hw, 'REPLACE')
        body.vertex_groups['root'].add([v.index], rw, 'REPLACE')
        body.vertex_groups['body'].add([v.index], max(0, 1 - hw - rw), 'REPLACE')
    print('веса по высоте (автовеса не взялись)', flush=True)


# --- ноги: нижний срез меша распадается на пятна (ступни/копыта); где пятна сливаются — бедро ---
def blobs(z0, z1, cell):
    """Пятна в срезе z0..z1: [(cx, cy, n)] — связные клетки сетки по x/y."""
    pts = co[(co[:, 2] >= z0) & (co[:, 2] < z1)]
    if len(pts) < 8:
        return [], 0
    g = {}
    for x, y in pts[:, :2]:
        k = (int(math.floor(x / cell)), int(math.floor(y / cell)))
        g[k] = g.get(k, 0) + 1
    seen, out = set(), []
    for k in g:
        if k in seen:
            continue
        stack, comp = [k], []
        seen.add(k)
        while stack:
            c = stack.pop()
            comp.append(c)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nb = (c[0] + dx, c[1] + dy)
                    if nb in g and nb not in seen:
                        seen.add(nb)
                        stack.append(nb)
        n = sum(g[c] for c in comp)
        cx = sum((c[0] + 0.5) * cell * g[c] for c in comp) / n
        cy = sum((c[1] + 0.5) * cell * g[c] for c in comp) / n
        out.append((cx, cy, n))
    total = len(pts)
    return [b for b in out if b[2] >= 0.06 * total], total


co = np.array([v.co[:] for v in me.vertices], dtype=np.float32)
CELL = 0.035 * max(H, X1 - X0)
feet, _ = blobs(0.0, 0.12 * H, CELL)
legs = []
if 2 <= len(feet) <= 6 and float(co[:, 2].min()) < 0.05 * H:  # парящие (киты, духи, змеи кольцом) — без ног
    hip = 0.5 * H
    for k in range(5, 24):
        z = k * 0.025 * H
        if len(blobs(z - 0.05 * H, z, CELL)[0]) < len(feet):
            hip = z
            break
    hip = min(max(hip, 0.22 * H), 0.55 * H)
    xs_med = float(np.median([f[0] for f in feet]))
    ys_med = float(np.median([f[1] for f in feet]))
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for i, (cx, cy, _) in enumerate(feet):
        e = arm.edit_bones.new(f'leg{i}')
        e.head = Vector((cx, cy, hip))
        e.tail = Vector((cx, cy, 0))
        e.parent = arm.edit_bones['root']
        # шаг: у четвероногих — по диагонали, у двуногих — левая/правая
        legs.append((f'leg{i}', math.pi * (((cx > xs_med) + (cy > ys_med)) % 2) if len(feet) > 2 else math.pi * (cy > ys_med)))
    bpy.ops.object.mode_set(mode='OBJECT')
    rad = 1.6 * CELL * 2
    for i, (cx, cy, _) in enumerate(feet):
        g = body.vertex_groups.new(name=f'leg{i}')
    for v in me.vertices:
        x, y, z = v.co
        if z > hip + 0.05 * H:
            continue
        d = [(math.hypot(x - cx, y - cy), i) for i, (cx, cy, _) in enumerate(feet)]
        dist, i = min(d)
        if dist > rad:
            continue
        w = min(1.0, max(0.0, (hip + 0.05 * H - z) / (0.13 * H)))
        for gr in v.groups:
            gr.weight *= 1 - w
        body.vertex_groups[f'leg{i}'].add([v.index], w, 'REPLACE')
    print(f'ноги: {len(feet)}, бедро {hip / H:.2f} роста', flush=True)
else:
    print(f'ноги: нет (пятен внизу {len(feet)})', flush=True)
pb = rig.pose.bones
for p in pb:
    p.rotation_mode = 'XYZ'


def pose(root_z=0.0, root_x=0.0, root_rot=0.0, lean=0.0, head=0.0, squash=1.0, tilt=0.0, walk=None):
    """root_z, root_x — сдвиг в долях H; root_rot — завал всего тела вбок (градусы, + — назад, от зрителя вправо);
    lean — наклон тела вперёд (к +X), head — кивок; squash — сплющивание по высоте (объём сохраняется);
    walk — фаза шага 0..1: ноги качаются вперёд-назад попарно."""
    for p in pb:
        p.location = (0, 0, 0)
        p.rotation_euler = (0, 0, 0)
        p.scale = (1, 1, 1)
    rig.location = (root_x * H, 0, root_z * H)
    rig.rotation_euler = (0, math.radians(-root_rot), YAW)  # + — назад: макушка к −X (персонаж смотрит на +X); YAW — направление
    # кость смотрит вверх (+Z); наклон к +X — вращение вокруг её оси Z… в пространстве кости ось X — вбок, Z — вглубь
    pb['body'].rotation_euler = (0, 0, math.radians(-lean))
    pb['head'].rotation_euler = (0, 0, math.radians(-head) + math.radians(tilt))
    s = squash
    pb['root'].scale = (1 / math.sqrt(s), s, 1 / math.sqrt(s))
    if walk is not None:
        for name, ph in legs:  # кость смотрит вниз (−Z): качание в плоскости x/z — вокруг её локальной Z
            pb[name].rotation_euler = (0, 0, math.radians(LEG_SWING * math.sin(2 * math.pi * walk + ph)))


def cyc(n, f):
    return [f(i / n) for i in range(n)]


LEG_SWING = 24  # градусов вперёд-назад
S = math.sin
P = math.pi
ANIMS = {
    'idle': {'fps': 8, 'loop': True, 'frames': cyc(8, lambda t: dict(squash=1 + 0.025 * S(2 * P * t), head=2 * S(2 * P * t)))},
    # с ногами — шаг (лёгкое покачивание на каждый шаг), без ног — прыжками
    'move': {'fps': 12, 'loop': True, 'frames': cyc(8, lambda t: dict(root_z=0.03 * abs(S(2 * P * t)), lean=3 * S(2 * P * t), walk=t)) if legs else
             cyc(8, lambda t: dict(root_z=0.12 * abs(S(P * t)), squash=1 - 0.08 * math.cos(2 * P * t) * (t < 0.15 or t > 0.85), lean=8 * S(P * t)))},
    'shoot': {'fps': 12, 'loop': False, 'frames': [dict(lean=a, head=b, squash=c) for a, b, c in (
        (0, 0, 1), (-6, -4, 1.02), (-10, -8, 1.04), (-12, -10, 1.05), (6, 10, 0.97), (10, 12, 0.95), (8, 8, 0.97), (4, 4, 0.99), (0, 0, 1))]},
    'hit': {'fps': 12, 'loop': False, 'frames': [dict(root_x=a, lean=b, squash=c) for a, b, c in (
        (0, 0, 1), (-0.04, -12, 0.94), (-0.05, -14, 0.96), (-0.03, -8, 0.99), (0, 0, 1))]},
    'defend': {'fps': 10, 'loop': False, 'frames': [dict(squash=s, lean=l) for s, l in ((1, 0), (0.95, 4), (0.92, 6), (0.92, 6))]},
    # падает на спину: макушка к −X; тело поднимается на половину своей ширины (иначе уходит под землю) и сдвигается вправо, чтобы влезть в кадр
    'death': {'fps': 12, 'loop': False, 'frames': [dict(root_rot=r, root_x=x, root_z=z, squash=s, lean=l) for r, x, z, s, l in (
        (0, 0, 0, 1, 0), (6, 0.02, 0.01, 0.97, -8), (18, 0.06, 0.05, 0.95, -12), (35, 0.12, 0.12, 0.95, -10), (55, 0.2, 0.2, 0.96, -6),
        (72, 0.26, 0.26, 0.97, -2), (82, 0.3, 0.29, 0.95, 0), (86, 0.31, 0.3, 0.93, 0), (88, 0.32, 0.3, 0.92, 0), (88, 0.32, 0.3, 0.92, 0))]},
}

# --- рендер: орто спереди, Freestyle-контур ---
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 3
sun.rotation_euler = (math.radians(55), math.radians(-30), math.radians(-35))
scene.collection.objects.link(sun)
scene.render.engine = 'BLENDER_EEVEE'
scene.render.film_transparent = True
scene.render.use_freestyle = True
scene.render.line_thickness_mode = 'ABSOLUTE'
scene.render.line_thickness = 1.2
fs = scene.view_layers[0].freestyle_settings
ls = fs.linesets[0] if fs.linesets else fs.linesets.new('outline')
ls.select_by_visibility = True
ls.select_silhouette = True
ls.select_border = True
ls.select_crease = False
ls.linestyle = ls.linestyle or bpy.data.linestyles.new('outline')
ls.linestyle.color = (0.08, 0.07, 0.06)
scene.view_settings.view_transform = 'Standard'

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
cam.data.type = 'ORTHO'
span = 1.8 * max(H, X1 - X0)  # с запасом: лежит на спине во весь рост
cam.data.ortho_scale = span
cam.location = (0, -10 * H * math.cos(ELEV), span / 2 - 0.12 * span + 10 * H * math.sin(ELEV))
cam.rotation_euler = (math.radians(90) - ELEV, 0, 0)
scene.camera = cam
scene.render.resolution_x = scene.render.resolution_y = FRAME
scene.render.filter_size = 0.8


def at(world):
    u = world_to_camera_view(scene, cam, world)
    return [round(u.x * FRAME, 1), round((1 - u.y) * FRAME, 1)]


os.makedirs(OUT, exist_ok=True)
pose()
bpy.context.view_layer.update()
meta = {'frameW': FRAME, 'frameH': FRAME, 'origin': at(Vector((0, 0, 0))),
        'muzzle': at(Vector((X1 * 0.95, 0, 0.62 * H))), 'top': at(Vector((0, 0, H))), 'anims': {}}
for name, a in ANIMS.items():
    if ONLY and name not in ONLY:
        continue
    for d in range(DIRS or 1):
        YAW = 2 * math.pi * d / DIRS if DIRS else 0.0
        for k, p in enumerate(a['frames']):
            pose(**p)
            scene.render.filepath = os.path.join(OUT, f'{name}_d{d}_{k:02d}.png' if DIRS else f'{name}_{k:02d}.png')
            bpy.ops.render.render(write_still=True)
    meta['anims'][name] = {'fps': a['fps'], 'loop': a['loop'], 'frames': len(a['frames'])}
    print('готово', name, len(a['frames']), flush=True)
if DIRS:
    meta['dirs'] = DIRS
json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'rigged.blend'))
print('кадры →', OUT, flush=True)
