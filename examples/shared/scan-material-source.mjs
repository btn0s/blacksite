import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { readGltfMeshGeometry } from '../../packages/geometry/scripts/build.mjs'

const families = new Map([
  ['M_MS_CustomGeneral', 'custom-general'],
  ['M_Smart_Master_02', 'smart-layers'],
  ['M_SimpleORM', 'simple-orm'],
  ['M_Candle', 'candle'],
  ['M_GenericProps', 'generic-props'],
  ['M_Cutout', 'cutout'],
  ['M_BlendMaterial', 'vertex-blend'],
  ['M_MS_CustomFoliage', 'foliage'],
  ['M_Emissive', 'emissive'],
  ['M_Metal_Burnished_Steel1', 'steel'],
  ['BasicShapeMaterial', 'solid'],
  ['WorldGridMaterial', 'world-grid'],
  ['M_Flame', 'flame'],
])


export function scanMaterialFamily(materials, path) {
  const visited = new Set()
  const parent = materials[path]?.properties.parent ?? null
  for (let current = path; current; current = materials[current]?.properties.parent) {
    if (visited.has(current)) throw new Error(`Cyclic material inheritance: ${path}`)
    visited.add(current)
    const name = current.split('.').at(-1)
    const reason = name === 'M_MS_CustomDecal' ? 'Projected decal: receiver depth and material-buffer blending'
      : name === 'M_FogCard' ? 'Fog card FX: depth-faded translucent atmosphere'
      : name === 'M_VolumetricFog_Static' ? 'Volumetric fog FX: volume integration'
        : name === 'M_MagicEnergy' ? 'Energy FX: animated translucency and vertex displacement'
          : name === 'M_MS_Puddle' ? 'Water FX: single-layer water scattering, absorption and scene-depth integration'
            : null
    if (reason) return { family: 'excluded', parent, reason }
    if (families.has(name)) return { family: families.get(name), parent }
  }
  return { family: 'untranslated', parent }
}

const graphMaps = {
  steel: { Albedo: '/Game/StarterContent/Textures/T_Metal_Aluminum_D.T_Metal_Aluminum_D', Normal: '/Game/StarterContent/Textures/T_Metal_Gold_N.T_Metal_Gold_N', Macro: '/Game/StarterContent/Textures/T_MacroVariation.T_MacroVariation' },
  'world-grid': { Grid: '/Engine/EngineMaterials/T_Default_Material_Grid_M.T_Default_Material_Grid_M', Normal: '/Engine/EngineMaterials/T_Default_Material_Grid_N.T_Default_Material_Grid_N' },
  'vertex-blend': { PuddleNormal: '/Engine/Functions/Engine_MaterialFunctions02/ExampleContent/Textures/water_n.water_n' },
}

export async function describeScanMaterials(source, approvedSource, uses, graphTextures = {}) {
  const materials = JSON.parse(await readFile(join(source, 'materials.json'), 'utf8')).materials
  const textures = JSON.parse(await readFile(join(source, 'textures.json'), 'utf8')).textures
  const approved = JSON.parse(await readFile(approvedSource, 'utf8')).surfaces[0]
  const surfaces = [], excluded = [], untranslated = []
  const image = (path, name) => {
    const info = textures[path]
    if (!info?.success || info.files.length !== 1) throw new Error(`Missing source image: ${path} (${name})`)
    return { file: join(source, info.files[0]), srgb: info.srgb }
  }
  for (const use of uses) {
    const material = materials[use.path]
    if (!material) throw new Error(`Missing source material: ${use.path}`)
    const classification = scanMaterialFamily(materials, use.path)
    if (classification.family === 'excluded') { excluded.push({ ...use, ...classification }); continue }
    if (classification.family === 'untranslated') { untranslated.push({ ...use, ...classification }); continue }
    const { family, parent } = classification
    const parameters = material.parameters
    const maps = {}
    const names = family === 'custom-general' || family === 'foliage' ? ['Albedo', 'Normal', 'Packed', ...(!parameters.static_switch['RGB Blend - Disable'] ? ['RGBNoise'] : [])]
      : family === 'candle' ? ['Albedo', 'Normal', 'Roughness']
        : family === 'simple-orm' ? ['Map_Colour', 'Map_Normals', 'Map_ORM']
          : family === 'generic-props' ? ['Map_Colour', 'Map_Normals', 'Map_ORM', ...(parameters.static_switch['Use Standalone Metalness'] ? ['Map_Metalness'] : [])]
            : family === 'cutout' ? ['Albedo', 'Normal', 'Opacity', ...(parameters.static_switch['Use Unique Roughness'] ? ['Roughness'] : [])]
              : family === 'flame' ? ['Flame TX', 'Distortion']
                : family === 'vertex-blend' ? Object.keys(parameters.texture).filter(name => !name.endsWith('Metalness'))
                : family === 'smart-layers' ? ['Unique_BaseColor', 'Unique_Normal', 'Unique_Mask', '0 - Detail Texture', ...[1, 2, 3, 4].filter(index => parameters.static_switch[`${index} - Detail Textures`]).map(index => `${index} - Detail Texture`), ...(parameters.static_switch['1 - Large Scale Rock'] ? ['Large Scale Rock Texture Sample 01'] : []), ...(parameters.static_switch['2 - Large Scale Rock'] ? ['Large Scale Rock Texture Sample 02'] : []), ...(!parameters.static_switch['RGB Blend - Disable'] ? ['RGBNoise'] : [])]
                  : []
    for (const name of names) {
      if (name === 'RGBNoise') {
        maps[name] = { ...approved.maps.RGBNoise, file: resolve(dirname(approvedSource), approved.maps.RGBNoise.file) }
      } else {
        const target = { Map_Colour: 'Albedo', Map_Normals: 'Normal', Map_ORM: 'Packed', Map_Metalness: 'Metalness', 'Flame TX': 'Flame' }[name] ?? name
        maps[target] = image(parameters.texture[name], name)
      }
    }
    for (const [name, path] of Object.entries(graphMaps[family] ?? {})) {
      const info = graphTextures[path]
      if (!info?.file || typeof info.srgb !== 'boolean') throw new Error(`Missing constant graph image: ${path}`)
      maps[name] = info
    }
    surfaces.push({ family, path: use.path, parent, parameters, channels: family === 'custom-general' || family === 'foliage' ? approved.channels : { roughness: 'g', metalness: 'b' }, maps })
  }
  const placements = use => use.uses ? use.uses.filter(item => item.visible).map(item => item.placement) : use.placements ?? []
  const groups = new Map()
  for (const surface of surfaces) {
    const group = surface.parent ?? surface.path
    if (!groups.has(group)) groups.set(group, { parent: group, family: surface.family, paths: [], placements: new Set() })
    const entry = groups.get(group)
    entry.paths.push(surface.path)
    for (const placement of placements(uses.find(use => use.path === surface.path))) entry.placements.add(placement)
  }
  const flameGeometry = {}
  for (const surface of surfaces) {
    if (surface.family !== 'flame') continue
    for (const id of new Set(uses.find(use => use.path === surface.path).uses.map(item => item.geometry))) {
      if (flameGeometry[id]) continue
      const [file, index] = id.split(':')
      const { geometry } = await readGltfMeshGeometry(join(source, file), Number(index))
      const round = array => Array.from(array, value => Math.round(value * 1e6) / 1e6)
      flameGeometry[id] = { position: round(geometry.positions), normal: round(geometry.normals), uv: round(geometry.uvs), index: Array.from(geometry.sourceIndices) }
    }
  }
  const translations = [...groups.values()].map(group => ({ ...group, placements: group.placements.size }))
  return { version: 1, surfaces, excluded, untranslated, flameGeometry, coverage: { active: uses.length, supported: surfaces.length, untranslated: untranslated.length, excluded: excluded.length }, translations }
}

export async function writeScanMaterialSource(source, approvedSource, uses, output, graphTextures = {}) {
  const descriptor = await describeScanMaterials(source, approvedSource, uses, graphTextures)
  await writeFile(output, JSON.stringify(descriptor, null, 2))
  return descriptor
}
