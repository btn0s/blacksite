import re
import sys

import bpy

args = sys.argv[sys.argv.index('--') + 1:]
source, output = args[0], args[1]
keep = re.compile(args[2]) if len(args) > 2 and args[2] else None
size = int(args[3]) if len(args) > 3 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)

for armature in [item for item in bpy.data.objects if item.type == 'ARMATURE']:
    weighted = set()
    for item in bpy.data.objects:
        if item.type != 'MESH' or not any(modifier.type == 'ARMATURE' and modifier.object == armature for modifier in item.modifiers):
            continue
        names = {group.index: group.name for group in item.vertex_groups}
        for vertex in item.data.vertices:
            for element in vertex.groups:
                if element.weight > 1e-4:
                    weighted.add(names[element.group])
    for bone in armature.data.bones:
        bone.use_deform = bone.name in weighted or bool(keep and keep.search(bone.name))
    print('deform', armature.name, sum(bone.use_deform for bone in armature.data.bones), 'of', len(armature.data.bones))

for image in bpy.data.images:
    width, height = image.size
    if width > size or height > size:
        scale = size / max(width, height)
        image.scale(max(1, round(width * scale)), max(1, round(height * scale)))

bpy.ops.export_scene.gltf(
    filepath=output, export_format='GLB', export_def_bones=True, export_animation_mode='ACTIONS',
    export_force_sampling=True, export_optimize_animation_size=True, export_image_format='JPEG',
    export_jpeg_quality=85, export_cameras=False, export_lights=False, export_morph=False,
)
