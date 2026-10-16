import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Game } from './game'

export function mount(element: HTMLElement) {
  const root = createRoot(element)
  root.render(createElement(Game))
  return () => root.unmount()
}

export { meta } from './meta'
