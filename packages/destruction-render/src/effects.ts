import { Color, Group } from 'three';
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
      this.particles.reset();
    }
    this.lastTick = frame.tick;
    for (let i = 0; i < frame.events.length; i++) {
      const event: PhysicalEvent = frame.events[i]!;
      const key = `${event.tick}:${i}:${event.type}:${event.position.join(',')}:${event.energy}:${event.count}`;
      if (this.seen.has(key)) continue;
      this.seen.set(key, event.tick);
      this.spawn(event);
    }
    for (const [key, tick] of this.seen) if (tick < frame.tick - 300) this.seen.delete(key);
  }

  emit(event: PhysicalEvent, time: number): void {
    this.particles.advance(time - this.particles.time);
    this.spawn(event);
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
        acceleration: { x: 0, y: smoke ? 0.5 : -3.05, z: 0 },
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

  dispose(): void { this.particles.dispose(); this.seen.clear(); }
}
