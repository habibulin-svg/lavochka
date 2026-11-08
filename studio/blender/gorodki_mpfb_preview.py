"""Городки: проверочные кадры гопника (Eevee) — анфас, профиль, спина, ¾, голова крупно, кулак с битой крупно.

blender -b --factory-startup --python studio/blender/gorodki_mpfb_preview.py -- <модель.glb> <папка> [<префикс>]
В кулак правой руки вставляется палка ⌀ 4 см по кости grip.R — видно, проходит ли бита через кулак.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = args[0], args[1]
PRE = args[2] if len(args) > 2 else os.path.splitext(os.path.basename(SRC))[0]
os.makedirs(DST, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 640, 900
sc.view_settings.view_transform = 'Standard'
w = bpy.data.worlds.new('w')
sc.world = w
w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.6, 0.68, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 0.6
for rot, en in (((50, 0, 30), 3.0), ((60, 0, 200), 1.2)):
    s = bpy.data.lights.new('sun', 'SUN')
    s.energy = en
    o = bpy.data.objects.new('sun', s)
    o.rotation_euler = [math.radians(a) for a in rot]
    sc.collection.objects.link(o)

rig = next(o for o in sc.objects if o.type == 'ARMATURE')
gb = rig.data.bones.get('grip.R')
if gb:
    bpy.ops.mesh.primitive_cylinder_add(radius=0.02, depth=0.5)
    bat = bpy.context.active_object
    m = bpy.data.materials.new('bat')
    m.diffuse_color = (0.45, 0.3, 0.15, 1)
    bat.data.materials.append(m)
    head = rig.matrix_world @ gb.head_local
    ax = (rig.matrix_world.to_3x3() @ (gb.tail_local - gb.head_local)).normalized()
    bat.rotation_mode = 'QUATERNION'
    bat.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(ax)
    bat.location = head + ax * 0.19

cam_d = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cam_d)
sc.collection.objects.link(cam)
sc.camera = cam


def shot(name, target, dist, yaw_deg, h=0.0, lens=50):
    yaw = math.radians(yaw_deg)
    cam_d.lens = lens
    pos = Vector(target) + Vector((math.sin(yaw) * dist, -math.cos(yaw) * dist, h))
    cam.location = pos
    cam.rotation_euler = (Vector(target) - pos).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(DST, f'{PRE}-{name}.png')
    bpy.ops.render.render(write_still=True)


shot('front', (0, 0, 0.9), 4.2, 0)
shot('side', (0, 0, 0.9), 4.2, 90)
shot('back', (0, 0, 0.9), 4.2, 180)
shot('34', (0, 0, 0.9), 4.2, -35)
headb = rig.data.bones['head']
hp = rig.matrix_world @ headb.head_local + Vector((0, 0, 0.1))
shot('head', hp, 0.75, -20, 0.03)
shot('head-side', hp, 0.75, 90, 0.03)
hb = rig.data.bones['hand.R']
hh = rig.matrix_world @ ((hb.head_local + hb.tail_local) / 2)
shot('hand', hh, 0.55, -60, 0.05)
shot('hand2', hh, 0.55, -140, -0.1)
