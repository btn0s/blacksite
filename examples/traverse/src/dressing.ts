import * as THREE from 'three'
import { apc, lada, puddleMaterial, waterTower, type LevelBuilder, type SurfaceName } from '@blacksite/look/world'
import { feet } from './model'
import type { Emitter, Light, Waypoint } from './route'

type Vec3 = [number, number, number]
type Mat = { name: SurfaceName; color?: string; ao?: false }
type Region = readonly [number, number, number, number]
type Batch = { position: number[]; normal: number[]; uv: number[]; sway: number[] }
type Style = 'panel' | 'hoarding' | 'ruin'

export type DressingContext = {
  rand: () => number
  lights: Light[]
  emitters: Emitter[]
  line: Waypoint[]
  garageRoof: number
  garages: number[]
  tower: { x0: number; x1: number; z0: number; z1: number }
  inner: { x0: number; x1: number; z0: number; z1: number }
  roof: number
  boiler: { x0: number; x1: number; z0: number; z1: number }
  upper: number
  plant: number
  finishX: number
  slabEnd: Vec3
  dockStart: Vec3
  dockTop: Vec3
}

const cast: Mat = { name: 'cast' }
const panel: Mat = { name: 'panel' }
const brick: Mat = { name: 'brick' }
const rust: Mat = { name: 'rust' }
const stained: Mat = { name: 'stained' }
const slab: Mat = { name: 'slab' }
const sheet: Mat = { name: 'corrugated', color: '#7d7a64' }
const sheetDark: Mat = { name: 'corrugated', color: '#6d6a58' }
const metal: Mat = { name: 'metal', color: '#4a4d43' }
const iron: Mat = { name: 'metal', color: '#2f302a' }
const rubber: Mat = { name: 'metal', color: '#1d1c19', ao: false }
const glass: Mat = { name: 'metal', color: '#16170f', ao: false }
const wood: Mat = { name: 'cast', color: '#4a4237' }
const drum: Mat = { name: 'rust', color: '#333029' }
const red: Mat = { name: 'rust', color: '#5a3c2c' }
const pale: Mat = { name: 'panel', color: '#a6a291' }
const trim: Mat = { name: 'cast', color: '#8f8b7c', ao: false }
const rubbleMat: Mat = { name: 'gravel', color: '#8d877a' }
const tar: Mat = { name: 'asphalt', ao: false }
const apron: Mat = { name: 'slab', ao: false }
const paint: Mat = { name: 'paint' }
const coal: Mat = { name: 'gravel', color: '#4a4740' }

const R = {
  stain: [0, 0, 128, 256], rust: [128, 0, 128, 256], soot: [256, 0, 256, 256], crack: [512, 0, 256, 256], peel: [768, 0, 256, 256],
  tsoi: [0, 256, 512, 128], tag: [0, 384, 512, 128], poster: [512, 256, 192, 256], notice: [704, 256, 160, 224], danger: [864, 256, 160, 128], exit: [864, 384, 160, 128],
  plate14: [0, 512, 128, 128], plate16: [128, 512, 128, 128], arrow: [768, 512, 128, 128], oil: [896, 512, 128, 128],
  sign: [0, 640, 256, 64], one: [0, 704, 64, 64], two: [64, 704, 64, 64], three: [128, 704, 64, 64], beam: [256, 640, 64, 128], window: [320, 640, 128, 128], band: [448, 640, 320, 128], grime: [768, 640, 256, 128],
  tracks: [0, 768, 256, 64], tarp: [0, 832, 256, 192], dirt: [256, 768, 128, 128], gravel: [384, 768, 128, 128], litter: [512, 768, 128, 128], weeds: [640, 768, 128, 128], tuft: [768, 768, 128, 128],
  sheet: [896, 768, 64, 128], shirt: [960, 768, 64, 128], towel: [896, 896, 64, 128], dress: [960, 896, 64, 128],
  boiler: [256, 896, 384, 64], tag3: [256, 960, 384, 64], moss: [640, 896, 128, 128], scorch: [768, 896, 128, 128],
} satisfies Record<string, Region>
const garageNumber = (index: number): Region => [256 + (index % 4) * 128, 512 + Math.floor(index / 4) * 64, 128, 64]

function random(seed: number) {
  let state = seed >>> 0
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 }
}

function paintAtlas() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1024
  const g = canvas.getContext('2d')!
  const rand = random(7)
  const ink = (r: number, gr: number, b: number, a: number) => `rgba(${r},${gr},${b},${a})`
  const cell = (region: Region, draw: (w: number, h: number) => void) => { g.save(); g.translate(region[0], region[1]); g.beginPath(); g.rect(0, 0, region[2], region[3]); g.clip(); draw(region[2], region[3]); g.restore() }
  const blot = (x: number, y: number, rx: number, ry: number, color: string) => { g.save(); g.translate(x, y); g.scale(rx, ry); const gradient = g.createRadialGradient(0, 0, 0, 0, 0, 1); gradient.addColorStop(0, color); gradient.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gradient; g.fillRect(-1, -1, 2, 2); g.restore() }
  const blob = (cx: number, cy: number, r: number, jag: number, points = 14) => { g.beginPath(); for (let k = 0; k < points; k++) { const a = k / points * Math.PI * 2; const d = r * (1 - jag * rand()); g[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * d, cy + Math.sin(a) * d) } g.closePath() }
  const speck = (count: number, w: number, h: number, color: () => string, size: [number, number]) => { for (let k = 0; k < count; k++) { g.fillStyle = color(); const s = size[0] + rand() * (size[1] - size[0]); g.fillRect(rand() * w, rand() * h, s, s) } }
  const erase = (count: number, w: number, h: number, size: [number, number]) => { g.save(); g.globalCompositeOperation = 'destination-out'; speck(count, w, h, () => ink(0, 0, 0, 0.6 + rand() * 0.4), size); g.restore() }
  const streaks = (w: number, h: number, color: [number, number, number], count: number, spread: number) => {
    g.filter = 'blur(2px)'
    for (let k = 0; k < count; k++) {
      const x = w / 2 + (rand() - 0.5) * spread
      const top = rand() * h * 0.15
      const length = h * (0.4 + rand() * 0.55)
      const gradient = g.createLinearGradient(0, top, 0, top + length)
      gradient.addColorStop(0, ink(...color, 0.1 + rand() * 0.18))
      gradient.addColorStop(1, ink(...color, 0))
      g.fillStyle = gradient
      g.fillRect(x, top, 2 + rand() * 7, length)
    }
    blot(w / 2, h * 0.06, w * 0.42, h * 0.06, ink(...color, 0.35))
    g.filter = 'none'
  }
  const spray = (text: string, w: number, h: number, size: number, fill: string, outline?: string, tilt = -0.04) => {
    g.save()
    g.translate(w / 2, h / 2)
    g.rotate(tilt)
    g.font = `bold ${size}px Impact, "Arial Black", "Helvetica Neue", sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.shadowColor = fill
    g.shadowBlur = 4
    if (outline) { g.lineWidth = size * 0.12; g.strokeStyle = outline; g.strokeText(text, 0, 0) }
    g.fillStyle = fill
    g.fillText(text, 0, 0)
    const width = Math.min(w * 0.9, g.measureText(text).width || w * 0.8)
    g.shadowBlur = 0
    g.fillStyle = fill
    for (let k = 0; k < 9; k++) g.fillRect(-width / 2 + rand() * width, size * 0.3, 2, 6 + rand() * size * 0.5)
    g.restore()
  }
  const stencil = (text: string, w: number, h: number, size: number, fill: string) => { g.font = `bold ${size}px "Arial Black", "Helvetica Neue", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fill; g.fillText(text, w / 2, h / 2); erase(220, w, h, [1, 3]) }
  const paper = (w: number, h: number, color: string) => { g.fillStyle = color; g.beginPath(); g.moveTo(4, 6); for (let x = 4; x <= w - 4; x += 8) g.lineTo(x, 3 + rand() * 5); for (let y = 6; y <= h - 6; y += 10) g.lineTo(w - 3 - rand() * 5, y); for (let x = w - 4; x >= 4; x -= 8) g.lineTo(x, h - 3 - rand() * 8); g.closePath(); g.fill() }

  cell(R.stain, (w, h) => streaks(w, h, [62, 52, 36], 34, w * 0.75))
  cell(R.rust, (w, h) => streaks(w, h, [118, 60, 24], 22, w * 0.35))
  cell(R.soot, (w, h) => { g.filter = 'blur(10px)'; for (let k = 0; k < 16; k++) blot(w / 2 + (rand() - 0.5) * 50, h - 30 - k * 13, 46 + k * 4.5, 34, ink(18, 16, 14, 0.16)); g.filter = 'none'; erase(160, w, h, [2, 5]) })
  cell(R.crack, (w, h) => {
    const crack = (x: number, y: number, angle: number, length: number, width: number) => {
      g.beginPath(); g.moveTo(x, y)
      for (let k = 0; k < length; k++) { angle += (rand() - 0.5) * 0.9; x += Math.cos(angle) * 9; y += Math.sin(angle) * 9; g.lineTo(x, y); if (rand() < 0.08 && width > 1) crack(x, y, angle + (rand() - 0.5) * 2, length / 3, width * 0.6) }
      g.strokeStyle = ink(28, 26, 22, 0.85); g.lineWidth = width; g.stroke()
    }
    crack(w / 2, 6, Math.PI / 2, 26, 2.6)
    crack(w / 2, h / 2, 0.3, 12, 1.6)
  })
  cell(R.peel, (w, h) => {
    for (let k = 0; k < 7; k++) { blob(30 + rand() * (w - 60), 30 + rand() * (h - 60), 24 + rand() * 40, 0.45); g.fillStyle = ink(86, 116, 108, 0.92); g.fill(); g.strokeStyle = ink(40, 44, 38, 0.5); g.lineWidth = 1.5; g.stroke() }
    g.save(); g.globalCompositeOperation = 'destination-out'
    for (let k = 0; k < 18; k++) { blob(rand() * w, rand() * h, 6 + rand() * 16, 0.5, 8); g.fillStyle = ink(0, 0, 0, 1); g.fill() }
    g.restore()
    speck(140, w, h, () => ink(210, 205, 190, 0.5), [1, 3])
  })
  cell(R.tsoi, (w, h) => spray('ЦОЙ ЖИВ', w, h, 92, ink(28, 28, 30, 0.92)))
  cell(R.tag, (w, h) => spray('СПАРТАК', w, h, 84, ink(150, 34, 26, 0.92), ink(214, 208, 190, 0.75), 0.05))
  cell(R.tag3, (w, h) => spray('ВЫХОДА НЕТ', w, h, 44, ink(30, 30, 30, 0.88), undefined, -0.02))
  cell(R.poster, (w, h) => {
    paper(w, h, ink(208, 197, 168, 1))
    g.fillStyle = ink(150, 40, 30, 0.95); g.fillRect(12, 16, w - 24, 70)
    g.fillStyle = ink(232, 214, 160, 1); g.font = 'bold 28px "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('СЛАВА', w / 2, 38); g.font = 'bold 20px "Arial Black", sans-serif'; g.fillText('ТРУДУ!', w / 2, 68)
    g.fillStyle = ink(150, 40, 30, 0.9); g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5; const r = k % 2 ? 14 : 34; g.lineTo(w / 2 + Math.cos(a) * r, 140 + Math.sin(a) * r) } g.fill()
    g.fillStyle = ink(40, 36, 30, 0.7); for (let k = 0; k < 6; k++) g.fillRect(22, 190 + k * 9, (w - 44) * (0.6 + rand() * 0.4), 4)
    g.filter = 'blur(6px)'; for (let k = 0; k < 6; k++) blot(rand() * w, rand() * h, 30, 40, ink(90, 70, 40, 0.25)); g.filter = 'none'
    g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.moveTo(w, h * 0.55); g.lineTo(w, h); g.lineTo(w * 0.55, h); g.closePath(); g.fill(); g.restore()
  })
  cell(R.notice, (w, h) => {
    paper(w, h, ink(222, 218, 204, 1))
    g.fillStyle = ink(30, 30, 30, 0.85); g.font = 'bold 15px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.fillText('ОБЪЯВЛЕНИЕ', w / 2, 30)
    for (let k = 0; k < 9; k++) g.fillRect(16, 46 + k * 11, (w - 32) * (0.5 + rand() * 0.5), 3)
    for (let k = 0; k < 8; k++) if (rand() > 0.35) { g.fillStyle = ink(222, 218, 204, 1); g.fillRect(8 + k * 18, 160, 14, 56); g.fillStyle = ink(30, 30, 30, 0.6); g.fillRect(14 + k * 18, 166, 2, 44) }
    g.filter = 'blur(5px)'; blot(w * 0.3, h * 0.2, 40, 60, ink(110, 90, 50, 0.2)); g.filter = 'none'
  })
  cell(R.danger, (w, h) => stencil('ОПАСНО', w, h, 30, ink(160, 34, 24, 0.9)))
  cell(R.exit, (w, h) => { stencil('ВЫХОД', w, h * 0.75, 32, ink(226, 220, 204, 0.9)); g.fillStyle = ink(226, 220, 204, 0.9); g.fillRect(36, 92, 70, 10); g.beginPath(); g.moveTo(106, 80); g.lineTo(128, 97); g.lineTo(106, 114); g.fill() })
  const plate = (number: string) => (w: number, h: number) => {
    g.fillStyle = ink(36, 64, 112, 1); g.beginPath(); g.roundRect(6, 14, w - 12, h - 28, 10); g.fill()
    g.strokeStyle = ink(220, 220, 214, 1); g.lineWidth = 3; g.beginPath(); g.roundRect(12, 20, w - 24, h - 40, 6); g.stroke()
    g.fillStyle = ink(232, 230, 222, 1); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 9px "Helvetica Neue", Arial, sans-serif'; g.fillText('УЛ. ГАГАРИНА', w / 2, 32); g.font = 'bold 58px "Arial Black", sans-serif'; g.fillText(number, w / 2, 72)
    speck(60, w, h, () => ink(200, 196, 180, 0.7), [1, 4]); g.filter = 'blur(6px)'; blot(w * 0.7, h * 0.8, 40, 20, ink(70, 50, 30, 0.4)); g.filter = 'none'
  }
  cell(R.plate14, plate('14'))
  cell(R.plate16, plate('16'))
  for (let index = 0; index < 8; index++) cell(garageNumber(index), (w, h) => spray(`№ ${31 + index}`, w, h, 36, ink(224, 218, 200, 0.85), undefined, (rand() - 0.5) * 0.12))
  cell(R.arrow, (w, h) => { g.save(); g.translate(w / 2, h / 2); g.rotate(-0.1); g.shadowColor = ink(230, 120, 30, 1); g.shadowBlur = 6; g.fillStyle = ink(230, 120, 30, 0.9); g.fillRect(-46, -8, 60, 16); g.beginPath(); g.moveTo(10, -26); g.lineTo(48, 0); g.lineTo(10, 26); g.fill(); g.restore() })
  cell(R.oil, (w, h) => { g.filter = 'blur(5px)'; for (let k = 0; k < 9; k++) { blob(w / 2 + (rand() - 0.5) * 50, h / 2 + (rand() - 0.5) * 50, 14 + rand() * 22, 0.4); g.fillStyle = ink(14, 13, 11, 0.4); g.fill() } g.filter = 'none' })
  cell(R.sign, (w, h) => { g.fillStyle = ink(30, 58, 104, 1); g.fillRect(4, 8, w - 8, h - 16); g.strokeStyle = ink(220, 220, 214, 1); g.lineWidth = 2; g.strokeRect(9, 13, w - 18, h - 26); g.fillStyle = ink(232, 230, 222, 1); g.font = 'bold 19px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ПОДЪЕЗД 2   КВ. 21–40', w / 2, h / 2 + 1); speck(80, w, h, () => ink(190, 186, 170, 0.8), [1, 3]) })
  for (const [region, digit] of [[R.one, '1'], [R.two, '2'], [R.three, '3']] as const) cell(region, (w, h) => stencil(digit, w, h, 50, ink(120, 40, 30, 0.9)))
  cell(R.beam, (w, h) => { const image = g.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const across = Math.exp(-Math.pow((x + 0.5 - w / 2) / (w * 0.3), 2)); const along = Math.pow(1 - y / h, 1.4) * Math.min(1, y / 6 + 0.3); image.data.set([255, 248, 228, Math.round(255 * across * along * 0.55)], (y * w + x) * 4) } g.putImageData(image, R.beam[0], R.beam[1]) })
  cell(R.window, (w, h) => { const gradient = g.createLinearGradient(0, 0, 0, h); gradient.addColorStop(0, ink(236, 236, 226, 1)); gradient.addColorStop(1, ink(196, 202, 190, 1)); g.fillStyle = gradient; g.fillRect(6, 6, w - 12, h - 12); g.fillStyle = ink(0, 0, 0, 0.75); for (let k = 0; k < 5; k++) { g.beginPath(); const x = rand() * w; const y = rand() * h; g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 50, y + 20 + rand() * 30); g.lineTo(x + (rand() - 0.5) * 40, y + rand() * 10); g.fill() } })
  cell(R.band, (w, h) => {
    g.fillStyle = ink(70, 102, 98, 1); g.beginPath(); g.moveTo(0, h); let y = 22
    for (let x = 0; x <= w; x += 6) { y = Math.max(12, Math.min(34, y + (rand() - 0.5) * 7)); g.lineTo(x, y) }
    g.lineTo(w, h); g.closePath(); g.fill()
    g.fillStyle = ink(48, 66, 62, 0.9); g.fillRect(0, 36, w, 3)
    g.save(); g.globalCompositeOperation = 'destination-out'
    for (let k = 0; k < 18; k++) { blob(rand() * w, 30 + Math.pow(rand(), 2) * (h - 40), 4 + rand() * 12, 0.5, 8); g.fillStyle = ink(0, 0, 0, 1); g.fill() }
    g.restore()
    const gradient = g.createLinearGradient(0, h * 0.5, 0, h); gradient.addColorStop(0, ink(30, 28, 20, 0)); gradient.addColorStop(1, ink(30, 28, 20, 0.45)); g.fillStyle = gradient; g.globalCompositeOperation = 'source-atop'; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over'
    speck(300, w, h, () => ink(200, 200, 190, 0.25), [1, 2])
  })
  cell(R.grime, (w, h) => { const gradient = g.createLinearGradient(0, 0, 0, h); gradient.addColorStop(0, ink(34, 32, 22, 0)); gradient.addColorStop(0.65, ink(34, 32, 22, 0.35)); gradient.addColorStop(1, ink(30, 30, 20, 0.7)); g.fillStyle = gradient; g.fillRect(0, 0, w, h); g.filter = 'blur(4px)'; for (let k = 0; k < 10; k++) blot(rand() * w, h - rand() * 30, 20 + rand() * 30, 12, ink(54, 66, 34, 0.45)); g.filter = 'none'; erase(500, w, h, [1, 4]) })
  cell(R.tracks, (w, h) => { for (const band of [10, 38]) for (let x = 0; x < w; x += 7) { g.fillStyle = ink(26, 22, 18, 0.22 + rand() * 0.2); g.fillRect(x, band + rand() * 2, 4, 14) } g.filter = 'blur(1.5px)'; g.drawImage(canvas, R.tracks[0], R.tracks[1], w, h, 0, 0, w, h); g.filter = 'none' })
  cell(R.dirt, (w, h) => { g.filter = 'blur(6px)'; for (let k = 0; k < 7; k++) { blob(w / 2 + (rand() - 0.5) * 40, h / 2 + (rand() - 0.5) * 40, 22 + rand() * 18, 0.4); g.fillStyle = ink(70, 58, 40, 0.32); g.fill() } g.filter = 'none'; for (let k = 0; k < 260; k++) { const a = rand() * Math.PI * 2; const r = Math.sqrt(rand()) * 50; g.fillStyle = ink(rand() > 0.5 ? 50 : 120, rand() > 0.5 ? 44 : 104, 30, 0.5); g.fillRect(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, 2, 2) } })
  cell(R.gravel, (w, h) => { g.filter = 'blur(5px)'; blot(w / 2, h / 2, 54, 54, ink(60, 56, 48, 0.4)); g.filter = 'none'; for (let k = 0; k < 420; k++) { const a = rand() * Math.PI * 2; const r = Math.pow(rand(), 0.7) * 58; const s = 2 + rand() * 4; const v = 90 + rand() * 90; g.fillStyle = ink(v, v * 0.95, v * 0.85, 0.9); blob(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, s, 0.4, 5); g.fill() } })
  cell(R.litter, (w, h) => {
    for (let k = 0; k < 16; k++) { g.save(); g.translate(10 + rand() * (w - 20), 10 + rand() * (h - 20)); g.rotate(rand() * 6); const kind = rand(); g.fillStyle = kind < 0.45 ? ink(205, 200, 185, 0.92) : kind < 0.6 ? ink(150, 40, 30, 0.9) : kind < 0.8 ? ink(60, 90, 50, 0.85) : ink(120, 110, 90, 0.9); if (kind > 0.6 && kind < 0.8) { g.beginPath(); g.roundRect(-3, -9, 6, 18, 3); g.fill() } else g.fillRect(-6 - rand() * 6, -4 - rand() * 4, 10 + rand() * 10, 7 + rand() * 6); g.restore() }
    speck(40, w, h, () => ink(220, 210, 180, 0.9), [1, 2])
  })
  const grassCell = (w: number, h: number, dry: boolean) => { for (let k = 0; k < 46; k++) { const x0 = w / 2 + (rand() - 0.5) * 50; const height = (0.35 + rand() * 0.6) * h; const lean = (rand() - 0.5) * 70; const shade = rand(); g.strokeStyle = dry ? ink(130 + shade * 40, 118 + shade * 30, 70, 1) : ink(80 + shade * 40, 96 + shade * 30, 46, 1); g.lineWidth = 2 + rand() * 2.5; g.beginPath(); g.moveTo(x0, h); g.quadraticCurveTo(x0 + lean * 0.2, h - height * 0.6, x0 + lean, h - height); g.stroke() } }
  cell(R.weeds, (w, h) => grassCell(w, h, false))
  cell(R.tuft, (w, h) => { grassCell(w, h, true); g.fillStyle = ink(110, 96, 70, 1); for (let k = 0; k < 6; k++) { const x = 20 + rand() * (w - 40); g.fillRect(x, 10 + rand() * 30, 4, 8) } })
  const cloth = (draw: (w: number, h: number) => void) => (w: number, h: number) => { draw(w, h); const gradient = g.createLinearGradient(0, 0, w, 0); for (let k = 0; k <= 6; k++) gradient.addColorStop(k / 6, ink(0, 0, 0, k % 2 ? 0.18 : 0)); g.fillStyle = gradient; g.globalCompositeOperation = 'source-atop'; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over' }
  cell(R.sheet, cloth((w, h) => { g.fillStyle = ink(210, 206, 190, 1); g.beginPath(); g.moveTo(3, 2); g.lineTo(w - 3, 2); g.lineTo(w - 5, h - 8); g.quadraticCurveTo(w / 2, h - 2, 5, h - 10); g.closePath(); g.fill() }))
  cell(R.shirt, cloth((w, h) => { g.fillStyle = ink(84, 104, 132, 1); g.beginPath(); g.moveTo(2, 4); g.lineTo(w - 2, 4); g.lineTo(w - 2, 34); g.lineTo(w - 12, 30); g.lineTo(w - 12, 100); g.lineTo(12, 100); g.lineTo(12, 30); g.lineTo(2, 34); g.closePath(); g.fill() }))
  cell(R.towel, cloth((w, h) => { for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? ink(168, 58, 48, 1) : ink(218, 208, 186, 1); g.fillRect(6, 2 + k * 11, w - 12, 11) } }))
  cell(R.dress, cloth((w, h) => { g.fillStyle = ink(96, 112, 74, 1); g.beginPath(); g.moveTo(18, 2); g.lineTo(w - 18, 2); g.lineTo(w - 14, 40); g.lineTo(w - 2, h - 6); g.lineTo(2, h - 6); g.lineTo(14, 40); g.closePath(); g.fill(); speck(60, w, h, () => ink(220, 200, 120, 0.8), [2, 3]) }))
  cell(R.tarp, (w, h) => { g.fillStyle = ink(66, 84, 96, 1); g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h * 0.7); for (let x = w; x >= 0; x -= 12) g.lineTo(x, h * (0.62 + rand() * 0.36)); g.closePath(); g.fill(); g.fillStyle = ink(24, 26, 26, 1); for (let x = 14; x < w; x += 40) { g.beginPath(); g.arc(x, 10, 4, 0, Math.PI * 2); g.fill() } g.filter = 'blur(6px)'; for (let k = 0; k < 6; k++) blot(rand() * w, rand() * h * 0.7, 40, 14, ink(20, 24, 26, 0.35)); g.filter = 'none' })
  cell(R.boiler, (w, h) => stencil('КОТЕЛЬНАЯ', w, h, 44, ink(214, 208, 190, 0.85)))
  cell(R.moss, (w, h) => { g.filter = 'blur(4px)'; for (let k = 0; k < 14; k++) blot(w / 2 + (rand() - 0.5) * 70, h / 2 + (rand() - 0.5) * 70, 12 + rand() * 20, 10 + rand() * 14, ink(58, 70, 38, 0.5)); g.filter = 'none'; speck(200, w, h, () => ink(80, 92, 50, 0.4), [1, 3]); erase(300, w, h, [1, 3]) })
  cell(R.scorch, (w, h) => { g.filter = 'blur(8px)'; blot(w / 2, h / 2, 56, 50, ink(10, 9, 8, 0.85)); blot(w / 2 + 10, h / 2 - 6, 40, 30, ink(70, 66, 60, 0.3)); g.filter = 'none'; erase(160, w, h, [1, 3]) })

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

const batch = (): Batch => ({ position: [], normal: [], uv: [], sway: [] })
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a))
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

function quad(target: Batch, region: Region, center: Vec3, right: Vec3, up: Vec3, normal: Vec3, flip = false, sway: [number, number] = [0, 0]) {
  const inset = 1.5
  const u0 = (region[0] + inset) / 1024
  const u1 = (region[0] + region[2] - inset) / 1024
  const v0 = 1 - (region[1] + region[3] - inset) / 1024
  const v1 = 1 - (region[1] + inset) / 1024
  for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]] as const) {
    target.position.push(...add(add(center, right, i), up, j))
    target.normal.push(...normal)
    target.uv.push((i < 0) !== flip ? u0 : u1, j < 0 ? v0 : v1)
    target.sway.push(j < 0 ? sway[0] : sway[1])
  }
}

function meshOf(source: Batch, material: THREE.Material, order: number) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.position, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(source.normal, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(source.uv, 2))
  geometry.setAttribute('sway', new THREE.Float32BufferAttribute(source.sway, 1))
  geometry.computeBoundingSphere()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.renderOrder = order
  return mesh
}

export function dress(level: LevelBuilder, context: DressingContext) {
  const { garageRoof, garages, tower, inner, roof, boiler, upper, plant, finishX, slabEnd, dockTop } = context
  const rand = random(29)
  const jitter = (amount: number) => (rand() - 0.5) * amount
  const pick = <T,>(items: readonly T[]) => items[Math.floor(rand() * items.length)]!
  const box = (size: Vec3, material: Mat, at: Vec3, rotate?: number | Vec3, collide = false, shadow = true) => level.box(size, material, { at, rotate, collide, shadow })
  const cyl = (radius: number, height: number, material: Mat, at: Vec3, rotate?: number | Vec3, collide = false, segments = 10) => level.cylinder(radius, height, material, { at, rotate, collide }, segments)
  const solid = (half: Vec3, at: Vec3, yaw = 0) => level.collider({ kind: 'box', half, position: at, rotation: [0, yaw, 0] })
  const frame = (at: Vec3, yaw: number) => { const c = Math.cos(yaw); const s = Math.sin(yaw); return (x: number, y: number, z: number): Vec3 => [at[0] + x * c + z * s, at[1] + y, at[2] - x * s + z * c] }
  const axisOf = (yaw: number, tilt: number): Vec3 => [-Math.sin(tilt) * Math.cos(yaw), Math.cos(tilt), Math.sin(tilt) * Math.sin(yaw)]
  const rod = (from: Vec3, yaw: number, tilt: number, length: number, radius: number, material: Mat, segments = 6) => cyl(radius, length, material, add(from, axisOf(yaw, tilt), length / 2), [0, yaw, tilt], false, segments)

  const decals = batch()
  const foliage = batch()
  const shafts = batch()
  const organic = new Set<Region>([R.stain, R.rust, R.soot, R.crack, R.peel, R.grime, R.moss, R.oil, R.scorch, R.dirt, R.gravel, R.litter])
  const wall = (region: Region, at: Vec3, yaw: number, w: number, h: number, roll = 0, flip = false, target = decals) => {
    const n: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)]
    const r: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)]
    const right = add(scale(r, Math.cos(roll)), [0, Math.sin(roll), 0])
    const up = add([0, Math.cos(roll), 0], r, -Math.sin(roll))
    quad(target, region, add(at, n, 0.012), scale(right, w / 2), scale(up, h / 2), n, flip)
  }
  const mark = (region: Region, at: Vec3, yaw: number, height: number, roll = 0) => wall(region, at, yaw, height * region[2] / region[3], height, roll, organic.has(region) && rand() > 0.5)
  const strip = (region: Region, a: Vec3, b: Vec3, yaw: number, height: number) => { const pieces = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[2] - a[2]) / 4)); for (let k = 0; k < pieces; k++) wall(region, lerp(a, b, (k + 0.5) / pieces), yaw, Math.hypot(b[0] - a[0], b[2] - a[2]) / pieces + 0.04, height, 0, rand() > 0.5) }
  const floor = (region: Region, at: Vec3, w: number, d: number, rot = rand() * 6.28, flip = rand() > 0.5) => quad(decals, region, at, [Math.cos(rot) * w / 2, 0, -Math.sin(rot) * w / 2], [-Math.sin(rot) * d / 2, 0, -Math.cos(rot) * d / 2], [0, 1, 0], flip)
  const ceiling = (region: Region, at: Vec3, w: number, d: number, rot = 0) => quad(decals, region, at, [Math.cos(rot) * w / 2, 0, -Math.sin(rot) * w / 2], [Math.sin(rot) * d / 2, 0, Math.cos(rot) * d / 2], [0, -1, 0])
  const skew = (region: Region, a: Vec3, b: Vec3, height: number, normal: Vec3) => { const up: Vec3 = [0, height / 2, 0]; let right = scale(add(b, a, -1), 0.5); if (dot(cross(right, up), normal) < 0) right = scale(right, -1); quad(decals, region, add(add(scale(add(a, b), 0.5), up), normal, 0.012), right, up, normal, rand() > 0.5) }
  const band = (a: Vec3, b: Vec3, normal: Vec3, height = 1.75) => { const pieces = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[2] - a[2]) / 2)); for (let k = 0; k < pieces; k++) skew(R.band, lerp(a, b, k / pieces), lerp(a, b, (k + 1) / pieces), height, normal) }
  const leaf = (region: Region, center: Vec3, right: Vec3, up: Vec3, normal: Vec3, sway: [number, number], keepNormal = false) => { const flip = rand() > 0.5; quad(foliage, region, center, right, up, normal, flip, sway); quad(foliage, region, center, scale(right, -1), up, keepNormal ? normal : scale(normal, -1), !flip, sway) }
  const tuft = (at: Vec3, size = 0.5 + rand() * 0.5, dry = rand() > 0.55) => { const yaw = rand() * 3; for (const turn of [0, Math.PI / 2]) leaf(dry ? R.tuft : R.weeds, add(at, [0, size * 0.42, 0]), [Math.cos(yaw + turn) * size / 2, 0, -Math.sin(yaw + turn) * size / 2], [0, size * 0.42, 0], [0, 1, 0], [0, 0.05 + size * 0.06], true) }
  const weedsAlong = (a: [number, number], b: [number, number], count: number, y = 0, spread = 0.35) => { for (let k = 0; k < count; k++) { const t = rand(); tuft([a[0] + (b[0] - a[0]) * t + jitter(spread), y, a[1] + (b[1] - a[1]) * t + jitter(spread)]) } }
  const litter = (x: number, z: number, size = 1.2, y = 0.022) => floor(R.litter, [x, y, z], size, size)
  const patch = (region: Region, x: number, z: number, size: number, y = 0.02) => floor(region, [x, y, z], size * (0.8 + rand() * 0.4), size * (0.8 + rand() * 0.4))
  const shaft = (from: Vec3, direction: Vec3, length: number, width: number) => { const d = unit(direction); const side = unit(cross(d, [0, 1, 0])); const other = unit(cross(side, d)); for (const r of [side, other, unit(add(side, other))]) quad(shafts, R.beam, add(from, d, length / 2), scale(r, width / 2), scale(d, -length / 2), unit(cross(r, scale(d, -1)))) }

  const crate = (at: Vec3, yaw: number, size = 1, collide = true) => { const p = frame(at, yaw); box([0.9 * size, 0.6 * size, 0.6 * size], paint, p(0, 0.3 * size, 0), yaw, collide); box([0.96 * size, 0.06 * size, 0.64 * size], wood, p(0, 0.6 * size, 0), yaw, false, false); for (const x of [-0.32, 0.32]) box([0.06 * size, 0.62 * size, 0.64 * size], wood, p(x * size, 0.3 * size, 0), yaw, false, false) }
  const pallet = (at: Vec3, yaw: number) => { const p = frame(at, yaw); for (const z of [-0.36, 0, 0.36]) box([1.2, 0.1, 0.1], wood, p(0, 0.05, z), yaw, false, false); for (const x of [-0.5, -0.17, 0.17, 0.5]) box([0.14, 0.03, 0.82], wood, p(x, 0.115, 0), yaw, false, false) }
  const pallets = (at: Vec3, yaw: number, count: number, collide = true) => { for (let k = 0; k < count; k++) pallet([at[0] + jitter(0.12), at[1] + k * 0.135, at[2] + jitter(0.12)], yaw + jitter(0.18)); level.contact(1.3, 0.9, [at[0], at[2]], yaw); if (collide) solid([0.6, count * 0.0675, 0.42], [at[0], at[1] + count * 0.0675, at[2]], yaw) }
  const tyre = (at: Vec3, standing = false, yaw = rand() * 3) => standing ? cyl(0.33, 0.22, rubber, [at[0], at[1] + 0.33, at[2]], [Math.PI / 2, 0, yaw], false, 12) : cyl(0.33, 0.22, rubber, [at[0], at[1] + 0.11, at[2]], undefined, false, 12)
  const tyres = (at: Vec3, count: number, collide = true) => { for (let k = 0; k < count; k++) cyl(0.33, 0.21, rubber, [at[0] + jitter(0.1), at[1] + 0.105 + k * 0.21, at[2] + jitter(0.1)], undefined, false, 12); if (collide) level.collider({ kind: 'cylinder', halfHeight: count * 0.105, radius: 0.34, position: [at[0], at[1] + count * 0.105, at[2]], rotation: [0, 0, 0] }) }
  const barrel = (at: Vec3, material = drum, tipped = false, yaw = rand() * 3, collide = true) => tipped ? cyl(0.29, 0.88, material, [at[0], at[1] + 0.29, at[2]], [Math.PI / 2, 0, yaw], collide, 12) : cyl(0.29, 0.88, material, [at[0], at[1] + 0.44, at[2]], undefined, collide, 12)
  const bottles = (at: Vec3, count: number, fallen = true) => { for (let k = 0; k < count; k++) { const x = at[0] + (k % 2) * 0.26 + jitter(0.05); const z = at[2] + Math.floor(k / 2) * 0.26 + jitter(0.05); cyl(0.12, 1.3, k % 3 === 2 ? paint : red, [x, at[1] + 0.65, z], undefined, false, 10); cyl(0.05, 0.14, metal, [x, at[1] + 1.37, z], undefined, false, 6) } if (fallen) cyl(0.12, 1.3, red, [at[0] + 0.9, at[1] + 0.12, at[2] + 0.2], [Math.PI / 2, 0, 1.2 + jitter(0.5)], false, 10) }
  const spool = (at: Vec3, yaw: number, lying = false) => { if (lying) { for (const y of [0.04, 0.66]) cyl(0.62, 0.07, wood, [at[0], at[1] + y, at[2]], undefined, false, 14); cyl(0.44, 0.56, rubber, [at[0], at[1] + 0.35, at[2]], undefined, true, 12); return } const axis: Vec3 = [-Math.sin(yaw), 0, Math.cos(yaw)]; const center: Vec3 = [at[0], at[1] + 0.62, at[2]]; for (const s of [-0.32, 0.32]) cyl(0.62, 0.07, wood, add(center, axis, s), [Math.PI / 2, 0, yaw], false, 14); cyl(0.44, 0.58, rubber, center, [Math.PI / 2, 0, yaw], true, 12); level.contact(1.3, 0.8, [at[0], at[2]], yaw) }
  const rubble = (at: Vec3, radius: number, count: number, collide = true, mats: Mat[] = [cast, stained, brick, slab, rubbleMat]) => {
    box([radius * 1.3, radius * 0.45, radius * 1.1], rubbleMat, [at[0], at[1] + radius * 0.12, at[2]], [jitter(0.2), rand() * 3, jitter(0.2)], collide)
    for (let k = 0; k < count; k++) { const a = rand() * 6.28; const d = Math.sqrt(rand()) * radius; const s = 0.18 + rand() * 0.5 * (1 - d / radius / 1.5); box([s * 1.5, s * 0.7, s], pick(mats), [at[0] + Math.cos(a) * d, at[1] + s * 0.3 + (1 - d / radius) * radius * 0.18, at[2] + Math.sin(a) * d], [jitter(0.9), rand() * 3, jitter(0.9)], false, k % 3 === 0) }
    for (let k = 0; k < 3; k++) rod([at[0] + jitter(radius), at[1] + 0.1, at[2] + jitter(radius)], rand() * 6.28, 0.3 + rand() * 0.6, 0.8 + rand() * 0.9, 0.014, drum, 4)
    patch(R.gravel, at[0], at[2], radius * 2.8, at[1] + 0.021)
  }
  const brokenSlab = (at: Vec3, yaw: number, tilt: number, length = 2.4) => { const p = frame(at, yaw); box([length, 0.22, 1.2], slab, p(0, Math.sin(tilt) * length / 2 + 0.1, 0), [0, yaw, tilt], false); for (let k = 0; k < 4; k++) rod(p(length / 2 * Math.cos(tilt) - 0.05, Math.sin(tilt) * length + 0.05, -0.45 + k * 0.3), yaw + jitter(0.6), -1.1 + jitter(0.7), 0.4 + rand() * 0.5, 0.012, drum, 4) }
  const poles = (at: Vec3, yaw: number, count: number, length = 4.0) => { const along: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)]; for (let k = 0; k < count; k++) rod(add([at[0], at[1], at[2]], along, (k - count / 2) * 0.16 + jitter(0.06)), yaw + jitter(0.12), 0.2 + rand() * 0.08, length + jitter(0.6), 0.03, metal, 6) }
  const bags = (at: Vec3, count: number, radius = 0.7) => { for (let k = 0; k < count; k++) { const a = rand() * 6.28; const d = Math.sqrt(rand()) * radius; const s = 0.22 + rand() * 0.1; cyl(s, s * 1.5, rubber, [at[0] + Math.cos(a) * d, at[1] + s * 0.7, at[2] + Math.sin(a) * d], [jitter(0.5), rand() * 3, jitter(0.5)], false, 6) } if (at[1] < 0.1) level.contact(radius * 2, radius * 2, [at[0], at[2]]); litter(at[0], at[2], radius * 2.4, at[1] + 0.022) }
  const sandbags = (at: Vec3, yaw: number, length: number, rows: number) => { const p = frame(at, yaw); const count = Math.round(length / 0.56); for (let row = 0; row < rows; row++) for (let k = 0; k < count - (row % 2); k++) box([0.54, 0.17, 0.34], stained, p(-length / 2 + 0.28 + k * 0.56 + (row % 2) * 0.28 + jitter(0.04), 0.085 + row * 0.16, jitter(0.05)), [jitter(0.06), yaw + jitter(0.12), jitter(0.06)], false, row === 0); solid([length / 2, rows * 0.08, 0.18], p(0, rows * 0.08, 0), yaw) }
  const mattress = (at: Vec3, yaw: number, tilt = 0) => { const p = frame(at, yaw); const y = tilt ? Math.sin(tilt) * 0.95 + 0.06 : 0.085; box([1.9, 0.17, 0.86], stained, p(0, y, 0), [0, yaw, tilt], false); box([0.5, 0.02, 0.4], rust, p(0.3 * Math.cos(tilt) - 0.09 * Math.sin(tilt), y + 0.3 * Math.sin(tilt) + 0.09 * Math.cos(tilt), 0.1), [0, yaw, tilt], false, false) }
  const fridge = (at: Vec3, yaw: number) => { const p = frame(at, yaw); box([1.5, 0.62, 0.6], stained, p(0, 0.31, 0), yaw, true); box([0.06, 0.04, 0.3], metal, p(0.4, 0.64, 0.12), yaw, false, false) }
  const bedframe = (at: Vec3, yaw: number) => { const p = frame(at, yaw); for (const z of [-0.42, 0.42]) box([1.9, 0.05, 0.05], rust, p(0, 0.38, z), yaw); for (const x of [-0.95, 0.95]) { box([0.05, 0.8, 0.05], rust, p(x, 0.4, -0.43), yaw, false, false); box([0.05, 0.8, 0.05], rust, p(x, 0.4, 0.43), yaw, false, false); box([0.04, 0.04, 0.9], rust, p(x, 0.78, 0), yaw, false, false); for (let k = 0; k < 5; k++) box([0.025, 0.7, 0.025], rust, p(x, 0.4, -0.3 + k * 0.15), yaw, false, false) } level.contact(2.0, 1.0, [at[0], at[2]], yaw) }
  const trolley = (at: Vec3, yaw: number) => { const p = frame(at, yaw); box([0.9, 0.03, 0.55], metal, p(0, 0.45, 0), yaw); for (const z of [-0.27, 0.27]) box([0.9, 0.5, 0.02], metal, p(0, 0.7, z), yaw, false, false); for (const x of [-0.45, 0.45]) box([0.02, 0.5, 0.55], metal, p(x, 0.7, 0), yaw, false, false); box([0.03, 0.03, 0.6], metal, p(-0.58, 1.02, 0), yaw, false, false); for (const [x, z] of [[-0.4, -0.22], [-0.4, 0.22], [0.4, -0.22], [0.4, 0.22]] as const) box([0.03, 0.42, 0.03], metal, p(x, 0.22, z), yaw, false, false); level.contact(1.0, 0.6, [at[0], at[2]], yaw) }
  const bench = (at: Vec3, yaw: number) => { const p = frame(at, yaw); for (const x of [-0.7, 0.7]) box([0.14, 0.45, 0.5], cast, p(x, 0.225, 0), yaw, true); for (const z of [-0.15, 0, 0.15]) box([1.9, 0.05, 0.12], wood, p(0, 0.47, z), yaw, false, false); for (const y of [0.7, 0.86]) box([1.9, 0.12, 0.04], wood, p(0, y, 0.24), yaw, false, false); for (const x of [-0.7, 0.7]) box([0.06, 0.5, 0.06], iron, p(x, 0.7, 0.22), yaw, false, false) }
  const laundry = (a: [number, number], b: [number, number], height = 2.1, base = 0) => {
    const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0])
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)]
    for (const end of [a, b]) { cyl(0.045, height + 0.15, rust, [end[0], base + (height + 0.15) / 2, end[1]], undefined, false, 6); box([0.04, 0.04, 1.2], rust, [end[0], base + height + 0.1, end[1]], yaw, false, false) }
    for (const side of [-0.45, 0.45]) {
      box([length, 0.012, 0.012], iron, [(a[0] + b[0]) / 2 + n[0] * side, base + height, (a[1] + b[1]) / 2 + n[2] * side], yaw, false, false)
      let t = 0.06 + rand() * 0.1
      while (t < 0.9) { const region = pick([R.sheet, R.shirt, R.towel, R.dress, R.sheet]); const w = region === R.sheet ? 0.8 + rand() * 0.4 : 0.42 + rand() * 0.15; const h = region === R.sheet ? 1.0 + rand() * 0.3 : w * 1.6; const s = t + w / length / 2; if (s + w / length / 2 > 0.96) break; const center: Vec3 = [a[0] + (b[0] - a[0]) * s + n[0] * side, base + height - 0.02 - h / 2, a[1] + (b[1] - a[1]) * s + n[2] * side]; leaf(region, center, [Math.cos(yaw) * w / 2, 0, -Math.sin(yaw) * w / 2], [0, h / 2, 0], n, [0.06 + h * 0.08, 0]); t += w / length + 0.03 + rand() * 0.1 }
    }
  }
  const dish = (at: Vec3, yaw: number) => { const p = frame(at, yaw); box([0.12, 0.75, 0.12], metal, p(0, 0.375, 0), yaw); box([0.5, 0.04, 0.04], metal, p(-0.25, 0.95, 0), [0, yaw, 0.35], false, false); cyl(0.48, 0.05, pale, p(0.02, 0.92, 0), [0, yaw, 1.0], false, 14); box([0.14, 0.1, 0.1], iron, p(-0.48, 1.04, 0), yaw, false, false) }
  const antenna = (at: Vec3, height: number, yaw = rand() * 3) => { cyl(0.025, height, metal, [at[0], at[1] + height / 2, at[2]], undefined, false, 5); for (let tier = 0; tier < 2; tier++) { const y = at[1] + height - 0.1 - tier * 0.7; box([0.02, 0.02, 1.4], metal, [at[0], y, at[2]], yaw, false, false); for (let k = 0; k < 5; k++) { const along = -0.6 + k * 0.3; box([0.9 - k * 0.1, 0.012, 0.012], metal, [at[0] + Math.sin(yaw) * along, y, at[2] + Math.cos(yaw) * along], yaw, false, false) } } }
  const vent = (at: Vec3, kind: 'mushroom' | 'box', collide = true) => { if (kind === 'mushroom') { cyl(0.18, 0.7, metal, [at[0], at[1] + 0.35, at[2]], undefined, collide, 10); cyl(0.36, 0.08, metal, [at[0], at[1] + 0.78, at[2]], undefined, false, 10); cyl(0.2, 0.12, iron, [at[0], at[1] + 0.68, at[2]], undefined, false, 10) } else { const yaw = rand() * 0.3; const p = frame(at, yaw); box([0.8, 0.55, 0.8], metal, p(0, 0.275, 0), yaw, collide); box([0.95, 0.08, 0.95], iron, p(0, 0.62, 0), yaw, false, false); for (let k = 0; k < 3; k++) box([0.82, 0.03, 0.02], iron, p(0, 0.15 + k * 0.12, 0.41), yaw, false, false) } }
  const radiator = (at: Vec3, yaw: number, sections: number) => { const p = frame(at, yaw); for (let k = 0; k < sections; k++) box([0.065, 0.56, 0.12], paint, p(-sections * 0.0425 + k * 0.085, 0.28, 0), yaw, false, false); for (const y of [0.04, 0.52]) box([sections * 0.085 + 0.1, 0.04, 0.04], metal, p(0, y, -0.02), yaw, false, false); box([0.04, 0.9, 0.04], metal, p(sections * 0.0425 + 0.12, 0.6, -0.04), yaw, false, false) }
  const pipe = (from: Vec3, to: Vec3, radius: number, material: Mat, brackets = 0, collide = false) => {
    const d = add(to, from, -1)
    const yaw = Math.atan2(-d[2], d[0])
    const pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]))
    cyl(radius, Math.hypot(...d), material, scale(add(from, to), 0.5), [0, yaw, -Math.PI / 2 + pitch], collide, 10)
    for (let k = 1; k <= brackets; k++) { const at = add(from, d, k / (brackets + 1)); box([0.08, radius * 2 + 0.1, radius * 2 + 0.16], iron, at, yaw, false, false); cyl(radius * 1.25, 0.06, metal, at, [0, yaw, -Math.PI / 2 + pitch], false, 10) }
  }

  const fence = (points: [number, number][], styles: Style[], inward: 1 | -1) => points.slice(1).forEach((b, index) => {
    const a = points[index]!
    const style = styles[index % styles.length]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const length = Math.hypot(dx, dz)
    const yaw = Math.atan2(-dz, dx)
    const n: Vec3 = [Math.sin(yaw) * inward, 0, Math.cos(yaw) * inward]
    const face = Math.atan2(n[0], n[2])
    const at = (t: number, off = 0, y = 0): Vec3 => [a[0] + dx * t + n[0] * off, y, a[1] + dz * t + n[2] * off]
    solid([length / 2 + 0.3, 5, 0.3], [(a[0] + b[0]) / 2, 5, (a[1] + b[1]) / 2], yaw)
    if (style === 'panel') {
      const count = Math.max(1, Math.round(length / 4))
      const w = length / count
      for (let k = 0; k <= count; k++) box([0.34, 2.75, 0.34], cast, at(k / count, 0, 1.375), yaw)
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) / count
        const broken = rand() < 0.22
        const h = broken ? 1.9 + rand() * 0.3 : 2.35 + rand() * 0.2
        box([w - 0.08, h, 0.16], slab, at(t, 0, h / 2 + 0.05), [0, yaw + jitter(0.02), jitter(0.02)])
        if (broken) box([w * (0.3 + rand() * 0.3), 0.5, 0.16], slab, at(t + jitter(0.3) / count, 0, h + 0.2), [0, yaw, jitter(0.5)], false, false)
        for (const y of [0.75, 1.6]) if (y < h - 0.2) box([w - 0.5, 0.12, 0.06], slab, at(t, 0.1, y), yaw, false, false)
        if (rand() < 0.55) mark(pick([R.stain, R.rust, R.moss, R.crack, R.tsoi, R.poster]), at(t + jitter(0.4) / count, 0.13, 1.3), face, pick([1.6, 1.4, 0.5, 1.2]), jitter(0.05))
      }
    } else if (style === 'hoarding') {
      const count = Math.ceil(length / 1.05)
      for (let k = 0; k < count; k++) { const h = 2.35 + rand() * 0.35; box([1.12, h, 0.06], k % 3 === 2 ? sheetDark : sheet, at((k + 0.5) / count, jitter(0.06), h / 2), [jitter(0.03), yaw + jitter(0.04), jitter(0.03)], false, k % 4 === 0) }
      for (let k = 0; k <= Math.ceil(length / 3); k++) box([0.14, 2.6, 0.14], wood, at(k / Math.ceil(length / 3), -0.12, 1.3), yaw, false, false)
      for (const y of [0.5, 2.0]) box([length, 0.1, 0.08], wood, at(0.5, -0.12, y), yaw, false, false)
      for (let k = 0; k < length / 5; k++) { const region = pick([R.rust, R.poster, R.tag3, R.stain, R.notice, R.tag]); mark(region, at(0.05 + rand() * 0.9, 0.08, 1.4 + jitter(0.3)), face, region === R.tag3 || region === R.tag ? 0.42 : region === R.notice ? 0.5 : region === R.poster ? 0.78 : 1.7, jitter(0.06)) }
    } else {
      let t = 0
      while (t < 1) { const w = Math.min(1 - t, (1.2 + rand() * 1.4) / length); const h = 2.5 + rand() * 1.9; box([w * length + 0.02, h, 0.44], brick, at(t + w / 2, 0, h / 2), yaw); if (rand() < 0.35) box([w * length * 0.6, 0.4, 0.44], brick, at(t + w / 2, 0, h + 0.15), [0, yaw, jitter(0.6)], false, false); t += w }
      for (let k = 0; k < length / 5; k++) { const region = pick([R.soot, R.stain, R.crack, R.tag, R.grime, R.moss]); mark(region, at(0.05 + rand() * 0.9, 0.23, 1.4), face, region === R.tag ? 0.5 : 1.6) }
      rubble(at(0.2 + rand() * 0.6, 1.2), 0.9, 6, false)
    }
    strip(R.grime, at(0, style === 'ruin' ? 0.23 : 0.09, 0.42), at(1, style === 'ruin' ? 0.23 : 0.09, 0.42), face, 0.85)
    weedsAlong([a[0] + n[0] * 0.35, a[1] + n[2] * 0.35], [b[0] + n[0] * 0.35, b[1] + n[2] * 0.35], Math.round(length / 1.4))
    for (let k = 0; k < length / 8; k++) { const t = rand(); patch(pick([R.dirt, R.dirt, R.gravel, R.moss, R.litter]), a[0] + dx * t + n[0] * 0.9, a[1] + dz * t + n[2] * 0.9, 1.4 + rand()) }
  })

  fence([[10, 12.8], [31, 13], [46, 12.6], [61, 13.2], [77, 12.8], [92, 13], [110, 12.6], [126, 13.2], [145, 13.6], [164, 13.2]], ['panel', 'hoarding', 'panel', 'ruin', 'panel', 'hoarding', 'ruin', 'panel', 'hoarding'], -1)
  fence([[10, -12.8], [33, -13.4], [61, -14.2], [63, -21], [92, -21.4], [124, -21], [128, -17.6], [164, -17.8]], ['panel', 'ruin', 'panel', 'hoarding', 'panel', 'ruin', 'panel'], 1)
  fence([[-2, -6.5], [-8, -7], [-8.5, 6.5], [-2, 6.8]], ['ruin', 'panel', 'ruin'], -1)
  fence([[finishX + 12, -6], [finishX + 18, -6.5], [finishX + 18.5, 4.5], [finishX + 12, 4.4]], ['hoarding', 'panel', 'hoarding'], 1)

  waterTower(level, [52, 0, -32])
  const shell = (at: Vec3, w: number, d: number, storeys: number, yaw: number) => { const p = frame(at, yaw); for (const [x, z, len, along] of [[0, -d / 2, w, true], [0, d / 2, w, true], [-w / 2, 0, d, false], [w / 2, 0, d, false]] as const) { const bays = Math.round(len / 3); for (let k = 0; k < bays; k++) { const offset = -len / 2 + (k + 0.5) * len / bays; const h = storeys * 3.2 * (k % 3 === 2 ? 0.55 + rand() * 0.3 : 0.85 + rand() * 0.15); box(along ? [len / bays - 1.4, h, 0.4] : [0.4, h, len / bays - 1.4], brick, along ? p(x + offset, h / 2, z) : p(x, h / 2, z + offset), yaw, false, false); box(along ? [0.7, storeys * 3.2, 0.5] : [0.5, storeys * 3.2, 0.7], brick, along ? p(x + offset + len / bays / 2, storeys * 1.6, z) : p(x, storeys * 1.6, z + offset + len / bays / 2), yaw, false, false) } } for (let s = 1; s < storeys; s++) box([w * (0.5 + rand() * 0.5), 0.3, d * 0.9], slab, p(jitter(w * 0.3), s * 3.2, 0), [jitter(0.08), yaw, jitter(0.12)], false, false) }
  shell([22, 0, -28], 16, 9, 3, 0.1)
  shell([150, 0, 30], 18, 10, 4, -0.2)
  const skeleton = (at: Vec3, nx: number, nz: number, storeys: number) => { for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) { const h = storeys * 3.3 * (i === nx - 1 && k === 0 ? 0.5 : 1); box([0.45, h, 0.45], cast, [at[0] + i * 6, h / 2, at[2] + k * 6], 0, false, false) } for (let s = 1; s <= storeys; s++) for (let i = 0; i < nx - 1 - (s === storeys ? 1 : 0); i++) box([6.4, 0.3, (nz - 1) * 6 + 0.6], slab, [at[0] + i * 6 + 3, s * 3.3, at[2] + (nz - 1) * 3], [0, 0, i === nx - 2 && s === storeys - 1 ? 0.18 : 0], false, false) }
  skeleton([112, 0, 24], 4, 2, 4)
  skeleton([-22, 0, 16], 3, 2, 3)
  const crane = (at: Vec3, height: number, yaw: number) => { for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]] as const) box([0.16, height, 0.16], rust, [at[0] + x, height / 2, at[2] + z], 0, false, false); for (let y = 2; y < height; y += 2.4) { box([1.7, 0.08, 0.08], rust, [at[0], y, at[2] - 0.8], 0, false, false); box([0.08, 0.08, 1.7], rust, [at[0] - 0.8, y, at[2]], 0, false, false); box([2.2, 0.06, 0.06], rust, [at[0], y + 1.2, at[2] + 0.8], [0, 0, 0.8], false, false) } const p = frame([at[0], height, at[2]], yaw); box([34, 1.0, 1.0], rust, p(9, 0.6, 0), yaw, false, false); box([2.4, 2.4, 2.2], iron, p(-6, 0.4, 0), yaw, false, false); box([2.2, 3.4, 0.2], rust, p(0, 2.2, 0), [0, yaw, 0.1], false, false); cyl(0.03, 9, iron, p(18, -4, 0), undefined, false, 4) }
  crane([140, 0, -40], 32, 0.4)
  crane([18, 0, 40], 28, 2.5)

  context.lights.push({ kind: 'sodium', at: [53, 2.28, -2.2], color: '#ffb35c', intensity: 7, distance: 12 })
  context.emitters.push({ kind: 'buzz', at: [53, 2.28, -2.2] })
  box([0.36, 0.12, 0.42], iron, [53, 2.42, -2.38], 0, false, false)
  context.lights.push({ kind: 'fire', at: [134, 1.25, 7.2], color: '#ff8a3a', intensity: 13, distance: 11 })
  context.emitters.push({ kind: 'fire', at: [134, 1.0, 7.2] })
  barrel([134, 0, 7.2], red, false, 0, true)
  const shedDoor = dockTop[0] + 3.5 - 5
  context.lights.push({ kind: 'tube', at: [shedDoor - 0.2, 3.3, -11.5], color: '#d9f0e6', intensity: 5, distance: 8 })
  context.emitters.push({ kind: 'buzz', at: [shedDoor - 0.2, 3.3, -11.5] })
  box([0.14, 0.06, 1.25], iron, [shedDoor - 0.2, 3.36, -11.5], 0, false, false)
  solid([6, 2.25, 3], [80, 2.25, -16], 0.03)
  solid([5, 2.5, 3.5], [dockTop[0] + 3.5, 2.5, -11.5])

  const doorway = (x: number, z: number, facing: number) => { const n: Vec3 = [Math.sin(facing), 0, Math.cos(facing)]; const r: Vec3 = [Math.cos(facing), 0, -Math.sin(facing)]; box([1.3, 2.15, 0.1], iron, [x + n[0] * 0.04, 1.075, z + n[2] * 0.04], facing, false, false); box([2.0, 0.14, 1.5], cast, [x + n[0] * 0.75, 2.55, z + n[2] * 0.75], facing, false, false); box([1.8, 0.16, 1.0], cast, [x + n[0] * 0.5, 0.08, z + n[2] * 0.5], facing, false, false); wall(R.sign, [x, 2.82, z], facing, 0.95, 0.24); mark(R.notice, add([x, 1.5, z], r, 0.95), facing, 0.5, jitter(0.1)); mark(R.poster, add([x, 1.5, z], r, -1.05), facing, 0.75, jitter(0.08)) }

  doorway(10, -7.6, Math.PI / 2)
  doorway(10, 7.6, Math.PI / 2)
  box([0.05, 1.3, 1.45], wood, [10.06, 1.6, -4.0], Math.PI / 2, false, false)
  for (let k = 0; k < 6; k++) box([0.03, 1.3, 0.03], iron, [10.1, 1.6, 3.4 + k * 0.24], 0, false, false)
  wall(R.plate14, [10, 4.05, 0], Math.PI / 2, 0.7, 0.7)
  mark(R.stain, [10, 2.8, -1.6], Math.PI / 2, 1.8)
  mark(R.crack, [10, 1.3, 5.6], Math.PI / 2, 1.3)
  mark(R.tag, [10, 1.2, 9.0], Math.PI / 2, 0.45, 0.03)
  strip(R.grime, [10, 0.45, -9.5], [10, 0.45, -2.2], Math.PI / 2, 0.9)
  strip(R.grime, [10, 0.45, 2.2], [10, 0.45, 9.5], Math.PI / 2, 0.9)
  for (const side of [-1, 1]) {
    const facing = side < 0 ? 0 : Math.PI
    const z = side * 2.2
    strip(R.grime, [-2, 0.45, z], [10, 0.45, z], facing, 0.9)
    mark(R.stain, [side < 0 ? 1.2 : 7.6, 2.0, z], facing, 2.2)
    mark(R.peel, [side < 0 ? 6.2 : 2.4, 1.7, z], facing, 1.4)
  }
  mark(R.tsoi, [3.6, 1.55, -2.2], 0, 0.6, 0.02)
  mark(R.poster, [7.6, 1.5, 2.2], Math.PI, 0.8, -0.03)
  mark(R.notice, [6.8, 1.45, 2.2], Math.PI, 0.52, 0.05)
  mark(R.arrow, [8.8, 1.3, -2.2], 0, 0.6)
  ceiling(R.soot, [9.3, 3.08, 0], 2.2, 2.6, Math.PI / 2)
  ceiling(R.stain, [3.5, 3.08, 0.4], 1.6, 3.0, Math.PI / 2)
  pipe([-2, 2.85, 1.85], [10, 2.85, 1.85], 0.09, rust, 3)
  bags([-1.3, 0, 1.6], 3, 0.4)
  litter(2, 1.2, 1.4); litter(6.2, -1.1, 1.1)
  bags([-5.6, 0, -5.4], 5, 0.8)
  mattress([-7.6, 0, 2.4], Math.PI, 1.15)
  pallets([-6.6, 0, 5.4], 0.3, 3, false)
  tyres([-3.4, 0, 5.8], 3, false)
  brokenSlab([-5.6, 0, -2.2], 1.4, 0.3)
  mark(R.tag3, [-2, 1.4, 4.4], -Math.PI / 2, 0.34)
  mark(R.soot, [-2, 2.6, -4.5], -Math.PI / 2, 2.4)

  level.plane(1.6, 7, apron, { at: [10.8, 0.016, -6] })
  level.plane(1.6, 7, apron, { at: [10.8, 0.016, 6] })
  for (const z of [-6, 6]) box([0.22, 0.14, 7], trim, [11.7, 0.07, z], 0, false, false)
  bench([11.9, 0, -5.4], -Math.PI / 2)
  bench([11.9, 0, 5.2], -Math.PI / 2)
  litter(12.4, -5.2, 1.6); litter(12.5, 5.4, 1.4)
  bags([11.4, 0, 8.7], 5, 0.7)
  trolley([13.6, 0, 8.4], 0.5)
  tyre([14.3, 0, 7.5], true, 0.3)
  laundry([13.2, -3.4], [13.2, -9.0])
  laundry([23.6, 2.9], [23.6, 8.9], 2.05)
  pallets([17.2, 0, -8.6], 0.15, 4)
  tyres([18.4, 0, -7.4], 3)
  tyre([18.5, 0, -8.9], true, 1.2)
  bottles([15.8, 0, 8.4], 3, false)
  crate([17.4, 0, 8.7], 0.1)
  crate([17.5, 0.6, 8.65], -0.2, 0.8, false)
  mattress([18.6, 0, 9.0], -Math.PI / 2, 1.2)
  rubble([23.5, 0, -7.6], 1.3, 12)
  brokenSlab([24.6, 0, -5.6], 2.6, 0.32, 2.0)
  poles([27.2, 0, -8.5], -Math.PI / 2, 5)
  sandbags([27.2, 0, -6.2], Math.PI / 2, 1.7, 3)
  spool([27.3, 0, 7.4], 0.4)
  crate([26.9, 0, 9.0], 0.05)
  bags([27.6, 0, 5.6], 3, 0.4)
  for (const side of [-1, 1]) { const facing = side < 0 ? 0 : Math.PI; mark(R.rust, [14.5, 1.3, side * 9.54], facing, 1.6); mark(pick([R.poster, R.notice]), [20.4, 1.5, side * 9.54], facing, 0.7, jitter(0.1)); mark(R.stain, [26.4, 1.1, side * 9.54], facing, 1.6); strip(R.grime, [11, 0.4, side * 9.54], [29.4, 0.4, side * 9.54], facing, 0.8) }
  mark(R.tsoi, [17, 1.3, -9.54], 0, 0.55, 0.04)
  mark(R.danger, [24, 1.6, 9.54], Math.PI, 0.64)
  mark(R.tag3, [25.6, 0.55, -4], -Math.PI / 2, 0.4)
  mark(R.arrow, [25.6, 0.55, 2.4], -Math.PI / 2, 0.5)
  for (const x of [15, 20.5, 26]) { weedsAlong([x - 0.6, -9.2], [x - 0.6, 9.2], 9); weedsAlong([x + 0.6, -9.2], [x + 0.6, 9.2], 7) }
  weedsAlong([10.3, -9.3], [10.3, -2.5], 6); weedsAlong([10.3, 2.5], [10.3, 9.3], 6)
  for (const [x, z] of [[13, -2], [18, 3.5], [22.5, -2.8], [27.4, 2], [16.5, -5.6], [24.2, 5.5]] as const) patch(pick([R.dirt, R.gravel]), x, z, 1.6 + rand())

  garages.forEach((x, index) => {
    const cx = x + 1.6
    wall(garageNumber(index), [cx, 1.78, -2.53], 0, 0.5, 0.25, jitter(0.08))
    mark(pick([R.rust, R.stain, R.rust]), [cx + jitter(0.8), 1.1, -2.53], 0, 1.4)
    strip(pick([R.grime, R.moss]), [x, 0.4, -2.55], [x + 3.2, 0.4, -2.55], 0, 0.8)
    mark(pick([R.stain, R.crack, R.soot, R.moss]), [cx + jitter(0.6), 1.4, -8.6], Math.PI, 1.6)
    strip(R.grime, [x, 0.4, -8.6], [x + 3.2, 0.4, -8.6], Math.PI, 0.8)
    floor(R.oil, [cx + jitter(0.6), 0.022, -1.4 + jitter(0.4)], 1.2, 1.0)
    weedsAlong([x + 0.1, -8.8], [x + 3.1, -8.8], 3)
  })
  mark(R.tsoi, [48.4 + 1.6, 1.25, -2.52], 0, 0.45, -0.03)
  mark(R.tag, [54.8 + 1.6, 1.0, -2.52], 0, 0.45, 0.04)
  mark(R.tag3, [36.6, 1.4, -8.6], Math.PI, 0.36)
  mark(R.danger, [57.6, 1.6, -8.6], Math.PI, 0.64)
  mark(R.tsoi, [52, 1.4, -8.6], Math.PI, 0.6, 0.03)
  tyres([34.6, 0, -1.9], 3)
  tyre([35.4, 0, -2.25], true, 0.1)
  barrel([37.4, 0, -1.95])
  barrel([38.05, 0, -1.6], drum, true, 0.4, false)
  floor(R.oil, [37.8, 0.023, -1.5], 1.6, 1.4)
  floor(R.scorch, [54.5, 0.024, 4.6], 4.6, 3.2, 0.35)
  lada(level, [54.5, 0, 4.6], 0.35, '#2b2622')
  tyre([52.0, 0, 6.6], false)
  tyre([51.6, 0, 7.2], true, 0.8)
  rubble([59.6, 0, 6.8], 1.4, 12)
  sandbags([60.3, 0, 2.6], Math.PI / 2, 2.2, 4)
  tyres([57.4, 0, 9.4], 4)
  bags([49.2, 0, 10.2], 5, 0.8)
  bedframe([55.5, 0, 11.6], 0.1)
  pallets([45.8, 0, 2.6], Math.PI / 2, 3)
  box([0.13, 1.2, 0.82], wood, [46.88, 0.59, 4.6], [0, 0, -0.25], false)
  spool([45.6, 0, 5.9], 0.3)
  fridge([40.4, 0, 11.6], 0.2)
  mattress([42.8, 0, 11.4], 0.05)
  bags([37.4, 0, 11.4], 4, 0.6)
  bedframe([33.8, 0, 11.4], -0.2)
  tyre([44.6, 0, 9.8], true, 1.9)
  crate([31.6, 0, 9.2], 0.3)
  crate([32.5, 0, 9.4], -0.1, 0.9)
  for (const [x, z, r] of [[31, 3.4, 0.05], [34, 3.0, 0.08], [37, 2.6, 0.12], [40.2, 2.4, 0.02], [43.2, 2.2, -0.05], [50.5, 1.2, 0.3], [53.2, 2.6, 0.5]] as const) floor(R.tracks, [x, 0.021, z], 3.2, 1.5, r, false)
  level.plane(16, 2.0, apron, { at: [53.2, 0.016, -1.6] })
  rubble([36, 0, -10.6], 1.0, 8)
  bags([39.2, 0, -10.2], 4, 0.6)
  tyres([41.6, 0, -10.8], 2)
  rubble([50.4, 0, -10.9], 1.5, 12)
  brokenSlab([47.8, 0, -10.6], 0.2, 0.25)
  mattress([56.4, 0, -9.0], -Math.PI / 2, 1.3)
  bedframe([56.6, 0, -11.2], 0.2)
  poles([60.4, 0, -9.45], Math.PI / 2, 4, 3.6)
  for (let k = 0; k < 6; k++) patch(pick([R.dirt, R.moss, R.gravel]), 35 + k * 4.6 + jitter(1.5), -10.6 + jitter(1.5), 1.8 + rand())
  weedsAlong([34, -11.5], [61, -12.5], 22, 0, 2.5)

  const garageTop = garageRoof + 0.14
  for (const [x, z, standing] of [[35.2, -8.0, false], [38.6, -3.2, false], [47.0, -8.1, false], [52.3, -3.3, false], [57.6, -7.9, true], [42.4, -8.0, false]] as const) tyre([x, garageTop, z], standing, rand() * 3)
  for (const [x, z, w, d] of [[36.5, -4.4, 2.2, 1.6], [49.8, -6.8, 2.6, 1.9], [55.5, -4.2, 1.8, 1.4], [41.4, -7.2, 1.4, 1.2]] as const) level.plane(w, d, tar, { at: [x, garageTop + 0.004, z], rotate: jitter(0.6) })
  dish([50.2, garageTop, -8.1], -Math.PI / 2 + 0.3)
  antenna([41.6, garageTop, -8.3], 3.2)
  antenna([59.2, garageTop, -8.2], 2.6)
  for (let k = 0; k < 10; k++) box([0.25, 0.07, 0.12], brick, [garages[k % garages.length]! + 0.3 + rand() * 2.6, garageTop + 0.035, pick([-8.2, -3.1]) + jitter(0.5)], rand() * 3, false, false)
  cyl(0.15, 1.0, rubber, [45.8, garageTop + 0.15, -3.0], [Math.PI / 2, 0, 1.4], false, 8)
  for (const x of [37, 47, 54, 60.2]) weedsAlong([x, -8.4], [x + 1.0, -8.4], 2, garageTop)

  const north = 8.4
  pallets([63.0, 0, 7.5], 0.1, 4)
  spool([68.2, 0, 7.5], 1.5)
  spool([69.7, 0, 6.5], 0, true)
  bottles([61.8, 0, 5.4], 4, false)
  crate([70.9, 0, 5.8], 0.6, 0.8)
  crate([73.1, 0, 3.9], -0.4, 0.8)
  tyre([71.7, 0, 3.4], false)
  floor(R.scorch, [72, 0.024, 4.8], 2.2, 2.2)
  litter(72.6, 5.6, 1.6)
  poles([77.4, 0, north - 0.95], Math.PI / 2, 5)
  for (const x of [79.2, 81.6]) for (const z of [6.9, north - 0.2]) box([0.05, 2.4, 0.05], metal, [x, 1.2, z], 0, false, false)
  for (const y of [1.0, 2.2]) for (const z of [6.9, north - 0.2]) box([2.6, 0.05, 0.05], metal, [80.4, y, z], 0, false, false)
  box([2.4, 0.05, 0.3], wood, [80.4, 2.25, 7.5], [0, 0.05, 0.1], false, false)
  box([2.4, 0.05, 0.3], wood, [80.6, 0.9, 7.0], [0, 0.2, -0.45], false, false)
  box([2.4, 0.3, 0.6], wood, [80.4, 0.15, 7.6], 0.05, true)
  barrel([86.3, 0, 5.2], drum, true, 0.9, false)
  floor(R.oil, [85.2, 0.023, 4.6], 2.0, 1.8)
  sandbags([89.6, 0, 4.4], 0, 2.8, 4)
  sandbags([91.2, 0, 5.9], Math.PI / 2, 2.2, 4)
  rubble([63.6, 0, -9.8], 1.8, 16)
  brokenSlab([65.6, 0, -11.0], 0.4, 0.35)
  bottles([69.6, 0, -10.6], 3)
  spool([71.8, 0, -10.6], 0.2, true)
  for (let k = 0; k < 3; k++) pipe([74 + k * 0.1, 0.16 + (k === 2 ? 0.3 : 0), -9.8 - k * 0.34], [79.5 + k * 0.1, 0.16 + (k === 2 ? 0.3 : 0), -9.6 - k * 0.34], 0.16, rust, 0, k === 0)
  poles([84.0, 0, -11.05], -Math.PI / 2, 4)
  mattress([87.2, 0, -11.5], Math.PI / 2, 1.2)
  crate([89.7, 0, -10.9], 0.2)
  crate([90.5, 0, -11.4], -0.3, 0.85)
  crate([90.1, 0.6, -11.1], 0.5, 0.75, false)
  bags([90.6, 0, -9.4], 4, 0.6)
  for (let k = 0; k < 6; k++) rod([79.6 + jitter(0.3), 0.15, -6.3 + k * 0.92], 0, -0.9 + jitter(0.5), 0.5 + rand() * 0.4, 0.012, drum, 4)
  for (const z of [-7.2, -0.8]) rubble([71 + rand() * 4, 0, z], 0.6, 5, false)
  for (const [x, z, r] of [[63, 1.6, 0.4], [70, 2.0, 0.1], [77, 2.6, -0.1], [84, 1.8, 0.2]] as const) floor(R.tracks, [x, 0.023, z], 7.2, 1.5, r, false)
  for (const [x, z] of [[67, 3], [78, -8.4], [86, -2], [62.4, -2.4], [75.6, 5.4], [88.4, 1.4]] as const) patch(pick([R.dirt, R.gravel, R.dirt]), x, z, 2 + rand() * 1.5)
  weedsAlong([61.4, north - 0.1], [92, north - 0.1], 24); weedsAlong([61.4, 0.6], [61.4, 8.2], 6); weedsAlong([81.4, -11.9], [92, -11.9], 9); weedsAlong([74, -12.7], [81, -12.8], 6)
  for (const [x, region, height] of [[63.8, R.stain, 1.6], [68.6, R.tag, 0.5], [73.8, R.peel, 1.3], [79.0, R.crack, 1.4], [84.6, R.poster, 0.75], [88.2, R.rust, 1.5]] as const) mark(region, [x, 1.2, north], Math.PI, height, jitter(0.05))
  mark(R.tsoi, [76, 1.35, north], Math.PI, 0.5, 0.02)
  strip(R.grime, [61.2, 0.4, north], [92, 0.4, north], Math.PI, 0.8)
  mark(R.tag3, [61.2, 1.4, 4.4], Math.PI / 2, 0.36)
  mark(R.stain, [61.2, 1.4, 1.6], Math.PI / 2, 2.0)
  for (let k = 0; k < 4; k++) mark(pick([R.soot, R.stain, R.crack, R.rust]), [83.5 + k * 2.4, 1.6, -12.0], 0, 2.2)
  strip(R.grime, [81.2, 0.4, -12.0], [92, 0.4, -12.0], 0, 0.8)
  const shedFace = frame([80, 0, -16], 0.03)
  mark(R.danger, shedFace(-2.5, 1.7, 3), 0.03, 0.72)
  mark(R.rust, shedFace(-4.8, 1.6, 3), 0.03, 2.2)
  mark(R.tag3, shedFace(-1.0, 1.1, 3), 0.03, 0.34)

  mark(R.sign, [tower.x0, 2.62, -5.3], -Math.PI / 2, 0.24)
  box([1.0, 0.12, 2.2], cast, [tower.x0 - 0.5, 2.56, -5.3], 0, false, false)
  mark(R.tag, [tower.x0, 1.35, -2.2], -Math.PI / 2, 0.55, 0.03)
  mark(R.stain, [tower.x0, 3.6, -3.2], -Math.PI / 2, 3.0)
  mark(R.poster, [tower.x0, 1.5, -3.9], -Math.PI / 2, 0.74, -0.05)
  strip(R.grime, [tower.x0, 0.45, -4.4], [tower.x0, 0.45, tower.z1], -Math.PI / 2, 0.9)
  mark(R.soot, [96, 4.5, tower.z1], 0, 3.0)
  mark(R.tsoi, [95.4, 1.5, tower.z1], 0, 0.55, -0.02)
  strip(R.grime, [tower.x0, 0.45, tower.z1], [tower.x1, 0.45, tower.z1], 0, 0.9)
  mark(R.crack, [97.6, 2.2, tower.z0 - 0.3], Math.PI, 1.8)
  mark(R.stain, [94.6, 4.4, tower.z0 - 0.3], Math.PI, 3.0)
  weedsAlong([tower.x0 - 0.3, -0.2], [tower.x0 - 0.3, -4.2], 4); weedsAlong([92.2, 0.3], [96, 0.3], 4)

  const tread = feet.stairTread
  const riser = feet.stairRiser
  const run = tread * 8
  const start = inner.x1 - 1.5 - run
  const rise = riser * 8
  const south = inner.z0 + 1.5
  const northStrip = inner.z1 - 1.5
  const rail: Mat = { name: 'metal', color: '#2a2b26' }
  const railing = (from: Vec3, to: Vec3, stepped: boolean) => {
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
    const flat = Math.abs(to[0] - from[0]) < 0.01
    box(flat ? [0.05, 0.05, Math.abs(to[2] - from[2])] : [Math.hypot(to[0] - from[0], to[1] - from[1]) + 0.06, 0.05, 0.06], rail, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 + 0.95, (from[2] + to[2]) / 2], [0, 0, flat ? 0 : angle], false, false)
    const count = Math.max(2, Math.round(Math.hypot(to[0] - from[0], to[2] - from[2]) / (stepped ? tread : 0.3)))
    for (let k = 0; k <= count; k++) { const p = lerp(from, to, k / count); box([0.025, 0.95, 0.025], iron, [p[0], p[1] + 0.475, p[2]], 0, false, false) }
  }
  railing([start, 0.17, south + 0.06], [start + run, rise + 0.17, south + 0.06], true)
  railing([inner.x1 - 1.53, rise, south], [inner.x1 - 1.53, rise, northStrip], false)
  railing([start + run, rise + 0.17, northStrip - 0.06], [start, rise * 2 + 0.17, northStrip - 0.06], true)
  railing([start + 0.03, rise * 2, northStrip - 2.2], [start + 0.03, rise * 2, northStrip], false)
  railing([start + 1.26, rise * 2 + riser * 5, south + 0.06], [start + run, rise * 3 + 0.17, south + 0.06], true)
  railing([inner.x1 - 1.53, rise * 3, south], [inner.x1 - 1.53, rise * 3, northStrip], false)
  const sideS: Vec3 = [0, 0, 1]
  const sideN: Vec3 = [0, 0, -1]
  const z0 = inner.z0
  const z1 = inner.z1
  band([inner.x0, 0, z0], [start, 0, z0], sideS); band([start, 0, z0], [start + run, rise, z0], sideS); band([start + run, rise, z0], [inner.x1, rise, z0], sideS)
  band([inner.x0, rise * 2, z0], [start, rise * 2, z0], sideS); band([start, rise * 2, z0], [start + run, rise * 3, z0], sideS); band([start + run, rise * 3, z0], [inner.x1, rise * 3, z0], sideS)
  band([inner.x0, 0, z1], [start + run, 0, z1], sideN); band([start + run, rise, z1], [start, rise * 2, z1], sideN); band([start + run, rise, z1], [inner.x1, rise, z1], sideN)
  band([inner.x0, rise * 2, z1], [start, rise * 2, z1], sideN); band([start + run, rise * 3, z1], [inner.x1, rise * 3, z1], sideN)
  band([inner.x0, 0, -4.4], [inner.x0, 0, z1], [1, 0, 0]); band([inner.x0, rise * 2, z0], [inner.x0, rise * 2, z1], [1, 0, 0])
  band([inner.x1, 0, south], [inner.x1, 0, z1], [-1, 0, 0], 1.1); band([inner.x1, rise, z0], [inner.x1, rise, -4.0], [-1, 0, 0]); band([inner.x1, rise, -2.7], [inner.x1, rise, z1], [-1, 0, 0])
  band([inner.x1, rise * 3, z0], [inner.x1, rise * 3, -5.6], [-1, 0, 0]); band([inner.x1, rise * 3, -2.2], [inner.x1, rise * 3, z1], [-1, 0, 0])
  const landing2 = rise * 2
  mark(R.one, [inner.x0, 1.95, -1.4], Math.PI / 2, 0.4)
  mark(R.two, [inner.x0, landing2 + 1.95, -4.6], Math.PI / 2, 0.4)
  mark(R.three, [inner.x1, rise * 3 + 1.95, -1.0], -Math.PI / 2, 0.4)
  mark(R.tag3, [inner.x0, landing2 + 2.3, -2.4], Math.PI / 2, 0.36, 0.04)
  mark(R.stain, [inner.x0, landing2 + 3.4, -5.4], Math.PI / 2, 2.4)
  mark(R.crack, [inner.x0, 4.0, -1.0], Math.PI / 2, 1.6)
  mark(R.soot, [inner.x1 - 1.0, 6.4, z1], Math.PI, 2.0)
  mark(R.stain, [97, 6.0, z0], 0, 2.6)
  mark(R.notice, [93.6, 1.9, z1], Math.PI, 0.5, 0.06)
  mark(R.notice, [95.0, 2.0, z1], Math.PI, 0.42, -0.08)
  mark(R.tsoi, [97.4, landing2 + 1.75, z0], 0, 0.45, 0.06)
  mark(R.exit, [inner.x1, rise * 3 + 2.6, -1.3], -Math.PI / 2, 0.56)
  wall(R.arrow, [inner.x1, rise * 3 + 1.3, -1.3], -Math.PI / 2, 0.5, 0.5, 0, true)
  mark(R.crack, [inner.x1, rise * 3 + 2.0, -6.0], -Math.PI / 2, 1.4)
  box([1.5, 0.55, 0.16], metal, [94.1, 1.35, z1 - 0.09], 0, false, false)
  for (let k = 0; k < 3; k++) box([1.52, 0.015, 0.17], iron, [94.1, 1.17 + k * 0.18, z1 - 0.09], 0, false, false)
  for (let k = 0; k < 5; k++) box([0.015, 0.56, 0.17], iron, [93.4 + k * 0.35, 1.35, z1 - 0.09], 0, false, false)
  box([0.12, 0.6, 0.45], metal, [inner.x0 + 0.07, 1.75, -0.95], 0, false, false)
  mark(R.danger, [inner.x0 + 0.13, 1.85, -0.95], Math.PI / 2, 0.28)
  box([0.03, 0.03, 6], iron, [inner.x0 + 0.03, 2.45, -3.3], 0, false, false)
  box([0.03, 2.6, 0.03], iron, [inner.x0 + 0.03, landing2 + 1.2, -0.6], 0, false, false)
  radiator([inner.x0 + 0.1, 0.16, -2.6], Math.PI / 2, 10)
  radiator([inner.x0 + 0.1, landing2 + 0.16, -5.4], Math.PI / 2, 8)
  radiator([inner.x1 - 0.1, rise + 0.16, -1.0], -Math.PI / 2, 7)
  const chunks = (at: Vec3, count: number, radius: number) => { for (let k = 0; k < count; k++) { const s = 0.08 + rand() * 0.22; box([s * 1.4, s * 0.6, s], pick([panel, cast, stained]), [at[0] + jitter(radius), at[1] + s * 0.25, at[2] + jitter(radius)], [jitter(0.6), rand() * 3, jitter(0.6)], false, false) } floor(R.gravel, [at[0], at[1] + 0.012, at[2]], radius * 2.2, radius * 2.2) }
  chunks([inner.x0 + 0.5, landing2, z0 + 0.5], 9, 0.7)
  chunks([inner.x0 + 0.5, landing2, z1 - 0.5], 6, 0.5)
  chunks([inner.x1 - 0.4, rise * 3, z0 + 0.4], 7, 0.5)
  chunks([inner.x1 - 0.4, rise * 3, z1 - 0.5], 6, 0.5)
  chunks([inner.x1 - 0.4, rise, z1 - 0.4], 5, 0.4)
  chunks([97.4, 0, z1 - 0.6], 8, 0.7)
  bags([96.6, 0, -2.6], 2, 0.3)
  litter(94, -3.6, 1.6); litter(93.4, -2.4, 1.2, landing2 + 0.022)
  floor(R.stain, [94.2, 0.022, -2.8], 2.2, 2.4)
  const win: Vec3 = [inner.x1, rise + 1.55, (z0 + z1) / 2]
  wall(R.window, [win[0] - 0.004, win[1], win[2]], -Math.PI / 2, 1.0, 1.2, 0, false, shafts)
  for (const dz of [-0.53, 0.53]) box([0.1, 1.3, 0.07], iron, [win[0] - 0.03, win[1], win[2] + dz], 0, false, false)
  for (const dy of [-0.63, 0.63, 0.15]) box([0.1, 0.07, 1.12], iron, [win[0] - 0.03, win[1] + dy, win[2]], 0, false, false)
  box([0.08, 1.2, 0.05], iron, [win[0] - 0.03, win[1], win[2] + 0.05], 0, false, false)
  box([0.28, 0.06, 1.25], cast, [win[0] - 0.12, win[1] - 0.68, win[2]], 0, false, false)
  for (let k = 0; k < 6; k++) box([0.12 + rand() * 0.14, 0.01, 0.08 + rand() * 0.1], glass, [win[0] - 0.4 - rand() * 0.8, rise + 0.006, win[2] + jitter(1.2)], rand() * 3, false, false)
  shaft([win[0] - 0.05, win[1], win[2]], [-0.8, -0.55, 0.2], 3.4, 1.0)
  shaft([inner.x1 + 0.1, rise * 3 + 1.3, -3.9], [-0.7, -0.5, 0.3], 4.6, 2.2)
  floor(R.dirt, [inner.x1 - 1.6, rise + 0.02, win[2] + 0.4], 1.4, 1.2)

  const roofTop = roof + 0.12
  const upperTop = upper + 0.1
  const plantTop = upper + plant
  for (let k = 0; k < 7; k++) { const x = 102.5 + k * 2.8; mark(k % 2 === 0 ? R.soot : pick([R.stain, R.rust]), [x, 3.35, boiler.z1], 0, k % 2 === 0 ? 1.6 : 1.8) }
  mark(R.boiler, [111.2, 0.95, boiler.z1], 0, 0.44)
  strip(R.grime, [boiler.x0, 0.4, boiler.z1], [boiler.x1, 0.4, boiler.z1], 0, 0.8)
  mark(R.tsoi, [104.6, 0.9, boiler.z1], 0, 0.4, -0.04)
  for (const x of [boiler.x0 + 0.3, boiler.x1 - 0.3]) { cyl(0.08, roof, rust, [x, roof / 2, boiler.z1 + 0.14], undefined, false, 6); box([0.3, 0.1, 0.3], rust, [x, 0.1, boiler.z1 + 0.24], 0, false, false) }
  pipe([boiler.x0 + 0.6, 3.35, boiler.z1 + 0.38], [boiler.x1 - 0.6, 3.35, boiler.z1 + 0.38], 0.2, stained, 6)
  const steam: Vec3 = [boiler.x0 + 3.6, 3.7, boiler.z1 + 0.85]
  pipe([steam[0], 3.35, boiler.z1 + 0.38], [steam[0], steam[1], boiler.z1 + 0.38], 0.09, rust)
  pipe([steam[0], steam[1], boiler.z1 + 0.38], steam, 0.09, rust)
  cyl(0.13, 0.05, metal, [steam[0], steam[1], steam[2] - 0.04], [Math.PI / 2, 0, 0], false, 10)
  cyl(0.065, 0.006, rubber, [steam[0], steam[1], steam[2] + 0.003], [Math.PI / 2, 0, 0], false, 10)
  context.emitters.push({ kind: 'steam', at: steam })
  for (const x of [boiler.x0 + 0.6, boiler.x1 - 0.6]) box([0.44, 0.44, 0.5], metal, [x, 3.35, boiler.z1 + 0.2], 0, false, false)
  weedsAlong([100.4, boiler.z1 + 0.3], [121.6, boiler.z1 + 0.3], 14)
  for (const z of [-8, -5.2, 1.2, 3.0]) mark(pick([R.soot, R.stain, R.crack, R.rust]), [boiler.x1, 2.0 + jitter(0.6), z], Math.PI / 2, 1.8)
  strip(R.grime, [boiler.x1, 0.4, boiler.z0], [boiler.x1, 0.4, boiler.z1], Math.PI / 2, 0.8)
  mark(R.tag, [boiler.x1, 1.4, -7.4], Math.PI / 2, 0.5, -0.03)
  mark(R.danger, [boiler.x1, 1.6, 2.2], Math.PI / 2, 0.72)
  weedsAlong([boiler.x1 + 0.3, -9.6], [boiler.x1 + 0.3, -5.4], 5); weedsAlong([boiler.x1 + 0.3, -0.6], [boiler.x1 + 0.3, 3.6], 5)
  for (const x of [103, 108, 115, 120]) mark(pick([R.soot, R.stain, R.rust]), [x, 2.4, boiler.z0], Math.PI, 2.0)
  pipe([110, 3.4, boiler.z0], [110, 3.4, -12.7], 0.26, metal, 1)
  box([0.3, 3.4, 0.3], rust, [110, 1.7, -11.5], 0, true)
  for (const x of [109.75, 110.25]) box([0.05, 19, 0.05], rust, [x, 10.7, -12.62], 0, false, false)
  for (let y = 1.6; y < 20; y += 0.6) box([0.55, 0.035, 0.035], rust, [110, y, -12.62], 0, false, false)
  for (let k = 0; k < 7; k++) box([0.8 + rand() * 1.3, 0.5 + rand() * 0.7, 0.8 + rand() * 1.2], coal, [115.5 + jitter(3.4), 0.2, -14.6 + jitter(2.2)], [jitter(0.4), rand() * 3, jitter(0.4)], false, k === 0)
  box([3.4, 0.9, 2.6], coal, [115.5, 0.2, -14.6], [0.15, 0.4, 0.1], true, false)
  floor(R.scorch, [115.5, 0.024, -14.6], 6, 4.4)
  rubble([96, 0, -15.6], 1.4, 10)
  poles([102.6, 0, -10.8], Math.PI / 2, 4, 3.4)
  bottles([105.2, 0, -11.2], 3)
  tyres([119.8, 0, -18.2], 3)
  weedsAlong([92.5, -20.6], [123, -20.6], 14)

  box([9.4, 0.3, 0.3], cast, [107.3, roofTop + 0.15, boiler.z1 - 0.15], 0, false, false)
  box([12, 0.3, 0.3], cast, [boiler.x0 + 6, roofTop + 0.15, boiler.z0 + 0.15], 0, false, false)
  for (const z of [boiler.z1 - 0.15, boiler.z0 + 0.15]) solid([3.5, 0.15, 0.15], [108.5, roofTop + 0.15, z])
  for (const [a, b] of [[boiler.z0, -5.6], [-0.4, boiler.z1]] as const) box([0.3, 0.32, b - a], cast, [boiler.x1 - 0.15, upperTop + 0.16, (a + b) / 2], 0, true, false)
  for (const z of [boiler.z0 + 0.15, boiler.z1 - 0.15]) for (const [a, b] of [[112, 116], [120, boiler.x1 - 0.3]] as const) box([b - a, 0.3, 0.3], cast, [(a + b) / 2, upperTop + 0.15, z], 0, true, false)
  box([0.08, 0.1, boiler.z1 - boiler.z0 + 0.3], trim, [112.02, upper + 0.02, (boiler.z0 + boiler.z1) / 2], 0, false, false)
  vent([106.0, roofTop, -8.3], 'mushroom')
  vent([106.6, roofTop, 2.4], 'mushroom')
  vent([109.8, roofTop, -8.5], 'box')
  vent([107.6, roofTop, -7.6], 'box')
  vent([113.4, upperTop, -8.4], 'box')
  vent([119.3, plantTop, 0.6], 'mushroom', false)
  pipe([102.8, roofTop + 0.4, 3.15], [111.6, roofTop + 0.4, 3.15], 0.14, metal, 3)
  pipe([101.2, roofTop + 0.4, -9.2], [111.6, roofTop + 0.4, -9.2], 0.14, metal, 3)
  for (const z of [3.15, -9.2]) solid([3.3, 0.14, 0.14], [108.3, roofTop + 0.4, z])
  for (const x of [104, 107.5, 111]) for (const z of [3.15, -9.2]) box([0.14, 0.3, 0.3], iron, [x, roofTop + 0.15, z], 0, false, false)
  pipe([111.75, roofTop + 0.4, 3.15], [111.75, upperTop + 0.4, 3.15], 0.14, metal)
  pipe([111.75, upperTop + 0.4, 3.15], [115.6, upperTop + 0.4, 3.15], 0.14, metal, 1, true)
  for (const [x, z, w, d, y] of [[104.2, -6.0, 2.8, 1.8, roofTop], [108.6, 0.8, 2.0, 1.4, roofTop], [106.6, -3.4, 1.6, 1.1, roofTop], [114.0, -6.5, 1.6, 2.4, upperTop], [121, 1.6, 1.4, 2.0, upperTop], [117.8, -2.0, 2.2, 1.4, plantTop]] as const) level.plane(w, d, tar, { at: [x, y + 0.004, z], rotate: jitter(0.8) })
  dish([113.2, upperTop, 2.4], -Math.PI / 2 - 0.2)
  dish([116.9, plantTop, 2.9], -Math.PI / 2 + 0.4)
  antenna([114.8, upperTop, -8.8], 3.4)
  antenna([102.2, roofTop, -8.8], 2.8)
  for (let k = 0; k < 3; k++) { const y = plantTop + 2.4 + k; const x = 118.5 + k * 0.6; box([0.02, 0.02, 1.3], metal, [x, y, 1.5], 0, false, false); for (let e = 0; e < 4; e++) box([0.8 - e * 0.1, 0.012, 0.012], metal, [x, y, 1.0 + e * 0.32], 0, false, false) }
  leaf(R.tarp, [119.1, plantTop + 1.75, 1.5], [0.62, 0, 0], [0, 0.55, 0], [0, 0, 1], [0.22, 0.02])
  box([1.4, 0.5, 1.0], metal, [118.2, plantTop + 0.25, 2.8], 0.2, false, false)
  leaf(R.tarp, [118.2, plantTop + 0.52, 2.8], [0.75, 0, -0.15], [0, 0.01, -0.55], [0, 1, 0], [0.05, 0.12])
  laundry([105.2, 1.0], [110.8, 1.8], 1.75, roofTop)
  for (let k = 0; k < 6; k++) box([0.25, 0.07, 0.12], brick, [101 + rand() * 10, roofTop + 0.035, pick([-9.3, 3.3]) + jitter(0.5)], rand() * 3, false, false)
  for (const [x, z, y] of [[112.8, 0.6, upperTop], [114.6, -7.6, upperTop], [120.6, -8.4, upperTop]] as const) weedsAlong([x, z], [x + 0.6, z + 0.6], 2, y)
  for (const [x, z] of [[101, -9.4], [111.4, 3.4], [111.4, -9.4]] as const) floor(R.moss, [x, roofTop + 0.012, z], 1.6, 1.6)

  rubble([slabEnd[0] - 0.6, 0, -6.6], 1.2, 10)
  rubble([slabEnd[0] - 1.6, 0, 0.9], 1.0, 8)
  for (let k = 0; k < 4; k++) rod([slabEnd[0] - 0.2, 0.1, -4.6 + k * 1.1], Math.PI, -0.9 + jitter(0.5), 0.5 + rand() * 0.4, 0.012, drum, 4)
  crate([132.8, 0, 6.2], 0.3, 0.8)
  crate([135.3, 0, 8.0], -0.6, 0.8)
  pallets([131.2, 0, 8.8], 0.2, 5)
  tyres([136.9, 0, 9.6], 3)
  litter(134.6, 6.2, 1.6)
  floor(R.scorch, [134, 0.024, 7.2], 2.2, 2.2)
  bags([129.2, 0, 11.6], 5, 0.8)
  apc(level, [153.6, 0, 8.4], -0.25)
  floor(R.oil, [152.8, 0.023, 7.4], 2.6, 2.2)
  tyre([150.2, 0, 11.0], true, 0.3)
  laundry([159.8, 4.4], [159.8, 10.6])
  bench([161.6, 0, 3.0], 0)
  bags([163.0, 0, 10.9], 4, 0.6)
  for (const [x, z, r] of [[127, 4.6, 0.1], [133.5, 4.0, 0.05], [140, 3.2, 0.1], [146.5, 2.6, 0.08], [153, 2.4, 0.04], [158.6, 2.2, 0]] as const) floor(R.tracks, [x, 0.021, z], 6.6, 1.5, r, false)
  const dockY = dockTop[1] + 0.09
  pallets([147.2, dockY, -6.2], 0.1, 2)
  crate([150.6, dockY, -6.0], 0.2)
  crate([150.7, dockY, 0.2], -0.2)
  crate([150.6, dockY + 0.6, 0.25], 0.4, 0.8, false)
  pallet([146.4, dockY, 0.3], 1.4)
  bags([145.6, dockY, -6.3], 2, 0.3)
  for (let k = 0; k < 5; k++) box([0.26, 0.36, 0.16], rubber, [dockTop[0] + 0.9 + k * 1.4, 0.72, 1.08], 0, false, false)
  mark(R.stain, [dockTop[0] + 2.2, 0.6, 1.0], 0, 1.1); mark(R.tag3, [dockTop[0] + 4.6, 0.65, 1.0], 0, 0.34)
  bottles([shedDoor - 2.4, 0, -14.6], 4)
  poles([shedDoor - 0.85, 0, -14.4], Math.PI, 4, 3.6)
  spool([139.6, 0, -12.6], 0.9)
  rubble([131.6, 0, -12.8], 1.6, 12)
  brokenSlab([134.4, 0, -14.8], 0.8, 0.3)
  sandbags([137.6, 0, -16.2], 0.05, 3.0, 3)
  mattress([128.8, 0, -16.2], 0.3)
  mark(R.danger, [shedDoor, 2.75, -13.7], -Math.PI / 2, 0.64)
  mark(R.rust, [shedDoor, 2.0, -9.2], -Math.PI / 2, 2.2)
  mark(R.poster, [shedDoor, 1.5, -14.3], -Math.PI / 2, 0.74, 0.04)
  for (const [x, z] of [[129, -6], [138, -9.6], [146, 6], [156.4, -7], [142, 9.6], [125.6, -14]] as const) patch(pick([R.dirt, R.gravel]), x, z, 2 + rand() * 1.5)
  weedsAlong([125, -16.8], [164, -17], 18); weedsAlong([126, 12.4], [164, 12.6], 18)

  for (const [z, w] of [[3.7, 8.6], [-5.7, 7.8]] as const) box([w, 0.15, 0.24], trim, [finishX - w / 2 - 0.2, 0.075, z], 0, false, false)
  doorway(finishX, -8.6, -Math.PI / 2)
  doorway(finishX, 6.6, -Math.PI / 2)
  wall(R.plate16, [finishX, 4.25, -1.0], -Math.PI / 2, 0.7, 0.7)
  mark(R.tsoi, [finishX, 1.5, -12.4], -Math.PI / 2, 0.6, 0.03)
  mark(R.stain, [finishX, 2.8, -4.6], -Math.PI / 2, 2.0)
  mark(R.crack, [finishX, 1.2, 9.6], -Math.PI / 2, 1.4)
  strip(R.grime, [finishX, 0.45, -17.5], [finishX, 0.45, -3.2], -Math.PI / 2, 0.9); strip(R.grime, [finishX, 0.45, 1.2], [finishX, 0.45, 12.8], -Math.PI / 2, 0.9)
  for (const [z, facing] of [[-3.2, 0], [1.2, Math.PI]] as const) { strip(R.grime, [finishX, 0.45, z], [finishX + 12, 0.45, z], facing, 0.9); mark(pick([R.stain, R.peel]), [finishX + 3 + rand() * 6, 1.9, z], facing, 1.8); mark(R.crack, [finishX + 9.5, 1.4, z], facing, 1.2) }
  mark(R.tag, [finishX + 5.4, 1.55, -3.2], 0, 0.6, -0.02)
  mark(R.poster, [finishX + 8.4, 1.5, 1.2], Math.PI, 0.8, 0.04)
  mark(R.notice, [finishX + 7.6, 1.45, 1.2], Math.PI, 0.52, -0.05)
  ceiling(R.soot, [finishX + 0.9, 3.08, -1], 2.2, 2.8, Math.PI / 2)
  pipe([finishX, 2.85, 0.85], [finishX + 12, 2.85, 0.85], 0.09, rust, 3)
  litter(finishX + 3.2, -2.2, 1.2); litter(finishX - 2.6, 1.6, 1.4)
  bags([finishX + 13.4, 0, 3.4], 4, 0.6)
  pallets([finishX + 16.6, 0, -4.8], 0.4, 3, false)
  rubble([finishX + 17, 0, 2.2], 1.0, 8, false)
  tyres([finishX + 13.2, 0, -5.0], 2, false)
  weedsAlong([finishX - 0.3, 2], [finishX - 0.3, 12], 7); weedsAlong([finishX - 0.3, -4], [finishX - 0.3, -17], 9)

  const puddles = batch()
  for (const [x, y, z, w, d] of [[48.5, garageTop, -5.0, 1.6, 0.9], [56, garageTop, -6.4, 1.2, 0.8], [103.8, roofTop, -1.2, 2.2, 1.2], [109.6, roofTop, -6.4, 1.6, 1.0], [114.2, upperTop, 0.4, 1.2, 0.8], [118.6, plantTop, -1.0, 1.0, 0.6], [inner.x1 - 0.7, rise, -2.4, 0.8, 0.5], [148.2, dockY, -4.2, 1.4, 0.7]] as const) {
    for (const [ox, oz, k] of [[0, 0, 1], [w * 0.3, d * 0.2, 0.6]] as const) {
      const rot = rand() * 3
      const point = (a: number): Vec3 => { const px = Math.cos(a) * w * k / 2; const pz = Math.sin(a) * d * k / 2; return [x + ox + px * Math.cos(rot) - pz * Math.sin(rot), y + 0.014, z + oz + px * Math.sin(rot) + pz * Math.cos(rot)] }
      for (let s = 0; s < 14; s++) for (const p of [[x + ox, y + 0.014, z + oz] as Vec3, point((s + 1) / 14 * Math.PI * 2), point(s / 14 * Math.PI * 2)]) { puddles.position.push(...p); puddles.normal.push(0, 1, 0); puddles.uv.push(0, 0); puddles.sway.push(0) }
    }
  }

  const atlas = paintAtlas()
  const decalMaterial = new THREE.MeshStandardMaterial({ name: 'traverse-decals', map: atlas, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, roughness: 0.9, envMapIntensity: 0.4 })
  const foliageMaterial = new THREE.MeshStandardMaterial({ name: 'traverse-foliage', map: atlas, alphaTest: 0.45, roughness: 0.95, envMapIntensity: 0.4 })
  const time = { value: 0 }
  foliageMaterial.onBeforeCompile = shader => {
    shader.uniforms.swayTime = time
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float swayTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xz += vec2(sin(swayTime * 1.9 + position.x * 0.7 + position.z * 0.3) + 0.4 * sin(swayTime * 4.3 + position.z), cos(swayTime * 1.3 + position.z * 0.6 + position.x * 0.2)) * sway;')
  }
  foliageMaterial.customProgramCacheKey = () => 'traverse-foliage'
  const shaftMaterial = new THREE.MeshBasicMaterial({ name: 'traverse-shafts', map: atlas, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true, color: new THREE.Color(1.25, 1.2, 1.08) })
  const foliageMesh = meshOf(foliage, foliageMaterial, 0)
  foliageMesh.onBeforeRender = () => { time.value = performance.now() / 1000 }
  const shaftMesh = meshOf(shafts, shaftMaterial, 4)
  shaftMesh.receiveShadow = false
  level.mesh(meshOf(decals, decalMaterial, 2))
  level.mesh(foliageMesh)
  level.mesh(shaftMesh)
  level.mesh(meshOf(puddles, puddleMaterial(), 2))
}
