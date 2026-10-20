import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { buildScanMaterials } from '../../shared/build-scan-materials.mjs'

export async function buildCourtyardSurfaces(source, materialSource, uses, output, textureDirectory = output) {
  const materialExport = JSON.parse(await readFile(join(source, 'materials.json'), 'utf8')).materials
  const textures = JSON.parse(await readFile(join(source, 'textures.json'), 'utf8')).textures
  const approved = JSON.parse(await readFile(materialSource, 'utf8')).surfaces[0]
  const surfaces = [], untranslated = [], excluded = []
  const image = (path, name) => {
    const texture = textures[path]
    if (!texture?.success || texture.files.length !== 1) throw new Error(`Missing source image: ${path} (${name})`)
    return { file: join(source, texture.files[0]), srgb: texture.srgb }
  }
  for (const use of uses) {
    const material = materialExport[use.path]
    const parent = material.properties.parent ?? ''
    const reason = parent.includes('/Candles_FX/') ? 'Flame FX' : parent.includes('/FogCards/') ? 'Fog card FX' : parent.includes('/Fog/Local/') ? 'Volumetric fog FX' : null
    if (reason) { excluded.push({ ...use, reason }); continue }
    const family = parent === approved.parent ? approved.family : parent.endsWith('/M_Smart_Master_02.M_Smart_Master_02') ? 'smart-layers' : parent.endsWith('/M_Candle.M_Candle') ? 'candle' : parent.endsWith('/M_SimpleORM.M_SimpleORM') ? 'simple-orm' : null
    if (!family) { untranslated.push({ ...use, parent: material.properties.parent ?? null }); continue }
    const maps = {}
    const names = family === 'custom-general' ? ['Albedo', 'Normal', 'Packed', 'Metalness', 'RGBNoise']
      : family === 'candle' ? ['Albedo', 'Normal', 'Roughness']
        : family === 'simple-orm' ? ['Albedo', 'Normal', 'Packed']
          : ['Unique_BaseColor', 'Unique_Normal', 'Unique_Mask', '0 - Detail Texture', ...[1, 2, 3, 4].filter(index => material.parameters.static_switch[`${index} - Detail Textures`]).map(index => `${index} - Detail Texture`), 'Large Scale Rock Texture Sample 01', 'Large Scale Rock Texture Sample 02', ...(!material.parameters.static_switch['RGB Blend - Disable'] ? ['RGBNoise'] : [])]
    for (const name of names) {
      if (name === 'RGBNoise') { maps[name] = { ...approved.maps[name], file: resolve(materialSource, '..', approved.maps[name].file) }; continue }
      const parameter = family === 'simple-orm' ? { Albedo: 'Map_Colour', Normal: 'Map_Normals', Packed: 'Map_ORM' }[name] : name
      maps[name] = image(material.parameters.texture[parameter], name)
    }
    surfaces.push({ family, path: use.path, parameters: material.parameters, channels: family === 'custom-general' ? approved.channels : { roughness: 'g', metalness: 'b' }, maps })
  }
  const descriptor = join(output, 'material-source.json')
  await writeFile(descriptor, JSON.stringify({ version: 1, surfaces }))
  await buildScanMaterials(descriptor, output, textureDirectory)
  return { untranslated, excluded }
}
