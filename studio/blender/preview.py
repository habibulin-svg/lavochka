"""Превью меша с трёх сторон (спереди, сбоку, ¾) одним листом.

blender -b -P studio/blender/preview.py -- <модель.glb> <выход.png>
Workbench: быстро, с контуром — чтобы оценить форму, не материал.
"""
import math
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
src, dst = args[0], args[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']

# габариты всей модели
pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
lo = Vector([min(p[i] for p in pts) for i in range(3)])
hi = Vector([max(p[i] for p in pts) for i in range(3)])
center = (lo + hi) / 2
size = max(hi - lo)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
shading = scene.display.shading
shading.light = 'STUDIO'
shading.color_type = 'SINGLE'
shading.single_color = (0.82, 0.8, 0.76)
shading.show_object_outline = True
shading.show_cavity = True
scene.render.resolution_x = 640
scene.render.resolution_y = 640
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new('w')

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
cam.data.type = 'ORTHO'
cam.data.ortho_scale = size * 1.15
scene.camera = cam

import tempfile, os
tmp = tempfile.mkdtemp()
frames = []
# glTF: вперёд модели — +Y после импорта (Z вверх); углы — спереди, ¾, сбоку
for i, ang in enumerate((0, 45, 90)):
    a = math.radians(ang)
    d = Vector((math.sin(a), -math.cos(a), 0)) * size * 3
    cam.location = center + d
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    path = os.path.join(tmp, f'{i}.png')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    frames.append(path)

# склеить в одну полосу
imgs = [bpy.data.images.load(p) for p in frames]
w, h = imgs[0].size
sheet = bpy.data.images.new('sheet', w * len(imgs), h)
px = [0.0] * (w * len(imgs) * h * 4)
for k, im in enumerate(imgs):
    src_px = list(im.pixels)
    for y in range(h):
        row = src_px[y * w * 4:(y + 1) * w * 4]
        start = (y * w * len(imgs) + k * w) * 4
        px[start:start + w * 4] = row
sheet.pixels = px
sheet.filepath_raw = dst
sheet.file_format = 'PNG'
sheet.save()
print('превью:', dst)
