import { Vector3 } from 'three'

export type CharacterFly = { readonly speed: number; readonly sprintSpeed: number; readonly response: number; readonly doubleTapSeconds: number }
export type CharacterFlight = { readonly position: Vector3; readonly velocity: Vector3 }
export type CharacterFlightInput = { readonly forward: number; readonly right: number; readonly rise: number; readonly sprint: boolean }

export const CHARACTER_FLY: CharacterFly = { speed: 16, sprintSpeed: 64, response: 9, doubleTapSeconds: 0.3 }

export function createFlight(): CharacterFlight {
  return { position: new Vector3(), velocity: new Vector3() }
}

export function stepFlight(flight: CharacterFlight, input: CharacterFlightInput, yaw: number, fly: CharacterFly, dt: number) {
  const speed = input.sprint ? fly.sprintSpeed : fly.speed
  const sin = Math.sin(yaw), cos = Math.cos(yaw)
  const blend = 1 - Math.exp(-fly.response * dt)
  const velocity = flight.velocity
  velocity.x += ((-sin * input.forward + cos * input.right) * speed - velocity.x) * blend
  velocity.y += (input.rise * speed - velocity.y) * blend
  velocity.z += ((-cos * input.forward - sin * input.right) * speed - velocity.z) * blend
  flight.position.addScaledVector(velocity, dt)
}
