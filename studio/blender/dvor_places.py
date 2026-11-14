"""Дворовый спорт: ещё три площадки для лапты, пекаря и чижа — Blender → glTF для three.js.

blender -b --factory-startup --python studio/blender/dvor_places.py -- <папка текстур> <папка выхода> [school|dvor|village ...]

Та же ровная утоптанная площадка ~40 × 72 м, что у пустыря за гаражами (dvor_field.py: дом у y = 0, кон — дальше по +y),
но другое окружение: school.glb — школьный стадион (поле, гаревая дорожка, школа, бетонный забор, турники),
dvor.glb — двор между пятиэтажками (панельные дома, песочница, турник для ковров, бельё, трансформаторная будка),
village.glb — выгон за деревней (луг, избы за штакетником, стога, колодец, берёзовая роща и сосны).
Разметки нет — линии своей игры рисует сама игра. Текстуры: старые двора городков + studio/jobs/dvorsport/01-places.yaml
(бесшовные — post/seamless.py, вырезки — runners/cutout.py). Общие функции (mat, box, plane, billboard, bench, garage,
export…) берутся из dvor_field.py — его «шапка» до раздела «пустырь» выполняется здесь же.
"""
import math
import sys
from pathlib import Path

import bpy
import bmesh

_src = (Path(__file__).parent / 'dvor_field.py').read_text(encoding='utf-8')
exec(compile(_src.split('# ------------------------------------------------------------------ пустырь')[0], 'dvor_field_head', 'exec'))

WHICH = [a for a in sys.argv[sys.argv.index('--') + 3:]] or ['school', 'dvor', 'village']


def prop_add(op, mat_, name, loc, rot=(0, 0, 0), **kw):
    """Примитив Blender в текущую площадку (как в dvor_field.py, там она ниже «шапки»)."""
    op(location=loc, rotation=rot, **kw)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat_)
    for c in o.users_collection:
        c.objects.unlink(o)
    yard.objects.link(o)
    return o

M.update({
    'turf': mat('turf', 'turf', rough=0.95),
    'cinder': mat('cinder', 'cinder', rough=0.95),
    'school-wall': mat('school-wall', 'school-wall', rough=0.85),
    'fence-concrete': mat('fence-concrete', 'fence-concrete', rough=0.95),
    'asphalt': mat('asphalt', 'asphalt', rough=0.92),
    'panel-wall': mat('panel-wall', 'panel-wall', rough=0.9),
    'sand': mat('sand', 'sand', rough=1.0),
    'brick-red': mat('brick-red', 'brick-red', rough=0.9),
    'meadow': mat('meadow', 'meadow', rough=0.95),
    'path': mat('path', 'path', rough=0.95),
    'village-dirt': mat('village-dirt', 'dirt', rough=0.95, tint=(0.72, 0.68, 0.55, 1)),
    'log-wall': mat('log-wall', 'log-wall', rough=0.9),
    'shingle': mat('shingle', 'shingle', rough=0.85),
    'picket': mat('picket', 'picket', rough=0.9, alpha=True),
    'white': mat('white', color=(0.92, 0.92, 0.9, 1), rough=0.6),
    'pipe-blue': mat('pipe-blue', color=(0.12, 0.3, 0.62, 1), rough=0.5, metal=0.3),
    'pipe-yellow': mat('pipe-yellow', color=(0.85, 0.65, 0.1, 1), rough=0.5, metal=0.3),
    'pipe-green': mat('pipe-green', color=(0.15, 0.45, 0.2, 1), rough=0.5, metal=0.3),
    'pipe-red': mat('pipe-red', color=(0.7, 0.14, 0.1, 1), rough=0.5, metal=0.3),
    'glassdark': mat('glassdark', color=(0.05, 0.07, 0.09, 1), rough=0.25),
    'rope': mat('rope', color=(0.85, 0.85, 0.8, 1), rough=0.9),
    'cloth-white': mat('cloth-white', color=(0.93, 0.93, 0.9, 1), rough=0.95),
    'cloth-blue': mat('cloth-blue', 'burlap', rough=0.95, tint=(0.35, 0.5, 0.8, 1)),
    'cloth-red': mat('cloth-red', 'burlap', rough=0.95, tint=(0.8, 0.25, 0.2, 1)),
    'birchlog': mat('birchlog', 'birch', rough=0.85),
})


def new_place(name):
    """Новая площадка: своя коллекция (общие функции кладут всё в глобальную yard)."""
    global yard
    yard = bpy.data.collections.new(name)
    scene.collection.children.link(yard)
    return yard


def wall(name, x0, y0, x1, y1, z0, z1, material, tw, th, two=False, u0=0.0):
    """Стена-плоскость от (x0, y0) до (x1, y1): плитка текстуры tw × th м, лицом влево по ходу (нормаль = поворот на +90°)."""
    ln = math.hypot(x1 - x0, y1 - y0)
    bm = bmesh.new()
    a = bm.verts.new((x0, y0, z0))
    b = bm.verts.new((x1, y1, z0))
    c = bm.verts.new((x1, y1, z1))
    d = bm.verts.new((x0, y0, z1))
    faces = [bm.faces.new((a, b, c, d))]
    uvl = bm.loops.layers.uv.verify()
    uvs = [(u0, 0), (u0 + ln / tw, 0), (u0 + ln / tw, (z1 - z0) / th), (u0, (z1 - z0) / th)]
    for lp, uv in zip(faces[0].loops, uvs):
        lp[uvl].uv = uv
    if two:
        a2, b2, c2, d2 = (bm.verts.new(v.co) for v in (a, b, c, d))
        f2 = bm.faces.new((d2, c2, b2, a2))
        for lp, uv in zip(f2.loops, uvs[::-1]):
            lp[uvl].uv = uv
    return mesh_obj(name, bm, material, yard)


def rr_points(hw, y0, y1, r, n=10):
    """Скруглённый прямоугольник |x| ≤ hw, y0 ≤ y ≤ y1, радиус углов r — точки по кругу (замкнуто)."""
    pts = []
    for cx, cy, a0 in ((hw - r, y1 - r, 0.0), (-(hw - r), y1 - r, math.pi / 2), (-(hw - r), y0 + r, math.pi), (hw - r, y0 + r, 1.5 * math.pi)):
        for k in range(n + 1):
            a = a0 + (math.pi / 2) * k / n
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def ring(name, hw, y0, y1, r, width, z, material, uv):
    """Дорожка-кольцо шириной width снаружи скруглённого прямоугольника."""
    inner = rr_points(hw, y0, y1, r)
    outer = rr_points(hw + width, y0 - width, y1 + width, r + width)
    bm = bmesh.new()
    vi = [bm.verts.new((x, y, z)) for x, y in inner]
    vo = [bm.verts.new((x, y, z)) for x, y in outer]
    n = len(vi)
    for k in range(n):
        bm.faces.new((vi[k], vo[k], vo[(k + 1) % n], vi[(k + 1) % n]))
    world_uv(bm, uv)
    return mesh_obj(name, bm, material, yard)


def cyl(name, x, y, z0, z1, radius, material, verts=10):
    return prop_add(bpy.ops.mesh.primitive_cylinder_add, material, name, (x, y, (z0 + z1) / 2), radius=radius, depth=z1 - z0, vertices=verts)


def bar(name, p0, p1, radius, material, verts=8):
    """Труба/жердь между двумя точками."""
    dx, dy, dz = (p1[i] - p0[i] for i in range(3))
    ln = math.sqrt(dx * dx + dy * dy + dz * dz)
    o = prop_add(bpy.ops.mesh.primitive_cylinder_add, material, name, ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2),
                 radius=radius, depth=ln, vertices=verts)
    o.rotation_euler = (0, math.acos(max(-1, min(1, dz / ln))), math.atan2(dy, dx))
    return o


def gable(name, cx, cy, z, sx, sy, rise, material, uv=2.0, over=0.35):
    """Двускатная крыша: конёк вдоль y, скаты на ±x, напуск over."""
    bm = bmesh.new()
    hx, hy = sx / 2 + over, sy / 2 + over
    a = bm.verts.new((-hx, -hy, 0))
    b = bm.verts.new((hx, -hy, 0))
    c = bm.verts.new((hx, hy, 0))
    d = bm.verts.new((-hx, hy, 0))
    e = bm.verts.new((0, -hy, rise))
    f = bm.verts.new((0, hy, rise))
    bm.faces.new((a, e, f, d))
    bm.faces.new((e, b, c, f))
    bm.faces.new((a, b, e))
    bm.faces.new((d, f, c))
    bm.faces.new((a, d, c, b))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    world_uv(bm, uv)
    o = mesh_obj(name, bm, material, yard)
    o.location = (cx, cy, z)
    return o


def cutout(name, tex, x, y, hgt, cross=True):
    """Вырезанная картинка стоймя (стог, сосна) — крестом; имя с «cutout» — игра режет по альфе."""
    billboard(f'cutout-{name}', tex, x, y, hgt)


def finish(name):
    for o in yard.all_objects:
        if o.type == 'MESH':
            for p in o.data.polygons:
                p.use_smooth = False
    export(OUT / f'{name}.glb', yard)
    print('готово', name)


def home_patch(material='clay'):
    # у дома (где бьют и ждут) — земля темнее и плотнее; вытоптанные пятна и камешки
    plane('clay-dom', -9.0, 9.0, -6.5, 2.2, 0.012, M[material], 1.8, nx=14, ny=8, jitter=0.25, coll=yard)
    for k in range(50):
        decal(f'pebbles{k}', M['pebbles'], rnd.uniform(-18, 18), rnd.uniform(-10, 60), rnd.uniform(0.2, 0.45), rnd.uniform(0, 6.28))
    for k in range(18):
        decal(f'scuff{k}', M['scuff'], rnd.uniform(-3, 3), rnd.uniform(-2.5, 3.5), rnd.uniform(0.35, 0.7), rnd.uniform(0, 6.28))


# ====================================================================== школьный стадион

def school():
    new_place('school')
    plane('ground', -110, 110, -60, 150, -0.04, M['grass'], 3.0, coll=yard)
    # поле: вытоптанная трава; вокруг — гаревая дорожка с белыми линиями
    plane('court', -22.0, 22.0, -13.0, 63.0, 0.0, M['turf'], 3.4, nx=22, ny=38, jitter=0.5, coll=yard)
    ring('court-track', 22.5, -13.5, 63.5, 12.0, 6.0, -0.012, M['cinder'], 2.6)
    for k, off in enumerate((0.05, 2.0, 4.0, 5.95)):
        ring(f'mark-lane{k}', 22.5 + off, -13.5 - off, 63.5 + off, 12.0 + off, 0.07, 0.004, M['chalk'], 1.0)
    home_patch()

    # школа за дальним концом поля: три этажа белого кирпича, крыльцо с козырьком
    tw = 10.5                   # плитка — все три этажа, четыре окна
    box('school-body', 0, 96.0, 5.25, 84.0, 14.0, 10.5, M['concrete'], uv=3.0, coll=yard)
    wall('school-front', 42.0, 88.98, -42.0, 88.98, 0.0, 10.5, M['school-wall'], tw, tw)
    wall('school-left', -42.02, 89.0, -42.02, 103.0, 0.0, 10.5, M['school-wall'], tw, tw)
    wall('school-right', 42.02, 103.0, 42.02, 89.0, 0.0, 10.5, M['school-wall'], tw, tw)
    box('school-roof', 0, 96.0, 10.62, 85.0, 15.0, 0.25, M['roof'], uv=2.0, coll=yard)
    box('school-porch', 0, 87.6, 0.2, 9.0, 2.8, 0.4, M['concrete'], uv=2.0, coll=yard)
    box('school-step', 0, 85.9, 0.1, 9.6, 0.7, 0.2, M['concrete'], uv=2.0, coll=yard)
    box('school-canopy', 0, 87.4, 3.3, 9.6, 3.2, 0.18, M['concrete'], uv=2.0, coll=yard)
    for sx in (-4.3, 4.3):
        cyl(f'school-col{sx}', sx, 86.3, 0.4, 3.2, 0.12, M['steel'])
    box('school-door', 0, 88.9, 1.5, 2.6, 0.1, 2.2, M['planks'], uv=1.2, coll=yard)

    # бетонный забор «ромбиками» слева и позади дома
    for k, (x0, y0, x1, y1) in enumerate(((-36.0, 86.0, -36.0, -30.0), (-36.0, -30.0, 40.0, -30.0))):
        wall(f'fence{k}', x0, y0, x1, y1, 0.0, 2.2, M['fence-concrete'], 3.3, 2.2, two=True)
        n = int(math.hypot(x1 - x0, y1 - y0) / 3.3)
        for j in range(n + 1):
            t = j / n
            box(f'fencepost{k}-{j}', x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 1.15, 0.16, 0.16, 2.3, M['concrete'], uv=1.0, coll=yard)

    # футбольные ворота за дальней линией поля
    for sx in (-3.66, 3.66):
        cyl(f'goalpost{sx}', sx, 62.3, 0.0, 2.44, 0.06, M['white'])
        bar(f'goalstay{sx}', (sx, 62.3, 2.44), (sx, 64.0, 0.0), 0.03, M['white'])
    bar('goalbar', (-3.66, 62.3, 2.44), (3.66, 62.3, 2.44), 0.06, M['white'])

    # спортгородок справа за дорожкой: турники разной высоты, брусья, вкопанные покрышки, баскетбольный щит
    for k, (y, hgt) in enumerate(((6.0, 2.3), (9.0, 2.0), (12.0, 1.7))):
        for dy in (0.0, 1.6):
            cyl(f'turnik{k}-post{dy}', 33.0, y + dy, 0.0, hgt, 0.045, M['pipe-blue'])
        bar(f'turnik{k}-bar', (33.0, y, hgt - 0.05), (33.0, y + 1.6, hgt - 0.05), 0.02, M['steel'])
    for sx in (32.7, 33.3):
        for y in (17.0, 19.4):
            cyl(f'brus-post{sx}-{y}', sx, y, 0.0, 1.5, 0.04, M['pipe-yellow'])
        bar(f'brus-bar{sx}', (sx, 16.7, 1.5), (sx, 19.7, 1.5), 0.025, M['steel'])
    for k in range(9):
        o = prop_add(bpy.ops.mesh.primitive_torus_add, (M['pipe-red'], M['white'], M['pipe-blue'], M['pipe-yellow'])[k % 4], f'tire{k}', (32.5, 24.0 + k * 0.72, 0.05),
                     rot=(math.pi / 2, 0, math.pi / 2), major_radius=0.34, minor_radius=0.12, major_segments=20, minor_segments=8)
    cyl('hoop-post', -31.5, 22.0, 0.0, 3.3, 0.06, M['steel'])
    box('hoop-board', -31.0, 22.0, 3.25, 0.05, 1.8, 1.05, M['white'], coll=yard)
    prop_add(bpy.ops.mesh.primitive_torus_add, M['pipe-red'], 'hoop-ring', (-30.72, 22.0, 3.0), major_radius=0.23, minor_radius=0.012, major_segments=20, minor_segments=6)
    cyl('hoop-post2', -31.5, 42.0, 0.0, 3.3, 0.06, M['steel'])
    box('hoop-board2', -31.0, 42.0, 3.25, 0.05, 1.8, 1.05, M['white'], coll=yard)
    prop_add(bpy.ops.mesh.primitive_torus_add, M['pipe-red'], 'hoop-ring2', (-30.72, 42.0, 3.0), major_radius=0.23, minor_radius=0.012, major_segments=20, minor_segments=6)

    # лавочки болельщиков вдоль дорожки, тополя за спортгородком, берёзы у забора, сирень у школы
    for k, y in enumerate((2.0, 30.0, 44.0)):
        bench(f'bench{k}', 30.6, y, -math.pi / 2)
    bench('bench-home1', -7.0, -21.0, 0.0)
    bench('bench-home2', 7.0, -21.0, 0.0)
    trees = [('poplar-tree', 38.0 + (k % 2) * 2.5, -22.0 + k * 9.5, 13.0 + (k % 3)) for k in range(12)]
    trees += [('birch-tree', -33.0, -24.0 + k * 13.0, 9.0 + (k % 2)) for k in range(9)]
    trees += [('birch-tree', -20.0 + k * 13.0, -27.0, 9.5) for k in range(5)]
    trees += [('poplar-tree', -30.0, 82.0, 13.0), ('poplar-tree', 30.0, 82.0, 14.0), ('birch-tree', 47.0, 84.0, 10.0)]
    for k, (t, x, y, hgt) in enumerate(trees):
        billboard(f'tree{k}', t, x, y, hgt, 0.68)
    for k, (x, y) in enumerate([(-22.0, 86.5), (-11.0, 86.8), (11.0, 86.6), (23.0, 86.9), (36.0, 70.0), (-34.0, 60.0), (30.5, 52.0)]):
        billboard(f'bush{k}', 'lilac-bush', x, y, 1.8, 1.45)
    for k in range(40):
        billboard(f'weeds{k}', 'weeds', rnd.choice((-1, 1)) * rnd.uniform(29.5, 35.0), rnd.uniform(-28, 80), rnd.uniform(0.35, 0.6))
    finish('school')


# ====================================================================== двор у пятиэтажек

def panel_house(name, x0, y0, x1, y1, depth=12.0, floors_h=14.0):
    """Панельная пятиэтажка: фасад от (x0, y0) до (x1, y1) лицом влево по ходу, корпус — за фасадом."""
    ln = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / ln, (y1 - y0) / ln
    nx, ny = -uy, ux            # нормаль фасада
    cx, cy = (x0 + x1) / 2 - nx * depth / 2, (y0 + y1) / 2 - ny * depth / 2
    ang = math.atan2(uy, ux)
    box(f'{name}-body', cx - nx * 0.02, cy - ny * 0.02, floors_h / 2, ln, depth, floors_h, M['concrete'], uv=3.0, coll=yard, rot_z=ang)
    tile = 17.5                 # плитка — пять этажей, шесть окон (17,5 × 14 м)
    wall(f'{name}-front', x0, y0, x1, y1, 0.0, floors_h, M['panel-wall'], tile, floors_h)
    wall(f'{name}-end0', x0 - nx * depth, y0 - ny * depth, x0, y0, 0.0, floors_h, M['panel-wall'], tile, floors_h)
    wall(f'{name}-end1', x1, y1, x1 - nx * depth, y1 - ny * depth, 0.0, floors_h, M['panel-wall'], tile, floors_h)
    box(f'{name}-roof', cx, cy, floors_h + 0.15, ln + 0.6, depth + 0.6, 0.3, M['roof'], uv=2.0, coll=yard, rot_z=ang)
    # подъезды: козырёк, дверь, лавочка
    n = max(2, int(ln / 20))
    for k in range(n):
        t = (k + 0.5) / n
        px, py = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        box(f'{name}-visor{k}', px + nx * 0.9, py + ny * 0.9, 2.5, 2.6, 1.8, 0.14, M['concrete'], uv=2.0, coll=yard, rot_z=ang)
        box(f'{name}-door{k}', px + nx * 0.03, py + ny * 0.03, 1.05, 1.3, 0.08, 2.1, M['planks'], uv=1.2, coll=yard, rot_z=ang)
        box(f'{name}-stoop{k}', px + nx * 0.9, py + ny * 0.9, 0.08, 2.4, 1.8, 0.16, M['concrete'], uv=2.0, coll=yard, rot_z=ang)
        bench(f'{name}-bench{k}', px + nx * 2.3 + ux * 2.4, py + ny * 2.3 + uy * 2.4, ang + math.pi)


def dvor():
    new_place('dvor')
    plane('ground', -110, 110, -60, 150, -0.04, M['grass'], 3.0, coll=yard)
    plane('court', -19.5, 19.5, -11.0, 61.0, 0.0, M['dirt'], 2.6, nx=26, ny=48, jitter=0.9, coll=yard)
    home_patch()
    # асфальтовые проезды вдоль домов
    plane('ground-asphalt1', -31.5, -24.5, -40.0, 76.0, -0.015, M['asphalt'], 3.0, coll=yard)
    plane('ground-asphalt2', -31.5, 60.0, 69.0, 76.0, -0.014, M['asphalt'], 3.0, coll=yard)
    plane('ground-asphalt3', 26.0, 29.0, -40.0, 69.0, -0.013, M['asphalt'], 3.0, coll=yard)

    # пятиэтажки: слева вдоль поля и за дальним концом; ещё одна вдалеке справа
    panel_house('houseL', -34.0, 70.0, -34.0, -17.5)
    panel_house('houseF', 47.0, 80.0, -23.0, 80.0)
    panel_house('houseR', 52.0, -22.0, 52.0, 65.5)

    # детская площадка справа: песочница с грибком, качели, горка-лестница
    box('sandbox-n', 34.0, 13.5, 0.14, 3.0, 0.12, 0.28, M['planks'], uv=0.9, coll=yard)
    box('sandbox-s', 34.0, 10.5, 0.14, 3.0, 0.12, 0.28, M['planks'], uv=0.9, coll=yard)
    box('sandbox-w', 32.5, 12.0, 0.14, 0.12, 3.0, 0.28, M['planks'], uv=0.9, coll=yard)
    box('sandbox-e', 35.5, 12.0, 0.14, 0.12, 3.0, 0.28, M['planks'], uv=0.9, coll=yard)
    plane('clay-sand', 32.56, 35.44, 10.56, 13.44, 0.2, M['sand'], 1.6, coll=yard)
    cyl('gribok-post', 34.0, 12.0, 0.2, 2.1, 0.07, M['post'])
    prop_add(bpy.ops.mesh.primitive_cone_add, M['pipe-red'], 'gribok-cap', (34.0, 12.0, 2.35), vertices=20, radius1=1.35, radius2=0.05, depth=0.6)
    for sy in (18.0, 21.2):
        bar(f'swing-a{sy}', (33.0, sy, 0.0), (34.0, sy, 2.3), 0.04, M['pipe-green'])
        bar(f'swing-b{sy}', (35.0, sy, 0.0), (34.0, sy, 2.3), 0.04, M['pipe-green'])
    bar('swing-top', (34.0, 18.0, 2.3), (34.0, 21.2, 2.3), 0.04, M['pipe-green'])
    for sy in (19.0, 20.2):
        bar(f'swing-rod{sy}a', (34.0, sy - 0.22, 2.3), (34.0, sy - 0.22, 0.5), 0.012, M['steel'])
        bar(f'swing-rod{sy}b', (34.0, sy + 0.22, 2.3), (34.0, sy + 0.22, 0.5), 0.012, M['steel'])
        box(f'swing-seat{sy}', 34.0, sy, 0.48, 0.22, 0.5, 0.04, M['slat'], uv=0.6, coll=yard)
    # турник для ковров (П-образная рама) и ковёр на нём
    for k, y in enumerate((30.0, 33.5)):
        for sx in (32.8, 35.6):
            cyl(f'carpet{k}-post{sx}', sx, y, 0.0, 2.2, 0.045, M['pipe-blue'])
        bar(f'carpet{k}-bar', (32.8, y, 2.2), (35.6, y, 2.2), 0.03, M['pipe-blue'])
    wall('carpet-rug', 33.2, 30.0, 35.2, 30.0, 0.9, 2.19, M['cloth-red'], 1.0, 1.0, two=True)
    # бельё на верёвках между столбами
    for k, x in enumerate((38.0, 42.5)):
        for y in (38.0, 46.0):
            cyl(f'dry-post{k}-{y}', x, y, 0.0, 2.1, 0.05, M['post'])
            bar(f'dry-cross{k}-{y}', (x - 0.6, y, 2.05), (x + 0.6, y, 2.05), 0.03, M['post'])
        for dx in (-0.5, 0.5):
            bar(f'rope{k}{dx}', (x + dx, 38.0, 2.03), (x + dx, 46.0, 2.03), 0.006, M['rope'])
    for k, (x, y0, w, hh, m_) in enumerate(((37.5, 39.0, 1.6, 1.1, 'cloth-white'), (37.5, 41.2, 1.2, 0.8, 'cloth-blue'), (38.5, 43.0, 1.8, 1.2, 'cloth-white'),
                                            (42.0, 39.6, 1.4, 0.9, 'cloth-red'), (43.0, 42.4, 1.7, 1.15, 'cloth-white'), (42.0, 44.4, 1.0, 0.7, 'cloth-blue'))):
        wall(f'laundry{k}', x, y0, x, y0 + w, 2.02 - hh, 2.02, M[m_], 0.8, 0.8, two=True)
    # трансформаторная будка из красного кирпича
    box('tp-body', 37.0, 56.0, 1.7, 4.5, 5.5, 3.4, M['brick-red'], uv=1.6, coll=yard)
    box('tp-roof', 37.0, 56.0, 3.48, 4.9, 5.9, 0.16, M['concrete'], uv=2.0, coll=yard)
    box('tp-door', 34.72, 56.0, 1.05, 0.06, 1.8, 2.1, M['steel'], coll=yard)
    # гаражи-«ракушки» в углу двора и помойка
    for i in range(4):
        garage(100 + i, 46.0, -8.0 + i * 3.15, -1, ('green', 'blue', 'red', 'green')[i])
    for k, x in enumerate((30.0, 31.6)):
        box(f'bin{k}', x, 64.5, 0.55, 1.3, 0.9, 1.1, M['rust'], uv=1.0, coll=yard, bevel=0.03)
    # низкий заборчик из труб позади дома и вдоль проезда
    for k, (x0, y0, x1, y1) in enumerate(((-22.0, -16.5, 22.0, -16.5), (23.5, -16.5, 23.5, 66.0))):
        n = int(math.hypot(x1 - x0, y1 - y0) / 2.2)
        for j in range(n + 1):
            t = j / n
            cyl(f'rail{k}-post{j}', x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.0, 0.55, 0.03, M['pipe-yellow'] if j % 2 else M['pipe-green'], verts=8)
        bar(f'rail{k}-bar', (x0, y0, 0.52), (x1, y1, 0.52), 0.025, M['pipe-green'])
    bench('bench-home1', -6.5, -9.0, 0.0)
    bench('bench-home2', 6.5, -9.0, 0.0)
    bench('bench-side', 21.5, 24.0, -math.pi / 2)
    # тополя и берёзы между домами, сирень у подъездов
    trees = [('poplar-tree', -27.0, -20.0 + k * 16.0, 14.0 + (k % 2)) for k in range(6)]
    trees += [('poplar-tree', 31.0, 2.0, 13.0), ('birch-tree', 37.5, 26.0, 9.5), ('poplar-tree', 40.0, 34.0, 14.0), ('birch-tree', 31.0, 49.0, 9.0),
              ('poplar-tree', 45.0, 62.0, 13.5), ('birch-tree', -14.0, 72.0, 10.0), ('poplar-tree', 4.0, 73.5, 14.0), ('birch-tree', 20.0, 72.5, 9.5),
              ('birch-tree', -12.0, -22.0, 9.0), ('poplar-tree', 10.0, -24.0, 13.0), ('birch-tree', 28.0, -22.0, 9.5), ('poplar-tree', 40.0, -26.0, 14.0)]
    for k, (t, x, y, hgt) in enumerate(trees):
        billboard(f'tree{k}', t, x, y, hgt, 0.68)
    for k, (x, y) in enumerate([(-28.5, 4.0), (-28.5, 30.0), (-28.5, 56.0), (-6.0, 74.5), (26.0, 74.5), (30.0, 22.0), (36.0, 6.0)]):
        billboard(f'bush{k}', 'lilac-bush', x, y, 1.8, 1.45)
    for k in range(36):
        s_ = rnd.choice((-1, 1))
        billboard(f'weeds{k}', 'weeds', s_ * rnd.uniform(19.5, 22.5), rnd.uniform(-10, 61), rnd.uniform(0.35, 0.6))
    finish('dvor')


# ====================================================================== выгон за деревней

def izba(name, x, y, facing=1):
    """Изба: сруб 7 × 6 м с окнами в наличниках, шиферная двускатная крыша, труба, крыльцо. facing = +1 — окнами на +x."""
    w, d, hgt = 6.0, 7.0, 3.0   # по x, по y, высота сруба
    tile = 3.5
    box(f'{name}-body', x, y, hgt / 2, w - 0.04, d - 0.04, hgt, M['planks'], uv=2.0, coll=yard)
    hx, hy = w / 2, d / 2
    wall(f'{name}-e', x + hx, y - hy, x + hx, y + hy, 0.0, hgt, M['log-wall'], tile, hgt)
    wall(f'{name}-w', x - hx, y + hy, x - hx, y - hy, 0.0, hgt, M['log-wall'], tile, hgt)
    wall(f'{name}-n', x + hx, y + hy, x - hx, y + hy, 0.0, hgt, M['log-wall'], tile * (w / 7.0) * 2, hgt)
    wall(f'{name}-s', x - hx, y - hy, x + hx, y - hy, 0.0, hgt, M['log-wall'], tile * (w / 7.0) * 2, hgt)
    gable(f'{name}-roof', x, y, hgt, w, d, 2.3, M['shingle'], uv=2.2, over=0.5)
    box(f'{name}-chimney', x + 0.8, y + 1.0, hgt + 2.0, 0.55, 0.55, 1.6, M['brick-red'], uv=1.2, coll=yard)
    box(f'{name}-porch', x + facing * (hx + 0.8), y - hy + 1.2, 0.2, 1.6, 1.8, 0.4, M['planks'], uv=1.0, coll=yard)
    box(f'{name}-porchroof', x + facing * (hx + 0.8), y - hy + 1.2, 2.5, 1.9, 2.1, 0.08, M['shingle'], uv=2.0, coll=yard)
    for py in (y - hy + 0.4, y - hy + 2.0):
        cyl(f'{name}-porchpost{py}', x + facing * (hx + 1.5), py, 0.4, 2.5, 0.05, M['post'], verts=6)


def village():
    new_place('village')
    plane('ground', -120, 120, -70, 160, -0.04, M['meadow'], 3.4, coll=yard)
    # вытоптанная поляна и тропинки к ней
    plane('court', -17.0, 17.0, -10.0, 60.0, 0.0, M['village-dirt'], 2.6, nx=22, ny=44, jitter=1.6, coll=yard)
    plane('clay-dom', -8.5, 8.5, -6.5, 2.0, 0.012, M['clay'], 1.8, nx=14, ny=8, jitter=0.4, coll=yard)
    plane('court-path1', -26.0, -16.0, 16.0, 18.2, 0.004, M['path'], 2.4, nx=10, ny=2, jitter=0.35, coll=yard)
    plane('court-path2', -1.2, 1.2, -42.0, -9.0, 0.004, M['path'], 2.4, nx=2, ny=14, jitter=0.4, coll=yard)
    for k in range(50):
        decal(f'pebbles{k}', M['pebbles'], rnd.uniform(-16, 16), rnd.uniform(-9, 59), rnd.uniform(0.2, 0.4), rnd.uniform(0, 6.28))
    for k in range(16):
        decal(f'scuff{k}', M['scuff'], rnd.uniform(-3, 3), rnd.uniform(-2.5, 3.5), rnd.uniform(0.35, 0.7), rnd.uniform(0, 6.28))

    # улица слева: избы за штакетником, сараи, поленницы
    for k, y in enumerate((-6.0, 17.0, 40.0, 63.0)):
        izba(f'izba{k}', -35.0, y + (k % 2) * 1.5)
        box(f'shed{k}', -43.0, y + 6.0, 1.1, 3.4, 4.2, 2.2, M['planks'], uv=1.6, coll=yard)
        box(f'shedroof{k}', -43.0, y + 6.0, 2.3, 3.9, 4.7, 0.1, M['shingle'], uv=2.0, coll=yard).rotation_euler.y = 0.12
        # поленница берёзовых дров у стены
        for j in range(7):
            for i in range(4 - (j > 4)):
                o = cyl(f'wood{k}-{j}-{i}', -30.6, y - 3.2 + i * 0.24 + (j % 2) * 0.12, 0, 0.5, 0.11, M['birchlog'], verts=8)
                o.rotation_euler = (0, math.pi / 2, 0)
                o.location = (-30.9, y - 3.2 + i * 0.24 + (j % 2) * 0.12, 0.12 + j * 0.2)
    pk = image('picket')
    pw = 1.3 * pk.size[0] / pk.size[1]
    for k, (x0, y0, x1, y1) in enumerate(((-27.0, 76.0, -27.0, -22.0), (-27.0, -22.0, -48.0, -22.0), (-48.0, 76.0, -27.0, 76.0))):
        o = wall(f'cutout-picket{k}', x0, y0, x1, y1, 0.0, 1.3, M['picket'], pw, 1.3, two=True)
        n = int(math.hypot(x1 - x0, y1 - y0) / 2.6)
        for j in range(n + 1):
            t = j / n
            cyl(f'picketpost{k}-{j}', x0 + (x1 - x0) * t + 0.06, y0 + (y1 - y0) * t, 0.0, 1.2, 0.05, M['post'], verts=6)

    # справа — выгон: стога, колодец с воротом, жердевая изгородь, телега-лавка из бревна
    for k, (x, y, hgt) in enumerate(((29.0, 8.0, 3.4), (34.0, 15.0, 3.0), (30.0, 41.0, 3.6), (38.0, 50.0, 3.1))):
        cutout(f'hay{k}', 'stog', x, y, hgt)
    wx, wy = 26.0, 26.0
    box('well-box', wx, wy, 0.45, 1.3, 1.3, 0.9, M['planks'], uv=0.8, coll=yard)
    for sy in (-0.75, 0.75):
        cyl(f'well-post{sy}', wx, wy + sy, 0.0, 2.1, 0.06, M['post'], verts=6)
    bar('well-roller', (wx, wy - 0.75, 1.5), (wx, wy + 0.75, 1.5), 0.08, M['birchlog'])
    gable('well-roof', wx, wy, 2.05, 1.5, 1.9, 0.6, M['planks'], uv=1.0, over=0.15)
    prop_add(bpy.ops.mesh.primitive_cone_add, M['zinc'], 'well-bucket', (wx + 0.9, wy - 0.3, 0.16), vertices=16, radius1=0.12, radius2=0.16, depth=0.32, end_fill_type='NOTHING')
    for k, (x0, y0, x1, y1) in enumerate(((23.0, -18.0, 23.0, 66.0), (23.0, 66.0, 60.0, 70.0), (-22.0, -18.0, 23.0, -18.0))):
        n = int(math.hypot(x1 - x0, y1 - y0) / 3.0)
        for j in range(n + 1):
            t = j / n
            cyl(f'pole{k}-post{j}', x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.0, 1.15, 0.055, M['post'], verts=6)
        for z in (0.5, 0.95):
            bar(f'pole{k}-rail{z}', (x0, y0, z), (x1, y1, z + 0.04), 0.035, M['post'], verts=6)
    for k, (x, y, rot) in enumerate(((-6.0, -9.5, 0.0), (6.0, -9.5, 0.0), (20.5, 20.0, -math.pi / 2))):
        o = cyl(f'logbench{k}', x, y, 0, 2.2, 0.17, M['birchlog'], verts=10)
        o.rotation_euler = (0, math.pi / 2, rot)
        o.location = (x, y, 0.33)
        for s_ in (-0.7, 0.7):
            box(f'logbench{k}-leg{s_}', x + s_ * math.cos(rot), y + s_ * math.sin(rot), 0.09, 0.2, 0.3, 0.18, M['post'], uv=0.6, coll=yard, rot_z=rot)

    # за дальним концом — берёзовая роща, за ней сосны; берёзы и у дворов
    for k in range(22):
        billboard(f'tree-grove{k}', 'birch-tree', rnd.uniform(-22, 34), rnd.uniform(66, 84), rnd.uniform(8.5, 11.5), 0.68)
    for k in range(18):
        cutout(f'pine{k}', 'pine-tree', rnd.uniform(-50, 60), rnd.uniform(88, 104), rnd.uniform(14, 19))
    for k in range(8):
        cutout(f'pineR{k}', 'pine-tree', rnd.uniform(48, 64), rnd.uniform(-20, 86), rnd.uniform(14, 18))
    for k, (x, y, hgt) in enumerate(((-40.0, 6.0, 10.0), (-41.0, 29.0, 9.0), (-40.0, 52.0, 10.5), (-12.0, -24.0, 9.0), (14.0, -26.0, 10.0), (36.0, -8.0, 9.5), (41.0, 30.0, 10.0))):
        billboard(f'tree-yard{k}', 'birch-tree', x, y, hgt, 0.68)
    for k, (x, y) in enumerate([(-28.5, 2.0), (-28.5, 27.0), (-28.5, 49.0), (25.0, 58.0), (-18.0, -19.5), (19.0, -19.5)]):
        billboard(f'bush{k}', 'lilac-bush', x, y, 1.9, 1.45)
    for k in range(70):
        billboard(f'weeds{k}', 'weeds', rnd.uniform(-26, 24) if k % 3 else rnd.choice((-1, 1)) * rnd.uniform(17.5, 22), rnd.choice((rnd.uniform(-17, -10.5), rnd.uniform(60.5, 66))) if k % 3 else rnd.uniform(-9, 60), rnd.uniform(0.35, 0.75))
    finish('village')


for name in WHICH:
    {'school': school, 'dvor': dvor, 'village': village}[name]()
