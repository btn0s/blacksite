import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Actions, Hints, Loading, Prompt, Screen, Status, TitleCard, useTouch } from '../../look/hud'
import { AirStrikeScene, type AirStrikeState } from './scene'

function App() {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<AirStrikeScene | null>(null)
  const touch = useTouch()
  const [state, setState] = useState<AirStrikeState>({ phase: 'loading', countdown: 0, progress: 0.05, detached: 0, error: null })
  useEffect(() => {
    const instance = new AirStrikeScene(host.current!)
    instance.onState = next => setState(next)
    scene.current = instance
    const canvas = instance.renderer.domElement
    const pointers = new Map<number, { x: number; y: number }>()
    let start = { x: 0, y: 0, at: 0, moved: 0 }
    let pinch = 0
    const down = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId)
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pointers.size === 1) start = { x: event.clientX, y: event.clientY, at: performance.now(), moved: 0 }
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y) }
    }
    const move = (event: PointerEvent) => {
      const last = pointers.get(event.pointerId)
      if (!last) { if (event.pointerType === 'mouse') instance.hover(event.clientX, event.clientY); return }
      const dx = event.clientX - last.x
      const dy = event.clientY - last.y
      last.x = event.clientX
      last.y = event.clientY
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        if (pinch > 0) instance.rig.zoom(pinch / distance)
        pinch = distance
        start.moved = 99
        return
      }
      start.moved += Math.abs(dx) + Math.abs(dy)
      if (start.moved > 6) instance.rig.orbit(dx, dy)
    }
    const up = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return
      pointers.delete(event.pointerId)
      if (pointers.size === 0 && start.moved <= 6 && performance.now() - start.at < 400) instance.tap(event.clientX, event.clientY)
      if (pointers.size < 2) pinch = 0
    }
    const wheel = (event: WheelEvent) => { event.preventDefault(); instance.rig.zoom(Math.exp(event.deltaY * 0.001)) }
    const key = (event: KeyboardEvent) => {
      if (event.code === 'Space') { event.preventDefault(); instance.callStrike() }
      if (event.code === 'KeyR') instance.rebuild()
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('wheel', wheel, { passive: false })
    addEventListener('keydown', key)
    return () => {
      removeEventListener('keydown', key)
      instance.dispose()
      scene.current = null
    }
  }, [])
  const busy = state.phase === 'designating' || state.phase === 'inbound'
  const status = state.phase === 'designating' ? { label: 'Target designated', value: `Release in ${state.countdown.toFixed(1)} s`, tone: 'alert' as const }
    : state.phase === 'inbound' ? { label: 'Salvo released', value: 'Strike inbound', tone: 'alert' as const }
    : state.detached > 0 ? { label: 'Structure down', value: `${state.detached}%` }
    : null
  return <Screen>
    <div ref={host} />
    <TitleCard title="Cascade · Air Strike" />
    {status && <Status {...status} />}
    <Hints visible={!touch} items={[['Click', 'Strike'], ['Drag', 'Orbit'], ['Wheel', 'Zoom'], ['R', 'Rebuild']]} />
    <Prompt text={touch ? 'Tap the block to call a strike' : 'Click the block to call a strike'} visible={state.phase === 'ready' && state.detached === 0} />
    <Actions items={[{ id: 'strike', label: 'Strike', disabled: busy || state.phase === 'loading', onPress: () => scene.current?.callStrike() }, { id: 'rebuild', label: 'Rebuild', disabled: state.phase === 'loading', onPress: () => scene.current?.rebuild() }]} />
    <Loading title="Air Strike" detail={state.error ?? (state.progress < 0.35 ? 'Loading materials' : state.progress < 0.6 ? 'Casting 2,700 concrete pieces' : 'Starting the physics worker')} progress={state.progress} done={state.phase !== 'loading'} />
  </Screen>
}

createRoot(document.getElementById('root')!).render(<App />)
