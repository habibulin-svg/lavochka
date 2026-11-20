"""Симулятор дирижёра: концертные залы — модели Blender по типам, с узнаваемыми чертами настоящих залов.

blender -b --factory-startup --python studio/blender/dirizher_halls.py -- <папка выхода> [зал …]

Оси (как у оркестра в dirizher_anims.py): дирижёр в начале координат, оркестр сзади него по +Y (музыканты смотрят на −Y),
публика — по −Y. Сцена — z = 0, партер ниже (−1,1 м). Типы: shoebox («коробка»: БЗК, Мусикферайн, филармония, Карнеги),
horseshoe («подкова» лож: Мариинка, Большой, Ла Скала, Гарнье), vineyard (Берлин), oval (Альберт-холл), sydney, shell
(летняя эстрада), dk (дом культуры). Материалы — постоянные PBR, люстры — светящиеся (emissive), публика — тёмные фигуры
в креслах. Экспорт — <папка>/<зал>.glb (glTF, Y вверх).
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
ONLY = args[1:]

MATS = {}
# места зрителей: [x, y, пол z, поворот] — в <зал>.seats.json; людей ставит игра (dirizher_audience.py, InstancedMesh)
SEATS = []


def seat_at(x, y, floor):
    """Зритель на месте (x, y), ноги на полу floor; смотрит на середину сцены (модель смотрит на −Y)."""
    fx, fy = 0 - x, 3.0 - y
    SEATS.append([round(x, 2), round(y, 2), round(floor, 2), round(math.atan2(fx, -fy), 3)])


def mat(name, rgb, metal=0.0, rough=0.6, emit=0.0):
    key = name
    if key in MATS:
        return MATS[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*rgb, 1)
        b.inputs['Emission Strength'].default_value = emit
    MATS[key] = m
    return m


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    SEATS.clear()


def add(name, bm, material, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(material)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return o


def box(sx, sy, sz, c):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    bmesh.ops.translate(bm, vec=c, verts=bm.verts)
    return bm


def boxes(items):
    """Несколько коробок одним мешем: [(sx, sy, sz, (x, y, z), поворот_z)]."""
    bm = bmesh.new()
    for sx, sy, sz, c, rz in items:
        g = bmesh.new()
        bmesh.ops.create_cube(g, size=1)
        bmesh.ops.scale(g, vec=(sx, sy, sz), verts=g.verts)
        bmesh.ops.rotate(g, verts=g.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(rz, 3, 'Z'))
        bmesh.ops.translate(g, vec=c, verts=g.verts)
        me = bpy.data.meshes.new('_t')
        g.to_mesh(me)
        g.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    return bm


def cyl(r, h, c, seg=16, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    bmesh.ops.translate(bm, vec=c, verts=bm.verts)
    return bm


def merge(bms):
    out = bmesh.new()
    for g in bms:
        me = bpy.data.meshes.new('_t')
        g.to_mesh(me)
        g.free()
        out.from_mesh(me)
        bpy.data.meshes.remove(me)
    return out


def sphere(r, c, seg=10):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2 + 1, radius=r)
    bmesh.ops.translate(bm, vec=c, verts=bm.verts)
    return bm


def ring_band(r, z0, z1, a0, a1, seg=48, cx=0.0, cy=0.0, ry=None, inward=True):
    """Полоса стены по дуге (эллипс r×ry) от z0 до z1."""
    ry = ry or r
    bm = bmesh.new()
    lo, hi = [], []
    for k in range(seg + 1):
        a = a0 + (a1 - a0) * k / seg
        x, y = cx + r * math.sin(a), cy + ry * math.cos(a)
        lo.append(bm.verts.new((x, y, z0)))
        hi.append(bm.verts.new((x, y, z1)))
    for k in range(seg):
        f = (lo[k], lo[k + 1], hi[k + 1], hi[k]) if inward else (lo[k + 1], lo[k], hi[k], hi[k + 1])
        bm.faces.new(f)
    return bm


# ---------------------------------------------------------------- общие части
def stage(w=20.0, depth=11.0, wood=(0.32, 0.17, 0.08), risers=True):
    """Сцена (паркет) и ступени-подиумы для духовых, меди и литавр."""
    W = mat('stage_wood', wood, rough=0.45)
    add('stage', box(w, depth + 1.5, 0.4, (0, depth / 2 - 0.75, -0.2)), W)
    if risers:
        for r0, r1, h in ((3.9, 5.7, 0.25), (5.7, 6.9, 0.5), (6.9, 8.4, 0.75)):
            bm = bmesh.new()
            seg = 40
            a0, a1 = -0.62 * math.pi / 2 * 1.25, 0.62 * math.pi / 2 * 1.25
            top_o, top_i, bot_i = [], [], []
            for k in range(seg + 1):
                a = a0 + (a1 - a0) * k / seg
                top_i.append(bm.verts.new((r0 * math.sin(a), r0 * math.cos(a), h)))
                top_o.append(bm.verts.new((r1 * math.sin(a), r1 * math.cos(a), h)))
                bot_i.append(bm.verts.new((r0 * math.sin(a), r0 * math.cos(a), 0)))
            for k in range(seg):
                bm.faces.new((top_i[k], top_i[k + 1], top_o[k + 1], top_o[k]))
                bm.faces.new((bot_i[k], bot_i[k + 1], top_i[k + 1], top_i[k]))
            add(f'riser{h}', bm, W)
    # край сцены — чёрный
    add('stage_edge', box(w, 0.06, 1.1, (0, -1.5, -0.55)), mat('black', (0.02, 0.02, 0.02), rough=0.8))


def audience(rows, row0=-3.0, gap=0.95, width=18.0, z0=-1.1, rise=0.12, seat=(0.45, 0.03, 0.04), people=0.85, curve=0.0, seed=1):
    """Партер: ряды кресел (бархат; ряд — несколько длинных блоков по дуге) и публика (тёмные фигуры: торс, голова)."""
    rnd = random.Random(seed)
    chairs, bodies, heads = [], [], []
    for r in range(rows):
        y = row0 - r * gap
        z = z0 + r * rise
        n = int(width / 0.55)
        seg = 6
        for side in (-1, 1):
            # ряд по каждую сторону прохода — блоками по seg кресел
            xs = [x for x in (-width / 2 + (i + 0.5) * width / n for i in range(n)) if (x > 0.6 if side > 0 else x < -0.6)]
            for k in range(0, len(xs), seg):
                part = xs[k:k + seg]
                cx = (part[0] + part[-1]) / 2
                cy = y - curve * (cx / (width / 2)) ** 2
                rz = math.atan2(cx, -cy) * 0.3
                L = part[-1] - part[0] + 0.5
                chairs.append((L, 0.5, 0.45, (cx, cy, z + 0.22), rz))
                chairs.append((L, 0.1, 0.55, (cx, cy - 0.25, z + 0.6), rz))
            for x in xs:
                yy = y - curve * (x / (width / 2)) ** 2
                rz = math.atan2(x, -yy) * 0.3
                if rnd.random() < people:
                    seat_at(x, yy + 0.08, z)
    add('seats', boxes(chairs), mat('velvet', seat, rough=1.0))


def chandelier(c, r=1.2, tiers=3, light=(1.0, 0.85, 0.6), name='chandelier'):
    """Люстра: латунные кольца и светящиеся «свечи»-шары."""
    gold = mat('gold', (0.85, 0.62, 0.28), metal=1.0, rough=0.28)
    glow = mat('glow', light, emit=6.0)
    rings, bulbs = [], []
    for t in range(tiers):
        rr = r * (1 - t * 0.28)
        z = c[2] - t * r * 0.35
        n = int(10 + 8 * rr)
        for k in range(n):
            a = 2 * math.pi * k / n
            bulbs.append(sphere(0.06 + 0.02 * rr, (c[0] + rr * math.cos(a), c[1] + rr * math.sin(a), z), 6))
        rings.append(cyl(rr, 0.06, (c[0], c[1], z - 0.05), 24))
    rings.append(cyl(0.05, 3, (c[0], c[1], c[2] + 1.5), 6))
    add(name + '_frame', merge(rings), gold)
    add(name + '_glow', merge(bulbs), glow)


def organ(cx, cy, z0, w, h, gold=True, n=31):
    """Орган: корпус и фасад труб (по высоте — «подкова»)."""
    case = mat('organ_case', (0.35, 0.2, 0.1) if not gold else (0.75, 0.55, 0.25), metal=0.0 if not gold else 0.6, rough=0.4)
    pipe = mat('pipes', (0.85, 0.85, 0.82), metal=1.0, rough=0.25)
    add('organ_case', box(w, 1.0, h, (cx, cy + 0.5, z0 + h / 2)), case)
    ps = []
    for k in range(n):
        x = cx - w / 2 + (k + 0.5) * w / n
        hh = h * (0.45 + 0.5 * (1 - abs((k - n / 2) / (n / 2)) ** 1.5))
        ps.append(cyl(w / n * 0.38, hh, (x, cy - 0.05, z0 + 0.4 + hh / 2), 10))
    add('organ_pipes', merge(ps), pipe)


def balcony_side(x_sign, y0, y1, z, depth=2.2, front=(0.9, 0.8, 0.6), gilt=True, tiers=1, gap=3.2):
    """Боковые балконы с золочёным барьером."""
    wallm = mat('balcony_front', front, rough=0.5)
    gold = mat('gold', (0.85, 0.62, 0.28), metal=1.0, rough=0.28)
    for t in range(tiers):
        zz = z + t * gap
        x = x_sign * (10 - depth / 2)
        add(f'balc{x_sign}{t}', box(depth, y1 - y0, 0.25, (x, (y0 + y1) / 2, zz)), wallm)
        add(f'balcfront{x_sign}{t}', box(0.15, y1 - y0, 1.0, (x - x_sign * depth / 2, (y0 + y1) / 2, zz + 0.6)), wallm)
        if gilt:
            add(f'balcgold{x_sign}{t}', box(0.18, y1 - y0, 0.08, (x - x_sign * depth / 2, (y0 + y1) / 2, zz + 1.1)), gold)
        bodies = []
        for k in range(int((y1 - y0) / 0.6)):
            y = y0 + 0.3 + k * 0.6
            if random.random() < 0.8:
                seat_at(x + x_sign * 0.4, y, zz + 0.125)


def columns(xs, y0, y1, n, h, r, m, z0=0.0, caps=True):
    gold = mat('gold', (0.85, 0.62, 0.28), metal=1.0, rough=0.28)
    cs, cp = [], []
    for x in xs:
        for k in range(n):
            y = y0 + (y1 - y0) * k / max(1, n - 1)
            cs.append(cyl(r, h, (x, y, z0 + h / 2), 14))
            if caps:
                cp.append(box(r * 2.6, r * 2.6, 0.3, (x, y, z0 + h)))
    add('columns', merge(cs), m)
    if cp:
        add('capitals', merge(cp), gold)


def ceiling(w, y0, y1, z, color, coffers=0, coffer_color=(0.85, 0.65, 0.3)):
    add('ceiling', box(w, y1 - y0, 0.3, (0, (y0 + y1) / 2, z)), mat('ceiling', color, rough=0.7))
    if coffers:
        gold = mat('gold', (0.85, 0.62, 0.28), metal=1.0, rough=0.28)
        pan = mat('coffer', coffer_color, rough=0.6)
        g, p = [], []
        nx, ny = coffers, int(coffers * (y1 - y0) / w)
        for i in range(nx):
            for j in range(ny):
                x = -w / 2 + (i + 0.5) * w / nx
                y = y0 + (j + 0.5) * (y1 - y0) / ny
                p.append(box(w / nx * 0.82, (y1 - y0) / ny * 0.82, 0.05, (x, y, z - 0.18)))
                g.append(box(w / nx * 0.9, 0.08, 0.12, (x, y - (y1 - y0) / ny / 2, z - 0.2)))
        add('coffer_panels', merge(p), pan)
        add('coffer_ribs', merge(g), gold)


def walls_box(w, y0, y1, h, color, back=True, front_open=False):
    m = mat('wall', color, rough=0.75)
    add('wall_l', box(0.4, y1 - y0, h, (-w / 2, (y0 + y1) / 2, h / 2 - 1.1)), m)
    add('wall_r', box(0.4, y1 - y0, h, (w / 2, (y0 + y1) / 2, h / 2 - 1.1)), m)
    if back:
        add('wall_back', box(w, 0.4, h, (0, y1, h / 2 - 1.1)), m)
    add('wall_aud', box(w, 0.4, h, (0, y0, h / 2 - 1.1)), m)


def windows(w, y0, y1, z, n, color=(0.9, 0.85, 0.7)):
    """Светлые высокие окна/ниши по боковым стенам (вечер — подсвечены изнутри)."""
    glow = mat('window', color, emit=0.6)
    ws = []
    for s in (-1, 1):
        for k in range(n):
            y = y0 + (y1 - y0) * (k + 0.5) / n
            ws.append(box(0.05, 1.4, 3.0, (s * (w / 2 - 0.22), y, z)))
    add('windows', merge(ws), glow)


def portraits(w, y0, y1, z, n):
    """Медальоны-портреты композиторов (БЗК): овалы в золотых рамах."""
    gold = mat('gold', (0.85, 0.62, 0.28), metal=1.0, rough=0.28)
    dark = mat('portrait', (0.25, 0.18, 0.12), rough=0.7)
    fr, pic = [], []
    for s in (-1, 1):
        for k in range(n):
            y = y0 + (y1 - y0) * (k + 0.5) / n
            f = cyl(0.75, 0.06, (0, 0, 0), 20)
            bmesh.ops.scale(f, vec=(1, 1.3, 1), verts=f.verts)
            bmesh.ops.rotate(f, verts=f.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
            bmesh.ops.translate(f, vec=(s * (w / 2 - 0.25), y, z), verts=f.verts)
            fr.append(f)
            p_ = cyl(0.6, 0.08, (0, 0, 0), 20)
            bmesh.ops.scale(p_, vec=(1, 1.3, 1), verts=p_.verts)
            bmesh.ops.rotate(p_, verts=p_.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
            bmesh.ops.translate(p_, vec=(s * (w / 2 - 0.27), y, z), verts=p_.verts)
            pic.append(p_)
    add('portrait_frames', merge(fr), gold)
    add('portraits', merge(pic), dark)


def curtain(w, h, y, z0, color=(0.45, 0.03, 0.04), gathered=True):
    """Занавес: складки (волна), собран по краям портала."""
    m = mat('curtain', color, rough=0.95)
    for s in (-1, 1):
        bm = bmesh.new()
        n = 24
        cw = w * 0.16 if gathered else w / 2
        lo, hi = [], []
        for k in range(n + 1):
            x = s * (w / 2 - cw * k / n)
            yy = y + 0.12 * math.sin(k * 1.7)
            lo.append(bm.verts.new((x, yy, z0)))
            hi.append(bm.verts.new((x, yy, z0 + h)))
        for k in range(n):
            bm.faces.new((lo[k], lo[k + 1], hi[k + 1], hi[k]))
        add(f'curtain{s}', bm, m, smooth=True)
    # ламбрекен
    bm = bmesh.new()
    n = 60
    lo, hi = [], []
    for k in range(n + 1):
        x = -w / 2 + w * k / n
        yy = y + 0.1 * math.sin(k * 1.3)
        lo.append(bm.verts.new((x, yy, z0 + h - 1.6 - 0.3 * abs(math.sin(k * math.pi / 6)))))
        hi.append(bm.verts.new((x, yy, z0 + h)))
    for k in range(n):
        bm.faces.new((lo[k], lo[k + 1], hi[k + 1], hi[k]))
    add('valance', bm, m, smooth=True)


def portal(w, h, y, color=(0.85, 0.62, 0.28), metal=1.0, thick=1.2):
    m = mat('portal', color, metal=metal, rough=0.3)
    add('portal_l', box(thick, 1.0, h + 1.1, (-w / 2 - thick / 2, y, h / 2 - 0.55)), m)
    add('portal_r', box(thick, 1.0, h + 1.1, (w / 2 + thick / 2, y, h / 2 - 0.55)), m)
    add('portal_top', box(w + 2 * thick, 1.0, 2.2, (0, y, h + 1.1)), m)


def shell(w, depth, h, wood=(0.55, 0.36, 0.2)):
    """Концертная «раковина» на оперной сцене: деревянные панели за оркестром и над ним."""
    m = mat('shell_wood', wood, rough=0.5)
    add('shell_back', box(w, 0.3, h, (0, depth, h / 2)), m)
    for s in (-1, 1):
        bm = box(0.3, depth, h, (s * w / 2, depth / 2, h / 2))
        add(f'shell_side{s}', bm, m)
    for k in range(4):
        y = depth * (k + 0.5) / 4
        b = box(w, depth / 4 * 0.9, 0.2, (0, y, h - 0.6 + k * 0.4))
        add(f'shell_top{k}', b, m)


def horseshoe(tiers, r, color_front, color_inside, gold=True, y_c=-14.0, depth=2.0, open_angle=0.55):
    """Зрительный зал-«подкова»: ярусы лож по дуге, перегородки, барьеры с золотом."""
    front = mat('box_front', color_front, rough=0.55)
    inside = mat('box_inside', color_inside, rough=0.95)
    goldm = mat('gold', (0.85, 0.62, 0.28), metal=1.0, rough=0.28)
    crowd = mat('crowd', (0.035, 0.03, 0.03), rough=0.9)
    a0, a1 = math.pi * open_angle, 2 * math.pi - math.pi * open_angle
    for t in range(tiers):
        z = 1.2 + t * 2.6
        # пол яруса и барьер
        bm = bmesh.new()
        seg = 48
        outer, inner = [], []
        for k in range(seg + 1):
            a = a0 + (a1 - a0) * k / seg
            outer.append(bm.verts.new(((r + depth) * math.sin(a), y_c + (r + depth) * math.cos(a), z)))
            inner.append(bm.verts.new((r * math.sin(a), y_c + r * math.cos(a), z)))
        for k in range(seg):
            bm.faces.new((inner[k], inner[k + 1], outer[k + 1], outer[k]))
        add(f'tier{t}_floor', bm, inside)
        add(f'tier{t}_front', ring_band(r, z, z + 1.0, a0, a1, 48, 0, y_c), front)
        if gold:
            add(f'tier{t}_gold', ring_band(r - 0.02, z + 0.85, z + 1.0, a0, a1, 48, 0, y_c), goldm)
        add(f'tier{t}_back', ring_band(r + depth, z - 0.1, z + 2.6, a0, a1, 48, 0, y_c), inside)
        # перегородки лож и зрители
        parts, ppl = [], []
        nb = 22
        for k in range(nb + 1):
            a = a0 + (a1 - a0) * k / nb
            x, y = (r + depth / 2) * math.sin(a), y_c + (r + depth / 2) * math.cos(a)
            parts.append((0.08, depth, 2.4, (x, y, z + 1.2), -a))
            if k < nb and random.random() < 0.75:
                am = a + (a1 - a0) / nb / 2
                seat_at((r + 0.6) * math.sin(am), y_c + (r + 0.6) * math.cos(am), z + 0.28)
        add(f'tier{t}_parts', boxes(parts), front)


# ---------------------------------------------------------------- залы
def h_dk():
    stage(w=16, depth=9)
    walls_box(16, -22, 10, 9, (0.78, 0.7, 0.55))
    ceiling(16, -22, 10, 7.6, (0.82, 0.76, 0.62))
    columns([-7.4, 7.4], -20, -4, 6, 8, 0.28, mat('col_beige', (0.86, 0.8, 0.66), rough=0.6), z0=-1.1)
    portal(13, 6.5, -1.6, color=(0.7, 0.55, 0.32), metal=0.3, thick=1.5)
    curtain(13, 6.5, -1.4, 0)
    add('backdrop', box(16, 0.2, 8, (0, 9.6, 4)), mat('backdrop_velvet', (0.3, 0.05, 0.06), rough=1))
    audience(14, row0=-3.2, width=13, people=0.7, seat=(0.4, 0.06, 0.05))
    for y in (-8, -15):
        chandelier((0, y, 6.4), r=0.9, tiers=2)
    windows(16, -20, -4, 2.5, 5)


def h_oblfil():
    stage(w=18, depth=10)
    walls_box(18, -26, 10.5, 13, (0.9, 0.86, 0.76))
    ceiling(18, -26, 10.5, 11.6, (0.92, 0.88, 0.78), coffers=6, coffer_color=(0.75, 0.62, 0.42))
    organ(0, 10, 3.5, 9, 7, gold=False)
    columns([-8.6, 8.6], -24, 8, 9, 11.5, 0.32, mat('col_white', (0.92, 0.9, 0.84), rough=0.5), z0=-1.1)
    balcony_side(-1, -24, -4, 4.2)
    balcony_side(1, -24, -4, 4.2)
    audience(18, row0=-3.0, width=15)
    for y in (-6, -14, -22):
        chandelier((0, y, 10), r=1.0, tiers=2)


def h_park():
    stage(w=18, depth=9, wood=(0.45, 0.3, 0.16))
    # ракушка из рёбер
    wood = mat('shell_wood', (0.7, 0.55, 0.38), rough=0.6)
    white = mat('shell_white', (0.92, 0.9, 0.85), rough=0.6)
    for k in range(7):
        r = 9 - k * 0.8
        bm = bmesh.new()
        seg = 32
        lo, hi = [], []
        for i in range(seg + 1):
            a = math.pi * i / seg
            x, z = -r * math.cos(a), r * math.sin(a) * 0.9
            lo.append(bm.verts.new((x, 9 - k * 1.1, z)))
            hi.append(bm.verts.new((x, 9 - k * 1.1 - 1.0, z)))
        for i in range(seg):
            bm.faces.new((lo[i], lo[i + 1], hi[i + 1], hi[i]))
        add(f'shell_rib{k}', bm, white if k % 2 else wood, smooth=True)
    # небо и деревья
    sky = mat('sky', (0.03, 0.05, 0.12), emit=0.4)
    add('sky', ring_band(45, -6, 40, -math.pi, math.pi, 64, 0, -10), sky)
    stars = mat('stars', (1, 1, 0.9), emit=8)
    random.seed(7)
    add('stars', merge([sphere(0.08, ((r := random.uniform(30, 42)) * math.sin(a := random.uniform(-math.pi, math.pi)), -10 + r * math.cos(a), random.uniform(8, 35)), 4) for _ in range(160)]), stars)
    tree = mat('trees', (0.02, 0.05, 0.03), rough=1)
    add('trees', merge([cyl(random.uniform(1.5, 3), random.uniform(6, 10), (x, y, 3), 8, 0.2) for x, y in [(random.uniform(-25, 25), random.uniform(-30, 12)) for _ in range(40)] if abs(x) > 11 or y < -26]), tree)
    # скамейки
    bench = mat('bench', (0.35, 0.22, 0.12), rough=0.8)
    items = []
    for r in range(12):
        items.append((15, 0.5, 0.1, (0, -3.5 - r * 1.1, -0.65 + r * 0.06), 0))
        items.append((15, 0.08, 0.4, (0, -3.75 - r * 1.1, -0.4 + r * 0.06), 0))
    add('benches', boxes(items), bench)
    audience(12, row0=-3.5, gap=1.1, width=15, rise=0.06, seat=(0.35, 0.22, 0.12), people=0.75)
    lamp = mat('lamp', (1.0, 0.85, 0.55), emit=10)
    add('lamps', merge([sphere(0.25, (s * 10, y, 4), 8) for s in (-1, 1) for y in (-5, -15, 4)]), lamp)


def h_shoebox(name, w, length, h, wall, ceil, coffer_color, col_m, gold_organ, balc_front, chand=3, portraits_=False, caryatids=False, arch=False):
    stage(w=w, depth=10)
    walls_box(w, -length, 11, h, wall)
    ceiling(w, -length, 11, h - 1.4, ceil, coffers=7, coffer_color=coffer_color)
    organ(0, 10.6, 3.2, w * 0.55, h - 6, gold=gold_organ, n=41)
    # хоры/места за оркестром
    add('choir', box(w * 0.8, 3, 2.0, (0, 9.4, 1.0)), mat('choir_seats', (0.22, 0.1, 0.05), rough=0.8))
    if caryatids:
        gold = mat('caryatid', (0.82, 0.6, 0.27), metal=1.0, rough=0.3)
        cs = []
        for s in (-1, 1):
            for k in range(12):
                y = -length + 3 + k * (length + 6) / 12
                cs.append(cyl(0.22, 2.4, (s * (w / 2 - 0.5), y, 5.4), 10, 0.18))
                cs.append(sphere(0.2, (s * (w / 2 - 0.5), y, 6.8), 8))
        add('caryatids', merge(cs), gold)
    columns([-w / 2 + 0.35, w / 2 - 0.35], -length + 2, 9, 10, h - 3, 0.28, col_m, z0=-1.1)
    balcony_side(-1, -length + 1, 6, 3.8, front=balc_front)
    balcony_side(1, -length + 1, 6, 3.8, front=balc_front)
    if portraits_:
        portraits(w, -length + 2, 6, 7.5, 8)
    if arch:
        m = mat('arch', (0.92, 0.88, 0.78), rough=0.5)
        bm = bmesh.new()
        seg = 32
        lo, hi = [], []
        for i in range(seg + 1):
            a = math.pi * i / seg
            x, z = -(w / 2 - 0.5) * math.cos(a), 4 + (h - 7) * math.sin(a)
            lo.append(bm.verts.new((x, -0.8, z)))
            hi.append(bm.verts.new((x * 1.06, -1.4, z + 0.8)))
        for i in range(seg):
            bm.faces.new((lo[i], lo[i + 1], hi[i + 1], hi[i]))
        add('arch', bm, m, smooth=True)
        add('arch_gold', ring_band(w / 2 - 0.5, 0, 0.1, 0, 0, 2), mat('gold', (0.85, 0.62, 0.28), metal=1.0, rough=0.28))
    audience(int(length / 1.1), row0=-3.0, width=w - 3)
    for i in range(chand):
        chandelier((0, -length * (i + 0.5) / chand, h - 3.2), r=1.3, tiers=3)


def h_horseshoe(name, tiers, front, inside, curtain_c, ceiling_c, chand_r=2.2, shell_wood=(0.55, 0.36, 0.2), painted=None):
    stage(w=20, depth=10)
    shell(19, 10.5, 11, shell_wood)
    portal(17, 11, -2.0)
    curtain(17, 11, -1.8, 0, color=curtain_c)
    # зал
    floor = mat('parterre', (0.25, 0.12, 0.06), rough=0.7)
    add('parterre_floor', box(30, 30, 0.2, (0, -16, -1.2)), floor)
    horseshoe(tiers, 12, front, inside)
    audience(13, row0=-4.0, width=18, curve=1.5)
    top = 1.2 + tiers * 2.6
    cm = mat('dome', ceiling_c, rough=0.8)
    add('dome', cyl(14.5, 0.4, (0, -14, top + 0.5), 48), cm)
    if painted:
        # роспись плафона: цветные «лепестки» вокруг люстры
        cols = [mat(f'paint{i}', c, rough=0.8) for i, c in enumerate(painted)]
        for i in range(len(painted) * 2):
            a0 = 2 * math.pi * i / (len(painted) * 2)
            bm = bmesh.new()
            c0 = bm.verts.new((0, -14, top + 0.28))
            vs = [bm.verts.new((10 * math.sin(a0 + d), -14 + 10 * math.cos(a0 + d), top + 0.28)) for d in (0, math.pi / len(painted))]
            bm.faces.new((c0, vs[1], vs[0]))
            add(f'paint{i}', bm, cols[i % len(cols)])
    chandelier((0, -14, top - 1.0), r=chand_r, tiers=4)


def ell(cx, cy, rr, k, a):
    """Точка эллипса: угол a от оси +Y (к сцене), полуось по X — rr, по Y — rr·k."""
    return cx + rr * math.sin(a), cy + rr * k * math.cos(a)


def tier_ring(name, cx, cy, r, k, z, depth, a0, a1, front, back, slab, rail=None, wall_h=3.0, rows=3, boxes_every=0.0,
              people=0.85, seg=72, lamps=None):
    """Ярус по дуге эллипса: пол-плита, барьер (front) с поручнем (rail), задняя стена (back), ряды публики,
    перегородки лож (каждые boxes_every рад), светильники на барьере."""
    crowd = mat('crowd', (0.035, 0.03, 0.03), rough=0.9)
    head = mat('crowd_head', (0.12, 0.085, 0.07), rough=0.8)
    bm = bmesh.new()
    inner, outer = [], []
    for i in range(seg + 1):
        a = a0 + (a1 - a0) * i / seg
        inner.append(bm.verts.new((*ell(cx, cy, r, k, a), z)))
        outer.append(bm.verts.new((*ell(cx, cy, r + depth, k, a), z)))
    for i in range(seg):
        bm.faces.new((inner[i], outer[i], outer[i + 1], inner[i + 1]))
    # низ плиты (видно из партера)
    lo_i = [bm.verts.new((v.co.x, v.co.y, z - 0.35)) for v in inner]
    lo_o = [bm.verts.new((v.co.x, v.co.y, z - 0.35)) for v in outer]
    for i in range(seg):
        bm.faces.new((lo_i[i + 1], lo_o[i + 1], lo_o[i], lo_i[i]))
    add(f'{name}_slab', bm, slab)
    add(f'{name}_front', merge([ring_band(r, z - 0.35, z + 1.0, a0, a1, seg, cx, cy, r * k, inward=False),
                                ring_band(r - 0.02, z - 0.35, z + 1.0, a0, a1, seg, cx, cy, r * k)]), front)
    if rail:
        add(f'{name}_rail', ring_band(r - 0.05, z + 0.95, z + 1.08, a0, a1, seg, cx, cy, r * k), rail)
    add(f'{name}_back', ring_band(r + depth, z, z + wall_h, a0, a1, seg, cx, cy, (r + depth) * k), back)
    ppl, hs, parts = [], [], []
    for row in range(rows):
        rr = r + 0.6 + row * (depth - 0.8) / max(1, rows - 1) if rows > 1 else r + depth / 2
        n = int(abs(a1 - a0) * rr / 0.62)
        zz = z + row * 0.35
        for i in range(n):
            a = a0 + (a1 - a0) * (i + 0.5) / n
            x, y = ell(cx, cy, rr, k, a)
            if random.random() < people:
                seat_at(x, y, zz)
    if boxes_every:
        a = a0
        while a <= a1 + 1e-6:
            x0, y0 = ell(cx, cy, r, k, a)
            x1, y1 = ell(cx, cy, r + depth, k, a)
            L = math.hypot(x1 - x0, y1 - y0)
            parts.append((0.12, L, wall_h * 0.85, ((x0 + x1) / 2, (y0 + y1) / 2, z + wall_h * 0.42), -math.atan2(x1 - x0, y1 - y0)))
            a += boxes_every
        add(f'{name}_boxes', boxes(parts), front)
    if lamps:
        glow = mat('lamp', lamps, emit=5.0)
        n = max(1, int(abs(a1 - a0) * r / 2.2))
        add(f'{name}_lamps', merge([sphere(0.09, (*ell(cx, cy, r - 0.1, k, a0 + (a1 - a0) * (i + 0.5) / n), z + 1.25), 6) for i in range(n)]), glow)


def choir_steps(name, w, y0, rows, z0, dz, dy, seat_c, riser_c, people=0.85):
    """Хоры за оркестром: ступени с креслами и публикой."""
    items, seats, ppl, hs = [], [], [], []
    for row in range(rows):
        y = y0 + row * dy
        z = z0 + row * dz
        items.append((w, dy + 0.02, z, (0, y, z / 2), 0))
        seats.append((w - 0.4, 0.45, 0.4, (0, y + 0.15, z + 0.2), 0))
        n = int(w / 0.62)
        for i in range(n):
            x = -w / 2 + (i + 0.5) * w / n
            if random.random() < people:
                seat_at(x, y + 0.1, z)
    add(f'{name}_steps', boxes(items), riser_c)
    add(f'{name}_seats', boxes(seats), seat_c)


def big_organ(cx, cy, z0, w, h, case_c, pipe_c, towers=5):
    """Большой концертный орган: корпус, башни труб (выше по краям и в центре), ряды мелких труб."""
    case = mat('organ_case2', case_c, rough=0.45)
    pipe = mat('pipes2', pipe_c, metal=1.0, rough=0.22)
    add('organ_case', box(w, 1.6, h, (cx, cy + 0.8, z0 + h / 2)), case)
    ps, tw = [], []
    tws = w / towers
    for t in range(towers):
        tx = cx - w / 2 + (t + 0.5) * tws
        th = h * (0.95 if t in (0, towers - 1, towers // 2) else 0.75)
        n = 9
        for i in range(n):
            x = tx - tws / 2 + (i + 0.5) * tws / n
            hh = th * (0.6 + 0.4 * (1 - abs((i - n / 2) / (n / 2))))
            ps.append(cyl(tws / n * 0.4, hh, (x, cy - 0.15, z0 + 0.5 + hh / 2), 10))
        tw.append(box(tws * 0.98, 0.5, 0.35, (tx, cy - 0.1, z0 + th + 0.7)))
        tw.append(box(tws * 0.98, 0.5, 0.3, (tx, cy - 0.1, z0 + 0.35)))
    for row in range(2):
        for i in range(int(w / 0.22)):
            x = cx - w / 2 + (i + 0.5) * 0.22
            hh = 1.2 + 0.4 * row
            ps.append(cyl(0.07, hh, (x, cy - 0.45, z0 + 0.5 + row * (h * 0.45) + hh / 2), 6))
    add('organ_pipes', merge(ps), pipe)
    add('organ_cornice', merge(tw), case)


def h_vineyard():
    """Берлинская филармония: «виноградник» — блоки террас на разной высоте со всех сторон, белые барьеры,
    шатёр из парусов, «облака»-отражатели над сценой, орган слева сзади."""
    stage(w=16, depth=8, wood=(0.62, 0.44, 0.24))
    wood = mat('berlin_wood', (0.66, 0.5, 0.3), rough=0.55)
    white = mat('berlin_white', (0.93, 0.92, 0.88), rough=0.6)
    seats = mat('berlin_seat', (0.32, 0.3, 0.42), rough=1)
    gold = mat('berlin_gold', (0.9, 0.72, 0.35), metal=0.6, rough=0.35)
    add('floor', cyl(30, 0.3, (0, -2, -1.3), 64), wood)
    # кольца блоков-террас: (радиус, высота, сколько блоков, сдвиг угла); за оркестром — тоже
    rings = [(10.5, 0.6, 9, 0.0), (13.5, 2.2, 11, 0.25), (16.5, 4.0, 13, 0.1), (19.5, 5.8, 15, 0.3), (22.5, 7.6, 15, 0.05)]
    for ri, (R, Z, n, off) in enumerate(rings):
        span = 2 * math.pi / n
        for b in range(n):
            a_mid = -math.pi + (b + 0.5 + off) * span
            # первое кольцо прямо за оркестром не ставим — там подиумы
            if ri == 0 and abs(a_mid) < 1.0:
                continue
            z = Z + (random.random() - 0.5) * 0.9
            a0, a1 = a_mid - span * 0.42, a_mid + span * 0.42
            tier_ring(f'v{ri}_{b}', 0, -2, R, 1.0, z, 2.4, a0, a1, white, wood, wood, rail=gold, wall_h=1.6, rows=3, seg=10)
            add(f'v{ri}_{b}_under', ring_band(R + 0.02, -1.2, z - 0.35, a0, a1, 10, 0, -2, R), wood)
            add(f'v{ri}_{b}_seats', merge([ring_band(R + 0.6 + row * 0.8, z + row * 0.35, z + row * 0.35 + 0.45, a0, a1, 10, 0, -2) for row in range(3)]), seats)
    add('walls_out', ring_band(27, -1.3, 18, -math.pi, math.pi, 64, 0, -2), mat('berlin_wall', (0.86, 0.74, 0.5), rough=0.7))
    big_organ(-15, 14, 7, 9, 8, (0.62, 0.5, 0.36), (0.88, 0.88, 0.86), towers=3)
    tent = mat('tent', (0.95, 0.94, 0.9), rough=0.8)
    bm = bmesh.new()
    top = bm.verts.new((0, -2, 23))
    n = 10
    ring1 = [bm.verts.new((*ell(0, -2, 14, 1, 2 * math.pi * k / n), 20.5 + 0.8 * (k % 2))) for k in range(n)]
    ring2 = [bm.verts.new((*ell(0, -2, 27.5, 1, 2 * math.pi * k / n + math.pi / n), 17.5)) for k in range(n)]
    for k in range(n):
        bm.faces.new((top, ring1[(k + 1) % n], ring1[k]))
        bm.faces.new((ring1[k], ring1[(k + 1) % n], ring2[k]))
        bm.faces.new((ring1[k], ring2[k], ring2[(k - 1) % n]))
    add('tent', bm, tent)
    add('clouds', merge([cyl(1.5, 0.35, (x, y, 12.5), 12, 1.25) for x, y in [(0, 3), (-3.2, 4.6), (3.2, 4.6), (-2.2, 0.8), (2.2, 0.8), (0, 6.2), (-4.6, 2.2), (4.6, 2.2), (0, -1.2)]]), white)
    add('cloud_lights', merge([sphere(0.12, (x + dx, y, 12.25), 6) for x, y in [(0, 3), (-3.2, 4.6), (3.2, 4.6), (0, 6.2)] for dx in (-0.5, 0.5)]), mat('lamp', (1.0, 0.9, 0.7), emit=6.0))
    audience(8, row0=-3.0, width=16, curve=1.5, seat=(0.32, 0.3, 0.42))


def h_oval():
    """Королевский Альберт-холл: овал, ложи с красным бархатом, кремовые ярусы с золотом, наверху — галерея с колоннами;
    за оркестром — крутые хоры и огромный орган; стеклянный купол на железных рёбрах и «грибы»-отражатели."""
    stage(w=20, depth=9)
    red = mat('albert_red', (0.45, 0.05, 0.06), rough=0.95)
    deep = mat('albert_deep', (0.25, 0.03, 0.04), rough=0.95)
    cream = mat('albert_cream', (0.86, 0.78, 0.6), rough=0.6)
    terra = mat('albert_terra', (0.62, 0.36, 0.24), rough=0.7)
    gold = mat('gold', (0.85, 0.62, 0.28), metal=1.0, rough=0.28)
    cx, cy, k = 0, -6, 0.8
    skip = 0.62  # за сценой — хоры и орган
    add('arena', cyl(19, 0.3, (cx, cy, -1.3), 64), mat('albert_floor', (0.35, 0.2, 0.12), rough=0.6))
    for t, (z, r, depth, front, back, rows, bx, wall) in enumerate([
            (0.6, 17.0, 2.4, cream, terra, 4, 0.0, 2.6),
            (3.6, 19.0, 2.4, red, deep, 2, 0.105, 2.8),
            (6.6, 19.6, 2.4, red, deep, 2, 0.105, 2.8),
            (9.6, 20.2, 3.0, cream, terra, 3, 0.0, 2.6),
            (12.4, 21.0, 2.6, cream, cream, 2, 0.0, 3.4)]):
        tier_ring(f'oval{t}', cx, cy, r, k, z, depth, skip, 2 * math.pi - skip, front, back, front if t else terra,
                  rail=gold, wall_h=wall, rows=rows, boxes_every=bx, lamps=(1.0, 0.82, 0.55) if t in (1, 2) else None)
        add(f'oval_wall{t}', ring_band(r + depth, z + wall, z + 3.0, skip, 2 * math.pi - skip, 72, cx, cy, (r + depth) * k), terra)
    cols = []
    for i in range(60):
        a = skip + (2 * math.pi - 2 * skip) * (i + 0.5) / 60
        x, y = ell(cx, cy, 21.2, k, a)
        cols.append(cyl(0.22, 3.2, (x, y, 14.0), 10))
    add('gallery_cols', merge(cols), cream)
    add('frieze', ring_band(23.6, 15.6, 17.0, -math.pi, math.pi, 72, cx, cy, 23.6 * k), terra)
    choir_steps('choir', 18, 9.0, 12, 0.8, 0.55, 0.85, red, deep)
    add('choir_wall_l', box(0.6, 13, 22, (-9.3, 14.5, 10)), terra)
    add('choir_wall_r', box(0.6, 13, 22, (9.3, 14.5, 10)), terra)
    # торцы ярусов у сцены — глухие стены до хоров
    add('side_l', box(12, 0.6, 22, (-15.2, 8.4, 10)), terra)
    add('side_r', box(12, 0.6, 22, (15.2, 8.4, 10)), terra)
    add('organ_back', box(26, 0.6, 22, (0, 21.0, 9)), terra)
    big_organ(0, 19.0, 8.0, 17, 11, (0.42, 0.26, 0.14), (0.86, 0.78, 0.55), towers=7)
    glass = mat('dome_glass', (0.32, 0.36, 0.42), rough=0.2, emit=0.25)
    add('dome', cyl(24, 0.4, (cx, cy, 20.5), 64, 8), glass)
    iron = mat('iron', (0.12, 0.12, 0.13), metal=0.8, rough=0.5)
    ribs = []
    for i in range(24):
        a = 2 * math.pi * i / 24
        x, y = ell(cx, cy, 12, k, a)
        ribs.append((0.25, 24, 0.35, (x, y, 20.0), -a))
    add('dome_ribs', boxes(ribs), iron)
    mush = mat('mushroom', (0.8, 0.77, 0.72), rough=0.55)
    ms, ls = [], []
    for i in range(85):
        rr = 2.5 + 13 * math.sqrt((i + 0.5) / 85)
        a = i * 2.39996
        x, y = ell(cx, cy + 3, rr, 0.85, a)
        ms.append(cyl(0.95, 0.35, (x, y, 15.8 + 0.4 * math.sin(i)), 12, 0.35))
        ls.append(sphere(0.08, (x, y, 15.55), 4))
    add('mushrooms', merge(ms), mush, smooth=True)
    add('mushroom_lights', merge(ls), mat('lamp', (1.0, 0.85, 0.6), emit=4.0))
    audience(14, row0=-3.0, width=22, curve=2.0)


def h_sydney():
    """Сиднейский оперный театр, концертный зал: стены из белой берёзы рёбрами, трибуны из щёточника
    (красно-коричневое дерево), хоры за оркестром под Большим органом, прозрачные кольца-отражатели над сценой."""
    stage(w=18, depth=9, wood=(0.7, 0.55, 0.38))
    birch = mat('birch', (0.9, 0.84, 0.72), rough=0.55)
    birch2 = mat('birch_dark', (0.76, 0.68, 0.55), rough=0.6)
    brush = mat('brushbox', (0.52, 0.24, 0.13), rough=0.5)
    seat = mat('syd_seat', (0.6, 0.14, 0.24), rough=0.95)
    acrylic = mat('acrylic', (0.85, 0.88, 0.92), rough=0.15, metal=0.1)
    cx, cy, k = 0, -2, 1.0
    add('floor', cyl(21, 0.3, (cx, cy, -1.3), 64), brush)
    add('wall', ring_band(20.5, -1.3, 21, -math.pi, math.pi, 72, cx, cy, 20.5 * k), birch2)
    ribs = []
    for i in range(56):
        a = -math.pi + 2 * math.pi * i / 56
        x, y = ell(cx, cy, 20.0, k, a)
        ribs.append((0.35, 1.1, 22, (x, y, 9.7), -math.atan2(x - cx, (y - cy) / k)))
    add('birch_ribs', boxes(ribs), birch)
    for t, (z, r) in enumerate([(1.2, 15.0), (4.6, 16.6)]):
        tier_ring(f'syd{t}', cx, cy, r, k, z, 2.6, 0.75, 2 * math.pi - 0.75, brush, birch2, brush, rail=birch,
                  wall_h=2.2, rows=3, lamps=(1.0, 0.86, 0.6) if t == 0 else None)
    choir_steps('choir', 16, 9.6, 8, 1.0, 0.5, 0.85, seat, brush)
    add('organ_wall', box(22, 0.6, 20, (0, 18.3, 9)), birch2)
    big_organ(0, 16.9, 5.6, 14, 10, (0.55, 0.28, 0.15), (0.88, 0.88, 0.86), towers=5)
    vault = []
    for i in range(28):
        a = 2 * math.pi * i / 28
        x, y = ell(cx, cy, 10, k, a)
        vault.append((0.5, 20, 0.6, (x, y, 19.5), -a))
    add('vault_ribs', boxes(vault), birch)
    add('ceiling', cyl(21, 0.4, (cx, cy, 20.5), 64), birch2)
    for i, (x, y, z, r) in enumerate([(0, 3, 10, 2.2), (-4, 2, 10.5, 1.8), (4, 2, 10.5, 1.8), (0, 7, 11, 2.0), (-3.5, 6.5, 11.2, 1.6),
                                      (3.5, 6.5, 11.2, 1.6), (0, -1, 10.6, 1.8), (-7, 4.5, 11.5, 1.5), (7, 4.5, 11.5, 1.5)]):
        bm = bmesh.new()
        bmesh.ops.create_circle(bm, cap_ends=False, segments=32, radius=r)
        me = bpy.data.meshes.new('_t')
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(f'ring{i}', me)
        bpy.context.scene.collection.objects.link(o)
        o.location = (x, y, z)
        o.modifiers.new('sk', 'SKIN')
        for v in me.skin_vertices[0].data:
            v.radius = (0.3, 0.3)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier='sk')
        me.materials.append(acrylic)
    audience(16, row0=-3.0, width=22, curve=1.2, seat=(0.6, 0.14, 0.24))


HALLS = {
    'dk': h_dk,
    'oblfil': h_oblfil,
    'park': h_park,
    'bzk': lambda: h_shoebox('bzk', 20, 36, 16, (0.94, 0.92, 0.86), (0.95, 0.93, 0.88), (0.85, 0.78, 0.6), mat('col_white', (0.95, 0.94, 0.9), rough=0.5),
                             False, (0.95, 0.93, 0.86), chand=4, portraits_=True),
    'musikverein': lambda: h_shoebox('musikverein', 19, 40, 17, (0.82, 0.62, 0.3), (0.75, 0.55, 0.28), (0.55, 0.35, 0.18),
                                     mat('col_gold', (0.85, 0.62, 0.28), metal=1.0, rough=0.3), True, (0.85, 0.65, 0.32), chand=5, caryatids=True),
    'carnegie': lambda: h_shoebox('carnegie', 22, 36, 18, (0.93, 0.9, 0.84), (0.92, 0.9, 0.84), (0.85, 0.72, 0.45),
                                  mat('col_white', (0.95, 0.94, 0.9), rough=0.5), False, (0.92, 0.88, 0.8), chand=2, arch=True),
    'mariinka': lambda: h_horseshoe('mariinka', 5, (0.25, 0.55, 0.6), (0.12, 0.3, 0.34), (0.2, 0.45, 0.5), (0.85, 0.82, 0.72), shell_wood=(0.6, 0.45, 0.28)),
    'bolshoi': lambda: h_horseshoe('bolshoi', 6, (0.9, 0.8, 0.55), (0.45, 0.04, 0.05), (0.55, 0.05, 0.06), (0.88, 0.8, 0.6), chand_r=2.6),
    'scala': lambda: h_horseshoe('scala', 6, (0.92, 0.85, 0.65), (0.5, 0.05, 0.05), (0.5, 0.04, 0.05), (0.9, 0.85, 0.7)),
    'garnier': lambda: h_horseshoe('garnier', 5, (0.55, 0.06, 0.07), (0.45, 0.04, 0.05), (0.5, 0.04, 0.05), (0.8, 0.75, 0.6), chand_r=2.8,
                                   painted=[(0.15, 0.25, 0.6), (0.85, 0.2, 0.15), (0.9, 0.75, 0.2), (0.2, 0.55, 0.3), (0.6, 0.2, 0.55)]),
    'berlin': h_vineyard,
    'albert': h_oval,
    'sydney': h_sydney,
}

os.makedirs(OUT, exist_ok=True)
for name, fn in HALLS.items():
    if ONLY and name not in ONLY:
        continue
    reset()
    random.seed(hash(name) % 1000)
    fn()
    import json
    with open(os.path.join(OUT, f'{name}.seats.json'), 'w', encoding='utf8') as fj:
        json.dump(SEATS, fj, separators=(',', ':'))
    out = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=True)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    print('зал', name, os.path.getsize(out) // 1024, 'КБ', tris, 'треуг.')
