"""Городки: гопник бригады — человек MakeHuman (MPFB2, CC0) в олимпийке, спортивных штанах, кепке и кроссовках.

blender -b --factory-startup --python studio/blender/gorodki_mpfb.py -- <бригада> <выход.glb> [<сцена.blend>]

Почему так (замечание пользователя 2026-11-08: «люди уродливые, руки с битами, лица без глаз — манекены»): вместо слепка
TripoSG с проекцией картинки — параметрический человек MakeHuman: настоящие глаза, брови, ресницы, кисти с пальцами,
взрослые пропорции и скелет game_engine. Всё CC0: аддон MPFB 2.0.18 (код GPL, выход — CC0), «makehuman_system_assets»
(кожа, глаза, брови, волосы, одежда male_casualsuit02 и кроссовки shoes05/06). Олимпийка и штаны — геометрия
male_casualsuit02 (кофта с длинным рукавом и штаны), но ткань рисуется заново (`paint_suit`): цвет бригады, лампасы
по внешней стороне рукавов и штанин, молния, воротник-резинка, манжеты, полосы/зигзаг на груди — по эталонам
studio/jobs/gorodki/04-gopniks.yaml; складки — от «ambient occlusion» исходной одежды. Кепка-восьмиклинка строится
здесь же (купол из восьми клиньев с пуговкой и козырёк, «ёлочка»).

Скелет: имена костей — как ждёт lavochka/src/games/gorodki/people3d.ts (hips, spine, head, upper_arm/forearm/hand.L/R,
thigh/shin/foot.L/R), пальцы — свои кости game_engine. Обе кисти сжаты в кулак (поза пальцев записана в покой), в кулаке —
кость grip.L/R: начало — середина кулака (через неё идёт бита), ось Y — вдоль канала кулака от мизинца к указательному.
Рост — 1,78 м, подошва на z = 0, лицом к −Y.

Аддон: blender --command extension install-file -r user_default -e mpfb-2.0.18.zip (сборка из G:/ai/src/mpfb2);
ассеты — G:/ai/models/3d/mpfb/data (копируются в папку данных аддона, если их там нет).
"""
import importlib
import math
import os
import shutil
import sys

import addon_utils
import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
NAME, OUT = args[0], args[1]
BLEND = args[2] if len(args) > 2 else None
HEIGHT = 1.78
ASSETS = 'G:/ai/models/3d/mpfb/data'
rng = np.random.default_rng(abs(hash(NAME)) % 2**32)

# ---------------------------------------------------------------- бригады
# цвета — sRGB 0..255; stripes — лампасы [(сдвиг от внешней линии, м, ширина, м, цвет)]
NAVY, WHITE, BLACK, RED = (28, 36, 72), (236, 236, 230), (22, 22, 24), (178, 30, 34)
LOOKS = {
    'zaton': dict(  # голубая олимпийка, тёмно-синие лампасы, тёмно-синие штаны
        macro=dict(muscle=0.72, weight=0.72, height=0.5, proportions=0.55, age=0.52), race=(0.95, 0.05, 0), hair_rgb=(150, 112, 70),
        targets={'chin/chin-width-incr': 0.8, 'nose/nose-volume-incr': 0.8, 'head/head-square': 1.0, 'ears/l-ear-flap-incr': 0.9, 'ears/r-ear-flap-incr': 0.9,
                 'neck/neck-scale-horiz-incr': 0.6, 'nose/nose-point-width-incr': 0.5},
        skin='young_caucasian_male2', eyes='blue', brows='eyebrow006', hair='short04', shoes='shoes05',
        jacket=(120, 178, 222), sleeve=[(-0.016, 0.011, NAVY), (0.0, 0.011, NAVY), (0.016, 0.011, NAVY)],
        pants=NAVY, leg=[(-0.012, 0.009, WHITE), (0.012, 0.009, WHITE)], collar=NAVY, cuffs=NAVY,
        chest=[], cap=(70, 70, 72)),
    'rastochka': dict(  # изумрудная, на груди бирюзовая и синяя полосы
        macro=dict(muscle=0.55, weight=0.42, height=0.6, proportions=0.65, age=0.47), race=(0.6, 0.4, 0), hair_rgb=(28, 24, 22),
        targets={'nose/nose-hump-incr': 1.0, 'mouth/mouth-scale-horiz-incr': 0.6, 'chin/chin-prominent-incr': 0.6, 'cheek/l-cheek-bones-incr': 0.9,
                 'cheek/r-cheek-bones-incr': 0.9, 'head/head-invertedtriangular': 0.6},
        skin='young_caucasian_male', eyes='brown', brows='eyebrow010', hair='short02', shoes='shoes05',
        jacket=(18, 120, 74), sleeve=[(-0.01, 0.012, WHITE), (0.01, 0.012, WHITE)],
        pants=(16, 104, 64), leg=[(-0.01, 0.01, WHITE), (0.01, 0.01, WHITE)], collar=(14, 70, 48), cuffs=(14, 70, 48),
        chest=[('band', 0.03, 0.05, (30, 170, 170)), ('band', -0.03, 0.03, (32, 70, 160))], cap=(140, 140, 140),
        cap2=(104, 104, 106)),
    'pervomayka': dict(  # тёмно-синий костюм с белым кантом
        macro=dict(muscle=0.45, weight=0.3, height=0.75, proportions=0.75, age=0.4), race=(1.0, 0, 0), hair_rgb=(190, 160, 110),
        targets={'head/head-oval': 1.0, 'nose/nose-point-width-decr': 0.8, 'mouth/mouth-lowerlip-volume-decr': 0.6, 'chin/chin-height-incr': 0.7,
                 'nose/nose-scale-vert-incr': 0.6, 'neck/neck-scale-vert-incr': 0.5},
        skin='young_caucasian_male', eyes='lightblue', brows='eyebrow001', hair='short02', shoes='shoes05',
        jacket=(30, 40, 84), sleeve=[(0.0, 0.006, WHITE)], pants=(28, 36, 78), leg=[(0.0, 0.006, WHITE)],
        collar=WHITE, cuffs=(24, 30, 64), chest=[('yoke', 0.0, 0.006, WHITE)], cap=(78, 80, 84)),
    'zatulinka': dict(  # чёрная с бирюзово-красно-белым зигзагом на груди и рукавах
        macro=dict(muscle=0.68, weight=0.48, height=0.58, proportions=0.6, age=0.5), race=(0.95, 0.05, 0), hair_rgb=(70, 48, 32),
        targets={'chin/chin-prognathism-incr': 0.8, 'nose/nose-curve-convex': 1.0, 'nose/nose-greek-incr': 0.6, 'head/head-rectangular': 0.8,
                 'chin/chin-bones-incr': 0.6},
        skin='young_caucasian_male2', eyes='grey', brows='eyebrow002', hair='short02', shoes='shoes06',
        jacket=BLACK, sleeve=[], pants=(26, 26, 28), leg=[(-0.01, 0.009, WHITE), (0.01, 0.009, WHITE)],
        collar=(40, 40, 42), cuffs=(40, 40, 42),
        chest=[('zig', 0.05, 0.022, (24, 168, 168)), ('zig', 0.025, 0.014, WHITE), ('zig', 0.0, 0.022, RED)],
        sleeve_zig=True, cap=(110, 110, 112)),
    'chemskoy': dict(  # тёмно-синяя, на груди красная вставка с зелёной полосой
        macro=dict(muscle=0.6, weight=0.95, height=0.45, proportions=0.5, age=0.7), race=(0.95, 0.05, 0), hair_rgb=(105, 62, 38),
        targets={'head/head-round': 0.8, 'chin/chin-width-incr': 0.8, 'nose/nose-volume-incr': 0.9,
                 'neck/neck-scale-horiz-incr': 0.9, 'head/head-fat-incr': 0.7},
        skin='middleage_caucasian_male', eyes='brownlight', brows='eyebrow007', hair='short04', shoes='shoes05',
        jacket=(30, 38, 80), sleeve=[(0.0, 0.01, (200, 40, 40))], pants=(30, 38, 80), leg=[(0.0, 0.01, (200, 40, 40))],
        collar=(26, 30, 64), cuffs=(26, 30, 64),
        chest=[('panel', 0.0, 0.0, (176, 34, 38)), ('band', -0.005, 0.022, (30, 130, 70))], cap=(56, 56, 58)),
    'leninskiy': dict(  # бирюзово-зелёная, красно-белые полосы на рукавах
        macro=dict(muscle=0.6, weight=0.55, height=0.62, proportions=0.6, age=0.48), race=(0.45, 0.55, 0), hair_rgb=(22, 20, 19),
        targets={'nose/nose-flaring-incr': 0.7, 'eyes/l-eye-height2-decr': 0.5, 'eyes/r-eye-height2-decr': 0.5,
                 'chin/chin-bones-incr': 0.7, 'head/head-square': 0.5},
        skin='young_asian_male', eyes='brown', brows='eyebrow004', hair='short04', shoes='shoes06',
        jacket=(20, 128, 120), sleeve=[(-0.016, 0.01, RED), (0.0, 0.01, WHITE), (0.016, 0.01, RED)],
        pants=(18, 112, 106), leg=[(-0.01, 0.009, WHITE), (0.01, 0.009, WHITE)], collar=(14, 84, 80),
        cuffs=(14, 84, 80), chest=[], cap=(24, 24, 26)),
}
L = LOOKS[NAME]

# ---------------------------------------------------------------- аддон и ассеты
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
TS = imp('mpfb.services.targetservice', 'TargetService')
ES = imp('mpfb.services.exportservice', 'ExportService')
OS_ = imp('mpfb.services.objectservice', 'ObjectService')
LS = imp('mpfb.services.locationservice', 'LocationService')

# ---------------------------------------------------------------- человек
macro = TS.get_default_macro_info_dict()
macro.update(gender=1.0, cupsize=0.5, firmness=0.5, **L['macro'])
c, a, f = L['race']
macro['race'] = {'caucasian': c, 'asian': a, 'african': f}
human = HS.create_human(macro_detail_dict=macro)
troot = LS.get_mpfb_data('targets')
# общее для всех: брови ниже и тяжелее, уголки рта вниз, шея крепче — «пацанское» лицо, не манекен
COMMON = {'eyebrows/eyebrows-trans-down': 0.5, 'forehead/forehead-nubian-incr': 0.4, 'mouth/mouth-angles-down': 0.35,
          'neck/neck-scale-horiz-incr': 0.35, 'head/head-age-incr': 0.25}
for t, w in {**COMMON, **L['targets']}.items():
    TS.load_target(human, os.path.join(troot, t + '.target.gz'), weight=w)
HS.set_character_skin(AS.find_asset_absolute_path(L['skin'] + '.mhmat', asset_subdir='skins'), human, skin_type='GAMEENGINE')
HS.add_builtin_rig(human, 'game_engine')
for sub, fname, kind in [('eyes', 'high-poly.mhclo', 'Eyes'), ('eyebrows', L['brows'] + '.mhclo', 'Eyebrows'),
                         ('eyelashes', 'eyelashes01.mhclo', 'Eyelashes'), ('hair', L['hair'] + '.mhclo', 'Hair'),
                         ('clothes', 'male_casualsuit02.mhclo', 'Clothes'), ('clothes', L['shoes'] + '.mhclo', 'Clothes')]:
    HS.add_mhclo_asset(AS.find_asset_absolute_path(fname, asset_subdir=sub), human, asset_type=kind,
                       material_type='GAMEENGINE', subdiv_levels=0)

root = ES.create_character_copy(human, name_suffix='_x')
base = OS_.find_object_of_type_amongst_nearest_relatives(root, 'Basemesh')
# формы (рост, вес, лицо) — в сетку до запекания: иначе запекание масок сбрасывает их к среднему человеку
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = base
base.select_set(True)
bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
base.select_set(False)
ES.bake_modifiers_remove_helpers(base, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=True)
rig = root if root.type == 'ARMATURE' else next(o for o in bpy.data.objects if o.type == 'ARMATURE' and o.name.endswith('_x'))
parts = [o for o in rig.children if o.type == 'MESH']
# убрать исходного человека
keep = set([rig] + parts)
for o in list(bpy.data.objects):
    if o not in keep:
        bpy.data.objects.remove(o, do_unlink=True)
print('части:', [(o.name, len(o.data.polygons)) for o in parts])


def part(key):
    return next((o for o in parts if key in o.name), None)


# глаза: цвет радужки
eyes = part('high-poly')
if eyes:
    img_path = os.path.join(ASSETS, 'eyes', 'materials', L['eyes'] + '_eye.png')
    for m in eyes.data.materials:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE':
                n.image = bpy.data.images.load(img_path)

# цвет волос и бровей: перекрасить по яркости
def recolor(img, rgb, keep=0.0):
    w_, h_ = img.size
    px = np.array(img.pixels[:], np.float32).reshape(h_, w_, 4)
    lum = px[..., :3].mean(-1)
    mean = float(np.median(lum[px[..., 3] > 0.5])) if (px[..., 3] > 0.5).any() else float(lum.mean())
    tgt = np.array(rgb, np.float32) / 255.0
    newc = np.clip(lum[..., None] / max(mean, 1e-3) * tgt, 0, 1)
    px[..., :3] = px[..., :3] * keep + newc * (1 - keep)
    img.pixels.foreach_set(px.ravel())
    img.pack()


for o in parts:
    if any(k in o.name for k in (L['hair'], 'eyebrow')):
        for m in o.data.materials:
            for n in m.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image and not getattr(n.image, '_done', False):
                    rgb = L['hair_rgb'] if L['hair'] in o.name else tuple(int(c * 0.7) for c in L['hair_rgb'])
                    recolor(n.image, rgb)
                    break

# прозрачность — только у бровей, ресниц и волос (у кожи альфа текстуры дыряво просвечивает рот изнутри)
for o in parts:
    for m in o.data.materials:
        if not m or not m.use_nodes:
            continue
        cut = any(k in o.name for k in ('eyebrow', 'eyelash', 'high-poly', L['hair']))
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        for lk in list(nt.links):
            if lk.to_socket == bsdf.inputs['Alpha'] and not cut:
                nt.links.remove(lk)
        if not cut:
            bsdf.inputs['Alpha'].default_value = 1.0
            m.surface_render_method = 'DITHERED'
        else:
            m.surface_render_method = 'DITHERED'
        if 'high-poly' in o.name:
            bsdf.inputs['Roughness'].default_value = 0.25
        elif not cut:
            bsdf.inputs['Roughness'].default_value = 0.6

# формы ключей — в сетку (иначе glTF потащит сотни морфов)
for o in parts:
    if o.data.shape_keys:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
        o.select_set(False)


# ---------------------------------------------------------------- кости в покое (мировые координаты)
def bone_pts(name):
    b = rig.data.bones[name]
    return rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local


# ---------------------------------------------------------------- растеризация UV: точка тела в каждом пикселе текстуры
def raster(obj, size):
    me = obj.data
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    lo = np.zeros(n * 3, np.int64)
    me.loop_triangles.foreach_get('loops', lo)
    vi = np.zeros(n * 3, np.int64)
    me.loop_triangles.foreach_get('vertices', vi)
    uv = np.zeros(len(me.loops) * 2)
    me.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    mw = np.array(obj.matrix_world)
    co = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    nr = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('normal', nr)
    nr = nr.reshape(-1, 3) @ mw[:3, :3].T
    P = np.zeros((size, size, 3), np.float32)
    N = np.zeros((size, size, 3), np.float32)
    UV = np.zeros((size, size, 2), np.float32)
    M = np.zeros((size, size), bool)
    F = np.full((size, size), -1, np.int32)
    pidx = np.zeros(n, np.int64)
    me.loop_triangles.foreach_get('polygon_index', pidx)
    tuv = uv[lo].reshape(n, 3, 2) * [size, size]
    tuv[..., 1] = size - tuv[..., 1]
    tco = co[vi].reshape(n, 3, 3)
    tnr = nr[vi].reshape(n, 3, 3)
    tuvr = uv[lo].reshape(n, 3, 2)
    for i in range(n):
        p = tuv[i]
        x0, y0 = np.floor(p.min(0)).astype(int)
        x1, y1 = np.ceil(p.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = p
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-12:
            continue
        w0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / d
        w1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / d
        w2 = 1 - w0 - w1
        e = -0.02
        inside = (w0 >= e) & (w1 >= e) & (w2 >= e)
        if not inside.any():
            continue
        W = np.stack([w0, w1, w2], -1)[inside]
        yy, xx = (ys[inside] - 0.5).astype(int), (xs[inside] - 0.5).astype(int)
        P[yy, xx] = W @ tco[i]
        N[yy, xx] = W @ tnr[i]
        UV[yy, xx] = W @ tuvr[i]
        M[yy, xx] = True
        F[yy, xx] = pidx[i]
    return P, N, UV, M, F


def uv_islands(obj):
    """Острова UV: номер острова для каждой грани (соседи через ребро без шва по UV)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uvl = bm.loops.layers.uv.active
    par = list(range(len(bm.faces)))

    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a
    for e in bm.edges:
        if len(e.link_loops) != 2:
            continue
        l1, l2 = e.link_loops
        a1, b1 = l1[uvl].uv, l1.link_loop_next[uvl].uv
        a2, b2 = l2.link_loop_next[uvl].uv, l2[uvl].uv
        if (a1 - a2).length < 1e-5 and (b1 - b2).length < 1e-5:
            par[find(l1.face.index)] = find(l2.face.index)
    isl = np.array([find(i) for i in range(len(bm.faces))])
    bm.free()
    return isl


def dilate(img, mask, it=12):
    """Заливка полей между островами UV соседними пикселями (чтобы на швах не было тёмных ниток)."""
    img = img.copy()
    m = mask.copy()
    for _ in range(it):
        acc = np.zeros_like(img)
        cnt = np.zeros(m.shape, np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sm = np.roll(m, (dy, dx), (0, 1))
            acc += np.roll(img, (dy, dx), (0, 1)) * sm[..., None]
            cnt += sm
        new = (~m) & (cnt > 0)
        img[new] = acc[new] / cnt[new][:, None]
        m |= new
    img[~m] = img[m].mean(0)
    return img


def to_image(name, rgb):
    h, w, _ = rgb.shape
    im = bpy.data.images.new(name, w, h, alpha=False)
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = np.clip(rgb[::-1], 0, 1)
    im.pixels.foreach_set(px.ravel())
    im.pack()
    return im


def lin(c):
    return (np.array(c, np.float32) / 255.0)


def noise(shape, scale):
    """Мягкий шум: сумма сдвинутых синусов (без scipy)."""
    h, w = shape
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    out = np.zeros(shape, np.float32)
    for k in range(6):
        a, b, ph = rng.uniform(0.5, 1.5, 2).tolist() + [rng.uniform(0, 6.28)]
        out += np.sin((x * a + y * b) * scale * (k + 1) * 0.7 + ph) / (k + 1)
    return out / 2


# ---------------------------------------------------------------- олимпийка и штаны
def paint_suit(obj, size=2048):
    P, N, UV, M, F = raster(obj, size)
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    u, v = UV[..., 0], UV[..., 1]
    # острова: штаны — внизу слева в UV, рукава — справа (раскладка male_casualsuit02)
    isl = uv_islands(obj)
    me = obj.data
    fuv = np.array([np.mean([me.uv_layers.active.data[li].uv[:] for li in p_.loop_indices], 0) for p_ in me.polygons])
    kind = np.zeros(len(me.polygons), np.int8)  # 0 — корпус, 1 — рукав, 2 — штаны
    for k_ in np.unique(isl):
        sel = isl == k_
        mu, mv = fuv[sel].mean(0)
        kind[sel] = 1 if mu >= 0.72 else (2 if mv < 0.6 else 0)
    K = np.where(F >= 0, kind[np.maximum(F, 0)], -1)
    pants = M & (K == 2)
    sleeve = M & (K == 1)
    torso = M & (K == 0)
    col = np.zeros((size, size, 3), np.float32)
    col[torso | sleeve] = lin(L['jacket'])
    col[pants] = lin(L['pants'])

    def around(mask, a, b, side):
        """Координаты вдоль конечности: t (0 — начало, 1 — конец), дуга d от внешней линии (м), радиус."""
        ax = (b - a)
        ln = ax.length
        ax = ax / ln
        out = Vector((side, 0, 0))
        o = (out - ax * out.dot(ax)).normalized()
        q = ax.cross(o)
        rel = P - np.array(a, np.float32)
        t = rel @ np.array(ax, np.float32)
        r = rel - t[..., None] * np.array(ax, np.float32)
        ro, rq = r @ np.array(o, np.float32), r @ np.array(q, np.float32)
        rad = np.hypot(ro, rq)
        ang = np.arctan2(rq, ro)
        return t / ln, ang * rad, rad

    def stripes(mask, d, spec):
        for off, wd, c in spec:
            sel = mask & (np.abs(d - off) < wd / 2)
            col[sel] = lin(c)

    # лампасы рукавов — вдоль шва, который художник одежды провёл по внешней стороне рукава (оранжевая линия
    # исходной текстуры: в UV она прямая) — расстояние до неё в метрах
    dif = bpy.data.images.load(os.path.join(ASSETS, 'clothes', 'male_casualsuit02', 'male_casualsuit02_diffuse.png'))
    dw, dh = dif.size
    dp = np.array(dif.pixels[:], np.float32).reshape(dh, dw, 4)[::-1, :, :3]
    orange = (dp[..., 0] > 0.7) & (dp[..., 1] > 0.3) & (dp[..., 1] < 0.75) & (dp[..., 2] < 0.35)
    orange[:, : int(0.72 * dw)] = False

    def seam_d(mask):
        out = np.full(mask.shape, 9.0, np.float32)
        ys_, xs_ = np.nonzero(mask)
        if not len(ys_):
            return out
        # строки этого рукава → точки оранжевой линии в тех же строках; прямая col = a·row + b
        r0, r1 = ys_.min(), ys_.max()
        oy, ox = np.nonzero(orange[int(r0 * dh / size):int(r1 * dh / size) + 1])
        if len(oy) < 20:
            return out
        oy = oy + int(r0 * dh / size)
        a_, b_ = np.polyfit(oy * size / dh, ox * size / dw, 1)
        # метров на пиксель вдоль u
        dx = np.linalg.norm(P[:, 1:] - P[:, :-1], axis=-1)
        ok = mask[:, 1:] & mask[:, :-1]
        mpp = float(np.median(dx[ok]))
        out[ys_, xs_] = (xs_ - (a_ * ys_ + b_)) * mpp
        return out

    # рукава и штанины: какая сторона — по x
    for side, sfx in ((1, 'l'), (-1, 'r')):
        sh, _ = bone_pts(f'upperarm_{sfx}')
        wr, _ = bone_pts(f'hand_{sfx}')
        arm = sleeve & (np.sign(x) == side)
        t, d, _ = around(arm, sh, wr, side)
        stripes(arm, seam_d(arm), L['sleeve'])
        if L.get('sleeve_zig'):
            zz = np.abs(((seam_d(arm) / 0.05) % 2) - 1) * 0.03
            for kind, off, wd, c in L['chest']:
                ln = (wr - sh).length
                sel = arm & (np.abs(t * ln - 0.12 - off - zz) < wd / 2)
                col[sel] = lin(c)
        cuff = arm & (t > 0.9)
        col[cuff] = lin(L['cuffs'])
        hp, _ = bone_pts(f'thigh_{sfx}')
        an, _ = bone_pts(f'foot_{sfx}')
        leg = pants & (np.sign(x) == side)
        t, d, _ = around(leg, hp, an, side)
        stripes(leg & (t > 0.05), d, L['leg'])
        col[leg & (t > 0.97)] = lin(L['cuffs']) * 0.9 + lin(L['pants']) * 0.1
    # грудь
    neck, _ = bone_pts('neck_01')
    chest_z = neck.z - 0.17
    front = y < float(bone_pts('spine_03')[0].y)
    for kind, off, wd, c in L['chest']:
        if kind == 'band':
            col[torso & (np.abs(z - chest_z - off) < wd / 2)] = lin(c)
        elif kind == 'zig':
            zz = np.abs(((x / 0.06) % 2) - 1) * 0.04
            col[torso & (np.abs(z - chest_z - off - zz) < wd / 2)] = lin(c)
        elif kind == 'panel':
            col[torso & (z > chest_z + 0.005)] = lin(c)
        elif kind == 'yoke':
            col[torso & (np.abs(z - (neck.z - 0.09)) < wd / 2)] = lin(c)
    # воротник-стойка и низ — резинка; по z относительно шеи и самого низа олимпийки
    tz = z[torso]
    zmin = float(tz.min())
    col[torso & (z > neck.z - 0.035)] = lin(L['collar'])
    col[torso & (z < zmin + 0.05)] = lin(L['cuffs'])
    # молния спереди посередине
    zip_ = torso & front & (np.abs(x) < 0.0045) & (z < neck.z - 0.005)
    col[zip_] = lin((150, 150, 150))
    teeth = zip_ & (((z * 1000).astype(int) % 4) < 2)
    col[teeth] = lin((90, 90, 92))
    col[torso & front & (np.abs(np.abs(x) - 0.0055) < 0.0012) & (z < neck.z - 0.005)] *= 0.55
    # рёбрышки резинки
    rib = (torso & ((z > neck.z - 0.035) | (z < zmin + 0.05))) | (sleeve & False)
    col[rib] *= (0.88 + 0.12 * (np.sin(x[rib] * 900) > 0))[:, None]
    # складки: ambient occlusion исходной одежды + лёгкий шум ткани
    ao_path = os.path.join(ASSETS, 'clothes', 'male_casualsuit02', 'male_casualsuit02_ao.png')
    ao_img = bpy.data.images.load(ao_path)
    aw, ah = ao_img.size
    aop = np.array(ao_img.pixels[:], np.float32).reshape(ah, aw, 4)[::-1, :, 0]
    ui = np.clip((u * aw).astype(int), 0, aw - 1)
    vi = np.clip(((1 - v) * ah).astype(int), 0, ah - 1)
    ao = aop[vi, ui]
    ao = np.where(pants & (z > zmin + 0.04), np.maximum(ao, 0.75), ao)  # пояс штанов под олимпийкой — не чернить
    shade = 0.62 + 0.38 * np.clip(ao, 0, 1) ** 0.8
    shade *= 1 + 0.035 * noise((size, size), 0.02) + 0.02 * rng.standard_normal((size, size)).astype(np.float32)
    col *= shade[..., None]
    col = dilate(col, M)
    return to_image(f'{NAME}_suit', col)


suit = part('casualsuit')
img = paint_suit(suit)
for m in suit.data.materials:
    m.name = 'suit'
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type == 'NORMAL_MAP' or (n.type == 'TEX_IMAGE' and 'normal' in (n.image.name if n.image else '')):
            nt.nodes.remove(n)
    for tex in nt.nodes:
        if tex.type == 'TEX_IMAGE':
            tex.image = img
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = 0.85


# ---------------------------------------------------------------- кепка-восьмиклинка
def herringbone(size, c1, c2):
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    col_w = 16.0
    k = (x // col_w) % 2
    diag = np.where(k == 0, x + y, y - x)
    t = (diag % 12) < 6
    a, b = lin(c1), lin(c2)
    out = np.where(t[..., None], a, b)
    out = out * (1 + 0.06 * noise((size, size), 0.05)[..., None])
    return out


def build_cap():
    head_pts = []
    for o in parts:
        if o.name.endswith('_x') or 'Human' in o.name and o == base:
            pass
    co = np.array([base.matrix_world @ v.co for v in base.data.vertices])
    hairo = part(L['hair'])
    hc = np.array([hairo.matrix_world @ v.co for v in hairo.data.vertices]) if hairo else co[:0]
    top = float(max(co[:, 2].max(), hc[:, 2].max() if len(hc) else 0))
    hd = np.concatenate([co[co[:, 2] > top - 0.12], hc[hc[:, 2] > top - 0.12]]) if len(hc) else co[co[:, 2] > top - 0.12]
    cx, cy = float(hd[:, 0].mean()), float((hd[:, 1].min() + hd[:, 1].max()) / 2)
    rx = float(hd[:, 0].max() - hd[:, 0].min()) / 2 + 0.008
    ry = float(hd[:, 1].max() - hd[:, 1].min()) / 2 + 0.008
    brim_front, brim_back = top - 0.1, top - 0.085
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    seg = 32
    # профиль восьмиклинки: (во сколько раз шире головы, доля высоты от околыша до макушки) — околыш по голове,
    # выше — «подушка» шире головы на 2 см, плоский верх
    prof = [(1.0, 0.0), (1.01, 0.2), (1.04, 0.38), (1.1, 0.55), (1.14, 0.69), (1.13, 0.8), (1.05, 0.88),
            (0.82, 0.95), (0.47, 0.99), (0.0, 1.0)]
    rings = len(prof) - 1
    z_c = top + 0.008
    grid = []
    for j, (rf, hf) in enumerate(prof[:-1]):
        row = []
        for i in range(seg):
            th = 2 * math.pi * i / seg
            sx, sy = math.sin(th), -math.cos(th)  # th=0 — перёд (−Y)
            fr = max(0.0, -sy)
            bz = brim_back + (brim_front - brim_back) * (0.5 + 0.5 * (-sy))
            r = rf * (1 + 0.07 * fr * hf)
            px = cx + sx * rx * r
            py = cy + sy * ry * r - 0.03 * hf
            zt = z_c - 0.02 * (-sy) * rf
            pz = bz + (zt - bz) * hf
            row.append(bm.verts.new((px, py, pz)))
        grid.append(row)
    tipv = bm.verts.new((cx, cy - 0.03, z_c))
    for j in range(rings - 1):
        for i in range(seg):
            a, b = grid[j][i], grid[j][(i + 1) % seg]
            c_, d = grid[j + 1][(i + 1) % seg], grid[j + 1][i]
            bm.faces.new((a, b, c_, d))
    for i in range(seg):
        bm.faces.new((grid[rings - 1][i], grid[rings - 1][(i + 1) % seg], tipv))
    # UV купола: вид сверху в левую половину текстуры
    for f in bm.faces:
        for lp in f.loops:
            p = lp.vert.co
            lp[uvl].uv = (0.25 + (p.x - cx) / (rx * 2.6) * 0.5, 0.5 + (p.y - cy) / (ry * 2.6))
    # козырёк: полукольцо спереди, чуть вниз
    vis = []
    n_v = 12
    for i in range(n_v + 1):
        th = -math.pi * 0.42 + math.pi * 0.84 * i / n_v
        sx, sy = math.sin(th), -math.cos(th)
        inner = (cx + sx * rx * 0.98, cy + sy * ry * 0.98, brim_front + 0.004)
        outer = (cx + sx * rx * 1.02, cy + sy * (ry + 0.055 * math.cos(th) ** 0.5), brim_front - 0.012)
        vis.append((bm.verts.new(inner), bm.verts.new(outer)))
    for i in range(n_v):
        (a, b), (c_, d) = vis[i], vis[i + 1]
        f = bm.faces.new((a, c_, d, b))
        for lp in f.loops:
            p = lp.vert.co
            lp[uvl].uv = (0.75 + (p.x - cx) / (rx * 2.6) * 0.5, 0.5 + (p.y - cy) / (ry * 2.6))
    me = bpy.data.meshes.new('cap')
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    cap = bpy.data.objects.new('cap', me)
    bpy.context.scene.collection.objects.link(cap)
    for p in me.polygons:
        p.use_smooth = True
    sol = cap.modifiers.new('sol', 'SOLIDIFY')
    sol.thickness = 0.004
    sol.offset = 1
    bpy.context.view_layer.objects.active = cap
    bpy.ops.object.select_all(action='DESELECT')
    cap.select_set(True)
    bpy.ops.object.modifier_apply(modifier='sol')
    # текстура: ёлочка, восемь швов-клиньев, пуговка
    S = 512
    tex = herringbone(S, L['cap'], tuple(int(c * 0.86) for c in L['cap']))
    if 'cap2' in L:
        tex = herringbone(S, L['cap'], L['cap2'])
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    # купол: центр (0.25, 0.5) в UV → пиксели (128, 256) с учётом сдвига макушки вперёд
    ucx, ucy = 0.25 * S, S - (0.5 + (-0.03) / (ry * 2.6)) * S
    ang = np.arctan2(yy - ucy, xx - ucx)
    rad = np.hypot(xx - ucx, yy - ucy)
    seam = (np.abs(((ang / (2 * np.pi / 8)) % 1) - 0.5) > 0.485) & (xx < S / 2)
    tex[seam] *= 0.7
    tex[(rad < 6) & (xx < S / 2)] = lin(L['cap']) * 0.8
    tex[(np.abs(rad - 6.5) < 1.2) & (xx < S / 2)] *= 0.5
    # козырёк чуть темнее
    tex[xx >= S / 2] *= 0.85
    m = bpy.data.materials.new('cap')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.9
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = to_image(f'{NAME}_cap', tex)
    nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    me.materials.append(m)
    # вес — целиком на голову
    g = cap.vertex_groups.new(name='head')
    g.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
    cap.parent = rig
    am = cap.modifiers.new('rig', 'ARMATURE')
    am.object = rig
    return cap


cap = build_cap()
parts.append(cap)

# ---------------------------------------------------------------- одна сетка (меньше вызовов отрисовки)
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
body.name = 'gopnik'
print('граней после склейки:', len(body.data.polygons), 'треугольников:', sum(len(p.vertices) - 2 for p in body.data.polygons))

# ---------------------------------------------------------------- кулаки: пальцы сжать, позу — в покой
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
CURL = {'01': 72, '02': 95, '03': 65}
THUMB = {'01': 25, '02': 35, '03': 45}


def curl_chain(names, angles):
    pb = rig.pose.bones
    b1 = pb[names[0]]
    d1 = (b1.tail - b1.head).normalized()
    d3 = (pb[names[2]].tail - pb[names[2]].head).normalized()
    bend = d3 - d1 * d3.dot(d1)
    if bend.length < 1e-4:
        return
    axis = d1.cross(bend.normalized()).normalized()
    for nm, deg in zip(names, angles):
        bpy.context.view_layer.update()
        b = pb[nm]
        h = b.head.copy()
        R = Matrix.Rotation(math.radians(deg), 4, axis)
        b.matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ b.matrix
        axis = (R.to_3x3() @ axis).normalized()


for s in ('l', 'r'):
    for fin in ('index', 'middle', 'ring', 'pinky'):
        curl_chain([f'{fin}_0{k}_{s}' for k in (1, 2, 3)], [CURL['01'], CURL['02'], CURL['03']])
    curl_chain([f'thumb_0{k}_{s}' for k in (1, 2, 3)], [THUMB['01'], THUMB['02'], THUMB['03']])
bpy.context.view_layer.update()
bpy.ops.object.mode_set(mode='OBJECT')
# сетку — в позу, позу — в покой
bpy.context.view_layer.objects.active = body
arm_mod = next(m for m in body.modifiers if m.type == 'ARMATURE')
bpy.ops.object.modifier_apply(modifier=arm_mod.name)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')
am = body.modifiers.new('rig', 'ARMATURE')
am.object = rig

# ---------------------------------------------------------------- имена костей под people3d.ts и кость «кулак»
RENAME = {'pelvis': 'hips', 'spine_01': 'spine', 'head': 'head'}
for s, S in (('l', 'L'), ('r', 'R')):
    RENAME.update({f'upperarm_{s}': f'upper_arm.{S}', f'lowerarm_{s}': f'forearm.{S}', f'hand_{s}': f'hand.{S}',
                   f'thigh_{s}': f'thigh.{S}', f'calf_{s}': f'shin.{S}', f'foot_{s}': f'foot.{S}'})
for old, new in RENAME.items():
    if old in rig.data.bones and old != new:
        rig.data.bones[old].name = new
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones
for s, S in (('l', 'L'), ('r', 'R')):
    hand = eb[f'hand.{S}']
    k_i, k_p = eb[f'index_01_{s}'].head, eb[f'pinky_01_{s}'].head
    ax = (k_i - k_p).normalized()
    # середина кулака: между костяшками и кончиками согнутых средних фаланг, чуть к ладони
    mid = (eb[f'middle_01_{s}'].head + eb[f'middle_02_{s}'].head + eb[f'middle_03_{s}'].head +
           eb[f'middle_03_{s}'].tail + eb[f'ring_02_{s}'].head + eb[f'index_02_{s}'].head) / 6
    g = eb.new(f'grip.{S}')
    g.head = mid
    g.tail = mid + ax * 0.05
    g.parent = hand
    g.use_deform = False
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- рост и подошва
co = np.array([v.co[:] for v in body.data.vertices])
mn, mx = co.min(0), co.max(0)
k = HEIGHT / (mx[2] - mn[2])
for o in (rig, body):
    o.select_set(True)
print('масштаб', k, 'исходный рост', mx[2] - mn[2])
rig.scale = (k, k, k)
rig.location = (0, 0, -mn[2] * k)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---------------------------------------------------------------- текстуры полегче
for im in bpy.data.images:
    if im.size[0] > 2048:
        im.scale(2048, 2048)
    nm = im.name.lower()
    if any(k in nm for k in ('eye', 'brow', 'lash')) and im.size[0] > 512:
        im.scale(512, 512)
    if any(k in nm for k in ('short', 'shoes')) and im.size[0] > 1024:
        im.scale(1024, 1024)

if BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
rig.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format='GLB', export_animations=False, export_skins=True,
                          export_morph=False, export_image_format='WEBP', export_image_quality=82, export_yup=True,
                          export_def_bones=False)
print('готово', OUT, os.path.getsize(OUT) // 1024, 'КБ')
