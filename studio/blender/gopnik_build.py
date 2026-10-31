"""Гопник: меш TripoSG → слоты одежды + раскраска бригады (+ риг и анимации — дальше).

blender -b -P studio/blender/gopnik_build.py -- <меш.glb> <выход.blend> [бригада]

Модель после импорта glTF: перёд −Y, верх +Z. Все размеры — в долях роста H (подошва 0, макушка кепки 1),
подобраны по базовой модели q333 (`studio/bible/gopnik.md`); для других бойцов — поправить BODY.
Слоты — отдельные объекты (кепка, голова, куртка, штаны, обувь): косметика меняет объект слота целиком.
Расцветки бригад — `liveries.py`.
"""
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
from liveries import LIVERIES, rgb  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = args[0], args[1]
BRIGADE = args[2] if len(args) > 2 else 'zatulinka'

BODY = {
    'shoes_top': 0.085,
    'trousers_top': 0.27,  # низ куртки
    'neck': 0.46,
    'cap_low': 0.64,  # ниже — только лицо и уши
    'cap_all': 0.71,  # выше — всё кепка
    'cap_brim_y': -0.21,  # козырёк: перед дальше этого (доля H)
    'cap_back_y': 0.16,
    'arm_x': 0.185,  # |x| дальше — рука
    'elbow': 0.33,
    'yoke': 0.415,  # выше — кокетка
    'hand_top': 0.27,  # кисти ниже (и дальше arm_x)
    'eye_r': 0.617, 'eye_x': 0.097, 'eye_cx': 0.034,  # глаза: высота, полуразнос, сдвиг головы по x; овалы:
    'eye_rx': 0.036, 'eye_rz': 0.044,
}
FIXED = {
    'cap': '545558', 'skin': 'f5bd9a', 'eye': '0b0b0d', 'shoe': 'f2f1ec', 'sole': '8a8a8a',
}


def main():
    L = LIVERIES[BRIGADE]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    me = obj.data
    vs = [v.co for v in me.vertices]
    lo = Vector([min(v[i] for v in vs) for i in range(3)])
    hi = Vector([max(v[i] for v in vs) for i in range(3)])
    H = hi.z - lo.z
    shift = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))  # подошвы на z=0, по центру
    for v in me.vertices:
        v.co -= shift
    lo -= shift
    hi -= shift

    bm = bmesh.new()
    bm.from_mesh(me)
    # подразбить один раз: края цветовых блоков ровнее
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
    bm.faces.ensure_lookup_table()

    B = BODY

    def stripes(value, start, bands, down=True):
        """Попадание в стопку полос [(цвет, толщина), …], начиная от start вниз (или вверх)."""
        d = (start - value) if down else (value - start)
        acc = 0.0
        for col, t in bands:
            if acc <= d < acc + t:
                return col
            acc += t
        return None

    def lampas(c, n, count):
        """Полосы по внешнему боку конечности (нормаль наружу по x, у середины по y)."""
        if abs(n.x) < 0.5 or (n.x > 0) != (c.x > 0):
            return False
        y = c.y / H
        if count == 1:
            return abs(y) < 0.012
        return 0.006 < abs(y) < 0.018 if count == 2 else abs(y) < 0.004 or 0.012 < abs(y) < 0.02

    def classify(f):
        """→ (слот, цвет hex)."""
        c = f.calc_center_median()
        n = f.normal
        r = c.z / H
        X = abs(c.x) / H
        Y = c.y / H
        if r >= B['cap_all'] or (r >= B['cap_low'] and (Y < B['cap_brim_y'] or Y > B['cap_back_y'])):
            return 'cap', FIXED['cap']
        if r >= B['neck']:
            if n.y < -0.3 and ((abs(c.x / H - B['eye_cx']) - B['eye_x']) / B['eye_rx']) ** 2 + ((r - B['eye_r']) / B['eye_rz']) ** 2 < 1:
                return 'head', FIXED['eye']
            return 'head', FIXED['skin']
        if r < B['shoes_top']:
            return 'shoes', FIXED['sole'] if r < 0.012 else FIXED['shoe']
        arm = X > B['arm_x']
        if arm and r < B['hand_top']:
            return 'head', FIXED['skin']  # кисти — к телу, как и голова
        if r < B['trousers_top']:
            # штаны
            if r < B['shoes_top'] + 0.018 and 'cuff' in L:
                return 'trousers', L['cuff']
            lt = L.get('lampas_trousers') or L.get('lampas')
            if lt and lampas(c, n, lt[1]):
                return 'trousers', lt[0]
            if 'ankle' in L:
                col = stripes(r, B['shoes_top'] + 0.07 + 0.25 * X, L['ankle'])
                if col:
                    return 'trousers', col
            return 'trousers', L['trousers']
        # куртка
        if r < B['trousers_top'] + 0.016 and not arm and 'cuff' in L:
            return 'jacket', L['cuff']
        if arm:
            if r < B['hand_top'] + 0.016 and 'cuff' in L:
                return 'jacket', L['cuff']
            if 'lampas' in L and lampas(c, n, L['lampas'][1]):
                return 'jacket', L['lampas'][0]
            if r < B['elbow'] and 'forearm' in L:
                return 'jacket', L['forearm']
            if r >= B['elbow'] + 0.03 and 'sleeve_top' in L:
                return 'jacket', L['sleeve_top']
            if 'sleeve' in L:
                return 'jacket', L['sleeve']
        if r >= B['yoke'] and 'yoke' in L:
            return 'jacket', L['yoke']
        if not arm and 'chevron' in L:
            col = stripes(r, 0.375 + 0.35 * X, L['chevron'])
            if col:
                return 'jacket', col
        if not arm and 'chest' in L and Y < 0:
            col, k = L['chest']
            if 0.35 <= r < 0.41 and int((r - 0.35) / (0.06 / (2 * k))) % 2 == 0:
                return 'jacket', col
        if arm and 'yoke' in L and r >= B['yoke'] - 0.02:
            return 'jacket', L['yoke']
        return 'jacket', L['jacket']

    cls = [classify(f) for f in bm.faces]
    colors = sorted({col for _, col in cls})
    # сначала слоты материалов, потом индексы — иначе Blender обрежет индексы до 0
    me.materials.clear()
    for col in colors:
        m = bpy.data.materials.get('gop_' + col) or bpy.data.materials.new('gop_' + col)
        m.diffuse_color = (*rgb(col), 1)
        m.use_nodes = True
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb(col), 1)
        me.materials.append(m)
    for f, (_, col) in zip(bm.faces, cls):
        f.material_index = colors.index(col)
    bm.to_mesh(me)
    bm.free()

    # разрезать на слоты: копия объекта на каждый слот, чужие грани удаляются
    slot_of_face = [s for s, _ in cls]
    for slot in ('cap', 'head', 'jacket', 'trousers', 'shoes'):
        part = obj.copy()
        part.data = me.copy()
        part.name = part.data.name = 'slot_' + slot
        bpy.context.scene.collection.objects.link(part)
        bm = bmesh.new()
        bm.from_mesh(part.data)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[f for f, s in zip(bm.faces, slot_of_face) if s != slot], context='FACES')
        bm.to_mesh(part.data)
        bm.free()
    bpy.data.objects.remove(obj)

    counts = {o.name: len(o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH'}
    print('бригада', BRIGADE, 'слоты:', counts, 'высота', round(H, 3))
    bpy.ops.wm.save_as_mainfile(filepath=DST)


main()
