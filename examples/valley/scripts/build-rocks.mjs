import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildGltfMeshes } from '../../../packages/geometry/scripts/build.mjs'

const assets = join(homedir(), 'dev/owned-assets')
for (const [source, destination] of [
  ['rileyb3d/field-rock.glb', 'field-rock'],
]) await buildGltfMeshes(join(assets, source), join(assets, 'meshlets', destination))
