import { DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, UnsignedByteType, RGBAFormat } from 'three'

export interface LayerImages {
  readonly color: DataArrayTexture
  readonly normal: DataArrayTexture
  readonly averages: readonly (readonly [number, number, number])[]
}

async function pixels(url: string, size: number): Promise<Uint8ClampedArray> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Texture ${url}: ${response.status}`)
  const bitmap = await createImageBitmap(await response.blob(), { resizeWidth: size, resizeHeight: size, resizeQuality: 'high', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const canvas = new OffscreenCanvas(size, size)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('2D canvas unavailable')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return context.getImageData(0, 0, size, size).data
}

function arrayTexture(data: Uint8Array, size: number, depth: number, srgb: boolean) {
  const texture = new DataArrayTexture(data, size, size, depth)
  texture.format = RGBAFormat
  texture.type = UnsignedByteType
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 4
  texture.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
  texture.needsUpdate = true
  return texture
}

const linear = (value: number) => {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export async function loadLayerImages(layers: readonly { readonly color: string; readonly normal: string }[], size = 1024): Promise<LayerImages> {
  const colors = await Promise.all(layers.map(layer => pixels(layer.color, size)))
  const normals = await Promise.all(layers.map(layer => pixels(layer.normal, size)))
  const layerBytes = size * size * 4
  const color = new Uint8Array(layerBytes * layers.length)
  const normal = new Uint8Array(layerBytes * layers.length)
  const averages: [number, number, number][] = []
  colors.forEach((data, index) => {
    color.set(data, index * layerBytes)
    let r = 0
    let g = 0
    let b = 0
    let count = 0
    for (let offset = 0; offset < data.length; offset += 4 * 97) {
      r += linear(data[offset]!)
      g += linear(data[offset + 1]!)
      b += linear(data[offset + 2]!)
      count++
    }
    averages.push([r / count, g / count, b / count])
  })
  normals.forEach((data, index) => normal.set(data, index * layerBytes))
  return { color: arrayTexture(color, size, layers.length, true), normal: arrayTexture(normal, size, layers.length, false), averages }
}
