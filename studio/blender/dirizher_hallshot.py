"""Симулятор дирижёра: снимок зала (glb) с заданной точки — проверка, узнаётся ли зал.

blender -b --factory-startup --python studio/blender/dirizher_hallshot.py -- <зал.glb> <выход.png> [вид: auditorium|stage|organ]
Точки — как у камеры игры при облёте (в координатах Blender: публика — к −Y).
"""
import math
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
VIEW = args[2] if len(args) > 2 else 'auditorium'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
if VIEW == 'auditorium':
    cam.location = Vector((0, 7.5, 4.5))
    target = Vector((0, -14, 4.5))
    cam.data.angle = math.radians(75)
elif VIEW == 'organ':
    # из зала на сцену: хоры, орган, потолок
    cam.location = Vector((0, -12, 6))
    target = Vector((0, 12, 7))
    cam.data.angle = math.radians(80)
else:
    cam.location = Vector((0, -4.2, 5.0))
    target = Vector((0, 4.6, 1.2))
    cam.data.angle = math.radians(65)
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
for i, (loc, e) in enumerate([((0, 6, 12), 1500), ((0, -12, 10), 2500), ((-8, -4, 8), 800), ((8, -4, 8), 800)]):
    l = bpy.data.objects.new(f'l{i}', bpy.data.lights.new(f'l{i}', 'POINT'))
    l.location = loc
    l.data.energy = e
    l.data.shadow_soft_size = 3
    sc.collection.objects.link(l)
w = bpy.data.worlds.new('w')
sc.world = w
w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.05, 0.04, 0.035, 1)
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 960, 540
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('снимок', OUT)
