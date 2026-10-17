import { Color, Euler, Group, Quaternion, Vector3, type Camera } from 'three';
import { SoftParticles } from '@blacksite/look/soft';
import type { DestructionEvent, SimulationFrame, Vec3 } from '../../destruction-domain/src/index';

// Optional additions keep this renderer source-compatible with older snapshot producers.
type PhysicalEvent = DestructionEvent & { mass?: number; impulse?: number; normal?: Vec3; radius?: number };

const dustTint = new Color('#a79e8e');
const smokeTint = new Color('#928b80');
const sootTint = new Color('#45464a');

export class DestructionEffects {
  readonly group = new Group();
  private readonly particles: SoftParticles;
  private cursor = 0;
  private lastTick = -1;
  private readonly seen = new Map<string, number>();
  readonly shake = new ImpactCameraShake();

  constructor(readonly capacity = 2048) {
    this.particles = new SoftParticles({ capacity });
    this.particles.name = 'cascade-event-clouds';
    this.group.name = 'cascade-event-dust-and-smoke';
    this.group.add(this.particles);
  }

  advance(time: number, reducedMotion: boolean): void {
    this.particles.advance(time - this.particles.time);
    this.particles.still = reducedMotion;
  }

  update(frame: SimulationFrame | null | undefined, time: number, reducedMotion: boolean): void {
    this.advance(time, reducedMotion);
    if (!frame) return;
    if (frame.tick < this.lastTick) {
      this.seen.clear(); this.cursor = 0;
      this.particles.reset(); this.shake.clear();
    }
    this.lastTick = frame.tick;
    for (let i = 0; i < frame.events.length; i++) {
      const event: PhysicalEvent = frame.events[i]!;
      const key = `${event.tick}:${i}:${event.type}:${event.position.join(',')}:${event.energy}:${event.count}`;
      if (this.seen.has(key)) continue;
      this.seen.set(key, event.tick);
      this.spawn(event);
      if (event.type === 'heavyImpact' || event.type === 'cannonballImpact' || event.type === 'explosiveDetonated') this.shake.add(event, time);
    }
    for (const [key, tick] of this.seen) if (tick < frame.tick - 300) this.seen.delete(key);
  }

  emit(event: PhysicalEvent, time: number): void {
    this.particles.advance(time - this.particles.time);
    this.spawn(event);
    if (event.type === 'heavyImpact' || event.type === 'cannonballImpact' || event.type === 'explosiveDetonated') this.shake.add(event, time);
  }

  private spawn(event: PhysicalEvent): void {
    const mass = Math.max(0, event.mass ?? 0);
    const impulse = Math.max(0, event.impulse ?? (mass > 0 ? Math.sqrt(2 * mass * Math.max(0, event.energy)) : 0));
    if (mass === 0 && impulse === 0) return;
    const blast = event.type === 'explosiveDetonated';
    const impact = event.type === 'heavyImpact' || event.type === 'cannonballImpact';
    const settled = event.type === 'rubbleSettled';
    const weight = Math.log1p(mass) * 0.6 + Math.log1p(impulse) * 0.7;
    const count = Math.min(64, Math.max(2, Math.round(weight * (blast ? 3.5 : impact ? 2.2 : settled ? 0.4 : 0.9))));
    const extent = Math.max(0.08, Math.min(4, event.radius ?? Math.cbrt(Math.max(mass, 1) / 2200)));
    const speed = Math.min(12, 0.35 + impulse / Math.max(mass, 15) * 0.12);
    let seed = (event.tick * 1664525 + Math.round(event.position[0] * 113 + event.position[2] * 719) + this.cursor) | 0;
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    const normal = event.normal ?? [0, 1, 0];
    for (let i = 0; i < count; i++) {
      this.cursor = (this.cursor + 1) % this.capacity;
      const smoke = (blast || impact || mass > 500) && i % 3 === 0;
      const x = random() * 2 - 1, y = random() * 2 - 1, z = random() * 2 - 1;
      this.particles.emit({
        position: { x: event.position[0] + x * extent * 0.45, y: event.position[1] + y * extent * 0.2, z: event.position[2] + z * extent * 0.45 },
        velocity: { x: (x + normal[0] * 0.5) * speed, y: (Math.abs(y) + normal[1] * 0.5) * speed * 0.65, z: (z + normal[2] * 0.5) * speed },
        acceleration: { x: 0, y: smoke ? 0.5 : -1.8, z: 0 },
        drag: 1.4,
        life: (smoke ? 4.5 : settled ? 1.4 : 2.3) + random() * 1.5,
        size: 2 * Math.min(2.8, (0.12 + extent * 0.32) * (0.6 + random())),
        grow: smoke ? 2.8 : 1,
        opacity: smoke ? 0.55 : 0.65,
        tint: !smoke ? dustTint : blast ? sootTint : smokeTint,
        seed: random(),
      });
    }
  }

  dispose(): void { this.shake.restore(); this.particles.dispose(); this.seen.clear(); }
}

/** Short, additive, decaying impact feedback; never takes ownership of a host camera's base pose. */
export class ImpactCameraShake {
  private camera?: Camera;
  private pulses: Array<{ position: Vec3; strength: number; time: number }> = [];
  private applied = false;
  private readonly basePosition = new Vector3();
  private readonly baseRotation = new Quaternion();
  private readonly lastPosition = new Vector3();
  private readonly lastRotation = new Quaternion();
  private readonly rotation = new Quaternion();
  private readonly euler = new Euler();

  setCamera(camera?: Camera): void { if (camera === this.camera) return; this.restore(); this.camera = camera; }
  discover(camera: Camera): void { if (!this.camera) this.camera = camera; }

  add(event: PhysicalEvent, time: number): void {
    const mass = Math.max(0, event.mass ?? 0);
    const impulse = Math.max(0, event.impulse ?? Math.sqrt(2 * mass * Math.max(event.energy, 0)));
    if (!impulse) return;
    const strength = Math.min(1, Math.log1p(impulse / 200) * 0.2 + Math.log1p(mass / 100) * 0.1);
    this.pulses.push({ position: [...event.position], strength, time });
    if (this.pulses.length > 24) this.pulses.shift();
  }

  restore(): void {
    const camera = this.camera;
    if (!camera || !this.applied) return;
    // A host that wrote a new pose already removed our offset; don't subtract it twice.
    if (camera.position.equals(this.lastPosition)) camera.position.copy(this.basePosition);
    if (camera.quaternion.equals(this.lastRotation)) camera.quaternion.copy(this.baseRotation);
    camera.updateMatrixWorld();
    this.applied = false;
  }

  update(time: number, reducedMotion: boolean, strength = 1): void {
    this.restore();
    this.pulses = this.pulses.filter(pulse => time - pulse.time < 0.65);
    const camera = this.camera;
    if (!camera || reducedMotion || strength <= 0) return;
    let x = 0, y = 0, roll = 0;
    for (const pulse of this.pulses) {
      const age = Math.max(0, time - pulse.time);
      const distance = camera.position.distanceTo(new Vector3(...pulse.position));
      const envelope = pulse.strength * Math.exp(-age * 10) / (1 + distance * distance / 144);
      x += envelope * Math.sin(age * 97 + 0.5);
      y += envelope * Math.sin(age * 113 + 1.4);
      roll += envelope * Math.sin(age * 83 + 2.1);
    }
    if (Math.abs(x) + Math.abs(y) + Math.abs(roll) < 0.00001) return;
    this.basePosition.copy(camera.position); this.baseRotation.copy(camera.quaternion);
    const clamp = (value: number) => Math.max(-1, Math.min(1, value * strength));
    camera.position.add(new Vector3(clamp(x) * 0.04, clamp(y) * 0.035, 0).applyQuaternion(this.baseRotation));
    this.rotation.setFromEuler(this.euler.set(clamp(y) * 0.012, clamp(x) * 0.01, clamp(roll) * 0.014));
    camera.quaternion.multiply(this.rotation);
    this.lastPosition.copy(camera.position); this.lastRotation.copy(camera.quaternion);
    camera.updateMatrixWorld();
    this.applied = true;
  }

  clear(): void { this.restore(); this.pulses.length = 0; }
}
