from pathlib import Path
import unreal

output = Path(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())) / 'exports'
output.mkdir(exist_ok=True)
registry = unreal.AssetRegistryHelpers.get_asset_registry()
registry.search_all_assets(True)
assets = registry.get_assets_by_path('/Game', recursive=True)
meshes = sorted([asset for asset in assets if str(asset.asset_class_path.asset_name) in ['StaticMesh', 'SkeletalMesh']], key=lambda asset: str(asset.package_name))
options = unreal.GLTFExportOptions()
options.export_preview_mesh = False
options.bake_material_inputs = unreal.GLTFMaterialBakeMode.DISABLED
options.use_mesh_quantization = False
exported = False
for asset in meshes:
    result = unreal.GLTFExporter.export_to_gltf(asset.get_asset(), str(output / 'model.glb'), options, set())
    if result is not None and (output / 'model.glb').exists():
        exported = True
        break
if not exported:
    raise RuntimeError('No exportable static or skeletal mesh found in pack')

unreal.log('FAB_EXPORT_DONE bytes=' + str((output / 'model.glb').stat().st_size))
