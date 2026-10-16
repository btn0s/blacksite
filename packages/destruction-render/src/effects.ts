import {
  BufferAttribute, Color, DynamicDrawUsage, Euler, Group, InstancedBufferAttribute, InstancedBufferGeometry,
  Mesh, Quaternion, ShaderMaterial, Vector3, type Camera,
} from 'three';
import type { DestructionEvent, SimulationFrame, Vec3 } from '../../destruction-domain/src/index';

// Optional additions keep this renderer source-compatible with older snapshot producers.
type PhysicalEvent = DestructionEvent & { mass?: number; impulse?: number; normal?: Vec3; radius?: number };

/** A bounded GPU particle ring. Events upload spawn data once; time advances in the shader. */
export class DestructionEffects {
  readonly group = new Group();
  private readonly geometry = new InstancedBufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly origin: InstancedBufferAttribute;
  private readonly velocity: InstancedBufferAttribute;
  private readonly life: InstancedBufferAttribute;
  private readonly size: InstancedBufferAttribute;
  private readonly color: InstancedBufferAttribute;
  private cursor = 0;
  private count = 0;
  private lastTick = -1;
  private readonly seen = new Map<string, number>();
  readonly shake = new ImpactCameraShake();

  constructor(readonly capacity = 2048) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Particle capacity must be a positive integer');
    this.group.name = 'cascade-event-dust-and-smoke';
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0]), 3));
    this.geometry.setIndex([0,1,2,0,2,3]);
    this.origin = this.attribute('spawnPosition', 3);
    this.velocity = this.attribute('spawnVelocity', 3);
    this.life = this.attribute('spawnLife', 2);
    this.size = this.attribute('spawnShape', 3);
    this.color = this.attribute('spawnColor', 3);
    this.geometry.instanceCount = 0;
    this.material = new ShaderMaterial({
      name: 'cascade-dust-smoke', transparent: true, depthWrite: false,
      uniforms: { time: { value: 0 }, reducedMotion: { value: 0 } },
      vertexShader: `
        attribute vec3 spawnPosition, spawnVelocity, spawnColor;
        attribute vec2 spawnLife;
        attribute vec3 spawnShape;
        uniform float time, reducedMotion;
        varying vec2 cloudUV;
        varying vec3 cloudColor;
        varying float cloudAlpha, cloudSeed;
        void main() {
          float age = time - spawnLife.x;
          float t = clamp(age / max(spawnLife.y, 0.01), 0.0, 1.0);
          float smoke = spawnShape.y;
          float travel = (1.0 - exp(-age * 1.4)) / 1.4;
          vec3 center = spawnPosition + spawnVelocity * max(0.0, travel);
          center.y += mix(-0.55 * age * age, 0.36 * age, smoke);
          center = mix(center, spawnPosition, reducedMotion);
          float radius = spawnShape.x * (1.0 + mix(1.0, 2.8, smoke) * t);
          radius = mix(radius, spawnShape.x * 1.5, reducedMotion);
          vec4 view = modelViewMatrix * vec4(center, 1.0);
          view.xy += position.xy * radius;
          gl_Position = projectionMatrix * view;
          cloudUV = position.xy;
          cloudColor = spawnColor;
          cloudSeed = spawnShape.z;
          cloudAlpha = smoothstep(0.0, 0.055, t) * pow(1.0 - t, mix(1.6, 1.1, smoke));
          cloudAlpha *= step(0.0, age) * mix(0.3, 0.2, smoke);
        }`,
      fragmentShader: `
        varying vec2 cloudUV;
        varying vec3 cloudColor;
        varying float cloudAlpha, cloudSeed;
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          vec4 h = fract(sin(vec4(dot(i,vec2(127.1,311.7)),dot(i+vec2(1,0),vec2(127.1,311.7)),dot(i+vec2(0,1),vec2(127.1,311.7)),dot(i+vec2(1,1),vec2(127.1,311.7)))+cloudSeed)*43758.5453);
          return mix(mix(h.x,h.y,f.x),mix(h.z,h.w,f.x),f.y);
        }
        void main() {
          float radial = 1.0 - smoothstep(0.25, 1.0, dot(cloudUV,cloudUV));
          float density = noise(cloudUV*3.5+cloudSeed)*0.65 + noise(cloudUV*8.0-cloudSeed)*0.35;
          float alpha = cloudAlpha * radial * smoothstep(0.12,0.8,density);
          if(alpha < 0.002) discard;
          gl_FragColor = vec4(cloudColor * (0.85 + density*0.2), alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new Mesh(this.geometry, this.material);
    mesh.name = 'cascade-event-clouds';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.group.add(mesh);
  }

  /** Render-clock work is just uniforms; event ingestion stays at snapshot rate. */
  advance(time: number, reducedMotion: boolean): void {
    this.material.uniforms.time!.value = time;
    this.material.uniforms.reducedMotion!.value = reducedMotion ? 1 : 0;
  }

  update(frame: SimulationFrame | null | undefined, time: number, reducedMotion: boolean): void {
    this.advance(time, reducedMotion);
    if (!frame) return;
    if (frame.tick < this.lastTick) {
      this.seen.clear(); this.cursor = this.count = 0;
      this.geometry.instanceCount = 0; this.shake.clear();
    }
    this.lastTick = frame.tick;
    for (let i = 0; i < frame.events.length; i++) {
      const event: PhysicalEvent = frame.events[i]!;
      const key = `${event.tick}:${i}:${event.type}:${event.position.join(',')}:${event.energy}:${event.count}`;
      if (this.seen.has(key)) continue;
      this.seen.set(key, event.tick);
      this.spawn(event, time);
      if (event.type === 'heavyImpact' || event.type === 'cannonballImpact' || event.type === 'explosiveDetonated') this.shake.add(event, time);
    }
    for (const [key, tick] of this.seen) if (tick < frame.tick - 300) this.seen.delete(key);
  }

  emit(event: PhysicalEvent, time: number): void {
    this.spawn(event, time);
    if (event.type === 'heavyImpact' || event.type === 'cannonballImpact' || event.type === 'explosiveDetonated') this.shake.add(event, time);
  }

  private spawn(event: PhysicalEvent, time: number): void {
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
      const slot = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      this.count = Math.min(this.capacity, this.count + 1);
      const smoke = (blast || impact || mass > 500) && i % 3 === 0 ? 1 : 0;
      const x = random() * 2 - 1, y = random() * 2 - 1, z = random() * 2 - 1;
      this.origin.setXYZ(slot, event.position[0] + x * extent * 0.45, event.position[1] + y * extent * 0.2, event.position[2] + z * extent * 0.45);
      this.velocity.setXYZ(slot, (x + normal[0] * 0.5) * speed, (Math.abs(y) + normal[1] * 0.5) * speed * 0.65, (z + normal[2] * 0.5) * speed);
      this.life.setXY(slot, time, (smoke ? 4.5 : settled ? 1.4 : 2.3) + random() * 1.5);
      this.size.setXYZ(slot, Math.min(2.8, (0.12 + extent * 0.32) * (0.6 + random())), smoke, random() * 100);
      const tint = smoke && blast ? new Color('#45464a') : new Color(smoke ? '#928b80' : '#a79e8e');
      this.color.setXYZ(slot, tint.r, tint.g, tint.b);
      for (const attribute of [this.origin, this.velocity, this.life, this.size, this.color]) {
        attribute.addUpdateRange(slot * attribute.itemSize, attribute.itemSize);
        attribute.needsUpdate = true;
      }
    }
    this.geometry.instanceCount = this.count;
  }

  private attribute(name: string, size: number): InstancedBufferAttribute {
    const attribute = new InstancedBufferAttribute(new Float32Array(this.capacity * size), size).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute(name, attribute);
    return attribute;
  }

  dispose(): void { this.shake.restore(); this.geometry.dispose(); this.material.dispose(); this.seen.clear(); }
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
