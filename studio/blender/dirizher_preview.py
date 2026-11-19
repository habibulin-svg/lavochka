"""Симулятор дирижёра: снимок сцены .blend/.glb для проверки глазами.

blender -b --factory-startup --python studio/blender/dirizher_preview.py -- <вход .blend|.glb> <выход.png> [вид: front|back|side|seat] [кадр]
"""
import math
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
VIEW = args[2] if len(args) > 2 else 'front'
FRAME = int(args[3]) if len(args) > 3 else 1
ONLY = args[4].split(',') if len(args) > 4 else None

if SRC.endswith('.blend'):
    bpy.ops.wm.open_mainfile(filepath=SRC)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene
sc.frame_set(FRAME)


def root_of(o):
    while o.parent:
        o = o.parent
    return o


if ONLY:
    for o in sc.objects:
        if o.type == 'MESH' and root_of(o).name not in ONLY:
            o.hide_render = True
meshes = [o for o in sc.objects if o.type == 'MESH' and not o.hide_render]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
ctr = (mn + mx) / 2
size = max((mx - mn).length, 0.5)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
d = {'front': Vector((0, -1, 0.25)), 'back': Vector((0, 1, 0.45)), 'side': Vector((1, 0, 0.2)), 'seat': Vector((0.6, -1, 0.5))}[VIEW].normalized()
cam.location = ctr + d * size * 1.25
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
w.node_tree.nodes['Background'].inputs[1].default_value = 0.6
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 900, 900
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('снимок', OUT)
