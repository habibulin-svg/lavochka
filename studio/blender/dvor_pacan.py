"""Дворовый спорт (проба): пацан в олимпийке бригады — стилизованный персонаж KayKit + готовые анимации KayKit.

blender -b --factory-startup --python studio/blender/dvor_pacan.py -- <персонаж.glb> <папка анимаций Rig_Medium (glb)> <выход.glb> [бригада] [all|mesh|anims]

В игре: модели бригад — режим mesh (public/gorodki/pacan/<бригада>.glb), клипы — один anims.glb (режим anims), их
three.js вешает на любую бригаду по именам костей.

Основа — KayKit Adventurers 2.0 «Ranger» (Kay Lousberg, CC0): low-poly, крупная голова, кисти-«варежки» — уровень Wii Sports.
Анимации — KayKit Character Animations 1.1 (CC0) на том же скелете Rig_Medium; в glb идут NLA-дорожками (имя дорожки —
имя клипа в three.js). Скелет: root, hips, spine, chest, head, upperarm/lowerarm/wrist/hand/handslot.l/r, upperleg/lowerleg/
foot/toes.l/r; handslot.r — точка для биты. Модель смотрит в −Y Blender (+Z glTF).

Что меняем: убираем плащ, колчан, шарф, пряжки, усы и бородку; голову чуть уменьшаем (меньше «чиби», ближе к Wii);
одежда — олимпийка бригады по liveries.py и правилам ГОПС (gopnik_build.py): своя развёртка и запечённая текстура,
цвет пикселя — по точке тела (шеврон, кокетка, полосы, лампасы, манжеты, молния); сапоги — белые кроссовки;
волосы темнее; сверху — кепка-восьмиклинка в серую ёлочку, шире плеч (studio/bible/gopnik.md).
Исходники ассетов — G:/temp/dl-assets (в git не кладём), лицензии — CC0.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
from liveries import LIVERIES  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
SRC, ANIMS, OUT = args[0], args[1], args[2]
BRIGADE = args[3] if len(args) > 3 else 'zatulinka'
# mesh — модель бригады без анимаций; anims — только скелет и клипы (общий anims.glb для всех бригад); all — всё вместе
MODE = args[4] if len(args) > 4 else 'all'
L = LIVERIES[BRIGADE]
HEAD_K = 0.86

# клипы: (файл, имя в KayKit, имя у нас)
CLIPS = [
    ('Rig_Medium_General.glb', 'Idle_A', 'idle'),
    ('Rig_Medium_General.glb', 'Idle_B', 'idle2'),
    ('Rig_Medium_General.glb', 'Throw', 'throw'),
    ('Rig_Medium_General.glb', 'PickUp', 'pickup'),
    ('Rig_Medium_General.glb', 'Hit_A', 'hit'),
    ('Rig_Medium_CombatMelee.glb', 'Melee_2H_Idle', 'hold2h'),
    ('Rig_Medium_CombatMelee.glb', 'Melee_2H_Attack_Slice', 'swing2h'),
    ('Rig_Medium_CombatMelee.glb', 'Melee_1H_Attack_Slice_Horizontal', 'swing1h'),
    ('Rig_Medium_Simulation.glb', 'Cheering', 'cheer'),
    ('Rig_Medium_Simulation.glb', 'Waving', 'wave'),
    ('Rig_Medium_Simulation.glb', 'Sit_Chair_Idle', 'sit'),
    ('Rig_Medium_MovementBasic.glb', 'Running_A', 'run'),
    ('Rig_Medium_MovementBasic.glb', 'Walking_A', 'walk'),
    ('Rig_Medium_MovementBasic.glb', 'Jump_Full_Short', 'jump'),
    ('Rig_Medium_Tools.glb', 'Holding_A', 'holding'),
]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
objs = list(bpy.context.scene.objects)
rig = next(o for o in objs if o.type == 'ARMATURE')
for o in objs:
    if o.type == 'MESH' and any(k in o.name for k in ('Cape', 'Quiver')):
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
head = next(o for o in meshes if o.name.endswith('_Head'))


def cell_of(uv):
    return int(min(0.999, uv.x) * 8), int(min(0.999, 1 - uv.y) * 4)


# ---------------------------------------------------------------- голова: без усов и бородки, чуть меньше
bm = bmesh.new()
bm.from_mesh(head.data)
uvl = bm.loops.layers.uv.active
mw = head.matrix_world


def fcell(f):
    u = sum(lp[uvl].uv.x for lp in f.loops) / len(f.loops)
    v = sum(lp[uvl].uv.y for lp in f.loops) / len(f.loops)
    return cell_of(Vector((u, v)))


eyes = [mw @ f.calc_center_median() for f in bm.faces if fcell(f) == (2, 0)]
eye_z = sum(p.z for p in eyes) / len(eyes)
seen = set()
drop = []
for f in bm.faces:
    if f.index in seen:
        continue
    part, stack = [], [f]
    seen.add(f.index)
    while stack:
        g = stack.pop()
        part.append(g)
        for e in g.edges:
            for h in e.link_faces:
                if h.index not in seen:
                    seen.add(h.index)
                    stack.append(h)
    if all(fcell(g) == (1, 0) for g in part) and max((mw @ v.co).z for g in part for v in g.verts) < eye_z:
        drop += part
bmesh.ops.delete(bm, geom=list(set(drop)), context='FACES')
# шея — точка, вокруг которой уменьшаем: кость head
hb = rig.data.bones['head']
neck = rig.matrix_world @ hb.head_local
inv = mw.inverted()
for v in bm.verts:
    w = mw @ v.co
    v.co = inv @ (neck + (w - neck) * HEAD_K)
bm.to_mesh(head.data)
bm.free()
print('голова: убрано граней', len(set(drop)), 'глаза на', round(eye_z, 3))

# ---------------------------------------------------------------- олимпийка бригады: запечённая текстура по правилам ГОПС
# Правила — как gopnik_build.py (кокетка, шеврон V-стопкой, полосы на груди, лампасы по внешнему боку, манжеты, пояс)
# + белая молния. Одежда получает свою развёртку (smart UV на все части разом) и текстуру SUIT×SUIT; цвет каждого
# пикселя считается по точке тела под ним (положение и нормаль) — края полос ровные, не по граням. Цвета плоские
# (toon, как концепты ГОПС). Кожа, волосы, глаза — на старой палитре KayKit (материал 0), одежда — материал «suit».
SUIT = 1024  # плоские цвета: 1024² хватает, а на телефонах 2048² × 6 бригад — ~130 МБ видеопамяти
FIXED = {'shoe': 'f2f1ec', 'sole': '8a8a8a', 'zip': 'f2f2f2', 'zip_edge': 'b8b8b8'}


def hexc(h):
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def bone(name):
    b = rig.data.bones[name]
    return rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local


hips_p = bone('hips')[0]
neck_p = bone('head')[0]
TH = neck_p.z - hips_p.z  # высота корпуса от таза до шеи
K = 3.0  # толщины полос ГОПС (доли роста) → доли корпуса (корпус ≈ треть роста)


def kind_of(o):
    kind = 'arm' if '_Arm' in o.name else 'leg' if '_Leg' in o.name else 'body' if o.name.endswith('_Body') else None
    return kind, (1 if o.name.endswith('Left') else -1)  # Left — +x (модель смотрит в −Y)


def connected_parts(bm):
    seen, parts = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        part, st = [], [f]
        seen.add(f.index)
        while st:
            g = st.pop()
            part.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        st.append(h)
        parts.append(part)
    return parts


# 1) подготовка: убрать шарф и пряжки, отметить грани одежды (атрибут cloth) и обуви (shoe)
cloth_objs = []
for o in meshes:
    kind, side = kind_of(o)
    if not kind:
        continue
    bm = bmesh.new()
    bm.from_mesh(o.data)
    uvl = bm.loops.layers.uv.active
    dl = bm.verts.layers.deform.active
    gname = {g.index: g.name for g in o.vertex_groups}

    def fc(f):
        u = sum(lp[uvl].uv.x for lp in f.loops) / len(f.loops)
        v = sum(lp[uvl].uv.y for lp in f.loops) / len(f.loops)
        return cell_of(Vector((u, v)))

    def dom(f):
        w = {}
        for v in f.verts:
            for gi, wt in v[dl].items():
                nm = gname.get(gi, '')
                w[nm] = w.get(nm, 0) + wt
        return max(w, key=w.get).split('.')[0] if w else ''

    if kind == 'body':
        drop = [f for part in connected_parts(bm) if sum(fc(g) in ((0, 1), (3, 0)) for g in part) > 0.6 * len(part) for f in part]
        bmesh.ops.delete(bm, geom=list(set(drop)), context='FACES')
        print(o.name, 'шарф и пряжки: убрано граней', len(set(drop)))
    bm.faces.ensure_lookup_table()
    lc = bm.faces.layers.int.new('cloth')
    for f in bm.faces:
        cell = fc(f)
        if cell in ((1, 0), (2, 0)):
            f[lc] = 0  # волосы, глаза
        elif cell == (0, 0):
            f[lc] = 1 if kind == 'arm' and dom(f) in ('upperarm', 'lowerarm') else 0  # длинный рукав; кисти и шея — кожа
        elif cell == (3, 2):
            f[lc] = 2  # сапоги → кроссовки
        else:
            f[lc] = 1
    bm.to_mesh(o.data)
    bm.free()
    cloth_objs.append(o)

# 2) развёртка одежды: все части разом, острова упакованы в один квадрат
bpy.ops.object.select_all(action='DESELECT')
for o in cloth_objs:
    o.data.uv_layers.new(name='paint')
    o.data.uv_layers.active = o.data.uv_layers['paint']
    o.select_set(True)
bpy.context.view_layer.objects.active = cloth_objs[0]
bpy.ops.object.mode_set(mode='EDIT')
for o in cloth_objs:
    bm = bmesh.from_edit_mesh(o.data)
    lc = bm.faces.layers.int.get('cloth')
    for f in bm.faces:
        f.select = f[lc] > 0
    bmesh.update_edit_mesh(o.data)
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=True)
bpy.ops.object.mode_set(mode='OBJECT')


# 3) растеризация: в каждом пикселе текстуры — точка тела, нормаль, номер грани
def raster(obj, size, uvname):
    me = obj.data
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    lo = np.zeros(n * 3, np.int64)
    me.loop_triangles.foreach_get('loops', lo)
    vi = np.zeros(n * 3, np.int64)
    me.loop_triangles.foreach_get('vertices', vi)
    pidx = np.zeros(n, np.int64)
    me.loop_triangles.foreach_get('polygon_index', pidx)
    uv = np.zeros(len(me.loops) * 2)
    me.uv_layers[uvname].data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    mw = np.array(obj.matrix_world)
    co = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    nr = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('normal', nr)
    nr = nr.reshape(-1, 3) @ mw[:3, :3].T
    cl = np.zeros(len(me.polygons), np.int64)
    me.attributes['cloth'].data.foreach_get('value', cl)
    P = np.zeros((size, size, 3), np.float32)
    N = np.zeros((size, size, 3), np.float32)
    F = np.full((size, size), -1, np.int64)
    tuv = uv[lo].reshape(n, 3, 2) * [size, size]
    tco = co[vi].reshape(n, 3, 3)
    tnr = nr[vi].reshape(n, 3, 3)
    for i in range(n):
        if cl[pidx[i]] == 0:
            continue
        p = tuv[i]
        x0, y0 = np.floor(p.min(0)).astype(int)
        x1, y1 = np.ceil(p.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax_, ay), (bx, by), (cx_, cy_) = p
        d = (by - cy_) * (ax_ - cx_) + (cx_ - bx) * (ay - cy_)
        if abs(d) < 1e-12:
            continue
        w0 = ((by - cy_) * (xs - cx_) + (cx_ - bx) * (ys - cy_)) / d
        w1 = ((cy_ - ay) * (xs - cx_) + (ax_ - cx_) * (ys - cy_)) / d
        w2 = 1 - w0 - w1
        e = -0.03
        inside = (w0 >= e) & (w1 >= e) & (w2 >= e)
        if not inside.any():
            continue
        Wt = np.stack([w0, w1, w2], -1)[inside]
        yy, xx = (ys[inside] - 0.5).astype(int), (xs[inside] - 0.5).astype(int)
        P[yy, xx] = Wt @ tco[i]
        N[yy, xx] = Wt @ tnr[i]
        F[yy, xx] = pidx[i]
    return P, N, F, cl


def band_stack(col, mask, d, bands, scale):
    """Стопка полос [(цвет, толщина в долях роста ГОПС), …]: d — расстояние от начала стопки (вниз)."""
    acc = 0.0
    for c, t in bands:
        col[mask & (d >= acc) & (d < acc + t * scale)] = hexc(c)
        acc += t * scale


def lampas_mask(off, count):
    a = np.abs(off)
    if count == 1:
        return a < 0.14
    if count == 2:
        return (a > 0.08) & (a < 0.28)
    return (a < 0.07) | ((a > 0.18) & (a < 0.3))


col = np.zeros((SUIT, SUIT, 3), np.float32)
M = np.zeros((SUIT, SUIT), bool)
for o in cloth_objs:
    kind, side = kind_of(o)
    sfx = 'l' if side > 0 else 'r'
    P, N, F, cl = raster(o, SUIT, 'paint')
    m = F >= 0
    shoe = m & (cl[np.maximum(F, 0)] == 2)
    m &= ~shoe
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    nn = N / np.maximum(1e-6, np.linalg.norm(N, axis=-1, keepdims=True))
    vco = np.array([o.matrix_world @ v.co for v in o.data.vertices])
    if kind == 'arm':
        a0, _ = bone(f'upperarm.{sfx}')
        a1, _ = bone(f'hand.{sfx}')
        ax = np.array((a1 - a0).normalized(), np.float32)
        alen = (a1 - a0).length
        rel = P - np.array(a0, np.float32)
        t = (rel @ ax) / alen  # 0 — плечо, 1 — запястье
        vr = vco - np.array(a0)
        rad = float(np.median(np.linalg.norm(vr - np.outer(vr @ ax, ax), axis=1)))
        off = (y - a0.y) / max(1e-3, rad)
        c = np.broadcast_to(hexc(L['jacket']), col.shape).copy()
        if 'yoke' in L:
            c[t < 0.2] = hexc(L['yoke'])
        if 'sleeve' in L:
            c[:] = hexc(L['sleeve'])
        if 'sleeve_top' in L:
            c[t <= 0.5] = hexc(L['sleeve_top'])
        if 'forearm' in L:
            c[t > 0.5] = hexc(L['forearm'])
        if 'lampas' in L:
            # верх руки в T-позе — внешний бок опущенной руки
            c[(nn[..., 2] > 0.45) & lampas_mask(off, L['lampas'][1])] = hexc(L['lampas'][0])
        if 'cuff' in L:
            c[t > 0.86] = hexc(L['cuff'])
    elif kind == 'leg':
        l0, _ = bone(f'upperleg.{sfx}')
        l1, _ = bone(f'foot.{sfx}')
        t = (l0.z - z) / max(1e-3, l0.z - l1.z)  # 0 — бедро, 1 — щиколотка
        lrad = float(np.quantile(np.abs(vco[:, 1] - l0.y), 0.8))
        c = np.broadcast_to(hexc(L['trousers']), col.shape).copy()
        if 'ankle' in L:
            band_stack(c, np.ones_like(m), t - 0.78, L['ankle'], -(-K))
        lt = L.get('lampas_trousers') or L.get('lampas')
        if lt:
            c[(nn[..., 0] * side > 0.45) & lampas_mask((y - l0.y) / max(1e-3, lrad), lt[1])] = hexc(lt[0])
        if 'cuff' in L:
            c[t > 0.92] = hexc(L['cuff'])
        c[shoe] = hexc(FIXED['shoe'])
        c[shoe & (z < 0.25 * l1.z)] = hexc(FIXED['sole'])
        m |= shoe
    else:
        r = (z - hips_p.z) / TH  # 0 — таз, 1 — шея
        band = np.abs(vco[:, 2] - (hips_p.z + 0.6 * TH)) < 0.1 * TH
        halfw = float(np.abs(vco[band, 0]).max()) if band.any() else 1.0
        X = np.abs(x) / halfw
        front = nn[..., 1] < -0.2
        c = np.broadcast_to(hexc(L['jacket']), col.shape).copy()
        if 'sleeve_top' in L:
            c[r >= 0.8] = hexc(L['sleeve_top'])
        if 'chest' in L:
            cc, k = L['chest']
            on = (((r - 0.5) / (0.22 / (2 * k))).astype(int) % 2 == 0) & (r >= 0.5) & (r < 0.72) & front
            c[on] = hexc(cc)
        if 'chevron' in L:
            band_stack(c, np.ones_like(m), (0.62 + 0.3 * X) - r, L['chevron'], K)
        if 'yoke' in L:
            c[r >= 0.8] = hexc(L['yoke'])
        # молния: белая полоса с серыми краями посередине спереди
        zr = front & (r > 0.14) & (r < 0.98)
        c[zr & (np.abs(x) < 0.05 * halfw)] = hexc(FIXED['zip_edge'])
        c[zr & (np.abs(x) < 0.03 * halfw)] = hexc(FIXED['zip'])
        c[r < 0.14] = hexc(L.get('cuff', L['jacket']))  # ремень → пояс-резинка
        c[r < 0.0] = hexc(L['trousers'])  # подол рубахи — как штаны
    col[m] = c[m]
    M |= m


def dilate(img, mask, it=6):
    img = img.copy()
    mk = mask.copy()
    for _ in range(it):
        acc = np.zeros_like(img)
        cnt = np.zeros(mk.shape, np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sm = np.roll(mk, (dy, dx), (0, 1))
            acc += np.roll(img, (dy, dx), (0, 1)) * sm[..., None]
            cnt += sm
        new = (~mk) & (cnt > 0)
        img[new] = acc[new] / cnt[new][:, None]
        mk |= new
    return img


col = dilate(col, M)
suit_img = bpy.data.images.new(f'suit_{BRIGADE}', SUIT, SUIT, alpha=True)
spx = np.ones((SUIT, SUIT, 4), np.float32)
spx[..., :3] = np.clip(col, 0, 1)  # растр — снизу вверх, как pixels Blender
suit_img.pixels.foreach_set(spx.ravel())
suit_img.pack()

# 4) материал «suit»; UV одежды → в основную развёртку, временную убрать
suit = bpy.data.materials.new('suit')
if not suit.node_tree:
    suit.use_nodes = True
sb = suit.node_tree.nodes['Principled BSDF']
st_ = suit.node_tree.nodes.new('ShaderNodeTexImage')
st_.image = suit_img
suit.node_tree.links.new(st_.outputs['Color'], sb.inputs['Base Color'])
sb.inputs['Roughness'].default_value = 0.85
for o in cloth_objs:
    me = o.data
    me.materials.append(suit)
    si = len(me.materials) - 1
    cl = np.zeros(len(me.polygons), np.int64)
    me.attributes['cloth'].data.foreach_get('value', cl)
    base, paint = me.uv_layers[0], me.uv_layers['paint']
    for p in me.polygons:
        if cl[p.index] > 0:
            p.material_index = si
            for li in p.loop_indices:
                base.data[li].uv = paint.data[li].uv
    me.uv_layers.active = base
    me.uv_layers.remove(paint)
    me.attributes.remove(me.attributes['cloth'])

# волосы — темнее (ёжик): ячейка (1,0) палитры
mat = head.data.materials[0]
img_node = next(nd for nd in mat.node_tree.nodes if nd.type == 'TEX_IMAGE')
src_img = img_node.image
W, H = src_img.size
px = np.array(src_img.pixels[:], dtype=np.float32).reshape(H, W, 4)
px[H - H // 4:H, W // 8:2 * W // 8, :3] = np.clip(px[H - H // 4:H, W // 8:2 * W // 8, :3] * 0.35, 0, 1)
img = bpy.data.images.new(f'pacan_{BRIGADE}', W, H, alpha=True)
img.pixels[:] = px.ravel()
img.pack()
img_node.image = img
print('олимпийка: пикселей', int(M.sum()))

# ---------------------------------------------------------------- кепка-восьмиклинка (low-poly)
hv = [head.matrix_world @ v.co for v in head.data.vertices]
top = max(p.z for p in hv)
band_f = eye_z + 0.42 * (top - eye_z)  # натянута пониже на лоб
band_b = eye_z + 0.3 * (top - eye_z)
up = [p for p in hv if p.z > band_b]
cx = (min(p.x for p in up) + max(p.x for p in up)) / 2
cy = (min(p.y for p in up) + max(p.y for p in up)) / 2
# кепка шире плеч — главный элемент силуэта гопника (studio/bible/gopnik.md)
rx = (max(p.x for p in up) - min(p.x for p in up)) / 2 * 1.22
ry = (max(p.y for p in up) - min(p.y for p in up)) / 2 * 1.14
hh = top - band_f
bm = bmesh.new()
seg = 16
prof = [(1.0, 0.0), (1.02, 0.3), (0.95, 0.55), (0.8, 0.78), (0.52, 0.94), (0.0, 1.0)]
rings = []
for rf, hf in prof[:-1]:
    row = []
    for i in range(seg):
        th = 2 * math.pi * i / seg
        sx, sy = math.sin(th), -math.cos(th)  # th=0 — перёд (−Y)
        fr = max(0.0, -sy)
        bz = band_b + (band_f - band_b) * (0.5 + 0.5 * (-sy))
        r = rf * (1 + 0.3 * fr ** 1.5 * hf)  # перёд купола нависает над козырьком
        z = bz + (top + 0.12 * hh - bz) * hf
        row.append(bm.verts.new((cx + sx * rx * r, cy + sy * ry * r - 0.04 * hh * hf, z)))
    rings.append(row)
tip = bm.verts.new((cx, cy - 0.04 * hh, top + 0.12 * hh))
for j in range(len(rings) - 1):
    for i in range(seg):
        bm.faces.new((rings[j][i], rings[j][(i + 1) % seg], rings[j + 1][(i + 1) % seg], rings[j + 1][i]))
for i in range(seg):
    bm.faces.new((rings[-1][i], rings[-1][(i + 1) % seg], tip))
# козырёк
vis = []
nv = 8
for i in range(nv + 1):
    th = -math.pi * 0.34 + math.pi * 0.68 * i / nv
    sx, sy = math.sin(th), -math.cos(th)
    k = max(0.0, math.cos(th / (0.34 * math.pi) * math.pi / 2 * 0.9)) ** 0.6
    inner = Vector((cx + sx * rx, cy + sy * ry, band_f + 0.01 * hh))
    outer = inner + Vector((sx * 0.05 * rx * k, -0.48 * ry * k - 0.02 * ry, -0.18 * hh * k))
    vis.append((bm.verts.new(inner), bm.verts.new(outer)))
for i in range(nv):
    (a, b), (c, d) = vis[i], vis[i + 1]
    bm.faces.new((a, c, d, b))
me = bpy.data.meshes.new('cap')
bm.normal_update()
bm.to_mesh(me)
bm.free()
cap = bpy.data.objects.new('Pacan_Cap', me)
bpy.context.scene.collection.objects.link(cap)
sol = cap.modifiers.new('sol', 'SOLIDIFY')
sol.thickness = 0.012 * hh / 0.1
sol.offset = 1
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = cap
cap.select_set(True)
bpy.ops.object.modifier_apply(modifier='sol')
bpy.ops.object.shade_smooth()
# ткань — серая «ёлочка» (концепты ГОПС, FIXED cap у gopnik_build): UV — угол вокруг головы × высота
uvc = me.uv_layers.new(name='UVMap')
for lp in me.loops:
    p_ = me.vertices[lp.vertex_index].co
    uvc.data[lp.index].uv = ((math.atan2(p_.x - cx, -(p_.y - cy)) / (2 * math.pi)) % 1.0, (p_.z - band_b) / max(1e-3, top - band_b))
S = 256
yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
col_w = S / 48  # ширина «ёлочки»
dirn = np.where((xx // col_w) % 2 == 0, 1.0, -1.0)
her = ((xx + dirn * yy) / (S / 64)) % 2 < 1
base = hexc('545558')
tex = np.where(her[..., None], base * 1.22, base * 0.8)
tex[((xx % col_w) < 0.8)] = base * 0.7
cimg = bpy.data.images.new(f'cap_{BRIGADE}', S, S, alpha=True)
cpx = np.ones((S, S, 4), np.float32)
cpx[..., :3] = np.clip(tex, 0, 1)
cimg.pixels[:] = cpx.ravel()
cimg.pack()
cm = bpy.data.materials.new('cap')
cb = cm.node_tree.nodes['Principled BSDF'] if cm.node_tree else None
if cb is None:
    cm.use_nodes = True
    cb = cm.node_tree.nodes['Principled BSDF']
ct = cm.node_tree.nodes.new('ShaderNodeTexImage')
ct.image = cimg
cm.node_tree.links.new(ct.outputs['Color'], cb.inputs['Base Color'])
cb.inputs['Roughness'].default_value = 0.9
me.materials.append(cm)
g = cap.vertex_groups.new(name='head')
g.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
cap.parent = rig
am = cap.modifiers.new('rig', 'ARMATURE')
am.object = rig

# ---------------------------------------------------------------- анимации: клипы из наборов KayKit → NLA-дорожки
if MODE != 'mesh':
    rig.animation_data_create()
    by_file = {}
    for f, src, dst in CLIPS:
        by_file.setdefault(f, []).append((src, dst))
    for f, pairs in by_file.items():
        before_o = set(bpy.data.objects)
        before_a = set(bpy.data.actions)
        bpy.ops.import_scene.gltf(filepath=os.path.join(ANIMS, f))
        new_a = {a.name.split('.')[0]: a for a in bpy.data.actions if a not in before_a}
        for o in [o for o in bpy.data.objects if o not in before_o]:
            bpy.data.objects.remove(o, do_unlink=True)
        for src, dst in pairs:
            act = new_a.get(src)
            if not act:
                print('нет клипа', src, 'в', f, '— есть:', sorted(new_a))
                continue
            act.name = dst
            act.use_fake_user = True
            tr = rig.animation_data.nla_tracks.new()
            tr.name = dst
            st = tr.strips.new(dst, int(act.frame_range[0]), act)
            if hasattr(st, 'action_slot') and act.slots:
                st.action_slot = act.slots[0]
            tr.mute = True
        for a in [a for a in bpy.data.actions if a not in before_a and not a.use_fake_user]:
            bpy.data.actions.remove(a)
    rig.animation_data.action = None

else:
    rig.animation_data_create()

pts = [o.matrix_world @ Vector(c) for o in bpy.context.scene.objects if o.type == 'MESH' for c in o.bound_box]
print('рост', round(max(p.z for p in pts) - min(p.z for p in pts), 3), 'дорожек', len(rig.animation_data.nla_tracks))
if MODE == 'anims':
    for o in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animation_mode='NLA_TRACKS', export_yup=True,
                          export_image_format='WEBP', export_apply=False, export_animations=MODE != 'mesh')
print('сохранено', OUT)
