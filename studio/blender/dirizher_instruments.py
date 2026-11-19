"""Симулятор дирижёра: инструменты оркестра и мебель сцены — модели Blender (размеры — настоящие, метры).

blender -b --factory-startup --python studio/blender/dirizher_instruments.py -- <выход.glb> <сцена.blend>

Струнные — корпус «радиальным лофтом» по контуру (верхняя и нижняя деки, талия-эсы, выпуклость дек), обечайки, гриф
из эбена, завиток, подставка, струны, подгрифник, эфы; альт — скрипка ×1,16, виолончель и контрабас — свои пропорции
и шпиль. Смычки — трость с изгибом, волос, колодка. Духовые: трубки — кривые с переменным радиусом (Blender curve bevel),
раструбы — тела вращения по профилю. Литавры — медный котёл, кожа, обод, ножки. Мебель — стул, пюпитр с нотами,
подиум дирижёра, высокий стул контрабаса.

В каждой модели — «пустышки» точек хвата (имена ниже, `grip_*`, `contact`, `lips`), по ним dirizher_anims.py ставит руки;
в игру пустышки не нужны (экспорт без них). Ось модели: длина инструмента — по +Z (струнные: головка вверх),
лицевая сторона — к −Y. Материалы — постоянные PBR-значения + цвета вершин (лак темнее к краям).
"""
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
OUT, BLEND = args[0], args[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
COL = bpy.context.scene.collection

# ---------------------------------------------------------------- материалы
MATS = {}


def mat(name, rgb, metal=0.0, rough=0.5, vcol=False):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if vcol:
        a = m.node_tree.nodes.new('ShaderNodeVertexColor')
        a.layer_name = 'Col'
        mix = m.node_tree.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs[6].default_value = (*rgb, 1)
        m.node_tree.links.new(a.outputs['Color'], mix.inputs[7])
        m.node_tree.links.new(mix.outputs[2], b.inputs['Base Color'])
    MATS[name] = m
    return m


VARNISH = lambda: mat('varnish', (0.42, 0.14, 0.04), rough=0.28, vcol=True)
VARNISH_DARK = lambda: mat('varnish_dark', (0.26, 0.08, 0.025), rough=0.3, vcol=True)
EBONY = lambda: mat('ebony', (0.025, 0.022, 0.02), rough=0.38)
MAPLE = lambda: mat('maple', (0.62, 0.42, 0.22), rough=0.45)
STRING = lambda: mat('string', (0.8, 0.78, 0.72), metal=1, rough=0.3)
HAIR = lambda: mat('bowhair', (0.92, 0.9, 0.82), rough=0.8)
BRASS = lambda: mat('brass', (0.86, 0.64, 0.26), metal=1, rough=0.2)
SILVER = lambda: mat('silver', (0.9, 0.9, 0.92), metal=1, rough=0.16)
GRENADILLA = lambda: mat('grenadilla', (0.035, 0.03, 0.03), rough=0.25)
BASSOON = lambda: mat('bassoon_wood', (0.36, 0.1, 0.05), rough=0.28)
COPPER = lambda: mat('copper', (0.8, 0.42, 0.26), metal=1, rough=0.24)
HEAD = lambda: mat('timp_head', (0.9, 0.87, 0.78), rough=0.7)
BLACK = lambda: mat('black', (0.03, 0.03, 0.032), rough=0.55)
BLACKMETAL = lambda: mat('blackmetal', (0.04, 0.04, 0.045), metal=0.6, rough=0.4)
PAPER = lambda: mat('paper', (0.93, 0.91, 0.84), rough=0.9)
CORK = lambda: mat('reed', (0.75, 0.62, 0.4), rough=0.6)
FELT = lambda: mat('felt', (0.9, 0.88, 0.82), rough=0.95)
RED = lambda: mat('carpet', (0.38, 0.03, 0.04), rough=0.9)
OAK = lambda: mat('oak', (0.38, 0.22, 0.1), rough=0.5)


def obj(name, bm, material, parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    COL.objects.link(o)
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = True
    if parent:
        o.parent = parent
    return o


def empty(name, loc, parent, rot=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.03
    e.location = loc
    e.rotation_euler = rot
    COL.objects.link(e)
    e.parent = parent
    return e


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    return o


# ---------------------------------------------------------------- примитивы
def lathe(profile, seg=32, cap_bottom=False, cap_top=False):
    """Тело вращения вокруг Z: profile — [(r, z)]."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = [bm.verts.new((r * math.cos(2 * math.pi * k / seg), r * math.sin(2 * math.pi * k / seg), z)) for k in range(seg)]
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(seg):
            bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
    if cap_bottom:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def tube(points, radius, seg=12, closed=False):
    """Трубка по ломаной: radius — число или список по точкам. Параллельный перенос рамки — без перекрутов."""
    pts = [Vector(p) for p in points]
    rs = radius if isinstance(radius, (list, tuple)) else [radius] * len(pts)
    bm = bmesh.new()
    n_prev = None
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if n_prev is None:
            n = t.orthogonal().normalized()
        else:
            n = (n_prev - t * n_prev.dot(t)).normalized()
        n_prev = n
        bnorm = t.cross(n)
        ring = [bm.verts.new(p + (n * math.cos(2 * math.pi * k / seg) + bnorm * math.sin(2 * math.pi * k / seg)) * rs[i]) for k in range(seg)]
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(seg):
            bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
    if not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def box(sx, sy, sz, center=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    bmesh.ops.translate(bm, vec=center, verts=bm.verts)
    return bm


def cyl(r, h, center=(0, 0, 0), seg=16, axis='Z'):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=h)
    if axis == 'X':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
    elif axis == 'Y':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    bmesh.ops.translate(bm, vec=center, verts=bm.verts)
    return bm


def sphere(r, center=(0, 0, 0), seg=12):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2 + 1, radius=r)
    bmesh.ops.translate(bm, vec=center, verts=bm.verts)
    return bm


def arc(cx, cz, r, a0, a1, n=16, y=0.0):
    return [(cx + r * math.cos(a0 + (a1 - a0) * k / n), y, cz + r * math.sin(a0 + (a1 - a0) * k / n)) for k in range(n + 1)]


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- струнные
# контур корпуса: полуширина (доля от максимальной) по длине (0 — низ, 1 — верх)
OUTLINE = [(0.0, 0.0), (0.015, 0.45), (0.05, 0.78), (0.12, 0.96), (0.2, 1.0), (0.3, 0.93), (0.38, 0.78), (0.44, 0.62),
           (0.5, 0.57), (0.56, 0.6), (0.62, 0.72), (0.7, 0.8), (0.78, 0.82), (0.86, 0.76), (0.93, 0.6), (0.975, 0.38), (1.0, 0.0)]
OUTLINE_BASS = [(0.0, 0.0), (0.015, 0.45), (0.05, 0.78), (0.12, 0.96), (0.2, 1.0), (0.3, 0.94), (0.4, 0.8), (0.47, 0.66),
                (0.53, 0.63), (0.6, 0.68), (0.68, 0.74), (0.76, 0.72), (0.84, 0.6), (0.92, 0.42), (0.97, 0.24), (1.0, 0.0)]


def half_width(t, table):
    for (a, wa), (b, wb) in zip(table, table[1:]):
        if a <= t <= b:
            u = (t - a) / (b - a)
            return wa + (wb - wa) * (0.5 - 0.5 * math.cos(math.pi * u))
    return 0.0


def body(L, W, rib, arch, table, name):
    """Корпус: контур (длина L, ширина W), обечайки rib, выпуклость дек arch. Низ корпуса — z = 0, по +Z к грифу."""
    n_side = 40
    outline = []
    for k in range(n_side + 1):
        t = 1 - k / n_side  # правая сторона сверху вниз
        outline.append((half_width(t, table) * W / 2, t * L))
    for k in range(1, n_side):
        t = k / n_side
        outline.append((-half_width(t, table) * W / 2, t * L))
    cx, cz = 0.0, L * 0.47
    R = 14
    bm = bmesh.new()
    col = bm.loops.layers.color.new('Col')
    # точки: (кольцо, угол) для передней (y<0) и задней деки
    def ring_pt(k, i, front):
        x, z = outline[i]
        u = k / R
        px, pz = cx + (x - cx) * u, cz + (z - cz) * u
        h = rib / 2 + arch * (1 - smooth(u)) ** 1.0 * (1 - u ** 4)
        return Vector((px, -h if front else h, pz))
    N = len(outline)
    front, back = [], []
    for k in range(R + 1):
        front.append([bm.verts.new(ring_pt(k, i, True)) for i in range(N)])
        back.append([bm.verts.new(ring_pt(k, i, False)) for i in range(N)])
    def shade(v, u):
        return (0.55 + 0.45 * (1 - u ** 3),) * 3 + (1,)
    faces = []
    for k in range(R):
        for i in range(N):
            j = (i + 1) % N
            f = bm.faces.new((front[k][i], front[k][j], front[k + 1][j], front[k + 1][i]))
            faces.append((f, k))
            f = bm.faces.new((back[k][j], back[k][i], back[k + 1][i], back[k + 1][j]))
            faces.append((f, k))
    # обечайки
    for i in range(N):
        j = (i + 1) % N
        f = bm.faces.new((front[R][i], front[R][j], back[R][j], back[R][i]))
        faces.append((f, R))
    # центр
    cf = bm.verts.new((cx, -rib / 2 - arch, cz))
    cb = bm.verts.new((cx, rib / 2 + arch, cz))
    for i in range(N):
        j = (i + 1) % N
        faces.append((bm.faces.new((cf, front[0][j], front[0][i])), 0))
        faces.append((bm.faces.new((cb, back[0][i], back[0][j])), 0))
    for f, k in faces:
        for lp in f.loops:
            lp[col] = shade(lp.vert, k / R)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, VARNISH())


def fhole(x, z, size, front_y, parent, name):
    """Эфа: тонкая тёмная S-полоса с кружками на концах."""
    pts = [(x + size * 0.18 * math.sin(math.pi * (k / 10 - 0.5)) * (1 if x > 0 else -1), front_y, z - size / 2 + size * k / 10) for k in range(11)]
    o = obj(name, tube(pts, size * 0.035, seg=6), EBONY(), parent)
    c1 = obj(name + 'a', sphere(size * 0.06, pts[0], 6), EBONY(), parent)
    c2 = obj(name + 'b', sphere(size * 0.06, pts[-1], 6), EBONY(), parent)
    return [o, c1, c2]


def bowed(name, L, W, rib, arch, neck_len, scroll, table=OUTLINE, endpin=0.0):
    """Скрипичный инструмент: корпус L×W, гриф и головка neck_len, завиток scroll (радиус)."""
    root = bpy.data.objects.new(name, None)
    COL.objects.link(root)
    parts = [body(L, W, rib, arch, table, name + '_body')]
    fy = -rib / 2 - arch
    # гриф (шейка) и накладка
    neck_w = W * 0.12
    parts.append(obj(name + '_neck', box(neck_w, rib * 0.9, neck_len * 0.62, (0, 0, L + neck_len * 0.31)), VARNISH_DARK()))
    fb_len = neck_len * 0.62 + L * 0.42
    fb = box(neck_w * 1.1, rib * 0.18, fb_len, (0, fy - rib * 0.12 - arch * 0.15, L + neck_len * 0.62 - fb_len / 2))
    parts.append(obj(name + '_fingerboard', fb, EBONY()))
    # колковая коробка и завиток
    pb_z = L + neck_len * 0.62
    parts.append(obj(name + '_pegbox', box(neck_w * 0.9, rib * 0.85, neck_len * 0.3, (0, 0, pb_z + neck_len * 0.15)), VARNISH_DARK()))
    spiral = []
    for k in range(40):
        a = k / 39 * 2.6 * math.pi
        r = scroll * (1 - k / 52)
        spiral.append((0, scroll * 0.2 - r * math.sin(a), pb_z + neck_len * 0.3 + scroll + r * math.cos(a) * 0.9))
    parts.append(obj(name + '_scroll', tube(spiral, [scroll * 0.42 * (1 - k / 60) for k in range(40)], seg=10), VARNISH_DARK()))
    for k in range(4):
        side = 1 if k % 2 else -1
        parts.append(obj(f'{name}_peg{k}', cyl(scroll * 0.12, neck_w * 2.2, (side * neck_w * 0.7, 0, pb_z + neck_len * (0.05 + 0.065 * k)), 8, 'X'), EBONY()))
    # подставка
    br_z = L * 0.4
    br_h = rib * 0.9 + arch * 0.3
    parts.append(obj(name + '_bridge', box(W * 0.2, rib * 0.06, br_h * 0.2, (0, fy - br_h / 2, br_z)), MAPLE()))
    bm = box(W * 0.2, br_h, rib * 0.05, (0, fy - br_h / 2, br_z))
    parts.append(obj(name + '_bridge2', bm, MAPLE()))
    # подгрифник
    parts.append(obj(name + '_tail', box(W * 0.16, rib * 0.12, L * 0.3, (0, fy - rib * 0.1, L * 0.16)), EBONY()))
    # струны: от подгрифника через подставку к порожку
    nut_z = pb_z
    for k in range(4):
        x = (k - 1.5) * W * 0.035
        pts = [(x * 0.8, fy - rib * 0.2, L * 0.28), (x, fy - br_h, br_z), (x * 0.6, fy - rib * 0.3 - arch * 0.15, nut_z)]
        parts.append(obj(f'{name}_str{k}', tube(pts, 0.0006 * (L / 0.355) * (1 + 0.25 * k), seg=5), STRING()))
    # эфы
    for s in (-1, 1):
        parts += fhole(s * W * 0.17, br_z, L * 0.2, fy - arch * 0.55 + 0.001, None, f'{name}_f{s}')
    if endpin:
        parts.append(obj(name + '_endpin', cyl(0.004, endpin, (0, 0, -endpin / 2), 8), SILVER()))
        parts.append(obj(name + '_endbtn', cyl(W * 0.06, 0.03, (0, 0, -0.01), 12), EBONY()))
    o = join(parts, name)
    o.parent = root
    # точки хвата
    empty('contact', (0, fy - br_h, br_z + L * 0.07), root)  # где смычок касается струн
    empty('grip_neck', (0, fy, L + neck_len * 0.5), root)  # левая рука у порожка
    empty('chin', (0, fy * 0.5, L * 0.03), root)  # нижний край у подбородника (скрипка, альт)
    empty('top', (0, 0, pb_z + neck_len * 0.3 + scroll * 2), root)
    return root


def bow(name, length):
    root = bpy.data.objects.new(name, None)
    COL.objects.link(root)
    n = 20
    stick = [(0, -0.012 * length / 0.75 * math.sin(math.pi * k / n) * 0.6, length * k / n) for k in range(n + 1)]
    r = [0.0042 * length / 0.75 * (1 - 0.45 * k / n) for k in range(n + 1)]
    parts = [obj(name + '_stick', tube(stick, r, seg=8), VARNISH_DARK())]
    parts.append(obj(name + '_hair', box(0.009 * length / 0.75, 0.0015, length * 0.9, (0, 0.016 * length / 0.75, length * 0.5)), HAIR()))
    parts.append(obj(name + '_frog', box(0.012, 0.03 * length / 0.75, 0.05 * length / 0.75, (0, 0.012, 0.035 * length / 0.75)), EBONY()))
    parts.append(obj(name + '_tip', box(0.007, 0.022, 0.012, (0, 0.008, length * 0.985)), HAIR()))
    o = join(parts, name)
    o.parent = root
    empty('grip_frog', (0, 0.0, 0.06 * length / 0.75), root)
    empty('hair_mid', (0, 0.016, length * 0.5), root)
    return root


# ---------------------------------------------------------------- деревянные духовые
def keys_along(name, z0, z1, n, r_tube, mat_):
    out = []
    for k in range(n):
        z = z0 + (z1 - z0) * k / max(1, n - 1)
        a = (k * 2.3) % (2 * math.pi) - math.pi / 2
        out.append(obj(f'{name}_k{k}', cyl(r_tube * 0.45, 0.003, (math.cos(a) * r_tube * 1.05, -abs(math.sin(a)) * r_tube * 1.05, z), 8, 'Y'), mat_))
        out.append(obj(f'{name}_kr{k}', tube([(r_tube * 1.1, -r_tube * 0.5, z - 0.008), (r_tube * 1.1, -r_tube * 0.5, z + 0.03)], 0.0012, seg=4), mat_))
    return out


def flute(name, length=0.67):
    root = bpy.data.objects.new(name, None)
    COL.objects.link(root)
    r = 0.0095 * (length / 0.67) ** 0.3
    parts = [obj(name + '_tube', cyl(r, length, (0, 0, length / 2), 16), SILVER())]
    parts.append(obj(name + '_lip', box(0.02, 0.004, 0.03, (0, -r, length * 0.92)), SILVER()))
    parts.append(obj(name + '_cap', sphere(r * 1.05, (0, 0, length), 10), SILVER()))
    parts += keys_along(name, length * 0.12, length * 0.72, 9, r, SILVER())
    o = join(parts, name)
    o.parent = root
    empty('lips', (0, -r * 1.4, length * 0.92), root)
    empty('grip_l', (0, 0, length * 0.68), root)
    empty('grip_r', (0, 0, length * 0.3), root)
    return root


def reed_pipe(name, length, r0, r1, bell, wood, keysmat, reed=True, mouth=False):
    """Гобой/кларнет: коническая трубка, раструб, клапаны; вершина (мундштук) — z = length."""
    root = bpy.data.objects.new(name, None)
    COL.objects.link(root)
    prof = [(r1 + bell * smooth((0.12 - z / length) / 0.12) if z < length * 0.12 else r1 + (r0 - r1) * (z / length), z) for z in [length * k / 24 for k in range(25)]]
    prof = [(max(r, 0.004), z) for r, z in prof]
    parts = [obj(name + '_body', lathe(prof, 18, cap_top=True), wood)]
    for z in (length * 0.33, length * 0.62, length * 0.88):
        parts.append(obj(f'{name}_ring{z:.2f}', cyl(r0 * 1.25 + 0.002, 0.012, (0, 0, z), 16), keysmat))
    parts += keys_along(name, length * 0.18, length * 0.82, 11, r0 * 1.1, keysmat)
    if reed:
        parts.append(obj(name + '_reed', box(0.007, 0.002, 0.045, (0, 0, length + 0.02)), CORK()))
    if mouth:
        parts.append(obj(name + '_mouth', lathe([(r0 * 1.1, length), (r0 * 1.0, length + 0.05), (r0 * 0.5, length + 0.09)], 14, cap_top=True), BLACK()))
    o = join(parts, name)
    o.parent = root
    top = length + (0.09 if mouth else 0.045)
    empty('lips', (0, 0, top), root)
    empty('grip_l', (0, -r0 * 1.2, length * 0.72), root)
    empty('grip_r', (0, -r0 * 1.2, length * 0.38), root)
    return root


def bassoon(name):
    root = bpy.data.objects.new(name, None)
    COL.objects.link(root)
    parts = [obj(name + '_wing', cyl(0.022, 0.5, (0.02, 0, 0.32), 16), BASSOON())]
    parts.append(obj(name + '_long', cyl(0.025, 0.85, (-0.025, 0, 0.82), 16), BASSOON()))
    parts.append(obj(name + '_boot', box(0.1, 0.055, 0.14, (0, 0, 0.07)), BASSOON()))
    parts.append(obj(name + '_bell', lathe([(0.026, 1.24), (0.03, 1.3), (0.034, 1.36), (0.032, 1.37)], 16, cap_top=True), BASSOON()))
    for z in (0.15, 0.56, 1.24):
        parts.append(obj(f'{name}_ring{z}', cyl(0.03, 0.012, (-0.02, 0, z), 16), SILVER()))
    # эс (бокал) — изогнутая трубка к губам
    bocal = [(0.02, 0, 0.57), (0.02, -0.02, 0.62), (0.03, -0.08, 0.66), (0.05, -0.16, 0.66), (0.06, -0.24, 0.63)]
    parts.append(obj(name + '_bocal', tube(bocal, [0.005, 0.0045, 0.004, 0.0035, 0.003], seg=8), SILVER()))
    parts.append(obj(name + '_reed', box(0.01, 0.003, 0.03, (0.06, -0.255, 0.628)), CORK()))
    parts += keys_along(name, 0.2, 0.55, 8, 0.024, SILVER())
    o = join(parts, name)
    o.parent = root
    empty('lips', (0.06, -0.27, 0.63), root)
    empty('grip_l', (-0.02, -0.03, 0.5), root)
    empty('grip_r', (0.03, -0.03, 0.25), root)
    return root


# ---------------------------------------------------------------- медные
def bell_profile(r_throat, r_mouth, length, z0, n=16, flare=4.0):
    return [(r_throat + (r_mouth - r_throat) * (k / n) ** flare, z0 + length * k / n) for k in range(n + 1)]


def trumpet(name):
    root = bpy.data.objects.new(name, None)
    COL.objects.link(root)
    # ось трубы — вдоль −Y (раструб от игрока вперёд); мундштук — y = 0
    parts = [obj(name + '_mp', lathe([(0.004, 0), (0.006, 0.06), (0.012, 0.085), (0.013, 0.088)], 12), SILVER())]
    lead = [(0, -0.08, 0), (0, -0.35, 0), (0, -0.4, -0.02), (0, -0.4, -0.05), (0, -0.35, -0.065), (0, -0.12, -0.065), (0, -0.08, -0.06),
            (0, -0.06, -0.035), (0, -0.08, -0.01), (0, -0.15, -0.005)]
    parts.append(obj(name + '_lead', tube(lead, 0.0058, seg=10), BRASS()))
    bp = bell_profile(0.006, 0.062, 0.32, 0)
    bm = lathe(bp, 24)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    bmesh.ops.translate(bm, vec=(0, -0.2, -0.035), verts=bm.verts)
    # раструб вперёд: z профиля → −Y
    for v in bm.verts:
        v.co.y = -0.2 - (v.co.y + 0.2) * -1
    parts.append(obj(name + '_bell', bm, BRASS()))
    for k in range(3):
        y = -0.18 - k * 0.025
        parts.append(obj(f'{name}_valve{k}', cyl(0.009, 0.1, (0, y, -0.035), 14), BRASS()))
        parts.append(obj(f'{name}_btn{k}', cyl(0.007, 0.006, (0, y, 0.02), 12), SILVER()))
    parts.append(obj(name + '_tubebelow', tube([(0, -0.15, -0.085), (0, -0.25, -0.085)], 0.0058, seg=10), BRASS()))
    o = join(parts, name)
    o.parent = root
    empty('lips', (0, 0.0, 0), root)
    empty('grip_r', (0, -0.205, 0.0), root)
    empty('grip_l', (0, -0.21, -0.06), root)
    return root


def horn(name):
    root = bpy.data.objects.new(name, None)
    COL.objects.link(root)
    # кольца трубки (плоскость XZ), раструб — вправо назад
    pts = []
    for k in range(120):
        a = k / 119 * 2 * math.pi * 2.3
        r = 0.115 + 0.012 * math.sin(a * 0.5)
        pts.append((r * math.cos(a), 0.012 * math.sin(a * 2.3), r * math.sin(a)))
    rs = [0.0055 + 0.006 * (k / 119) ** 2 for k in range(120)]
    parts = [obj(name + '_coil', tube(pts, rs, seg=10), BRASS())]
    # мундштучная трубка поднимается от витков к губам: витки — на уровне груди
    lead = [(0.02, 0, 0.115), (0.0, -0.06, 0.2), (-0.03, -0.13, 0.28), (-0.03, -0.2, 0.31)]
    parts.append(obj(name + '_lead', tube(lead, 0.005, seg=8), BRASS()))
    parts.append(obj(name + '_mp', lathe([(0.004, 0), (0.006, 0.05), (0.01, 0.075)], 12), SILVER()))
    parts[-1].location = (-0.03, -0.275, 0.31)
    parts[-1].rotation_euler = (math.pi / 2, 0, 0)
    bp = bell_profile(0.012, 0.155, 0.36, 0, flare=3.5)
    bm = lathe(bp, 28)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
    bmesh.ops.translate(bm, vec=(0.1, 0.0, -0.06), verts=bm.verts)
    parts.append(obj(name + '_bell', bm, BRASS()))
    for k in range(3):
        parts.append(obj(f'{name}_rot{k}', cyl(0.014, 0.05, (-0.05 + k * 0.03, 0.0, 0.03), 14, 'Y'), BRASS()))
    for p in parts:
        bpy.context.view_layer.objects.active = p
        p.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o = join(parts, name)
    o.parent = root
    empty('lips', (-0.03, -0.35, 0.31), root)
    empty('grip_l', (-0.05, -0.03, 0.06), root)
    empty('grip_r', (0.36, 0.0, -0.06), root)  # правая рука в раструбе
    return root


def trombone(name):
    root = bpy.data.objects.new(name, None)
    COL.objects.link(root)
    # мундштук y=0, кулиса вперёд по −Y, раструб вперёд выше; кулиса — отдельная часть (двигается)
    parts = [obj(name + '_mp', lathe([(0.005, 0), (0.007, 0.07), (0.013, 0.095)], 12), SILVER())]
    parts[-1].rotation_euler = (-math.pi / 2, 0, 0)
    parts.append(obj(name + '_inner', tube([(0, -0.08, 0), (0, -0.7, 0)], 0.007, seg=10), SILVER()))
    parts.append(obj(name + '_inner2', tube([(0.09, -0.08, 0), (0.09, -0.7, 0)], 0.007, seg=10), SILVER()))
    parts.append(obj(name + '_brace', tube([(0, -0.12, 0), (0.09, -0.12, 0)], 0.004, seg=6), BRASS()))
    bell_neck = [(0.09, -0.08, 0), (0.09, 0.05, 0), (0.09, 0.12, 0.02), (0.09, 0.14, 0.07), (0.09, 0.12, 0.12), (0.09, 0.05, 0.13), (0.09, -0.1, 0.13)]
    parts.append(obj(name + '_crook', tube(bell_neck, 0.007, seg=10), BRASS()))
    bp = bell_profile(0.008, 0.11, 0.42, 0, flare=3.8)
    bm = lathe(bp, 24)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    for v in bm.verts:
        v.co.y = -v.co.y
    bmesh.ops.translate(bm, vec=(0.09, -0.1, 0.13), verts=bm.verts)
    parts.append(obj(name + '_bell', bm, BRASS()))
    for p in parts:
        bpy.context.view_layer.objects.active = p
        p.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o = join(parts, name)
    o.parent = root
    # кулиса — отдельно: U-образная внешняя трубка
    slide = obj(name + '_slide', tube([(0, -0.3, 0), (0, -0.75, 0), (0.0, -0.79, 0.0)] + arc(0.045, 0, 0.045, math.pi, 2 * math.pi, 8, -0.79)[1:] + [(0.09, -0.75, 0), (0.09, -0.3, 0)], 0.0085, seg=10), BRASS())
    for v in slide.data.vertices:
        if abs(v.co.y + 0.79) < 0.05 and v.co.z != 0:
            pass
    slide.parent = root
    empty('lips', (0, 0.0, 0), root)
    empty('grip_l', (0.05, -0.1, 0.02), root)
    empty('grip_slide', (0.045, -0.36, 0), slide)
    return root


def tuba(name):
    root = bpy.data.objects.new(name, None)
    COL.objects.link(root)
    parts = []
    # овальная труба-«тело»: вертикальная петля, раструб вверх
    body_pts = [(0, 0, 0.75)] + arc(0, 0.32, 0.17, math.pi / 2, math.pi * 1.5, 14, 0)[1:] + [(0.05, 0, 0.15), (0.15, 0, 0.2), (0.18, 0, 0.35), (0.18, 0, 0.55)]
    rs = [0.02 + 0.045 * (k / (len(body_pts) - 1)) ** 2 for k in range(len(body_pts))]
    parts.append(obj(name + '_body', tube(body_pts, rs, seg=14), BRASS()))
    bp = bell_profile(0.065, 0.22, 0.4, 0.55, flare=3.2)
    bm = lathe(bp, 28)
    bmesh.ops.translate(bm, vec=(0.18, 0, 0), verts=bm.verts)
    parts.append(obj(name + '_bell', bm, BRASS()))
    for k in range(4):
        parts.append(obj(f'{name}_rot{k}', cyl(0.022, 0.07, (-0.08 + k * 0.045, -0.06, 0.48), 14, 'Y'), BRASS()))
    lead = [(-0.05, -0.06, 0.55), (-0.1, -0.12, 0.62), (-0.12, -0.2, 0.66)]
    parts.append(obj(name + '_lead', tube(lead, 0.008, seg=8), BRASS()))
    parts.append(obj(name + '_mp', sphere(0.018, (-0.12, -0.22, 0.665), 10), SILVER()))
    o = join(parts, name)
    o.parent = root
    empty('lips', (-0.12, -0.24, 0.665), root)
    empty('grip_r', (0.0, -0.08, 0.5), root)
    empty('grip_l', (0.1, -0.08, 0.35), root)
    return root


# ---------------------------------------------------------------- литавры
def timpani(name):
    root = bpy.data.objects.new(name, None)
    COL.objects.link(root)
    parts = []
    for i, (x, d) in enumerate([(-0.4, 0.74), (0.4, 0.66)]):
        r = d / 2
        prof = [(0.001, 0.36)] + [(r * math.sin(math.pi / 2 * k / 12) ** 0.7, 0.36 + 0.42 * (1 - math.cos(math.pi / 2 * k / 12)) ** 0.5 * 0 + 0.42 * (k / 12) ** 1.6) for k in range(1, 13)]
        bm = lathe([(p[0], p[1]) for p in prof], 32)
        bmesh.ops.translate(bm, vec=(x, 0, 0), verts=bm.verts)
        parts.append(obj(f'{name}_kettle{i}', bm, COPPER()))
        parts.append(obj(f'{name}_head{i}', cyl(r * 1.01, 0.006, (x, 0, 0.785), 32), HEAD()))
        parts.append(obj(f'{name}_rim{i}', tube(arc(x, 0, r * 1.03, 0, 2 * math.pi, 32), 0.012, seg=8, closed=False), BLACKMETAL()))
        parts[-1].rotation_euler = (math.pi / 2, 0, 0)
        parts[-1].location = (0, 0, 0.785)
        for k in range(3):
            a = 2 * math.pi * k / 3 + 0.5
            parts.append(obj(f'{name}_leg{i}{k}', tube([(x + r * 0.5 * math.cos(a), r * 0.5 * math.sin(a), 0.4), (x + r * 0.8 * math.cos(a), r * 0.8 * math.sin(a), 0.0)], 0.012, seg=6), BLACKMETAL()))
        for k in range(6):
            a = 2 * math.pi * k / 6
            parts.append(obj(f'{name}_rod{i}{k}', tube([(x + r * 1.04 * math.cos(a), r * 1.04 * math.sin(a), 0.78), (x + r * 0.9 * math.cos(a), r * 0.9 * math.sin(a), 0.55)], 0.005, seg=5), SILVER()))
    for p in parts:
        bpy.context.view_layer.objects.active = p
        p.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o = join(parts, name)
    o.parent = root
    empty('head_l', (-0.4, 0, 0.79), root)
    empty('head_r', (0.4, 0, 0.79), root)
    return root


def mallet(name):
    root = bpy.data.objects.new(name, None)
    COL.objects.link(root)
    parts = [obj(name + '_stick', cyl(0.006, 0.36, (0, 0, 0.18), 8), MAPLE()), obj(name + '_ball', sphere(0.022, (0, 0, 0.37), 10), FELT())]
    o = join(parts, name)
    o.parent = root
    empty('grip', (0, 0, 0.05), root)
    empty('tip', (0, 0, 0.37), root)
    return root


# ---------------------------------------------------------------- мебель
def chair(name, seat=0.46):
    root = bpy.data.objects.new(name, None)
    COL.objects.link(root)
    parts = [obj(name + '_seat', box(0.44, 0.42, 0.05, (0, 0, seat - 0.025)), BLACK())]
    parts.append(obj(name + '_back', box(0.42, 0.04, 0.3, (0, 0.2, seat + 0.25)), BLACK()))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(obj(f'{name}_leg{sx}{sy}', cyl(0.012, seat - 0.05, (sx * 0.19, sy * 0.18, (seat - 0.05) / 2), 6), BLACKMETAL()))
        parts.append(obj(f'{name}_bk{sx}', cyl(0.011, 0.3, (sx * 0.19, 0.2, seat + 0.1), 6), BLACKMETAL()))
    o = join(parts, name)
    o.parent = root
    return root


def stand(name):
    root = bpy.data.objects.new(name, None)
    COL.objects.link(root)
    parts = [obj(name + '_rod', cyl(0.009, 0.9, (0, 0, 0.45), 8), BLACKMETAL())]
    for k in range(3):
        a = 2 * math.pi * k / 3 + math.pi / 2
        parts.append(obj(f'{name}_foot{k}', tube([(0, 0, 0.12), (0.26 * math.cos(a), 0.26 * math.sin(a), 0.0)], 0.007, seg=5), BLACKMETAL()))
    desk = box(0.5, 0.012, 0.34)
    bmesh.ops.rotate(desk, verts=desk.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-25), 3, 'X'))
    bmesh.ops.translate(desk, vec=(0, 0, 1.0), verts=desk.verts)
    parts.append(obj(name + '_desk', desk, BLACKMETAL()))
    sheet = box(0.44, 0.004, 0.3)
    bmesh.ops.rotate(sheet, verts=sheet.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-25), 3, 'X'))
    bmesh.ops.translate(sheet, vec=(0, 0.01, 1.01), verts=sheet.verts)
    parts.append(obj(name + '_sheet', sheet, PAPER()))
    o = join(parts, name)
    o.parent = root
    return root


def podium(name):
    root = bpy.data.objects.new(name, None)
    COL.objects.link(root)
    parts = [obj(name + '_base', box(1.0, 1.0, 0.22, (0, 0, 0.11)), OAK()), obj(name + '_top', box(0.96, 0.96, 0.01, (0, 0, 0.225)), RED())]
    rail = [(-0.45, 0.45, 0.23), (-0.45, 0.45, 1.15), (-0.45, -0.45, 1.15), (-0.45, -0.45, 0.23)]
    # перила — сзади дирижёра (дирижёр смотрит к −Y на оркестр? нет: к +Y — оркестр перед ним)
    rail = [(-0.45, -0.45, 0.23), (-0.45, -0.45, 1.05), (0.45, -0.45, 1.05), (0.45, -0.45, 0.23)]
    parts.append(obj(name + '_rail', tube(rail, 0.014, seg=8), BRASS()))
    # пульт дирижёра — перед ним
    parts.append(obj(name + '_desk_rod', cyl(0.015, 0.85, (0, 0.55, 0.42), 8), BLACKMETAL()))
    desk = box(0.62, 0.015, 0.44)
    bmesh.ops.rotate(desk, verts=desk.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(30), 3, 'X'))
    bmesh.ops.translate(desk, vec=(0, 0.55, 0.98), verts=desk.verts)
    parts.append(obj(name + '_desk', desk, OAK()))
    score = box(0.56, 0.02, 0.38)
    bmesh.ops.rotate(score, verts=score.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(30), 3, 'X'))
    bmesh.ops.translate(score, vec=(0, 0.535, 0.99), verts=score.verts)
    parts.append(obj(name + '_score', score, PAPER()))
    o = join(parts, name)
    o.parent = root
    return root


def baton(name):
    root = bpy.data.objects.new(name, None)
    COL.objects.link(root)
    parts = [obj(name + '_stick', lathe([(0.0025, 0.0), (0.0016, 0.25), (0.0007, 0.38), (0.0002, 0.385)], 8, cap_bottom=True), mat('baton', (0.95, 0.94, 0.9), rough=0.4)),
             obj(name + '_handle', sphere(0.01, (0, 0, 0.0), 10), CORK())]
    o = join(parts, name)
    o.parent = root
    empty('grip', (0, 0, 0.0), root)
    empty('tip', (0, 0, 0.385), root)
    return root


# ---------------------------------------------------------------- сборка
items = [
    bowed('violin', 0.356, 0.205, 0.031, 0.016, 0.24, 0.018),
    bowed('viola', 0.41, 0.24, 0.037, 0.018, 0.27, 0.021),
    bowed('cello', 0.755, 0.44, 0.12, 0.026, 0.33, 0.035, endpin=0.38),
    bowed('contrabass', 1.12, 0.68, 0.19, 0.03, 0.62, 0.05, OUTLINE_BASS, endpin=0.3),
    bow('bow_violin', 0.75), bow('bow_viola', 0.74), bow('bow_cello', 0.72), bow('bow_bass', 0.7),
    flute('flute'), flute('piccolo', 0.32),
    reed_pipe('oboe', 0.62, 0.008, 0.016, 0.012, GRENADILLA(), SILVER(), reed=True),
    reed_pipe('clarinet', 0.6, 0.011, 0.014, 0.03, GRENADILLA(), SILVER(), reed=False, mouth=True),
    bassoon('bassoon'), trumpet('trumpet'), horn('horn'), trombone('trombone'), tuba('tuba'), timpani('timpani'),
    mallet('mallet'), chair('chair'), chair('stool', 0.72), stand('stand'), podium('podium'), baton('baton'),
]
for i, it in enumerate(items):
    it.location = ((i % 6) * 1.6, (i // 6) * 1.8, 0)

bpy.ops.wm.save_as_mainfile(filepath=BLEND)
# экспорт: только сетки (пустышки — для анимаций), у каждой — её «корень» с именем инструмента
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    if o.type == 'MESH' or (o.type == 'EMPTY' and o.parent is None):
        o.select_set(True)
for it in items:
    it.location = (0, 0, 0)
bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format='GLB', export_yup=True, export_vertex_color='ACTIVE',
                          export_apply=True)
import os
print('готово', OUT, os.path.getsize(OUT) // 1024, 'КБ', len(items), 'предметов')

# мебель сцены — отдельный файл (props.glb рядом с основным)
bpy.ops.object.select_all(action='DESELECT')
for nm in ('chair', 'stool', 'stand', 'podium'):
    r = bpy.data.objects[nm]
    r.select_set(True)
    for c in r.children_recursive:
        if c.type == 'MESH':
            c.select_set(True)
PROPS = os.path.join(os.path.dirname(OUT), 'props.glb')
bpy.ops.export_scene.gltf(filepath=PROPS, use_selection=True, export_format='GLB', export_yup=True, export_apply=True)
print('мебель', PROPS, os.path.getsize(PROPS) // 1024, 'КБ')
