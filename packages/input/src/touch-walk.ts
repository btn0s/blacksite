export type TouchWalkAction = 'jump' | 'crouch' | 'sprint' | 'cycle' | 'use' | 'respawn' | 'exit'

export interface TouchWalkHandlers {
  move(forward: number, right: number): void
  look(dx: number, dy: number): void
  action(action: TouchWalkAction, pressed: boolean): void
}

export function attachTouchWalkControls(root: HTMLElement, handlers: TouchWalkHandlers): () => void {
  const stick = root.querySelector<HTMLElement>('#touchStick')!
  const knob = root.querySelector<HTMLElement>('#touchKnob')!
  const look = root.querySelector<HTMLElement>('#touchLook')!
  let stickPointer: number | undefined
  let lookPointer: number | undefined
  let lookX = 0
  let lookY = 0
  const updateStick = (event: PointerEvent) => {
    const rect = stick.getBoundingClientRect()
    const radius = rect.width / 2
    const dx = (event.clientX - rect.left - radius) / radius
    const dy = (event.clientY - rect.top - radius) / radius
    const scale = Math.max(1, Math.hypot(dx, dy))
    const right = dx / scale
    const forward = -dy / scale
    knob.style.left = `${50 + right * 28}%`
    knob.style.top = `${50 - forward * 28}%`
    handlers.move(forward, right)
  }
  const stickDown = (event: PointerEvent) => {
    if (stickPointer !== undefined) return
    event.preventDefault()
    stickPointer = event.pointerId
    stick.setPointerCapture(event.pointerId)
    updateStick(event)
  }
  const stickMove = (event: PointerEvent) => { if (event.pointerId === stickPointer) updateStick(event) }
  const stickUp = (event: PointerEvent) => {
    if (event.pointerId !== stickPointer) return
    stickPointer = undefined
    knob.style.left = knob.style.top = '50%'
    handlers.move(0, 0)
  }
  const lookDown = (event: PointerEvent) => {
    if (lookPointer !== undefined) return
    event.preventDefault()
    lookPointer = event.pointerId
    lookX = event.clientX
    lookY = event.clientY
    look.setPointerCapture(event.pointerId)
  }
  const lookMove = (event: PointerEvent) => {
    if (event.pointerId !== lookPointer) return
    handlers.look(event.clientX - lookX, event.clientY - lookY)
    lookX = event.clientX
    lookY = event.clientY
  }
  const lookUp = (event: PointerEvent) => { if (event.pointerId === lookPointer) lookPointer = undefined }
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-touch]'))
  const down = (event: PointerEvent) => {
    event.preventDefault()
    const button = event.currentTarget as HTMLButtonElement
    button.setPointerCapture(event.pointerId)
    handlers.action(button.dataset.touch as TouchWalkAction, true)
  }
  const up = (event: PointerEvent) => handlers.action((event.currentTarget as HTMLButtonElement).dataset.touch as TouchWalkAction, false)
  stick.addEventListener('pointerdown', stickDown)
  stick.addEventListener('pointermove', stickMove)
  stick.addEventListener('pointerup', stickUp)
  stick.addEventListener('pointercancel', stickUp)
  look.addEventListener('pointerdown', lookDown)
  look.addEventListener('pointermove', lookMove)
  look.addEventListener('pointerup', lookUp)
  look.addEventListener('pointercancel', lookUp)
  for (const button of buttons) {
    button.addEventListener('pointerdown', down)
    button.addEventListener('pointerup', up)
    button.addEventListener('pointercancel', up)
  }
  return () => {
    stick.removeEventListener('pointerdown', stickDown)
    stick.removeEventListener('pointermove', stickMove)
    stick.removeEventListener('pointerup', stickUp)
    stick.removeEventListener('pointercancel', stickUp)
    look.removeEventListener('pointerdown', lookDown)
    look.removeEventListener('pointermove', lookMove)
    look.removeEventListener('pointerup', lookUp)
    look.removeEventListener('pointercancel', lookUp)
    for (const button of buttons) {
      button.removeEventListener('pointerdown', down)
      button.removeEventListener('pointerup', up)
      button.removeEventListener('pointercancel', up)
    }
    handlers.move(0, 0)
  }
}
