"""Городки: двор и реквизит в Blender → glTF для three.js.

blender -b --factory-startup --python studio/blender/gorodki_yard.py -- <папка текстур> <папка выхода>

Текстуры — из studio/jobs/gorodki/03-tex.yaml (бесшовные — после studio/post/seamless.py, деревья — после вырезки BiRefNet):
dirt, grass, planks, birch, endgrain, batwood, roof, concrete, door-green/blue/red, birch-tree, poplar-tree, lilac-bush, weeds (.png).
Выход: yard.glb (площадка, отбойник, гаражи, деревья, лавочки, мелочи) и props.glb (городок «rod», бита «bat»).
Оси: Blender x — вдоль лицевой линии, y — от бросающего к городу (лицевая линия y = 0), z — вверх.
glTF (+Y вверх) превращает это в three (x, z, −y) — ровно как в src/games/gorodki/scene.ts.
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

# трава и площадка (край площадки — неровный, утоптанный)
plane('ground', -60, 60, -60, 60, -0.004, M['grass'], 3.0, coll=yard)
plane('court', -4.2, 4.2, -16.5, 6.0, 0.0, M['dirt'], 2.4, nx=12, ny=30, jitter=0.35, coll=yard)

# город и пригород — утоптанная глина, по краям города — вкопанные доски
plane('clay-city', -2.2, 2.2, -1.15, 2.25, 0.0015, M['clay'], 1.6, nx=10, ny=10, jitter=0.08, coll=yard)
for k, (cx, cy, sx, sy) in enumerate([(0, 2.09, 2.3, 0.1), (-1.09, 1.0, 0.1, 2.08), (1.09, 1.0, 0.1, 2.08)]):
    box(f'cityboard{k}', cx, cy, 0.012, sx, sy, 0.03, M['board'], uv=1.0, coll=yard, bevel=0.006)

# разметка мелом: город, пригород («усы» и штрафная линия), отметки, марка, полукон и кон
Z = 0.003
strip('city', [(-1, 0), (1, 0), (1, 2), (-1, 2), (-1, 0)], 0.06, Z, M['chalk'], yard)
strip('prigorod', [(-1, 0), (-2, -1), (2, -1), (1, 0)], 0.06, Z, M['chalk'], yard)
for y in (-0.8, -0.6):
    strip(f'mark{y}', [(-0.15, y), (0.15, y)], 0.025, Z, M['chalk'], yard)
strip('marka1', [(-0.07, 0.93), (0.07, 1.07)], 0.03, Z, M['chalk'], yard)
strip('marka2', [(-0.07, 1.07), (0.07, 0.93)], 0.03, Z, M['chalk'], yard)
for y in (-6.5, -13.0):
    strip(f'line{y}', [(-1.6, y), (1.6, y)], 0.06, Z, M['chalk'], yard)
for y in (-5.0, -10.0, -4.0, -8.0):
    strip(f'line{y}', [(-0.25, y), (0.25, y)], 0.03, Z, M['chalk'], yard)

# отбойник за городом: столбы и доски, низкие борта по бокам
WALL_Y = 5.2
for i, x in enumerate([-3.5, -1.75, 0, 1.75, 3.5]):
    box(f'post{i}', x, WALL_Y + 0.08, 0.65, 0.1, 0.1, 1.3, M['post'], uv=1.0, coll=yard)
for k in range(7):
    h = 0.08 + k * 0.165
    box(f'plank{k}', 0, WALL_Y, h + 0.075, 7.1, 0.03, 0.15, M['planks'], uv=0.9, coll=yard, bevel=0.004)
for s in (-1, 1):
    for k in range(3):
        box(f'side{s}{k}', s * 3.5, 2.3, 0.08 + k * 0.165 + 0.075, 0.03, 5.8, 0.15, M['planks'], uv=0.9, coll=yard, bevel=0.004)
    for y in (-0.55, 1.8, 4.2):
        box(f'sidepost{s}{y}', s * 3.55, y, 0.3, 0.08, 0.08, 0.6, M['post'], uv=1.0, coll=yard)


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


colors = ['green', 'red', 'blue', 'green', 'blue', 'red', 'green', 'red']
for i in range(8):
    garage(i, -10.6, 10.5 - i * 3.15, +1, colors[i])
for i in range(6):
    garage(10 + i, 11.2, 6.5 - i * 3.15, -1, colors[(i + 3) % len(colors)])
# дальний ряд за отбойником — дверьми к площадке
for i in range(7):
    x = -9.5 + i * 3.15
    g = box(f'farg{i}', x, 16.5, 1.22, 3.1, 5.6, 2.45, M['concrete'], uv=2.0, coll=yard)
    box(f'farroof{i}', x, 16.5, 2.51, 3.2, 6.0, 0.12, M['roof'], uv=2.0, coll=yard)
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
    od.location = (x, 16.5 - 2.83, 0)
    link(od, yard)


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


TREES = [
    ('birch-tree', 6.8, 9.0, 9.5), ('poplar-tree', 7.6, -2.5, 13.0), ('birch-tree', 6.4, -9.5, 8.5),
    ('poplar-tree', -6.4, 13.5, 12.0), ('birch-tree', 5.6, 14.5, 9.0), ('birch-tree', -5.0, -17.5, 8.0),
    ('poplar-tree', 9.0, 13.0, 12.5), ('birch-tree', -14.5, 2.0, 10.0), ('poplar-tree', 15.5, -6.0, 13.0),
    ('birch-tree', 2.5, 20.5, 10.0), ('poplar-tree', -3.5, 21.0, 14.0), ('birch-tree', 13.0, 18.0, 9.0),
]
for k, (t, x, y, h) in enumerate(TREES):
    billboard(f'tree{k}', t, x, y, h, 0.68)
for k, (x, y) in enumerate([(5.2, 4.0), (-5.6, 7.5), (5.0, -14.0), (-6.0, -6.0), (8.2, 3.0)]):
    billboard(f'bush{k}', 'lilac-bush', x, y, 1.6, 1.45)
for k, (x, y) in enumerate([(4.6, 0.5), (-4.7, 3.5), (-4.5, -11.0), (4.4, -4.0), (-8.5, -2.0), (8.8, -10.0), (3.9, 7.5), (-4.0, 9.0)]):
    billboard(f'weeds{k}', 'weeds', x, y, 0.7, 1.45)


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


# спинкой от площадки: сидящие смотрят на игру
bench('bench1', 5.0, -9.0, -math.pi / 2)
bench('bench2', -5.2, -3.0, math.pi / 2)

# мелочи: покрышка, ржавая бочка, ящик
bpy.ops.mesh.primitive_torus_add(major_radius=0.32, minor_radius=0.12, location=(-5.0, 3.0, 0.12))
t = bpy.context.active_object
t.data.materials.append(M['rubber'])
t.name = 'tire'
for c in t.users_collection:
    c.objects.unlink(t)
yard.objects.link(t)
bpy.ops.mesh.primitive_cylinder_add(radius=0.3, depth=0.88, location=(-6.2, 8.8, 0.44))
b = bpy.context.active_object
b.data.materials.append(M['rust'])
b.name = 'barrel'
for c in b.users_collection:
    c.objects.unlink(b)
yard.objects.link(b)
box('crate', 3.6, -12.8, 0.2, 0.6, 0.4, 0.4, M['planks'], uv=0.6, coll=yard, rot_z=0.4, bevel=0.01)

def prop_add(op, mat_, name, loc, rot=(0, 0, 0), **kw):
    op(location=loc, rotation=rot, **kw)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat_)
    for c in o.users_collection:
        c.objects.unlink(o)
    yard.objects.link(o)
    return o


# старые покрышки стопками у отбойника
for k, (x, n) in enumerate([(-2.9, 3), (2.6, 2), (3.1, 1)]):
    for j in range(n):
        prop_add(bpy.ops.mesh.primitive_torus_add, M['rubber'], f'tirestack{k}-{j}', (x + rnd.uniform(-0.04, 0.04), 4.85, 0.12 + j * 0.23),
                 major_radius=0.33, minor_radius=0.12, major_segments=24, minor_segments=10)
# мешки с песком вдоль бортов
for k in range(6):
    s_ = 1 if k % 2 else -1
    y = 0.6 + (k // 2) * 1.4
    box(f'sack{k}', s_ * 3.3, y, 0.13, 0.42, 0.6, 0.26, M['burlap'], uv=0.5, coll=yard, rot_z=rnd.uniform(-0.3, 0.3), bevel=0.08)
# ведро у лавочки, сумки
prop_add(bpy.ops.mesh.primitive_cone_add, M['zinc'], 'bucket', (4.2, -11.4, 0.16), vertices=20, radius1=0.12, radius2=0.16, depth=0.32, end_fill_type='NOTHING')
box('bag1', 4.9, -7.6, 0.14, 0.55, 0.3, 0.28, M['bagred'], uv=0.5, coll=yard, rot_z=0.5, bevel=0.07)
box('bag2', 5.3, -10.6, 0.13, 0.5, 0.28, 0.26, M['bagblue'], uv=0.5, coll=yard, rot_z=-0.3, bevel=0.07)
# табличка «ГОРОДКИ» на двух столбиках у кона
for x in (-0.55, 0.55):
    box(f'signpost{x}', -3.2 + x, -14.2, 0.55, 0.06, 0.06, 1.1, M['post'], coll=yard)
box('signboard', -3.2, -14.21, 0.95, 1.3, 0.04, 0.38, M['planks'], uv=0.9, coll=yard, bevel=0.01)
font = bpy.data.fonts.load('C:/Windows/Fonts/arialbd.ttf')
bpy.ops.object.text_add(location=(-3.2, -14.24, 0.95), rotation=(math.pi / 2, 0, 0))
txt = bpy.context.active_object
txt.data.body = 'ГОРОДКИ'
txt.data.font = font
txt.data.size = 0.22
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


# следы бит: гуще всего в пригороде и перед ним
for k in range(14):
    y = rnd.choice([rnd.uniform(-1.2, 0.0), rnd.uniform(-4.0, -1.0), rnd.uniform(-1.0, 2.6)])
    decal(f'scuff{k}', M['scuff'], rnd.uniform(-1.8, 1.8), y, rnd.uniform(0.3, 0.6), rnd.uniform(1.2, 1.9) + math.pi)
# камешки
for k in range(26):
    decal(f'pebbles{k}', M['pebbles'], rnd.uniform(-3.6, 3.6), rnd.uniform(-15.5, 4.5), rnd.uniform(0.18, 0.38), rnd.uniform(0, 6.28))
# трава по краям площадки
for k in range(26):
    s_ = rnd.choice((-1, 1))
    billboard(f'edgeweeds{k}', 'weeds', s_ * rnd.uniform(3.7, 4.4), rnd.uniform(-16, 5), rnd.uniform(0.3, 0.55))

for o in yard.objects:
    if o.type == 'MESH':
        for p in o.data.polygons:
            p.use_smooth = False


def export(path, coll):
    for o in bpy.data.objects:
        o.select_set(False)
    for o in coll.all_objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path), use_selection=True, export_format='GLB', export_image_format='WEBP',
                              export_image_quality=80, export_yup=True, export_apply=True)


export(OUT / 'yard.glb', yard)

# ------------------------------------------------------------------ реквизит: городок и бита

props = bpy.data.collections.new('props')
scene.collection.children.link(props)
side = mat('rod-side', 'rodwood', rough=0.8, tint=(0.95, 0.85, 0.72, 1))
end = mat('rod-end', 'endgrain', rough=0.8)


def cylinder(name, r, length, seg, side_m, end_m, bevel, coll, uv_len):
    """Цилиндр вдоль оси y (как у three CylinderGeometry), торцы — круг текстуры торца, фаска."""
    bm = bmesh.new()
    res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r, depth=length)
    me = bpy.data.meshes.new(name)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        cap = abs(f.normal.z) > 0.9
        f.material_index = 1 if cap else 0
        for lp in f.loops:
            c = lp.vert.co
            if cap:
                lp[uv].uv = (0.5 + c.x / (2 * r), 0.5 + c.y / (2 * r))
            else:
                a = math.atan2(c.y, c.x) / (2 * math.pi) + 0.5
                lp[uv].uv = (a, (c.z + length / 2) / uv_len)
    # шов развёртки: у вершин на стыке a≈0 и a≈1 — подправить
    for f in bm.faces:
        if f.material_index == 0:
            us = [lp[uv].uv.x for lp in f.loops]
            if max(us) - min(us) > 0.5:
                for lp in f.loops:
                    if lp[uv].uv.x < 0.5:
                        lp[uv].uv.x += 1
    if bevel:
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and (e.link_faces[0].material_index != e.link_faces[1].material_index)]
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=2, affect='EDGES')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    me.materials.append(side_m)
    me.materials.append(end_m)
    for p in me.polygons:
        p.use_smooth = p.material_index == 0
    link(o, coll)
    # ось — вдоль y Blender (в three — вдоль −z); повернём к оси z Blender → в three станет y, как CylinderGeometry
    return o


rod = cylinder('rod', 0.025, 0.2, 20, side, end, 0.003, props, 0.2)
# бита городошная: ровная палка из тёмного потёртого дерева, на концах — железные оковки с заклёпками
bat = cylinder('bat', 0.03, 0.84, 24, mat('bat-wood', 'batwood2', rough=0.7), mat('bat-end', 'endgrain', rough=0.8, tint=(0.55, 0.42, 0.3, 1)), 0.003, props, 0.84)
steel = mat('bat-ring', color=(0.42, 0.43, 0.45, 1), rough=0.45, metal=0.9)
for k, z in enumerate([0.385, -0.385]):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.0325, depth=0.075, vertices=24, location=(0, 0, z))
    c = bpy.context.active_object
    c.data.materials.append(steel)
    c.name = f'bat-part{k}'
    for cc in c.users_collection:
        cc.objects.unlink(c)
    props.objects.link(c)
    c.parent = bat
    c.location = (0, 0, z)
    for a in range(4):
        ang = a * math.pi / 2
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.005, segments=8, ring_count=6, location=(0, 0, 0))
        rv = bpy.context.active_object
        rv.name = f'bat-rivet{k}{a}'
        rv.data.materials.append(steel)
        for cc in rv.users_collection:
            cc.objects.unlink(rv)
        props.objects.link(rv)
        rv.parent = bat
        rv.location = (math.cos(ang) * 0.033, math.sin(ang) * 0.033, z)
export(OUT / 'props.glb', props)
print('готово:', OUT)
