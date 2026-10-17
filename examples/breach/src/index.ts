import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { preloadArms } from '@blacksite/subject-fpp/arms'
import { Game } from './game'

export function mount(element: HTMLElement) {
  void preloadArms().catch(() => {})
  const root = createRoot(element)
  root.render(createElement(Game))
  return () => root.unmount()
}

export { meta } from './meta'
