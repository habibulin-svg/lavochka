"""Симулятор дирижёра: снимок музыканта с инструментом из отладочной сцены dirizher_anims.py (DZ_BLEND).

blender -b --python studio/blender/dirizher_shot.py -- <сцена.blend> <выход.png> <дорожка rest|play> <кадр> [вид: front|side|top|back]
"""
import math
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, TRACK, FRAME = args[0], args[1], args[2], int(args[3])
VIEW = args[4] if len(args) > 4 else 'front'
bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene
rig = bpy.data.objects['rig']
for t in rig.animation_data.nla_tracks:
    t.mute = t.name != TRACK
# поза — только из записанного действия (цели IK в сцене остались от последней записи)
for pb in rig.pose.bones:
    for c in pb.constraints:
        c.mute = True
for o in rig.children_recursive:
    if o.type == 'MESH':
        o.hide_render = False
for o in sc.objects:
    if o.type == 'EMPTY' and o.parent is None and o.name not in ('rig',):
        for c in o.children_recursive:
            c.hide_render = True
sc.frame_set(FRAME)
ctr = (rig.matrix_world @ rig.pose.bones['spine_03'].matrix).translation + Vector((0, -0.2, -0.05))
d = {'front': Vector((0.25, -1, 0.15)), 'side': Vector((1, -0.15, 0.1)), 'top': Vector((0.1, -0.4, 1)), 'back': Vector((-0.3, 1, 0.4)),
     'left': Vector((-1, -0.3, 0.15))}[VIEW].normalized()
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
cam.location = ctr + d * 1.9
cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = 50
for i, (rot, e) in enumerate([((math.radians(50), 0, math.radians(30)), 3.0), ((math.radians(60), 0, math.radians(-140)), 1.5)]):
    l = bpy.data.objects.new(f'sun{i}', bpy.data.lights.new(f'sun{i}', 'SUN'))
    l.rotation_euler = rot
    l.data.energy = e
    sc.collection.objects.link(l)
w = sc.world or bpy.data.worlds.new('w')
sc.world = w
w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.3, 0.3, 0.32, 1)
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 700, 700
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('снимок', OUT)
