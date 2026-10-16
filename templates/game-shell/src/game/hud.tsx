import { useEffect, useState } from 'react'
import { Hints, Prompt, TouchPad, useTouch, type TouchButton } from '@blacksite/ui/hud'
import { input } from './input'

export function PlayHud({ hints, buttons, ready }: { hints: Array<[string, string]>; buttons: TouchButton[]; ready: boolean }) {
  const touch = useTouch()
  const [locked, setLocked] = useState(() => document.pointerLockElement !== null)
  useEffect(() => {
    const change = () => setLocked(document.pointerLockElement !== null)
    document.addEventListener('pointerlockchange', change)
    return () => document.removeEventListener('pointerlockchange', change)
  }, [])
  return <>
    <Hints visible={!touch} items={hints} />
    <Prompt text="Click to play" visible={ready && !touch && !locked} />
    {touch && ready && <TouchPad
      buttons={buttons}
      onMove={(x, y) => input.actions.setTouchStick('move', x, y)}
      onLook={(dx, dy) => input.actions.addTouchLook(dx, dy)}
      onButton={(id, pressed) => input.actions.setTouchButton(id, pressed)} />}
  </>
}
