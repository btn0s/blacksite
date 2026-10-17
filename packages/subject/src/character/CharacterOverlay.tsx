import { useSyncExternalStore } from 'react'
import { MENU, glyphText, useConsoleNavigation, useInputContext, useInputSource, type GlyphMap } from '@blacksite/input'
import { Hints, Menu, Prompt, TouchPad, useTouch, type MenuItem, type TouchButton } from '@blacksite/ui/hud'
import { CHARACTER_GLYPHS } from '../input'
import type { CharacterHandle } from './state'

export type CharacterOverlayProps = {
  controller: CharacterHandle
  visible?: boolean
  prompt?: string
  hints?: ReadonlyArray<string>
  glyphs?: GlyphMap
  hintsClassName?: string
  buttons?: TouchButton[]
}

const hintsFor = (controller: CharacterHandle) => controller.armed
  ? ['move', 'fire', 'aim', 'sprint', 'crouch']
  : ['move', 'jump', 'sprint', 'roll', ...(controller.config.views.includes('shoulder') ? ['shoulder'] : []), ...(controller.config.views.length > 1 ? ['view'] : [])]

const buttonsFor = (controller: CharacterHandle, status: { touchAim: boolean; touchCrouch: boolean }): TouchButton[] => controller.armed
  ? [{ id: 'fire', label: 'Fire' }, { id: 'aim', label: status.touchAim ? 'Hip' : 'Aim' }, { id: 'reload', label: 'Reload' }, { id: 'crouch', label: status.touchCrouch ? 'Stand' : 'Crouch' }, { id: 'jump', label: 'Jump' }, { id: 'swap', label: 'Swap' }]
  : [{ id: 'jump', label: 'Jump' }, { id: 'roll', label: 'Roll' }, { id: 'crouch', label: status.touchCrouch ? 'Stand' : 'Crouch' }, ...(controller.config.views.length > 1 ? [{ id: 'view', label: 'View' }] : [])]

export function useCharacterStatus(controller: CharacterHandle) {
  return useSyncExternalStore(controller.subscribe, controller.status)
}

export function useTouchActive() {
  const touch = useTouch()
  const { device } = useInputSource()
  return touch && device !== 'gamepad'
}

export function CharacterOverlay({ controller, visible = true, prompt = 'Click to play', hints = hintsFor(controller), glyphs, hintsClassName, buttons }: CharacterOverlayProps) {
  const status = useCharacterStatus(controller)
  const { device, gamepadLayout } = useInputSource()
  const touch = useTouchActive()
  const pad = device === 'gamepad'
  const items = hints.flatMap(action => {
    const spec = glyphs?.[action] ?? CHARACTER_GLYPHS[action]
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
      if (id === 'fire') { touch.fire = pressed; return }
      const own = TOUCH[id]
      if (!own) { controller.input.actions.setTouchButton(id, pressed); return }
      if (pressed) own(controller)
    }}
    buttons={buttons ?? buttonsFor(controller, status)} />
}

const TOUCH: Record<string, (controller: CharacterHandle) => void> = {
  aim: controller => controller.setStatus({ touchAim: !controller.status().touchAim }),
  crouch: controller => controller.setStatus({ touchCrouch: !controller.status().touchCrouch }),
  jump: controller => controller.jump(),
  roll: controller => controller.roll(),
  ragdoll: controller => controller.ragdoll(),
  shoulder: controller => controller.swapShoulder(),
  reload: controller => controller.reload(),
  swap: controller => controller.cycle(),
  inspect: controller => controller.inspect(),
  view: controller => controller.cycleView(),
}

export function CharacterPause({ controller, title = 'Paused', detail, items = [] }: { controller: CharacterHandle; title?: string; detail?: string; items?: MenuItem[] }) {
  const resume = () => { controller.setPaused(false); controller.lock() }
  const navigation = useConsoleNavigation(resume)
  useInputContext(MENU)
  return <Menu root={navigation.root} title={title} detail={detail} items={[{ id: 'resume', label: 'Resume', onPress: resume }, ...items.map(item => ({ ...item, onPress: () => { resume(); item.onPress() } }))]} />
}
