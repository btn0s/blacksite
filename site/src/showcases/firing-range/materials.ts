import * as THREE from 'three'
import osbColor from './textures/osb_c.webp?url'
import osbNormal from './textures/osb_n.webp?url'
import canvasColor from './textures/canvas_c.webp?url'
import canvasNormal from './textures/canvas_n.webp?url'
import planksColor from './textures/planks_c.webp?url'
import planksNormal from './textures/planks_n.webp?url'
import plateColor from './textures/plate_c.webp?url'
import plateNormal from './textures/plate_n.webp?url'

export type RangeMaterial = 'osb' | 'canvas' | 'planks' | 'plate'

const specs: Record<RangeMaterial, { files: [string, string]; tile: number; color: string; roughness: number; metalness: number; normal: number }> = {
  osb: { files: [osbColor, osbNormal], tile: 1.2, color: '#a89a80', roughness: 0.9, metalness: 0, normal: 0.8 },
  canvas: { files: [canvasColor, canvasNormal], tile: 0.9, color: '#9c9071', roughness: 1, metalness: 0, normal: 1.4 },
  planks: { files: [planksColor, planksNormal], tile: 1.6, color: '#c4b8a4', roughness: 0.88, metalness: 0, normal: 1 },
  plate: { files: [plateColor, plateNormal], tile: 0.7, color: '#ffffff', roughness: 0.62, metalness: 0.25, normal: 0.7 },
}

const loader = new THREE.TextureLoader()
const pending: Promise<unknown>[] = []
const cache = new Map<RangeMaterial, THREE.MeshStandardMaterial>()

function load(url: string, color: boolean) {
  let done: (value: unknown) => void = () => {}
  pending.push(new Promise(resolve => { done = resolve }))
  const texture = loader.load(url, done, undefined, done)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 4
  if (color) texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function rangeMaterial(name: RangeMaterial) {
  const cached = cache.get(name)
  if (cached) return cached
  const spec = specs[name]
  const material = new THREE.MeshStandardMaterial({
    name: `range-${name}`, map: load(spec.files[0], true), normalMap: load(spec.files[1], false),
    normalScale: new THREE.Vector2(spec.normal, spec.normal), color: spec.color, roughness: spec.roughness, metalness: spec.metalness, envMapIntensity: 0.6,
  })
  material.userData.tile = spec.tile
  cache.set(name, material)
  return material
}

export const rangeTexturesReady = () => Promise.all(pending)

export function labelTexture(draw: (context: CanvasRenderingContext2D, width: number, height: number) => void, width = 256, height = 256) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  draw(canvas.getContext('2d')!, width, height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

export function paperTarget() {
  return labelTexture((context, width, height) => {
    context.fillStyle = '#d9cfb4'
    context.fillRect(0, 0, width, height)
    for (let index = 0; index < 900; index++) {
      context.fillStyle = `rgba(90,70,40,${Math.random() * 0.05})`
      context.fillRect(Math.random() * width, Math.random() * height, 2 + Math.random() * 6, 2 + Math.random() * 6)
    }
    const cx = width / 2
    const cy = height * 0.56
    context.fillStyle = '#23241f'
    context.beginPath()
    context.ellipse(cx, height * 0.25, width * 0.13, height * 0.12, 0, 0, Math.PI * 2)
    context.fill()
    context.beginPath()
    context.moveTo(width * 0.12, height)
    context.bezierCurveTo(width * 0.14, height * 0.5, width * 0.3, height * 0.38, cx, height * 0.37)
    context.bezierCurveTo(width * 0.7, height * 0.38, width * 0.86, height * 0.5, width * 0.88, height)
    context.fill()
    context.strokeStyle = '#d9cfb4'
    context.fillStyle = '#d9cfb4'
    context.lineWidth = 2
    context.font = '600 15px "Barlow Condensed", sans-serif'
    context.textAlign = 'center'
    for (let ring = 1; ring <= 5; ring++) {
      context.beginPath()
      context.arc(cx, cy, ring * width * 0.06, 0, Math.PI * 2)
      context.stroke()
      if (ring > 1) context.fillText(String(11 - ring), cx + ring * width * 0.06 - width * 0.03, cy + 5)
    }
    context.fillStyle = '#7a2a1e'
    context.font = '600 18px "Barlow Condensed", sans-serif'
    context.fillText('№ 4', width * 0.1, height * 0.07)
  }, 256, 320)
}

export function markerTexture(text: string) {
  return labelTexture((context, width, height) => {
    context.fillStyle = '#d8d2bf'
    context.fillRect(0, 0, width, height)
    for (let index = 0; index < 500; index++) {
      context.fillStyle = `rgba(60,50,30,${Math.random() * 0.08})`
      context.fillRect(Math.random() * width, Math.random() * height, 1 + Math.random() * 8, 1 + Math.random() * 5)
    }
    context.fillStyle = '#1f1f1a'
    context.font = `700 ${height * 0.62}px "Barlow Condensed", sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, width / 2, height * 0.54)
    context.fillStyle = '#9b3424'
    context.fillRect(0, 0, width, height * 0.08)
  }, 128, 96)
}
