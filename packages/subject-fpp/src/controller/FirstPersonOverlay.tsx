import { useSyncExternalStore } from 'react'
import { MENU, glyphText, useConsoleNavigation, useInputContext, useInputSource } from '@blacksite/input'
import { Hints, Menu, Prompt, TouchPad, useTouch, type MenuItem, type TouchButton } from '@blacksite/ui/hud'
import { FPP_GLYPHS } from '../input'
import type { FirstPerson } from './player'

export type FirstPersonOverlayProps = {
  player: FirstPerson
  visible?: boolean
  prompt?: string
  hints?: ReadonlyArray<string>
  hintsClassName?: string
  pauseItems?: MenuItem[]
}

const HINTS = ['move', 'fire', 'aim', 'sprint', 'crouch']

export function useFirstPersonStatus(player: FirstPerson) {
  return useSyncExternalStore(player.subscribe, player.status)
}

export function useTouchActive() {
  const touch = useTouch()
  const { device } = useInputSource()
  return touch && device !== 'gamepad'
}

export function FirstPersonOverlay({ player, visible = true, prompt = 'Click to play', hints = HINTS, hintsClassName, pauseItems = [] }: FirstPersonOverlayProps) {
  const status = useFirstPersonStatus(player)
  const { device, gamepadLayout } = useInputSource()
  const touch = useTouchActive()
  const pad = device === 'gamepad'
  const items = hints.flatMap(action => {
    const spec = FPP_GLYPHS[action]
    return spec ? [[glyphText(spec, device, gamepadLayout), spec.label] as [string, string]] : []
  })
  const resume = () => player.pause(false)
  return <>
    <div className={hintsClassName}><Hints visible={visible && !touch} items={items} /></div>
    <Prompt text={prompt} visible={visible && !touch && !pad && !status.locked && !status.paused} />
    {visible && touch && !status.paused && <TouchControls player={player} />}
    {status.paused && <PauseMenu items={[{ id: 'resume', label: 'Resume', onPress: resume }, ...pauseItems.map(item => ({ ...item, onPress: () => { resume(); item.onPress() } }))]} onBack={resume} />}
  </>
}

function PauseMenu({ items, onBack }: { items: MenuItem[]; onBack: () => void }) {
  useInputContext(MENU)
  const navigation = useConsoleNavigation<HTMLDivElement>(onBack)
  return <Menu title="Paused" items={items} root={navigation.root} />
}

export function TouchControls({ player, buttons }: { player: FirstPerson; buttons?: TouchButton[] }) {
  const status = useFirstPersonStatus(player)
  const touch = player.touch
  return <TouchPad
    onMove={(x, y) => { touch.forward = -y; touch.right = x }}
    onLook={(dx, dy) => { touch.lookX += dx * player.look.touchScale; touch.lookY += dy * player.look.touchScale }}
    onButton={(id, pressed) => {
      if (id === 'fire') touch.fire = pressed
      if (!pressed) return
      if (id === 'aim') player.setStatus({ touchAim: !player.status().touchAim })
      if (id === 'crouch') player.setStatus({ touchCrouch: !player.status().touchCrouch })
      if (id === 'jump') player.jump()
      if (id === 'reload') player.reload()
      if (id === 'swap') player.cycle()
      if (id === 'inspect') player.inspect()
    }}
    buttons={buttons ?? [{ id: 'fire', label: 'Fire' }, { id: 'aim', label: status.touchAim ? 'Hip' : 'Aim' }, { id: 'reload', label: 'Reload' }, { id: 'crouch', label: status.touchCrouch ? 'Stand' : 'Crouch' }, { id: 'jump', label: 'Jump' }, { id: 'swap', label: 'Swap' }]} />
}
