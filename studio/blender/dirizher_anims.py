"""Симулятор дирижёра: позы и циклы игры музыкантов — руки на инструменте (IK), запекание, экспорт.

blender -b --factory-startup --python studio/blender/dirizher_anims.py -- <человек.blend> <инструменты.blend> <папка выхода> <пол m|f> [инструмент …]

По человеку (dirizher_people.py) и инструментам (dirizher_instruments.py): садит на стул, ставит инструмент к телу
(подбородок, губы, колени, пол), ладони — в точки хвата (IK: запястье в точку, поворот кисти — по направлению пальцев и
линии костяшек), пальцы обхватывают гриф/трость/смычок. Инструмент и смычок — дети костей кисти: рука двигает — инструмент
идёт за ней. Действия: rest (отдых), play (цикл 2 доли = 48 кадров при 24 к/с; скорость под темп — в игре). Выход —
<папка>/<инструмент>_<пол>.glb: скелет без кожи + сетки инструментов на костях + действия. Кожу (лицо, костюм) игра
берёт из тел (любой вид этого пола), действия и инструменты — отсюда.
Оси: человек лицом к −Y (к дирижёру), его левая рука — +X, вверх — +Z, сиденье стула — z = 0,46.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

args = sys.argv[sys.argv.index('--') + 1:]
HUMAN, INSTR, OUTDIR, SEX = args[0], args[1], args[2], args[3]
ONLY = args[4:]
FPS = 24
CYCLE = 48

bpy.ops.wm.open_mainfile(filepath=HUMAN)
sc = bpy.context.scene
sc.render.fps = FPS
rig = bpy.data.objects['rig']
body = next(o for o in bpy.data.objects if o.type == 'MESH')

# инструменты — из второго файла (корни-пустышки с детьми)
with bpy.data.libraries.load(INSTR, link=False) as (src, dst):
    dst.objects = list(src.objects)
for o in dst.objects:
    if o is not None:
        sc.collection.objects.link(o)
for o in list(sc.objects):
    if o.parent is None and o.type == 'EMPTY':
        o.location = (0, 0, 0)
        o.hide_render = True
        for c in o.children_recursive:
            c.hide_render = True


def inst(name):
    return bpy.data.objects[name]


def node(root, name):
    """Пустышка точки хвата внутри инструмента."""
    for c in root.children_recursive:
        if c.name.split('.')[0] == name:
            return c
    raise KeyError(f'{root.name}: нет {name}')


def wpos(o):
    bpy.context.view_layer.update()
    return o.matrix_world.translation.copy()


PB = rig.pose.bones
REST = {b.name: (rig.matrix_world @ b.matrix_local) for b in rig.data.bones}


def bone_head(name):
    bpy.context.view_layer.update()
    return (rig.matrix_world @ PB[name].matrix).translation.copy()


def bone_mat(name):
    bpy.context.view_layer.update()
    return rig.matrix_world @ PB[name].matrix


# ---------------------------------------------------------------- цели IK
def target(name):
    e = bpy.data.objects.get(name)
    if not e:
        e = bpy.data.objects.new(name, None)
        sc.collection.objects.link(e)
    e.rotation_mode = 'QUATERNION'
    return e


def setup_ik():
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    for s in ('l', 'r'):
        t = target(f'T_hand_{s}')
        p = target(f'P_elbow_{s}')
        c = PB[f'lowerarm_{s}'].constraints.new('IK')
        c.target = t
        c.pole_target = p
        c.pole_angle = math.radians(float(os.environ.get('DZ_ARMPOLE_' + s, '-90')))
        c.chain_count = 2
        c.use_tail = True
        cr = PB[f'hand_{s}'].constraints.new('COPY_ROTATION')
        cr.target = t
    bpy.ops.object.mode_set(mode='OBJECT')


# покой кисти: направление пальцев и линия костяшек (от мизинца к указательному) — в мировых осях
def hand_frame_rest(s):
    m = REST
    w = m[f'hand_{s}'].translation
    fwd = (m[f'middle_01_{s}'].translation - w).normalized()
    across = (m[f'index_01_{s}'].translation - m[f'pinky_01_{s}'].translation)
    across = (across - fwd * across.dot(fwd)).normalized()
    palm = (m[f'middle_01_{s}'].translation * 0.6 + w * 0.4)
    return w, fwd, across, palm


def frame(f, a):
    f = f.normalized()
    a = (a - f * a.dot(f)).normalized()
    return Matrix((f, a, f.cross(a))).transposed()


def place_hand(s, palm, fingers, knuckles, elbow_hint):
    """Ладонь (середина) — в palm, пальцы — по fingers, костяшки от мизинца к указательному — по knuckles."""
    w0, f0, a0, p0 = hand_frame_rest(s)
    R = frame(fingers, knuckles) @ frame(f0, a0).inverted()
    rest_rot = REST[f'hand_{s}'].to_quaternion()
    q = R.to_quaternion() @ rest_rot
    wrist = palm - R @ (p0 - w0)
    t = target(f'T_hand_{s}')
    # IK с use_tail ведёт в цель конец предплечья = запястье
    t.location = wrist
    t.rotation_quaternion = q
    target(f'P_elbow_{s}').location = elbow_hint


def curl(s, fingers=0.5, thumb=0.3, spread=0.0, only=None):
    """Согнуть пальцы: 0 — прямые, 1 — кулак. only — список пальцев."""
    bpy.context.view_layer.objects.active = rig
    for fin in ('index', 'middle', 'ring', 'pinky'):
        if only and fin not in only:
            continue
        for k, ang in zip((1, 2, 3), (70, 90, 60)):
            pb = PB[f'{fin}_0{k}_{s}']
            pb.rotation_mode = 'XYZ'
            pb.rotation_euler = (math.radians(ang * fingers), 0, 0)
    for k, ang in zip((1, 2, 3), (20, 30, 40)):
        pb = PB[f'thumb_0{k}_{s}']
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (math.radians(ang * thumb), 0, 0)


def aim_bone(name, d):
    """Повернуть кость (в позе) так, чтобы она смотрела по d (мир): кратчайшим поворотом вокруг её начала."""
    bpy.context.view_layer.update()
    pb = PB[name]
    M = rig.matrix_world @ pb.matrix
    cur = (M.to_3x3() @ Vector((0, 1, 0))).normalized()
    q = cur.rotation_difference(d.normalized())
    h = M.translation.copy()
    newM = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ M
    pb.matrix = rig.matrix_world.inverted() @ newM
    bpy.context.view_layer.update()


def seat(height=0.46, lean=8.0, foot_y=-0.32, spread=0.12):
    """Сесть: таз на сиденье, бёдра вперёд, голени вниз, стопы на полу; корпус чуть вперёд."""
    root = PB['Root'] if 'Root' in PB else PB['pelvis']
    hip_rest = REST['thigh_l'].translation
    knee_rest = REST['calf_l'].translation
    thigh_len = (knee_rest - hip_rest).length
    dz = (height + 0.085) - hip_rest.z
    dy = 0.08 - hip_rest.y
    root.location = (0, 0, 0)
    bpy.context.view_layer.update()
    m = rig.matrix_world.inverted() @ Matrix.Translation((0, dy, dz)) @ rig.matrix_world @ root.matrix
    root.matrix = m
    bpy.context.view_layer.update()
    for s, sx in (('l', 1), ('r', -1)):
        hip = bone_head(f'thigh_{s}')
        aim_bone(f'thigh_{s}', Vector((sx * spread, -1, -(hip.z - 0.52) / max(thigh_len, 0.1))))
        knee = bone_head(f'calf_{s}')
        aim_bone(f'calf_{s}', Vector((0, -0.12, -1)))
        aim_bone(f'foot_{s}', Vector((sx * 0.1, -1, -0.45)))
    sp = PB['spine_01']
    sp.rotation_mode = 'XYZ'
    sp.rotation_euler = (math.radians(lean), 0, 0)


def look(pitch=0.0, yaw=0.0, roll=0.0):
    h = PB['head']
    h.rotation_mode = 'XYZ'
    h.rotation_euler = (math.radians(pitch), math.radians(yaw), math.radians(roll))


def place(obj_root, point_name, at, axis_z, axis_face):
    """Инструмент: его +Z — по axis_z, лицевая сторона (−Y) — по axis_face, точка point_name — в at."""
    z = axis_z.normalized()
    face = (axis_face - z * axis_face.dot(z)).normalized()
    y = -face
    x = y.cross(z)
    R = Matrix((x, y, z)).transposed().to_4x4()
    obj_root.matrix_world = R
    bpy.context.view_layer.update()
    p = node(obj_root, point_name).matrix_world.translation
    obj_root.matrix_world = Matrix.Translation(at - p) @ R
    bpy.context.view_layer.update()


def attach(obj_root, bone):
    """Сделать инструмент ребёнком кости (сохранив положение)."""
    bpy.context.view_layer.update()
    mw = obj_root.matrix_world.copy()
    obj_root.parent = rig
    obj_root.parent_type = 'BONE'
    obj_root.parent_bone = bone
    bpy.context.view_layer.update()
    obj_root.matrix_world = mw


# ---------------------------------------------------------------- запись действий
def key_pose(frame_no):
    for e in [o for o in bpy.data.objects if o.name.startswith(('T_', 'P_'))]:
        e.keyframe_insert('location', frame=frame_no)
        e.keyframe_insert('rotation_quaternion', frame=frame_no)
    for pb in PB:
        pb.keyframe_insert('location', frame=frame_no)
        pb.keyframe_insert('rotation_quaternion' if pb.rotation_mode == 'QUATERNION' else 'rotation_euler', frame=frame_no)


def clear_anim():
    """Снять ключи целей и текущее действие скелета (дорожки NLA с готовыми действиями остаются)."""
    for o in [o for o in bpy.data.objects if o.name.startswith(('T_', 'P_'))]:
        o.animation_data_clear()
    if rig.animation_data:
        rig.animation_data.action = None


def bake(name, f0, f1):
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, only_selected=True, visual_keying=True, clear_constraints=False,
                     use_current_action=False, bake_types={'POSE'})
    bpy.ops.object.mode_set(mode='OBJECT')
    act = rig.animation_data.action
    act.name = name
    act.use_fake_user = True
    tr = rig.animation_data.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, int(f0), act)
    rig.animation_data.action = None
    return act


# ---------------------------------------------------------------- постановки
def mouth():
    return bone_head('head') + Vector((0, -0.105, 0.035))


def jaw_left():
    """Куда упирается нижний край скрипки: левая ключица у шеи, под челюстью."""
    return bone_head('neck_01') + Vector((0.07, -0.02, 0.035))


def place_local(obj_root, local, at, axis_z, axis_face):
    """Как place(), но точка — в локальных координатах инструмента."""
    e = bpy.data.objects.new('_pt', None)
    sc.collection.objects.link(e)
    e.parent = obj_root
    e.location = local
    bpy.context.view_layer.update()
    place(obj_root, e.name, at, axis_z, axis_face)
    bpy.data.objects.remove(e)


def deck(o):
    """Нормаль лицевой стороны инструмента (его −Y) в мире."""
    return -(o.matrix_world.to_3x3() @ Vector((0, 1, 0))).normalized()


def axis(o):
    return (o.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()


def do_actions(rest, play, play_frames=None):
    clear_anim()
    rest()
    key_pose(1)
    key_pose(2)
    bake('rest', 1, 2)
    clear_anim()
    for k in (play_frames or range(0, CYCLE + 1, 4)):
        play(k)
        key_pose(k + 1)
    bake('play', 1, CYCLE + 1)


def rest_hand_r():
    knee = bone_head('calf_r')
    place_hand('r', knee + Vector((0.0, 0.02, 0.1)), Vector((0, -0.6, -0.8)), Vector((1, 0, 0)), knee + Vector((-0.3, 0.3, 0.25)))
    curl('r', 0.35, 0.3)


def rest_hand_l():
    knee = bone_head('calf_l')
    place_hand('l', knee + Vector((0.0, 0.02, 0.1)), Vector((0, -0.6, -0.8)), Vector((-1, 0, 0)), knee + Vector((0.3, 0.3, 0.25)))
    curl('l', 0.35, 0.3)


def stroke(k):
    """Смычок: −1 (у колодки) … 1 (у конца): вниз смычком первую долю, вверх — вторую."""
    u = (k % CYCLE) / CYCLE
    return -math.cos(2 * math.pi * u)


# ---- скрипка, альт: на левом плече, гриф влево-вперёд
def run_violin(name, bow_name, L):
    seat(lean=6)
    look(pitch=-6, yaw=-14, roll=-14)
    v, b = inst(name), inst(bow_name)
    D = Vector((0.55, -0.82, 0.06)).normalized()
    U = Vector((-0.6, 0.0, 1.0))
    place(v, 'chin', jaw_left(), D, U)
    face = deck(v)
    gn = wpos(node(v, 'grip_neck'))
    place_hand('l', gn - face * 0.025 + Vector((0.012, 0, -0.01)), face * 0.8 + Vector((-0.4, 0.0, 0.2)), D, gn + Vector((0.15, 0.25, -0.35)))
    curl('l', 0.55, 0.4)
    contact = wpos(node(v, 'contact'))
    B = D.cross(face).normalized()
    if B.x < 0:
        B = -B
    attach(v, 'neck_01')

    def bow_at(st):
        frog = contact - B * (L * 0.5 + st * L * 0.33) + face * 0.012
        place(b, 'grip_frog', frog, B, face)
        place_hand('r', frog + face * 0.035, -face * 0.7 + B * 0.3, B, frog + Vector((-0.25, 0.2, -0.25)))
        curl('r', 0.5, 0.5)
    bow_at(0.0)
    bpy.context.view_layer.update()
    attach(b, 'hand_r')
    do_actions(rest_hand_r, lambda k: bow_at(stroke(k)))


# ---- виолончель, контрабас: стоят на шпиле
def run_low(name, bow_name, L, tip, D, U, high, lean, neck_hint):
    seat(height=high, lean=lean, spread=0.22 if name == 'cello' else 0.18)
    look(pitch=-12, yaw=8 if name == 'cello' else 18)
    c, b = inst(name), inst(bow_name)
    endpin = 0.38 if name == 'cello' else 0.3
    place_local(c, (0, 0, -endpin), tip, D, U)
    face = deck(c)
    A = axis(c)
    side = A.cross(face).normalized()
    if side.x < 0:
        side = -side
    gn = wpos(node(c, 'grip_neck'))
    place_hand('l', gn + side * 0.035 - face * 0.02, -side * 0.6 - face * 0.7, A, gn + neck_hint)
    curl('l', 0.55, 0.35)
    contact = wpos(node(c, 'contact'))
    B = (side - A * side.dot(A)).normalized()

    def bow_at(st):
        frog = contact - B * (L * 0.5 + st * L * 0.3) + face * 0.015
        place(b, 'grip_frog', frog, B, face)
        place_hand('r', frog + A * 0.035 + face * 0.01, -A * 0.75 - face * 0.4, B, frog + Vector((-0.3, 0.3, -0.1)))
        curl('r', 0.5, 0.5)
    bow_at(0.0)
    bpy.context.view_layer.update()
    attach(b, 'hand_r')
    attach(c, 'Root' if 'Root' in PB else 'pelvis')
    do_actions(rest_hand_r, lambda k: bow_at(stroke(k)))


# ---- деревянные духовые: у губ, руки по клапанам
def run_wind(name, D, F, lean=5.0, look_=(-4, 0, 0), lips=(0, 0, 0)):
    seat(lean=lean)
    look(*look_)
    w = inst(name)
    place(w, 'lips', mouth() + Vector(lips), D, F)
    face = deck(w)
    A = axis(w)
    gl, gr = wpos(node(w, 'grip_l')), wpos(node(w, 'grip_r'))
    X = Vector((1, 0, 0))
    horizontal = abs(A.z) < 0.5  # флейта

    def hand_pose(k):
        wig = 0.004 * math.sin(2 * math.pi * k / CYCLE * 2)
        if horizontal:
            # флейта: ладони снизу-сзади, пальцы сверху на клапанах
            place_hand('l', gl + Vector((0, 0.025, -0.02)) + A * wig, Vector((0, -0.5, 1)), A, gl + Vector((0.25, 0.3, -0.35)))
            place_hand('r', gr + Vector((0, 0.025, -0.02)) - A * wig, Vector((0, -0.3, 1)), A, gr + Vector((-0.2, 0.35, -0.35)))
        else:
            place_hand('l', gl + X * 0.028 + face * 0.004 + A * wig, -X * 0.8 + face * 0.6, A, gl + Vector((0.35, 0.2, -0.3)))
            place_hand('r', gr - X * 0.028 + face * 0.004 - A * wig, X * 0.8 + face * 0.6, A, gr + Vector((-0.35, 0.2, -0.3)))
        curl('l', 0.45 + 0.1 * math.sin(2 * math.pi * k / CYCLE * 4), 0.4)
        curl('r', 0.45 + 0.1 * math.cos(2 * math.pi * k / CYCLE * 4), 0.4)
        sp = PB['spine_02']
        sp.rotation_mode = 'XYZ'
        sp.rotation_euler = (math.radians(2 * math.sin(2 * math.pi * k / CYCLE)), 0, 0)
    hand_pose(0)
    bpy.context.view_layer.update()
    attach(w, 'hand_l')

    def rest():
        # инструмент опущен: левая рука держит его у колена, правая — на колене
        knee = bone_head('calf_l')
        place_hand('l', knee + Vector((-0.06, 0.06, 0.16)), Vector((0, -0.4, -0.9)), Vector((-1, 0, 0.2)), knee + Vector((0.4, 0.35, 0.2)))
        curl('l', 0.6, 0.5)
        rest_hand_r()
    do_actions(rest, hand_pose)


# ---- медные
def run_brass(name, D, F, hand_l, hand_r, lean=4.0, slide=False):
    seat(lean=lean)
    look(-3, 0, 0)
    w = inst(name)
    place(w, 'lips', mouth(), D, F)

    def pose(k):
        pl, fl, kl = hand_l(w)
        pr, fr, kr = hand_r(w, k)
        place_hand('l', pl, fl, kl, pl + Vector((0.4, 0.2, -0.35)))
        place_hand('r', pr, fr, kr, pr + Vector((-0.4, 0.2, -0.35)))
        curl('l', 0.55, 0.45)
        curl('r', 0.35 + 0.15 * math.sin(2 * math.pi * k / CYCLE * 4), 0.35)
        sp = PB['spine_02']
        sp.rotation_mode = 'XYZ'
        sp.rotation_euler = (math.radians(1.5 * math.sin(2 * math.pi * k / CYCLE)), 0, 0)
    pose(0)
    bpy.context.view_layer.update()
    attach(w, 'hand_l')
    if slide:
        sl = next(c for c in w.children_recursive if c.name.startswith(name + '_slide'))
        bpy.context.view_layer.update()
        mw = sl.matrix_world.copy()
        sl.parent = rig
        sl.parent_type = 'BONE'
        sl.parent_bone = 'hand_r'
        bpy.context.view_layer.update()
        sl.matrix_world = mw

    def rest():
        pose(0)
        if not slide:
            rest_hand_r()
    do_actions(rest, pose)


# ---- литавры: высокий стул, котлы перед игроком, колотушки в кулаках
def run_timpani():
    seat(height=0.72, lean=12, spread=0.2)
    look(-25, 0, 0)
    t = inst('timpani')
    t.matrix_world = Matrix.Translation((0, -0.72, 0))
    bpy.context.view_layer.update()
    ml = inst('mallet')
    mr = bpy.data.objects.new('mallet_r', None)
    sc.collection.objects.link(mr)
    for ch in ml.children:
        cc = ch.copy()
        if ch.type == 'MESH':
            cc.data = ch.data
        cc.name = ch.name.split('.')[0] + ('_r' if ch.type == 'MESH' else '')
        sc.collection.objects.link(cc)
        cc.parent = mr
    h1, h2 = wpos(node(t, 'head_l')), wpos(node(t, 'head_r'))
    heads = {'l': h1 if h1.x > h2.x else h2, 'r': h2 if h1.x > h2.x else h1}

    def mallet_to(m, s, tip, lift):
        grip = tip + Vector((0, 0.34, 0.05 + lift))
        place(m, 'grip', grip, tip - grip, Vector((0, -1, 0)))
        sgn = 1 if s == 'l' else -1
        place_hand(s, grip + Vector((0, 0.02, 0.02)), (tip - grip).normalized() * 0.5 + Vector((0, 0, -1)), Vector((-sgn, 0, 0)), grip + Vector((sgn * 0.3, 0.3, -0.2)))
        curl(s, 0.75, 0.6)

    def pose(k):
        u = (k % CYCLE) / CYCLE
        ll = 0.18 * abs(math.sin(math.pi * u * 2)) ** 0.6 if u < 0.5 else 0.18
        rr = 0.18 * abs(math.sin(math.pi * (u * 2 - 1))) ** 0.6 if u >= 0.5 else 0.18
        mallet_to(ml, 'l', heads['l'] + Vector((0, 0.08, 0.0)), ll)
        mallet_to(mr, 'r', heads['r'] + Vector((0, 0.08, 0.0)), rr)
    pose(0)
    bpy.context.view_layer.update()
    attach(ml, 'hand_l')
    attach(mr, 'hand_r')
    attach(t, 'Root' if 'Root' in PB else 'pelvis')

    def rest():
        mallet_to(ml, 'l', heads['l'] + Vector((0.05, 0.12, 0.3)), 0.25)
        mallet_to(mr, 'r', heads['r'] + Vector((-0.05, 0.12, 0.3)), 0.25)
    do_actions(rest, pose)


V = Vector
SETUPS = {
    'violin': lambda: run_violin('violin', 'bow_violin', 0.75),
    'viola': lambda: run_violin('viola', 'bow_viola', 0.74),
    'cello': lambda: run_low('cello', 'bow_cello', 0.72, V((0, -0.68, 0)), V((0.1, 0.42, 1)), V((0, -1, 0.3)), 0.46, 4, V((0.3, 0.3, -0.2))),
    'contrabass': lambda: run_low('contrabass', 'bow_bass', 0.7, V((0.28, -0.62, 0)), V((-0.22, 0.42, 1)), V((0.25, -1, 0.2)), 0.72, 6, V((0.35, 0.3, -0.3))),
    'flute': lambda: run_wind('flute', V((0.95, 0.2, 0.04)), V((0, 0.5, 1)), look_=(-2, 12, -8), lips=(0, 0, -0.03)),
    'piccolo': lambda: run_wind('piccolo', V((0.95, 0.25, 0.06)), V((0, 0.5, 1)), look_=(-2, 12, -8), lips=(0, 0, -0.03)),
    'oboe': lambda: run_wind('oboe', V((0, 0.55, 0.83)), V((0, -0.8, 0.6))),
    'clarinet': lambda: run_wind('clarinet', V((0, 0.5, 0.86)), V((0, -0.8, 0.6))),
    'bassoon': lambda: run_wind('bassoon', V((0.32, 0.05, 1)), V((0.75, 0.66, 0)), look_=(-2, -10, 0)),
    'trumpet': lambda: run_brass('trumpet', V((0, -0.2, 1)), V((0, -1, -0.2)),
                                 lambda w: (wpos(node(w, 'grip_l')) + V((0.035, 0, 0)), V((-1, 0, 0.2)), V((0, 0, 1))),
                                 lambda w, k: (wpos(node(w, 'grip_r')) + V((0, 0.01, 0.045)), V((0, -0.3, -1)), V((0, 1, 0)))),
    'horn': lambda: run_brass('horn', V((0, 0, 1)), V((0, 1, 0)),
                              lambda w: (wpos(node(w, 'grip_l')) + V((0, 0.03, 0.03)), V((0, -0.4, -1)), V((1, 0, 0))),
                              lambda w, k: (wpos(node(w, 'grip_r')), V((0, -0.3, -1)), V((0, 1, 0)))),
    'trombone': lambda: run_brass('trombone', V((0, 0, 1)), V((0, -1, -0.12)),
                                  lambda w: (wpos(node(w, 'grip_l')) + V((0.02, 0, 0.0)), V((-0.6, 0, 1)), V((0, -1, 0))),
                                  lambda w, k: (wpos(node(w, 'grip_l')) + V((-0.05, -0.26 - 0.18 * (0.5 - 0.5 * math.cos(2 * math.pi * k / CYCLE)), -0.04)),
                                                V((0.3, 0, 1)), V((0, -1, 0))), slide=True),
    'tuba': lambda: run_brass('tuba', V((0, 0, 1)), V((0, 1, 0)),
                              lambda w: (wpos(node(w, 'grip_l')) + V((0.03, 0.03, 0)), V((-1, 0, 0)), V((0, 0, 1))),
                              lambda w, k: (wpos(node(w, 'grip_r')) + V((0, 0.03, 0.05)), V((0, -0.3, -1)), V((0, 1, 0)))),
    'timpani': run_timpani,
}


# ---- дирижёр: стоит на подиуме (0,23 м), палочка в правой; правая рука — схема такта, левая — жесты
def catmull(pts, u):
    """Замкнутая кривая Катмулла — Рома по точкам, u ∈ [0, 1)."""
    n = len(pts)
    x = u * n
    i = int(math.floor(x)) % n
    t = x - math.floor(x)
    p0, p1, p2, p3 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)


# схемы такта для правой руки (вид дирижёра: x — вправо от дирижёра = −X мира, z — вверх), точки «удара» — внизу
PATTERNS = {
    'beat2': [(0.0, 0.0), (0.02, -0.16), (0.04, -0.04), (0.02, 0.08), (0.0, 0.18), (-0.02, 0.1)],
    'beat3': [(0.0, 0.02), (0.0, -0.16), (0.05, -0.05), (0.2, -0.12), (0.22, -0.02), (0.12, 0.1), (0.02, 0.18)],
    'beat4': [(0.0, 0.02), (0.0, -0.16), (-0.04, -0.06), (-0.16, -0.12), (-0.1, -0.03), (0.08, -0.06), (0.22, -0.12), (0.2, 0.0),
              (0.08, 0.12), (0.02, 0.18)],
}


def run_conductor():
    # стоя: поднять всё тело на подиум
    root = PB['Root'] if 'Root' in PB else PB['pelvis']
    bpy.context.view_layer.update()
    root.matrix = rig.matrix_world.inverted() @ Matrix.Translation((0, 0, 0.23)) @ rig.matrix_world @ root.matrix
    look(-6, 0, 0)
    bt = inst('baton')
    sh_r = bone_head('upperarm_r')
    sh_l = bone_head('upperarm_l')
    center = sh_r + Vector((-0.1, -0.42, 0.0))  # перед правым плечом, чуть в сторону: со спины видно руку и палочку

    def right(px, pz, k=0.0):
        """Ладонь правой с палочкой: (px, pz) — смещение в плоскости перед дирижёром (px > 0 — вправо от него)."""
        palm = center + Vector((-px * 1.5, -0.02 * math.sin(k), pz * 1.5))
        tip_dir = Vector((-px * 0.6, -1.0, 0.55 + pz * 1.5)).normalized()
        place(bt, 'grip', palm + Vector((0, -0.04, 0)), tip_dir, Vector((0, 0, 1)))
        place_hand('r', palm, tip_dir * 0.6 + Vector((0, 0, -0.5)), Vector((0.2, 0, 1)), palm + Vector((-0.55, 0.15, -0.12)))
        curl('r', 0.65, 0.55)

    def left(kind, k=0.0):
        if kind == 'rest':
            p = sh_l + Vector((0.02, -0.3, -0.22))
            place_hand('l', p, Vector((-0.4, -0.6, -0.3)), Vector((0, 0, 1)), p + Vector((0.5, 0.2, -0.15)))
            curl('l', 0.45, 0.3)
        elif kind == 'cue':  # рука вперёд, ладонь вверх-вперёд: «вам!»
            p = sh_l + Vector((0.16, -0.58, 0.06 + 0.03 * math.sin(k)))
            place_hand('l', p, Vector((0.25, -1, 0.15)), Vector((-1, 0, 0.3)), p + Vector((0.5, 0.15, -0.3)))
            curl('l', 0.1, 0.1)
        elif kind == 'up':  # ладонью вверх поднимает: «громче»
            p = sh_l + Vector((0.08, -0.45, 0.12 + 0.12 * math.sin(k)))
            place_hand('l', p, Vector((0.2, -1, 0)), Vector((-1, 0, 0)), p + Vector((0.4, 0.2, -0.4)))
            curl('l', 0.15, 0.2)
        elif kind == 'hush':  # ладонью вниз прижимает: «тише»
            p = sh_l + Vector((0.0, -0.45, -0.22 - 0.05 * math.sin(k)))
            place_hand('l', p, Vector((0.1, -1, -0.1)), Vector((-1, 0, 0)), p + Vector((0.4, 0.3, -0.2)))
            curl('l', 0.05, 0.1)
        elif kind == 'hold':  # обе руки вверх — фермата
            p = sh_l + Vector((0.12, -0.42, 0.25))
            place_hand('l', p, Vector((0, -0.6, 0.8)), Vector((-1, 0, 0)), p + Vector((0.4, 0.2, -0.3)))
            curl('l', 0.25, 0.2)
    right(0, 0.1)
    left('rest')
    bpy.context.view_layer.update()
    attach(bt, 'hand_r')

    def keyed(name, fn, frames):
        clear_anim()
        for k in frames:
            fn(k)
            key_pose(k + 1)
        bake(name, 1, frames[-1] + 1)

    keyed('ready', lambda k: (right(0.0, 0.12 + 0.01 * math.sin(2 * math.pi * k / CYCLE)), left('rest')), list(range(0, CYCLE + 1, 8)))
    for nm, pts in PATTERNS.items():
        P = [Vector(p) for p in pts]

        def beat(k, P=P):
            u = (k % CYCLE) / CYCLE
            x, z = catmull(P, u)
            right(x, z + 0.04, 2 * math.pi * u)
            left('rest')
            sp = PB['spine_02']
            sp.rotation_mode = 'XYZ'
            sp.rotation_euler = (math.radians(3 + 2 * math.sin(2 * math.pi * u * len(P) / 2)), math.radians(-3), 0)
        keyed(nm, beat, list(range(0, CYCLE + 1, 2)))
    for kind in ('cue', 'up', 'hush', 'hold'):
        keyed('l_' + kind, lambda k, kind=kind: (right(0.0, 0.12), left(kind, 2 * math.pi * k / CYCLE)), list(range(0, CYCLE + 1, 8)))
    keyed('hold', lambda k: (right(0.05, 0.32), left('hold', 0)), [0, 24, 48])

    # поклон: руки вниз, корпус вперёд
    def bow(k):
        u = min(1.0, k / 24)
        right(0.0, -0.2)
        left('rest')
        sp = PB['spine_01']
        sp.rotation_mode = 'XYZ'
        sp.rotation_euler = (math.radians(35 * math.sin(math.pi * min(1, k / 48))), 0, 0)
    keyed('bow', bow, list(range(0, CYCLE + 1, 4)))


SETUPS['conductor'] = run_conductor


def export(name):
    out = os.path.join(OUTDIR, f'{name}_{SEX}.glb')
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for o in rig.children_recursive:
        if o is body or o.name.startswith(('T_', 'P_')):
            continue
        o.hide_render = False
        o.hide_set(False)
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=out, use_selection=True, export_format='GLB', export_yup=True, export_animations=True,
                              export_animation_mode='NLA_TRACKS', export_skins=True, export_def_bones=False, export_vertex_color='ACTIVE')
    print('готово', out, os.path.getsize(out) // 1024, 'КБ')


setup_ik()
for nm in (ONLY or list(SETUPS)):
    SETUPS[nm]()
    sc.frame_set(1)
    if os.environ.get('DZ_BLEND'):
        bpy.ops.wm.save_as_mainfile(filepath=os.environ['DZ_BLEND'])
    export(nm)
