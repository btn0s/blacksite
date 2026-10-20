import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { WebGPURenderer } from 'three/webgpu'
import { createWebGPULook, type WebGPULook as WebGPULookHandle, type WebGPULookOptions } from './webgpu'

export type WebGPULookProps = WebGPULookOptions & {
  readonly debug?: boolean
  readonly onReady?: (look: WebGPULookHandle | null) => void
  readonly onError?: (error: unknown) => void
}

export function WebGPULook({ onReady, onError, debug = false, ...options }: WebGPULookProps) {
  const { gl, scene, camera, size } = useThree()
  const look = useRef<WebGPULookHandle | null>(null)
  const callbacks = useRef({ onReady, onError })
  callbacks.current = { onReady, onError }
  useEffect(() => {
    let active = true
    void createWebGPULook(gl as unknown as WebGPURenderer, scene, camera, options).then(created => {
      if (!active) { created.dispose(); return }
      look.current = created
      created.setDebug(debug)
      callbacks.current.onReady?.(created)
    }).catch(error => {
      if (active) callbacks.current.onError?.(error)
    })
    return () => {
      active = false
      look.current?.dispose()
      look.current = null
      callbacks.current.onReady?.(null)
    }
  }, [gl, scene, camera, options.atmosphere, options.quality, options.shadowDistance, options.shadowMap, options.shadowLayers, options.sunlight, options.camera])
  useEffect(() => { look.current?.setSize(size.width, size.height) }, [size.width, size.height])
  useEffect(() => { look.current?.setDebug(debug) }, [debug])
  useFrame(() => { look.current?.beginFrame() }, -1000)
  useFrame((_, dt) => { look.current?.render(dt) }, 1)
  return null
}
