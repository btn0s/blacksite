import sys
from pathlib import Path
import bpy

arguments = sys.argv[sys.argv.index('--') + 1:]
source = Path(arguments[0]).resolve()
output = Path(arguments[1]).resolve()
bpy.ops.wm.read_factory_settings(use_empty=True)
if source.suffix.lower() == '.fbx':
    bpy.ops.import_scene.fbx(filepath=str(source), use_image_search=False)
elif source.suffix.lower() in ['.usd', '.usda', '.usdc', '.usdz']:
    bpy.ops.wm.usd_import(filepath=str(source))
else:
    raise RuntimeError('Unsupported source model format')

siblings = sorted([path for path in source.parent.iterdir() if path.is_file() and path.suffix.lower() in ['.png', '.jpg', '.jpeg'] and not any(word in path.name.lower() for word in ['login', 'token', 'secret', 'key', 'credential'])])

def texture(suffix, color):
    match = next((path for path in siblings if any(label in path.stem.lower() for label in suffix)), None)
    if not match:
        return None
    image = bpy.data.images.load(str(match), check_existing=True)
    image.colorspace_settings.name = color
    return image

base = texture(['basecolor', 'base_color', 'albedo', 'diffuse'], 'sRGB')
normal = texture(['normal'], 'Non-Color')
roughness = texture(['roughness'], 'Non-Color')
opacity = texture(['opacity'], 'Non-Color')
if base:
    for material in bpy.data.materials:
        material.use_nodes = True
        nodes = material.node_tree.nodes
        shader = next((node for node in nodes if node.type == 'BSDF_PRINCIPLED'), None)
        if not shader:
            continue
        for image, slot in [(base, 'Base Color'), (roughness, 'Roughness'), (opacity, 'Alpha')]:
            if not image:
                continue
            node = nodes.new('ShaderNodeTexImage')
            node.image = image
            material.node_tree.links.new(node.outputs['Color'], shader.inputs[slot])
        if normal:
            node = nodes.new('ShaderNodeTexImage')
            node.image = normal
            mapping = nodes.new('ShaderNodeNormalMap')
            material.node_tree.links.new(node.outputs['Color'], mapping.inputs['Color'])
            material.node_tree.links.new(mapping.outputs['Normal'], shader.inputs['Normal'])
        if opacity and hasattr(material, 'surface_render_method'):
            material.surface_render_method = 'DITHERED'

output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', export_apply=True)
if not output.exists() or output.stat().st_size < 32:
    raise RuntimeError('Model conversion did not produce a GLB')
print('FAB_MODEL_EXPORT_DONE bytes=' + str(output.stat().st_size))
