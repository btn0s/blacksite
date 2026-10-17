import { CanvasTexture, ClampToEdgeWrapping, LinearMipmapLinearFilter, LinearFilter, SRGBColorSpace } from 'three'
import { createRandom } from './random'

type Paint = (context: OffscreenCanvasRenderingContext2D, size: number, random: () => number) => void

function canvasTexture(size: number, seed: number, paint: Paint): CanvasTexture {
  const canvas = new OffscreenCanvas(size, size)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas unavailable')
  context.clearRect(0, 0, size, size)
  paint(context, size, createRandom(seed))
  const texture = new CanvasTexture(canvas as unknown as HTMLCanvasElement)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = 4
  texture.generateMipmaps = true
  texture.premultiplyAlpha = false
  texture.needsUpdate = true
  return texture
}

function blade(context: OffscreenCanvasRenderingContext2D, x: number, base: number, height: number, width: number, lean: number, shade: number) {
  const tipX = x + lean
  const tipY = base - height
  const gradient = context.createLinearGradient(0, base, 0, tipY)
  gradient.addColorStop(0, `rgb(${Math.round(70 * shade)},${Math.round(82 * shade)},${Math.round(40 * shade)})`)
  gradient.addColorStop(0.55, `rgb(${Math.round(150 * shade)},${Math.round(160 * shade)},${Math.round(92 * shade)})`)
  gradient.addColorStop(1, `rgb(${Math.round(214 * shade)},${Math.round(206 * shade)},${Math.round(150 * shade)})`)
  context.fillStyle = gradient
  context.beginPath()
  context.moveTo(x - width / 2, base)
  context.quadraticCurveTo(x - width * 0.4 + lean * 0.4, base - height * 0.55, tipX, tipY)
  context.quadraticCurveTo(x + width * 0.4 + lean * 0.4, base - height * 0.55, x + width / 2, base)
  context.closePath()
  context.fill()
}

export function grassTexture(size = 256, seed = 11): CanvasTexture {
  return canvasTexture(size, seed, (context, s, random) => {
    for (let index = 0; index < 46; index++) {
      const x = s * (0.06 + random() * 0.88)
      const height = s * (0.45 + random() * 0.53)
      const lean = (random() - 0.5) * s * 0.28
      blade(context, x, s, height, s * (0.018 + random() * 0.02), lean, 0.75 + random() * 0.4)
    }
    for (let index = 0; index < 5; index++) {
      const x = s * (0.15 + random() * 0.7)
      const height = s * (0.8 + random() * 0.18)
      const lean = (random() - 0.5) * s * 0.12
      context.strokeStyle = `rgb(${190 + Math.round(random() * 30)},${172 + Math.round(random() * 30)},${110})`
      context.lineWidth = s * 0.008
      context.beginPath()
      context.moveTo(x, s)
      context.quadraticCurveTo(x + lean * 0.5, s - height * 0.6, x + lean, s - height)
      context.stroke()
      context.fillStyle = 'rgb(200,182,118)'
      for (let seedIndex = 0; seedIndex < 7; seedIndex++) {
        const t = 0.82 + seedIndex * 0.025
        context.beginPath()
        context.ellipse(x + lean * t + (seedIndex % 2 ? 2 : -2) * s / 256, s - height * t, s * 0.006, s * 0.016, (seedIndex % 2 ? 0.5 : -0.5), 0, Math.PI * 2)
        context.fill()
      }
    }
  })
}

export function flowerTexture(size = 128, seed = 23): CanvasTexture {
  return canvasTexture(size, seed, (context, s, random) => {
    for (let index = 0; index < 4; index++) {
      const x = s * (0.2 + random() * 0.6)
      const height = s * (0.55 + random() * 0.35)
      const lean = (random() - 0.5) * s * 0.18
      context.strokeStyle = 'rgb(84,104,52)'
      context.lineWidth = s * 0.018
      context.beginPath()
      context.moveTo(x, s)
      context.quadraticCurveTo(x + lean * 0.4, s - height * 0.5, x + lean, s - height)
      context.stroke()
      const cx = x + lean
      const cy = s - height
      const radius = s * (0.05 + random() * 0.035)
      context.fillStyle = 'rgb(255,255,255)'
      for (let petal = 0; petal < 6; petal++) {
        const angle = petal / 6 * Math.PI * 2 + random() * 0.3
        context.beginPath()
        context.ellipse(cx + Math.cos(angle) * radius * 0.6, cy + Math.sin(angle) * radius * 0.6, radius * 0.55, radius * 0.3, angle, 0, Math.PI * 2)
        context.fill()
      }
      context.fillStyle = 'rgb(140,120,60)'
      context.beginPath()
      context.arc(cx, cy, radius * 0.32, 0, Math.PI * 2)
      context.fill()
    }
  })
}

export function litterTexture(size = 128, seed = 31): CanvasTexture {
  return canvasTexture(size, seed, (context, s, random) => {
    for (let index = 0; index < 9; index++) {
      const x = s * (0.15 + random() * 0.7)
      const y = s * (0.15 + random() * 0.7)
      const angle = random() * Math.PI * 2
      const length = s * (0.08 + random() * 0.1)
      const tone = 0.6 + random() * 0.5
      context.save()
      context.translate(x, y)
      context.rotate(angle)
      context.fillStyle = `rgb(${Math.round(120 * tone)},${Math.round(84 * tone)},${Math.round(44 * tone)})`
      context.beginPath()
      context.ellipse(0, 0, length, length * 0.45, 0, 0, Math.PI * 2)
      context.fill()
      context.strokeStyle = `rgba(60,40,20,0.7)`
      context.lineWidth = s * 0.006
      context.beginPath()
      context.moveTo(-length, 0)
      context.lineTo(length, 0)
      context.stroke()
      context.restore()
    }
    context.strokeStyle = 'rgb(88,66,44)'
    for (let index = 0; index < 3; index++) {
      context.lineWidth = s * (0.012 + random() * 0.01)
      const x = s * random()
      const y = s * random()
      const angle = random() * Math.PI
      const length = s * (0.25 + random() * 0.3)
      context.beginPath()
      context.moveTo(x, y)
      context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length)
      context.stroke()
    }
  })
}

export function leafClusterTexture(size = 256, seed = 41, palette: readonly (readonly [number, number, number])[] = [[86, 104, 48], [108, 124, 58], [70, 88, 40], [132, 140, 70]]): CanvasTexture {
  return canvasTexture(size, seed, (context, s, random) => {
    const centre = s / 2
    for (let index = 0; index < 150; index++) {
      const radius = Math.sqrt(random()) * s * 0.44
      const angle = random() * Math.PI * 2
      const x = centre + Math.cos(angle) * radius
      const y = centre + Math.sin(angle) * radius
      const colour = palette[Math.floor(random() * palette.length)]!
      const shade = 0.75 + random() * 0.45 - radius / (s * 0.44) * 0.25
      context.fillStyle = `rgb(${Math.round(colour[0] * shade)},${Math.round(colour[1] * shade)},${Math.round(colour[2] * shade)})`
      const leaf = s * (0.03 + random() * 0.025)
      context.beginPath()
      context.ellipse(x, y, leaf, leaf * 0.55, random() * Math.PI, 0, Math.PI * 2)
      context.fill()
    }
  })
}

export function needleClusterTexture(size = 256, seed = 53): CanvasTexture {
  return canvasTexture(size, seed, (context, s, random) => {
    const centre = s / 2
    for (let branch = 0; branch < 7; branch++) {
      const angle = -Math.PI / 2 + (random() - 0.5) * 2.4
      const length = s * (0.3 + random() * 0.15)
      const sx = centre
      const sy = centre + s * 0.1
      const ex = sx + Math.cos(angle) * length
      const ey = sy + Math.sin(angle) * length
      context.strokeStyle = 'rgb(58,48,36)'
      context.lineWidth = s * 0.01
      context.beginPath()
      context.moveTo(sx, sy)
      context.lineTo(ex, ey)
      context.stroke()
      for (let needle = 0; needle < 34; needle++) {
        const t = 0.15 + needle / 34 * 0.85
        const px = sx + (ex - sx) * t
        const py = sy + (ey - sy) * t
        const side = needle % 2 ? 1 : -1
        const nAngle = angle + side * (0.9 + random() * 0.3)
        const nLength = s * (0.05 + random() * 0.03) * (1.1 - t * 0.4)
        const shade = 0.7 + random() * 0.4
        context.strokeStyle = `rgb(${Math.round(52 * shade)},${Math.round(76 * shade)},${Math.round(46 * shade)})`
        context.lineWidth = s * 0.008
        context.beginPath()
        context.moveTo(px, py)
        context.lineTo(px + Math.cos(nAngle) * nLength, py + Math.sin(nAngle) * nLength)
        context.stroke()
      }
    }
  })
}
