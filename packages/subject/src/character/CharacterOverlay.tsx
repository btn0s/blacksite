import { useSyncExternalStore } from 'react'
import { glyphText, useInputSource } from '@blacksite/input'
import { Hints, Prompt, TouchPad, useTouch, type TouchButton } from '@blacksite/ui/hud'
import { FPP_GLYPHS } from '../input'
import type { CharacterHandle } from './state'

export type CharacterOverlayProps = {
  controller: CharacterHandle
  visible?: boolean
  prompt?: string
  hints?: ReadonlyArray<string>
  hintsClassName?: string
  buttons?: TouchButton[]
}

const HINTS = ['move', 'fire', 'aim', 'sprint', 'crouch']

export function useCharacterStatus(controller: CharacterHandle) {
  return useSyncExternalStore(controller.subscribe, controller.status)
}

export function useTouchActive() {
  const touch = useTouch()
  const { device } = useInputSource()
  return touch && device !== 'gamepad'
}

export function CharacterOverlay({ controller, visible = true, prompt = 'Click to play', hints = HINTS, hintsClassName, buttons }: CharacterOverlayProps) {
  const status = useCharacterStatus(controller)
  const { device, gamepadLayout } = useInputSource()
  const touch = useTouchActive()
  const pad = device === 'gamepad'
  const items = hints.flatMap(action => {
    const spec = FPP_GLYPHS[action]
    return spec ? [[glyphText(spec, device, gamepadLayout), spec.label] as [string, string]] : []
  })
  const shown = visible && !status.paused
  return <>
    <div className={hintsClassName}><Hints visible={shown && !touch} items={items} /></div>
    <Prompt text={prompt} visible={shown && !touch && !pad && !status.locked} />
    {shown && touch && <TouchControls controller={controller} buttons={buttons} />}
  </>
}

export function TouchControls({ controller, buttons }: { controller: CharacterHandle; buttons?: TouchButton[] }) {
  const status = useCharacterStatus(controller)
  const touch = controller.touch
  return <TouchPad
    onMove={(x, y) => { touch.forward = -y; touch.right = x }}
    onLook={(dx, dy) => { touch.lookX += dx * controller.look.touchScale; touch.lookY += dy * controller.look.touchScale }}
    onButton={(id, pressed) => {
      if (id === 'fire') touch.fire = pressed
      if (!pressed) return
      if (id === 'aim') controller.setStatus({ touchAim: !controller.status().touchAim })
      if (id === 'crouch') controller.setStatus({ touchCrouch: !controller.status().touchCrouch })
      if (id === 'jump') controller.jump()
      if (id === 'reload') controller.reload()
      if (id === 'swap') controller.cycle()
      if (id === 'inspect') controller.inspect()
      if (id === 'view') controller.cycleView()
    }}
    buttons={buttons ?? [{ id: 'fire', label: 'Fire' }, { id: 'aim', label: status.touchAim ? 'Hip' : 'Aim' }, { id: 'reload', label: 'Reload' }, { id: 'crouch', label: status.touchCrouch ? 'Stand' : 'Crouch' }, { id: 'jump', label: 'Jump' }, { id: 'swap', label: 'Swap' }]} />
}
