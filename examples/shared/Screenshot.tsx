import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { WebGPULook } from '@blacksite/look/webgpu'
import type { CharacterHandle } from '@blacksite/subject'

export const SCREENSHOT_RENDER_PRIORITY = 1.5

const pad = (value: number) => String(value).padStart(2, '0')

export function screenshotName(name: string, walker: CharacterHandle, now = new Date()) {
  const [x, y, z] = walker.position.toArray().map(value => value.toFixed(1))
  const yaw = ((walker.control.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  return `${name}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}-x${x}-y${y}-z${z}-yaw${yaw.toFixed(2)}.png`
}

export function Screenshot({ name, look, warm, walker, onSaved }: {
  name: string
  look: { current: WebGPULook | null }
  warm: { current: number }
  walker: CharacterHandle
  onSaved(file: string): void
}) {
  const gl = useThree(state => state.gl)
  const pending = useRef(false)
  const saved = useRef(onSaved)
  saved.current = onSaved
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (event.code !== 'KeyP' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) return
      event.preventDefault()
      pending.current = true
    }
    addEventListener('keydown', press)
    return () => removeEventListener('keydown', press)
  }, [])
  useFrame(() => {
    if (!pending.current) return
    if (!look.current || warm.current < 10) { pending.current = false; return }
    pending.current = false
    const canvas = gl.domElement
    const copy = document.createElement('canvas')
    copy.width = canvas.width
    copy.height = canvas.height
    copy.getContext('2d')!.drawImage(canvas, 0, 0)
    const file = screenshotName(name, walker)
    copy.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      saved.current(file)
    }, 'image/png')
  }, SCREENSHOT_RENDER_PRIORITY)
  return null
}
