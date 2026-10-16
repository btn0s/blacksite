'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { Camera } from 'three'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import {
  keySubject, lookSubject, resetFpsInput, updateFpsMovementInput,
  type SubjectState,
} from './controller'

export interface SubjectProps { controller: SubjectState }
const isTextInput = (target: EventTarget | null) => target !== null
  && typeof target === 'object'
  && 'tagName' in target
  && typeof target.tagName === 'string'
  && 'isContentEditable' in target
  && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
const isPerspectiveCamera = (camera: Camera): camera is PerspectiveCamera =>
  'isPerspectiveCamera' in camera && camera.isPerspectiveCamera === true

/**
 * Mount inside StriderScene player={controller.player}. Owns classic input and the stable FPP eye, never physics. TPP remains the native ALS camera.
 * Frame data publishes after ALS_FRAME_PRIORITY.Camera; fire simulation can sample at -0.1 or later.
 */
export function Subject({ controller }: SubjectProps) {
  const { camera, gl } = useThree()
  const scratch = useMemo(() => ({
    rotation: new Euler(0, 0, 0, 'YXZ'), right: new Vector3(), up: new Vector3(0, 1, 0),
    quaternion: new Quaternion(),
  }), [])
  const height = useRef(1.63)
  const previousReady = useRef(false)
  const previousView = useRef(controller.view)

  useEffect(() => {
    const canvas = gl.domElement
    const doc = canvas.ownerDocument
    const previousTabIndex = canvas.getAttribute('tabindex')
    canvas.tabIndex = 0
    const requestLock = async () => {
      canvas.focus({ preventScroll: true })
      if (doc.pointerLockElement !== canvas) await canvas.requestPointerLock()
    }
    controller.attachPointerLock(requestLock)
    const onLockChange = () => {
      controller.frame.locked = doc.pointerLockElement === canvas
      resetFpsInput(controller)
      controller.publish()
    }
    const onBlur = () => { resetFpsInput(controller); controller.publish() }
    const onVisibility = () => { if (doc.hidden) onBlur() }
    // Pointer down/up only describe the first/last pressed button. Mouse events
    // preserve every edge when players chord RMB aim and LMB fire.
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 && event.button !== 2) return
      if (doc.pointerLockElement !== canvas) {
        // The click which acquires the mouse never also fires a shot.
        if (event.button === 0) void requestLock().catch(() => {})
        return
      }
      if (!controller.enabled) return
      if (event.button === 0) controller.input.fire = true
      if (event.button === 2) controller.input.aim = true
    }
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 0) controller.input.fire = false
      if (event.button === 2) controller.input.aim = false
    }
    const onPointerMove = (event: PointerEvent) => {
      if (doc.pointerLockElement === canvas) lookSubject(controller, event.movementX, event.movementY)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (doc.pointerLockElement !== canvas && doc.activeElement !== canvas || isTextInput(event.target)) return
      if (event.code === 'Escape') {
        resetFpsInput(controller)
        controller.frame.locked = false
        controller.publish()
        doc.exitPointerLock()
        event.preventDefault()
        return
      }
      if (keySubject(controller, event.code, true, event.repeat)) event.preventDefault()
    }
    const onKeyUp = (event: KeyboardEvent) => { keySubject(controller, event.code, false) }
    const onContextMenu = (event: Event) => event.preventDefault()
    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('contextmenu', onContextMenu)
    doc.addEventListener('mouseup', onMouseUp)
    doc.addEventListener('pointermove', onPointerMove)
    doc.addEventListener('pointerlockchange', onLockChange)
    doc.addEventListener('keydown', onKeyDown)
    doc.addEventListener('keyup', onKeyUp)
    doc.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    onLockChange()
    return () => {
      controller.attachPointerLock(null)
      resetFpsInput(controller)
      controller.frame.locked = false
      controller.frame.ready = false
      controller.publish()
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('contextmenu', onContextMenu)
      doc.removeEventListener('mouseup', onMouseUp)
      doc.removeEventListener('pointermove', onPointerMove)
      doc.removeEventListener('pointerlockchange', onLockChange)
      doc.removeEventListener('keydown', onKeyDown)
      doc.removeEventListener('keyup', onKeyUp)
      doc.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      if (previousTabIndex === null) canvas.removeAttribute('tabindex')
      else canvas.setAttribute('tabindex', previousTabIndex)
      if (doc.pointerLockElement === canvas) doc.exitPointerLock()
    }
  }, [controller, gl])

  useEffect(() => {
    if (!isPerspectiveCamera(camera)) throw new Error('Subject requires a PerspectiveCamera')
    const original = { near: camera.near, fov: camera.fov }
    if (controller.view === 'first-person') {
      camera.near = 0.05
      camera.fov = controller.options.fov
      camera.updateProjectionMatrix()
    }
    return () => { camera.near = original.near; camera.fov = original.fov; camera.updateProjectionMatrix() }
  }, [camera, controller])

  useFrame(() => { updateFpsMovementInput(controller) }, ALS_FRAME_PRIORITY.ControlRotation - 0.1)

  useFrame((_, rawDelta) => {
    const sample = controller.player.pose.current
    const character = sample.character
    const frame = controller.frame
    frame.ready = sample.ready && character !== null && sample.ownerRigidBody !== null
    if (!frame.ready || !character || !isPerspectiveCamera(camera)) {
      previousReady.current = false
      controller.publish()
      return
    }
    const dt = Math.min(Math.max(rawDelta, 0), 0.1)
    const command = controller.player.command
    frame.view = controller.view
    frame.aiming = controller.enabled && command.aim
    frame.grounded = character.locomotionMode === 'Grounded'
    frame.crouching = character.stance === 'Crouching'
    frame.sprinting = character.gait === 'Sprinting'
    frame.action = character.locomotionAction
    frame.position.copy(sample.ground)
    frame.velocity.set(character.movement.velocity.x, character.movement.velocity.z, character.movement.velocity.y)
    frame.ownerColliderHandles.clear()
    const owner = sample.ownerRigidBody
    if (owner?.isValid()) for (let index = 0; index < owner.numColliders(); index++) frame.ownerColliderHandles.add(owner.collider(index).handle)
    const extraHandles = (sample as typeof sample & { ownerColliderHandles?: ReadonlySet<number> }).ownerColliderHandles
    if (extraHandles) for (const handle of extraHandles) frame.ownerColliderHandles.add(handle)

    // Ground comes from the interpolated capsule/mesh anchor, never the animated head bone.
    const eyeHeight = frame.crouching ? 1.0 : 1.63
    const resetCamera = !previousReady.current || previousView.current !== controller.view
    height.current = resetCamera ? eyeHeight : height.current + (eyeHeight - height.current) * (1 - Math.exp(-20 * dt))
    frame.eye.copy(frame.position).addScaledVector(scratch.up, height.current)
    if (controller.view === 'first-person') {
      scratch.rotation.set(command.pitch * Math.PI / 180, -command.yaw * Math.PI / 180 - Math.PI / 2, 0, 'YXZ')
      scratch.quaternion.setFromEuler(scratch.rotation)
      camera.position.copy(frame.eye)
      camera.quaternion.copy(scratch.quaternion)
      const fov = frame.aiming ? controller.options.aimFov : controller.options.fov
      const nextFov = resetCamera ? fov : camera.fov + (fov - camera.fov) * (1 - Math.exp(-14 * dt))
      if (Math.abs(nextFov - camera.fov) > 0.0001 || camera.near !== 0.05) {
        camera.fov = nextFov
        camera.near = 0.05
        camera.updateProjectionMatrix()
      }
      camera.updateMatrixWorld()
    }
    // ALS owns TPP position, rotation, FOV, near plane, lag, traces and shakes. In that view
    // this controller only observes the actual camera after its native camera actor tick.
    frame.cameraQuaternion.copy(camera.quaternion)
    camera.getWorldDirection(frame.aimDirection)
    camera.getWorldPosition(frame.aimOrigin)
    scratch.right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    // Authoritative shot origin stays inside the player's capsule envelope. A visual barrel can
    // extend past a thin wall; using that unswept point as the firing origin would bypass it.
    // Hosts may sweep eye→barrel before replacing this point for their Armory tick.
    frame.muzzlePosition.copy(frame.eye).addScaledVector(frame.aimDirection, 0.1)
      .addScaledVector(scratch.right, frame.aiming ? 0.025 : 0.1).addScaledVector(scratch.up, -0.12)
    previousReady.current = true
    previousView.current = controller.view
    controller.publish()
  }, ALS_FRAME_PRIORITY.Camera + 0.02)
  return null
}
