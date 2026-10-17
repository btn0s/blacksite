import { VIEWMODEL } from './model'

export type Spring3 = { value: [number, number, number]; velocity: [number, number, number] }

export const createSpring3 = (): Spring3 => ({ value: [0, 0, 0], velocity: [0, 0, 0] })

export function stepSpring3(spring: Spring3, target: readonly [number, number, number] | null, stiffness: number, damping: number, delta: number) {
  const steps = Math.max(1, Math.ceil(delta / VIEWMODEL.spring.maxStepSeconds))
  const dt = delta / steps
  for (let step = 0; step < steps; step++) {
    for (let index = 0; index < 3; index++) {
      const goal = target ? target[index] : 0
      const acceleration = (goal - spring.value[index]) * stiffness - spring.velocity[index] * damping
      spring.velocity[index] += acceleration * dt
      spring.value[index] += spring.velocity[index] * dt
    }
  }
}

export function kickSpring3(spring: Spring3, impulse: readonly [number, number, number]) {
  for (let index = 0; index < 3; index++) spring.velocity[index] += impulse[index]
}

export const approach = (value: number, target: number, rate: number, delta: number) => value + (target - value) * (1 - Math.exp(-rate * delta))

export const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}
