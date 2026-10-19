import { createElement, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { buttonGroup, folder, LevaPanel, useControls, useCreateStore } from 'leva'

export interface TuningOptions {
  setView: (view: 'normal' | 'meshlets' | 'lod') => void
  setPixelError: (value: number) => void
  setOcclusion: (enabled: boolean) => void
  setCamera: (view: 'overview' | 'channel') => void
  setExposure: (value: number) => void
  setSunIntensity: (value: number) => void
  setFogDensity: (value: number) => void
  initial?: {
    view?: 'normal' | 'meshlets' | 'lod'
    pixelError?: number
    occlusion?: boolean
    exposure?: number
    sunIntensity?: number
    fogDensity?: number
  }
}

function Tuning({ options }: { options: TuningOptions }) {
  const store = useCreateStore()
  const [collapsed, setCollapsed] = useState(true)
  useControls(() => ({
    Camera: buttonGroup({
      Overview: () => options.setCamera('overview'),
      'Coast path': () => options.setCamera('channel'),
    }),
    Surface: {
      value: options.initial?.view ?? 'normal',
      options: { 'Lit surface': 'normal', 'Meshlet colours': 'meshlets', 'LOD levels': 'lod' },
      onChange: options.setView,
    },
    Geometry: folder({
      'Screen error (px)': { value: options.initial?.pixelError ?? 2, min: 0.25, max: 8, step: 0.25, onChange: options.setPixelError },
      Occlusion: { value: options.initial?.occlusion ?? true, onChange: options.setOcclusion },
    }),
    Atmosphere: folder({
      Exposure: { value: options.initial?.exposure ?? 1, min: 0.2, max: 2, step: 0.01, onChange: options.setExposure },
      Sunlight: { value: options.initial?.sunIntensity ?? 3.9, min: 0, max: 8, step: 0.05, onChange: options.setSunIntensity },
      'Coastal haze': { value: options.initial?.fogDensity ?? 0.0022, min: 0, max: 0.012, step: 0.0001, pad: 4, onChange: options.setFogDensity },
    }),
    Display: folder({
      'Performance HUD': { value: false, onChange: (value: boolean) => { document.getElementById('telemetry')!.hidden = !value } },
      Diagnostics: { value: false, onChange: (value: boolean) => { document.getElementById('diagnostics')!.hidden = !value } },
    }, { collapsed: true }),
  }), { store }, [])
  useEffect(() => {
    document.getElementById('tuning-shell')!.dataset.collapsed = String(collapsed)
  }, [collapsed])
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCollapsed(true)
        document.querySelector<HTMLButtonElement>('.tuning-title')?.focus()
      }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])
  return createElement(LevaPanel, {
    store,
    fill: true,
    hideCopyButton: true,
    collapsed: { collapsed, onChange: setCollapsed },
    titleBar: {
      title: createElement('button', {
        className: 'tuning-title',
        type: 'button',
        'aria-expanded': !collapsed,
        'aria-label': collapsed ? 'Open scene tuning' : 'Close scene tuning',
        onClick: () => setCollapsed(value => !value),
      }, 'Scene tuning'),
      drag: false,
      filter: false,
    },
    theme: {
      colors: {
        elevation1: '#142124', elevation2: '#1b2b2e', elevation3: '#283b3e',
        accent1: '#869d83', accent2: '#a6b89b', accent3: '#d4dec0',
        highlight1: '#6e8586', highlight2: '#b1c0bb', highlight3: '#edf0e5',
        folderWidgetColor: '#b1c0bb', folderTextColor: '#d4ded4', rootText: '#edf0e5',
      },
      fonts: { sans: 'Inter, ui-sans-serif, system-ui, sans-serif', mono: 'ui-monospace, SFMono-Regular, monospace' },
      fontSizes: { root: '11px' },
      sizes: { rootWidth: '340px', controlWidth: '180px', numberInputMinWidth: '58px', rowHeight: '44px', folderTitleHeight: '44px', titleBarHeight: '48px', checkboxSize: '24px' },
      space: { rowGap: '4px', colGap: '8px', md: '12px', lg: '14px' },
      radii: { xs: '3px', sm: '5px', lg: '10px' },
    },
  })
}

export function mountTuning(container: HTMLElement, options: TuningOptions) {
  const root = createRoot(container)
  root.render(createElement(Tuning, { options }))
  return { dispose: () => root.unmount() }
}
