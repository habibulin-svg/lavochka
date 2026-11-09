"""Дворовый спорт: большой пустырь за гаражами для лапты (и других игр с мячом) — Blender → glTF для three.js.

blender -b --factory-startup --python studio/blender/dvor_field.py -- <папка текстур> <папка выхода>

Текстуры — те же, что у двора городков (studio/blender/gorodki_yard.py; studio/jobs/gorodki/03-tex.yaml, 05-tex2.yaml).
Выход: field.glb (утоптанная площадка ~40 × 72 м на траве, гаражи вдоль левого края и в дальнем ряду, деревья, лавочки,
мелочи — БЕЗ разметки: линии своей игры рисует сама игра) и lapta.glb (мяч «ball», бита-лапта «lapta»).
Оси: Blender x — поперёк поля, y — вдоль, от линии дома (y = 0) к линии кона, z — вверх; glTF → three (x, z, −y),
как в core/dvorsport/yard3d.ts.
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


# ------------------------------------------------------------------ материалы

_imgs = {}


def image(name):
    if name not in _imgs:
        _imgs[name] = bpy.data.images.load(str(TEX / f'{name}.png'))
    return _imgs[name]


def mat(name, tex=None, color=(0.8, 0.8, 0.8, 1), rough=0.85, metal=0.0, alpha=False, tint=None):
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
        if alpha:
            nt.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
            m.blend_method = 'CLIP' if hasattr(m, 'blend_method') else None
            try:
                m.surface_render_method = 'DITHERED'
            except Exception:
                pass
    else:
        bsdf.inputs['Base Color'].default_value = color
    return m


def link(obj, coll=None):
    (coll or scene.collection).objects.link(obj)
    return obj


def mesh_obj(name, bm, material, coll=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    me.materials.append(material)
    return link(o, coll)


def box(name, cx, cy, cz, sx, sy, sz, material, uv=1.0, coll=None, rot_z=0.0, bevel=0.0):
    """Ящик с развёрткой «по миру» (текстура не тянется): uv — метров на повтор."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=2, affect='EDGES')
    world_uv(bm, uv)
    o = mesh_obj(name, bm, material, coll)
    o.location = (cx, cy, cz)
    o.rotation_euler.z = rot_z
    return o


def world_uv(bm, scale):
    layer = bm.loops.layers.uv.verify()
    bm.normal_update()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for lp in f.loops:
            c = lp.vert.co
            if ax == 2:
                u, v = c.x, c.y
            elif ax == 1:
                u, v = c.x, c.z
            else:
                u, v = c.y, c.z
            lp[layer].uv = (u / scale, v / scale)


def plane(name, x0, x1, y0, y1, z, material, uv, nx=1, ny=1, jitter=0.0, coll=None):
    bm = bmesh.new()
    verts = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            x = x0 + (x1 - x0) * i / nx
            y = y0 + (y1 - y0) * j / ny
            edge = i in (0, nx) or j in (0, ny)
            if jitter and edge:
                x += rnd.uniform(-jitter, jitter)
                y += rnd.uniform(-jitter, jitter)
            row.append(bm.verts.new((x, y, z)))
        verts.append(row)
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
    world_uv(bm, uv)
    return mesh_obj(name, bm, material, coll)


def strip(name, pts, width, z, material, coll=None):
    """Меловая линия по точкам (ломаная), ширина width."""
    bm = bmesh.new()
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        dx, dy = bx - ax, by - ay
        ln = math.hypot(dx, dy)
        nx, ny = -dy / ln * width / 2, dx / ln * width / 2
        ex, ey = dx / ln * width / 2, dy / ln * width / 2
        q = [bm.verts.new((ax - ex + nx, ay - ey + ny, z)), bm.verts.new((bx + ex + nx, by + ey + ny, z)),
             bm.verts.new((bx + ex - nx, by + ey - ny, z)), bm.verts.new((ax - ex - nx, ay - ey - ny, z))]
        bm.faces.new(q[::-1] if (q[1].co - q[0].co).cross(q[2].co - q[1].co).z < 0 else q)
    world_uv(bm, 1.0)
    return mesh_obj(name, bm, material, coll)


# ------------------------------------------------------------------ двор

yard = bpy.data.collections.new('yard')
scene.collection.children.link(yard)

M = {
    'grass': mat('grass', 'grass', rough=0.95),
    'dirt': mat('dirt', 'dirt', rough=0.95, tint=(0.78, 0.68, 0.56, 1)),
    'chalk': mat('chalk', color=(1.0, 1.0, 0.97, 1), rough=0.8),
    'planks': mat('planks', 'planks', rough=0.9, tint=(0.95, 0.82, 0.66, 1)),
    'post': mat('post', 'planks', rough=0.9, tint=(0.55, 0.45, 0.35, 1)),
    'concrete': mat('concrete', 'concrete', rough=0.95),
    'roof': mat('roof', 'roof', rough=0.85),
    'steel': mat('steel', color=(0.22, 0.23, 0.24, 1), rough=0.55, metal=0.6),
    'rubber': mat('rubber', color=(0.03, 0.03, 0.035, 1), rough=0.9),
    'rust': mat('rust', 'roof', rough=0.7, metal=0.3, tint=(0.75, 0.38, 0.2, 1)),
    'slat': mat('slat', 'batwood', rough=0.7, tint=(0.95, 0.75, 0.55, 1)),
    'iron': mat('iron', color=(0.06, 0.06, 0.065, 1), rough=0.5, metal=0.7),
    'clay': mat('clay', 'dirt', rough=0.95, tint=(0.62, 0.52, 0.42, 1)),
    'burlap': mat('burlap', 'burlap', rough=1.0),
    'board': mat('board', 'batwood', rough=0.8, tint=(0.75, 0.6, 0.45, 1)),
    'zinc': mat('zinc', color=(0.62, 0.64, 0.66, 1), rough=0.4, metal=0.85),
    'bagred': mat('bagred', 'burlap', rough=0.8, tint=(0.75, 0.12, 0.1, 1)),
    'bagblue': mat('bagblue', 'burlap', rough=0.8, tint=(0.12, 0.25, 0.6, 1)),
    'scuff': mat('scuff', 'scuff', rough=1.0, alpha=True),
    'pebbles': mat('pebbles', 'pebbles', rough=0.9, alpha=True),
    'paint': mat('paint', color=(0.95, 0.93, 0.85, 1), rough=0.7),
}
DOORS = {c: mat(f'door-{c}', f'door-{c}', rough=0.7, metal=0.25) for c in ('green', 'blue', 'red')}
# гаражи: бетонные стены, ржавые железные двери, плоская крыша рубероидом с напуском
def garage(i, x, y, face, door):
    """face = +1 — дверь смотрит на +x, −1 — на −x."""
    w, d, h = 3.1, 5.6, 2.45
    g = box(f'garage{i}', x, y, h / 2, d, w, h, M['concrete'], uv=2.0, coll=yard)
    fx = x + face * (d / 2 + 0.005)
    # рама двери и сама дверь (чуть утоплена)
    box(f'gframe{i}', fx, y, 1.05, 0.06, 2.75, 2.1, M['steel'], coll=yard)
    dm = bpy.data.meshes.new(f'gdoor{i}')
    bm = bmesh.new()
    a = bm.verts.new((0, -1.3, 0.05))
    b = bm.verts.new((0, 1.3, 0.05))
    c = bm.verts.new((0, 1.3, 2.05))
    e = bm.verts.new((0, -1.3, 2.05))
    f = bm.faces.new((a, b, c, e) if face > 0 else (e, c, b, a))
    uv = bm.loops.layers.uv.verify()
    for lp in f.loops:
        lp[uv].uv = ((lp.vert.co.y + 1.3) / 2.6 if face > 0 else (1.3 - lp.vert.co.y) / 2.6, (lp.vert.co.z - 0.05) / 2.0)
    bm.to_mesh(dm)
    bm.free()
    od = bpy.data.objects.new(f'gdoor{i}', dm)
    dm.materials.append(DOORS[door])
    od.location = (fx + face * 0.035, y, 0)
    link(od, yard)
    # крыша с напуском и лёгким уклоном назад
    r = box(f'groof{i}', x - face * 0.05, y, h + 0.06, d + 0.4, w + 0.12, 0.12, M['roof'], uv=2.0, coll=yard)
    r.rotation_euler.y = -face * 0.03
    # козырёк над дверью
    box(f'gvisor{i}', fx + face * 0.12, y, 2.2, 0.25, 2.9, 0.04, M['steel'], coll=yard)
# деревья и кусты — крестом из двух вырезанных картинок
def billboard(name, tex, x, y, hgt, aspect=None):
    img = image(tex)
    aspect = img.size[0] / img.size[1]
    m = M.get(tex) or mat(tex, tex, rough=0.9, alpha=True)
    M[tex] = m
    for k, ang in enumerate((0.0, math.pi / 2)):
        bm = bmesh.new()
        w = hgt * aspect
        ca, sa = math.cos(ang), math.sin(ang)
        vs = [bm.verts.new((-w / 2 * ca, -w / 2 * sa, 0)), bm.verts.new((w / 2 * ca, w / 2 * sa, 0)),
              bm.verts.new((w / 2 * ca, w / 2 * sa, hgt)), bm.verts.new((-w / 2 * ca, -w / 2 * sa, hgt))]
        f = bm.faces.new(vs)
        uv = bm.loops.layers.uv.verify()
        for lp, (u, v) in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
            lp[uv].uv = (u, v)
        o = mesh_obj(f'{name}-{k}', bm, m, yard)
        o.location = (x, y, 0)
        o.rotation_euler.z = rnd.uniform(0, math.pi)
# лавочки: чугунные боковины, деревянные брусья сиденья и спинки
def bench(name, x, y, rot):
    parts = []
    for s in (-0.85, 0.85):
        parts.append(box(f'{name}-leg{s}', s, 0, 0.22, 0.05, 0.42, 0.44, M['iron'], coll=yard))
        parts.append(box(f'{name}-back{s}', s, 0.2, 0.62, 0.05, 0.05, 0.42, M['iron'], coll=yard))
    for k in range(3):
        parts.append(box(f'{name}-seat{k}', 0, -0.13 + k * 0.13, 0.46, 2.0, 0.11, 0.04, M['slat'], uv=1.0, coll=yard, bevel=0.008))
    for k in range(2):
        parts.append(box(f'{name}-rest{k}', 0, 0.23, 0.62 + k * 0.16, 2.0, 0.03, 0.11, M['slat'], uv=1.0, coll=yard, bevel=0.008))
    root = bpy.data.objects.new(name, None)
    link(root, yard)
    for p in parts:
        p.parent = root
    root.location = (x, y, 0)
    root.rotation_euler.z = rot

def decal(name, m, x, y, size, ang):
    bm = bmesh.new()
    vs = [bm.verts.new((-size / 2, -size / 2, 0)), bm.verts.new((size / 2, -size / 2, 0)), bm.verts.new((size / 2, size / 2, 0)), bm.verts.new((-size / 2, size / 2, 0))]
    f = bm.faces.new(vs)
    uvl = bm.loops.layers.uv.verify()
    for lp, (u, v) in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        lp[uvl].uv = (u, v)
    o = mesh_obj(name, bm, m, yard)
    o.location = (x, y, 0.004)
    o.rotation_euler.z = ang

def export(path, coll):
    for o in bpy.data.objects:
        o.select_set(False)
    for o in coll.all_objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path), use_selection=True, export_format='GLB', export_image_format='WEBP',
                              export_image_quality=80, export_yup=True, export_apply=True)



# ------------------------------------------------------------------ пустырь

# трава и утоптанная площадка с неровным краем
plane('ground', -110, 110, -60, 140, -0.004, M['grass'], 3.0, coll=yard)
plane('court', -19.5, 19.5, -11.0, 61.0, 0.0, M['dirt'], 2.6, nx=26, ny=48, jitter=0.9, coll=yard)
# у дома (где бьют и ждут) — земля темнее и плотнее
plane('clay-dom', -9.0, 9.0, -6.5, 2.2, 0.0015, M['clay'], 1.8, nx=14, ny=8, jitter=0.25, coll=yard)

# гаражи: длинный ряд вдоль левого края — дверьми к полю, и дальний ряд за линией кона
colors = ['green', 'red', 'blue', 'green', 'blue', 'red', 'green', 'red']
for i in range(22):
    garage(i, -25.5, -8.0 + i * 3.15, +1, colors[i % len(colors)])
for i in range(13):
    x = -19.0 + i * 3.15
    box(f'farg{i}', x, 70.0, 1.22, 3.1, 5.6, 2.45, M['concrete'], uv=2.0, coll=yard)
    box(f'farroof{i}', x, 70.0, 2.51, 3.2, 6.0, 0.12, M['roof'], uv=2.0, coll=yard)
    dm = bpy.data.meshes.new(f'fdoor{i}')
    bm = bmesh.new()
    vs = [bm.verts.new((-1.3, 0, 0.05)), bm.verts.new((1.3, 0, 0.05)), bm.verts.new((1.3, 0, 2.05)), bm.verts.new((-1.3, 0, 2.05))]
    f = bm.faces.new(vs[::-1])
    uv = bm.loops.layers.uv.verify()
    for lp in f.loops:
        lp[uv].uv = ((lp.vert.co.x + 1.3) / 2.6, (lp.vert.co.z - 0.05) / 2.0)
    bm.to_mesh(dm)
    bm.free()
    od = bpy.data.objects.new(f'fdoor{i}', dm)
    dm.materials.append(DOORS[colors[(i + 1) % len(colors)]])
    od.location = (x, 70.0 - 2.83, 0)
    link(od, yard)

# деревья: справа вдоль поля — тополя и берёзы (за ними двор), позади дома — пара берёз
TREES = [
    ('poplar-tree', 24.0, -6.0, 13.0), ('birch-tree', 23.0, 4.0, 9.5), ('poplar-tree', 25.5, 14.0, 14.0),
    ('birch-tree', 22.5, 23.0, 9.0), ('poplar-tree', 24.5, 33.0, 13.5), ('birch-tree', 23.5, 43.0, 9.5),
    ('poplar-tree', 25.0, 53.0, 13.0), ('birch-tree', 22.0, 62.0, 9.0), ('poplar-tree', 15.0, 76.0, 14.0),
    ('birch-tree', -8.0, 76.5, 10.0), ('birch-tree', 9.0, -17.0, 8.5), ('poplar-tree', -12.0, -18.0, 12.5),
    ('birch-tree', 30.0, 28.0, 10.0), ('poplar-tree', 31.0, 48.0, 13.0),
]
for k, (t, x, y, h) in enumerate(TREES):
    billboard(f'tree{k}', t, x, y, h, 0.68)
for k, (x, y) in enumerate([(21.0, -1.0), (20.5, 18.0), (21.5, 38.0), (20.0, 57.0), (-6.0, -14.0), (12.5, -13.0), (-21.5, 64.0)]):
    billboard(f'bush{k}', 'lilac-bush', x, y, 1.7, 1.45)
for k in range(46):
    s_ = rnd.choice((-1, 1))
    billboard(f'edgeweeds{k}', 'weeds', s_ * rnd.uniform(19.0, 21.0), rnd.uniform(-10, 61), rnd.uniform(0.35, 0.65))
for k in range(16):
    billboard(f'weeds{k}', 'weeds', rnd.uniform(-18, 18), rnd.choice((rnd.uniform(-12, -10.5), rnd.uniform(61, 63))), rnd.uniform(0.4, 0.7))

# лавочки справа у поля и за домом: болельщики и ждущие смотрят на игру
bench('bench1', 19.0, 6.0, -math.pi / 2)
bench('bench2', 19.0, 26.0, -math.pi / 2)
bench('bench3', -6.5, -9.0, 0.0)
bench('bench4', 6.5, -9.0, 0.0)


def prop_add(op, mat_, name, loc, rot=(0, 0, 0), **kw):
    op(location=loc, rotation=rot, **kw)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat_)
    for c in o.users_collection:
        c.objects.unlink(o)
    yard.objects.link(o)
    return o


# мелочи у дома: покрышки, ведро, сумки, ящик, бочка у гаражей, табличка «ЛАПТА»
for k, (x, y, n) in enumerate([(-10.5, -7.5, 3), (11.0, -6.0, 2), (-21.0, 30.0, 2)]):
    for j in range(n):
        prop_add(bpy.ops.mesh.primitive_torus_add, M['rubber'], f'tirestack{k}-{j}', (x + rnd.uniform(-0.04, 0.04), y, 0.12 + j * 0.23),
                 major_radius=0.33, minor_radius=0.12, major_segments=24, minor_segments=10)
prop_add(bpy.ops.mesh.primitive_cone_add, M['zinc'], 'bucket', (4.8, -9.8, 0.16), vertices=20, radius1=0.12, radius2=0.16, depth=0.32, end_fill_type='NOTHING')
box('bag1', -4.5, -9.6, 0.14, 0.55, 0.3, 0.28, M['bagred'], uv=0.5, coll=yard, rot_z=0.5, bevel=0.07)
box('bag2', 8.6, -9.4, 0.13, 0.5, 0.28, 0.26, M['bagblue'], uv=0.5, coll=yard, rot_z=-0.3, bevel=0.07)
box('crate', -8.8, -10.6, 0.2, 0.6, 0.4, 0.4, M['planks'], uv=0.6, coll=yard, rot_z=0.4, bevel=0.01)
prop_add(bpy.ops.mesh.primitive_cylinder_add, M['rust'], 'barrel', (-22.0, 12.0, 0.44), radius=0.3, depth=0.88)
for x in (-0.55, 0.55):
    box(f'signpost{x}', 13.0 + x, -11.0, 0.55, 0.06, 0.06, 1.1, M['post'], coll=yard)
box('signboard', 13.0, -11.0, 0.95, 1.3, 0.04, 0.38, M['planks'], uv=0.9, coll=yard, bevel=0.01)
font = bpy.data.fonts.load('C:/Windows/Fonts/arialbd.ttf')
# надпись — на стороне, что смотрит на поле (+y)
bpy.ops.object.text_add(location=(13.0, -10.97, 0.95), rotation=(math.pi / 2, 0, math.pi))
txt = bpy.context.active_object
txt.data.body = 'ЛАПТА'
txt.data.font = font
txt.data.size = 0.24
txt.data.align_x = 'CENTER'
txt.data.align_y = 'CENTER'
txt.data.extrude = 0.004
bpy.ops.object.convert(target='MESH')
txt = bpy.context.active_object
txt.name = 'signtext'
txt.data.materials.clear()
txt.data.materials.append(M['paint'])
for c in txt.users_collection:
    c.objects.unlink(txt)
yard.objects.link(txt)

# камешки по полю, вытоптанные пятна у дома
for k in range(70):
    decal(f'pebbles{k}', M['pebbles'], rnd.uniform(-18, 18), rnd.uniform(-10, 60), rnd.uniform(0.2, 0.45), rnd.uniform(0, 6.28))
for k in range(18):
    decal(f'scuff{k}', M['scuff'], rnd.uniform(-3, 3), rnd.uniform(-2.5, 3.5), rnd.uniform(0.35, 0.7), rnd.uniform(0, 6.28))

for o in yard.objects:
    if o.type == 'MESH':
        for p in o.data.polygons:
            p.use_smooth = False

export(OUT / 'field.glb', yard)

# ------------------------------------------------------------------ реквизит лапты: мяч и бита

props = bpy.data.collections.new('props')
scene.collection.children.link(props)

# мяч — литой резиновый, по размеру как теннисный (Ø 7 см), красный
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.035, segments=24, ring_count=14, location=(0, 0, 0))
ball = bpy.context.active_object
ball.name = 'ball'
ball.data.materials.append(mat('ball-rubber', 'concrete', rough=0.55, tint=(0.95, 0.18, 0.1, 1)))
for p in ball.data.polygons:
    p.use_smooth = True
for c in ball.users_collection:
    c.objects.unlink(ball)
props.objects.link(ball)

# лапта — круглая бита 90 см вдоль оси z Blender (в three — вдоль y): тонкая рукоять внизу, к концу утолщается;
# рукоять обмотана изолентой
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=20, radius1=0.019, radius2=0.034, depth=0.9)
uvl = bm.loops.layers.uv.verify()
for f in bm.faces:
    for lp in f.loops:
        c = lp.vert.co
        lp[uvl].uv = (math.atan2(c.y, c.x) / (2 * math.pi) + 0.5, (c.z + 0.45) / 0.9)
me = bpy.data.meshes.new('lapta')
bm.to_mesh(me)
bm.free()
lapta = bpy.data.objects.new('lapta', me)
me.materials.append(mat('lapta-wood', 'batwood', rough=0.65, tint=(1.0, 0.86, 0.66, 1)))
for p in me.polygons:
    p.use_smooth = True
link(lapta, props)
bpy.ops.mesh.primitive_cylinder_add(radius=0.0215, depth=0.2, vertices=20, location=(0, 0, -0.34))
tape = bpy.context.active_object
tape.name = 'lapta-tape'
tape.data.materials.append(M['rubber'])
for c in tape.users_collection:
    c.objects.unlink(tape)
props.objects.link(tape)
tape.parent = lapta
tape.location = (0, 0, -0.34)
export(OUT / 'lapta.glb', props)
print('готово:', OUT)
