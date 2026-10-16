import { createWorld, trait, type Entity } from 'koota';
import {
  AGENT_RADIUS,
  Buttons,
  DEFAULT_SKILL,
  DT,
  type AgentCommand,
  type Observation,
  type RuntimeConfig,
  type SelfState,
  type SimEvent,
  type SimulationRules,
  type Stance,
  type TacticalMap,
  type TeamId,
  type Vec3,
} from '@blacksite/ai-schema';
import {
  clamp,
  distance,
  hashValue,
  insideObstacle,
  quantize,
  randomAt,
  segmentRectEntry,
  wrapAngle,
} from './math';
import { ObservationGenerator } from './observations';
export {
  ObservationGenerator,
  type ObservationGeneratorOptions,
  type ObservationLineOfSightContext,
} from './observations';
export {
  clamp,
  distance,
  hashValue,
  insideObstacle,
  lineClear,
  quantize,
  randomAt,
  segmentRectEntry,
  wrapAngle,
} from './math';
const Identity = trait({ id: '', team: '' });
const Transform = trait({ pitch: 0, x: 0, y: 0, yaw: 0, z: 0 });
const Velocity = trait({ x: 0, y: 0, z: 0 });
const Body = trait({ health: 100, kills: 0, reviveTicks: 0, stance: 0, suppression: 0 });
const Weapon = trait({ ammo: 24, lastShotAt: -100, recoil: 0, reloadingUntil: 0, reserveAmmo: 96 });
const STANCES: Array<Stance> = ['stand', 'crouch', 'prone'];
const eyeHeight = (stance: Stance) =>
  stance === 'stand' ? 1.5 : stance === 'crouch' ? 0.93 : 0.35;
const bodyHeight = (stance: Stance) =>
  stance === 'stand' ? 1.78 : stance === 'crouch' ? 1.12 : 0.5;
export const RULES = {
  acceleration: 18,
  captureTicks: 240,
  damage: 26,
  fireIntervalTicks: 4,
  magazine: 24,
  radius: AGENT_RADIUS,
  range: 65,
  reloadTicks: 63,
} as const;
export type SimulationSetup = {
  config: RuntimeConfig;
  rules?: SimulationRules;
  initialAmmo?: number;
  initialHealth?: (team: TeamId, index: number) => number;
  map: TacticalMap;
};
export type SimulationStep = {
  checksum: string;
  commands: Array<AgentCommand>;
  events: Array<SimEvent>;
};
export function neutralCommand(
  tick: number,
  agentId: string,
  source: AgentCommand['source'] = 'ai',
): AgentCommand {
  return {
    agentId,
    buttons: 0,
    lookDelta: { pitch: 0, yaw: 0 },
    move: { x: 0, y: 0 },
    source,
    sourceSequence: tick,
    stance: 'stand',
    tick,
  };
}
export function normalizeCommand(command: AgentCommand, tick: number): AgentCommand {
  const numbers = [
    command.move?.x,
    command.move?.y,
    command.lookDelta?.yaw,
    command.lookDelta?.pitch,
    command.buttons,
    command.sourceSequence,
  ];
  if (
    command.tick !== tick ||
    numbers.some((value) => !Number.isFinite(value)) ||
    !STANCES.includes(command.stance) ||
    !['human', 'ai'].includes(command.source)
  ) {
    return neutralCommand(tick, command.agentId, command.source === 'human' ? 'human' : 'ai');
  }
  const length = Math.max(1, Math.hypot(command.move.x, command.move.y));
  return {
    agentId: command.agentId,
    buttons: Math.trunc(command.buttons) & 1023,
    lookDelta: {
      pitch: quantize(clamp(command.lookDelta.pitch, -0.3, 0.3)),
      yaw: quantize(clamp(command.lookDelta.yaw, -0.5, 0.5)),
    },
    move: { x: quantize(command.move.x / length), y: quantize(command.move.y / length) },
    source: command.source,
    sourceSequence: Math.max(0, Math.trunc(command.sourceSequence)),
    stance: command.stance,
    tick,
  };
}
const approach = (value: number, target: number) =>
  value + clamp(target - value, -RULES.acceleration * DT, RULES.acceleration * DT);

export class AuthoritativeSimulation {
  readonly map: TacticalMap;
  readonly config: RuntimeConfig;
  private readonly rules: Required<SimulationRules>;
  private readonly world = createWorld();
  private readonly entities = new Map<string, Entity>();
  private readonly observations: ObservationGenerator;
  private lastCommands: Array<AgentCommand> = [];
  private eventSequence = 0;
  private disposed = false;
  tick = 0;
  status: 'running' | 'complete' = 'running';
  winner?: TeamId | 'draw';
  objective: {
    owner?: TeamId;
    position: Vec3;
    progress: number;
  };
  constructor(setup: SimulationSetup) {
    this.map = setup.map;
    this.config = setup.config;
    this.rules = {
      damage: setup.rules?.damage ?? RULES.damage,
      spread: setup.rules?.spread ?? 0.002,
      suppressedSpread: setup.rules?.suppressedSpread ?? 0,
    };
    this.observations = new ObservationGenerator({ map: this.map, seed: this.config.seed });
    this.objective = { position: { ...this.map.objectives[0]!.position }, progress: 0 };
    for (const team of ['alpha', 'bravo'] as const) {
      this.map.spawns[team].forEach((position, index) => {
        const id = `${team}-${index + 1}`;
        const entity = this.world.spawn(
          Identity({ id, team }),
          Transform({ ...position, pitch: 0, yaw: team === 'alpha' ? Math.PI / 2 : -Math.PI / 2 }),
          Velocity,
          Body({
            health: setup.initialHealth?.(team, index) ?? 100,
            kills: 0,
            reviveTicks: 0,
            stance: 0,
            suppression: 0,
          }),
          Weapon({
            ammo: setup.initialAmmo ?? 24,
            lastShotAt: -100,
            recoil: 0,
            reloadingUntil: 0,
            reserveAmmo: 96,
          }),
        );
        this.entities.set(id, entity);
      });
    }
  }
  get states(): Array<SelfState> {
    this.assertActive();
    return [...this.entities].map(([id, entity]) => {
      const identity = entity.get(Identity)!;
      const transform = entity.get(Transform)!;
      const velocity = entity.get(Velocity)!;
      const body = entity.get(Body)!;
      const weapon = entity.get(Weapon)!;
      return {
        alive: body.health > 0,
        ammo: weapon.ammo,
        health: body.health,
        id,
        lastShotAt: weapon.lastShotAt,
        pitch: transform.pitch,
        position: { x: transform.x, y: transform.y, z: transform.z },
        reloadingUntil: weapon.reloadingUntil,
        reserveAmmo: weapon.reserveAmmo,
        skill: { ...DEFAULT_SKILL, ...this.config.skill },
        stance: STANCES[body.stance] ?? 'stand',
        suppression: body.suppression,
        team: identity.team as TeamId,
        velocity: { ...velocity },
        yaw: transform.yaw,
      };
    });
  }
  kills(id: string): number {
    return this.entities.get(id)?.get(Body)?.kills ?? 0;
  }
  observation(id: string): Observation | undefined {
    return this.observations.observation(id);
  }
  generateObservations(): Map<string, Array<Observation>> {
    this.assertActive();
    return this.observations.generate(this.tick, this.states);
  }
  step(input: ReadonlyArray<AgentCommand>): SimulationStep {
    this.assertActive();
    if (this.status === 'complete') {
      return { checksum: this.checksum(), commands: [], events: [] };
    }
    this.tick++;
    const tick = this.tick;
    const events: Array<SimEvent> = [];
    const commands = new Map<string, AgentCommand>();
    for (const command of input) {
      if (this.entities.has(command.agentId) && command.tick === tick) {
        const prior = commands.get(command.agentId);
        if (!prior || command.sourceSequence > prior.sourceSequence) {
          commands.set(command.agentId, normalizeCommand(command, tick));
        }
      }
    }
    this.lastCommands = [...this.entities.keys()].map(
      (id) => commands.get(id) ?? neutralCommand(tick, id),
    );
    this.world.query(Body, Weapon).updateEach(([body, weapon]) => {
      body.suppression = quantize(Math.max(0, body.suppression - DT * 0.35));
      weapon.recoil = quantize(Math.max(0, weapon.recoil - DT * 0.35));
      if (weapon.reloadingUntil > 0 && tick >= weapon.reloadingUntil) {
        const amount = Math.min(RULES.magazine - weapon.ammo, weapon.reserveAmmo);
        weapon.ammo += amount;
        weapon.reserveAmmo -= amount;
        weapon.reloadingUntil = 0;
      }
    });
    for (const command of this.lastCommands) {
      this.applyMovement(command);
    }
    const states = this.states;
    for (const command of this.lastCommands) {
      const shooter = states.find((state) => state.id === command.agentId)!;
      if (!shooter.alive) {
        continue;
      }
      const entity = this.entities.get(command.agentId)!;
      const weapon = entity.get(Weapon)!;
      if (
        command.buttons & Buttons.reload &&
        weapon.ammo < RULES.magazine &&
        weapon.reserveAmmo > 0 &&
        !weapon.reloadingUntil
      ) {
        entity.set(Weapon, { ...weapon, reloadingUntil: tick + RULES.reloadTicks });
      }
      const updated = entity.get(Weapon)!;
      if (
        command.buttons & Buttons.fire &&
        !(command.buttons & Buttons.sprint) &&
        !updated.reloadingUntil &&
        updated.ammo > 0 &&
        tick - updated.lastShotAt >= RULES.fireIntervalTicks
      ) {
        this.fire(shooter, states, events);
      }
      if (command.buttons & Buttons.use) {
        this.revive(shooter, states, events);
      }
    }
    this.updateObjective(events);
    const alpha = this.states.filter((state) => state.team === 'alpha' && state.alive).length;
    const bravo = this.states.filter((state) => state.team === 'bravo' && state.alive).length;
    if (alpha === 0 || bravo === 0) {
      this.status = 'complete';
      this.winner = alpha === bravo ? 'draw' : alpha > 0 ? 'alpha' : 'bravo';
    }
    if (tick >= this.config.maxTicks) {
      this.status = 'complete';
      this.winner =
        this.objective.owner ?? (alpha === bravo ? 'draw' : alpha > bravo ? 'alpha' : 'bravo');
    }
    return { checksum: this.checksum(), commands: structuredClone(this.lastCommands), events };
  }
  private applyMovement(command: AgentCommand): void {
    const entity = this.entities.get(command.agentId)!;
    const body = entity.get(Body)!;
    const transform = entity.get(Transform)!;
    const velocity = entity.get(Velocity)!;
    if (body.health <= 0) {
      entity.set(Velocity, { x: 0, y: 0, z: 0 });
      return;
    }
    const stance = command.stance;
    const speed =
      stance === 'prone'
        ? 1.25
        : stance === 'crouch'
          ? 2.5
          : command.buttons & Buttons.sprint
            ? 6.4
            : 4.5;
    let vx = approach(velocity.x, command.move.x * speed),
      vz = approach(velocity.z, command.move.y * speed);
    const origin = { x: transform.x, y: 0, z: transform.z };
    let position = { x: quantize(origin.x + vx * DT), y: 0, z: quantize(origin.z + vz * DT) };
    const blocked = (point: Vec3) =>
      insideObstacle(this.map, point, RULES.radius) ||
      [...this.entities].some(([id, other]) => {
        if (id === command.agentId || other.get(Body)!.health <= 0) {
          return false;
        }
        const otherPosition = other.get(Transform)!;
        return Math.hypot(point.x - otherPosition.x, point.z - otherPosition.z) < RULES.radius * 2;
      });
    if (blocked(position)) {
      const xOnly = { ...origin, x: position.x },
        zOnly = { ...origin, z: position.z };
      if (!blocked(xOnly)) {
        position = xOnly;
        vz = 0;
      } else if (!blocked(zOnly)) {
        position = zOnly;
        vx = 0;
      } else {
        position = origin;
        vx = 0;
        vz = 0;
      }
    }
    entity.set(Transform, {
      ...position,
      pitch: quantize(clamp(transform.pitch + command.lookDelta.pitch, -1.35, 1.35)),
      yaw: quantize(wrapAngle(transform.yaw + command.lookDelta.yaw)),
    });
    entity.set(Velocity, { x: quantize(vx), y: 0, z: quantize(vz) });
    entity.set(Body, { ...body, stance: STANCES.indexOf(stance) });
  }
  private fire(shooter: SelfState, states: Array<SelfState>, events: Array<SimEvent>): void {
    const entity = this.entities.get(shooter.id)!;
    const weapon = entity.get(Weapon)!;
    const spread =
      this.rules.spread +
      Math.hypot(shooter.velocity.x, shooter.velocity.z) * 0.0008 +
      shooter.suppression * this.rules.suppressedSpread;
    const yaw =
      shooter.yaw +
      (randomAt(this.config.seed, `${shooter.id}:weapon-spread`, this.tick, 0) - 0.5) * spread;
    const pitch =
      shooter.pitch +
      (randomAt(this.config.seed, `${shooter.id}:weapon-spread`, this.tick, 1) - 0.5) * spread;
    const origin = { ...shooter.position, y: eyeHeight(shooter.stance) };
    const direction = {
      x: Math.sin(yaw) * Math.cos(pitch),
      y: Math.sin(pitch),
      z: Math.cos(yaw) * Math.cos(pitch),
    };
    const fullEnd = {
      x: origin.x + direction.x * RULES.range,
      y: origin.y + direction.y * RULES.range,
      z: origin.z + direction.z * RULES.range,
    };
    let hitDistance: number = RULES.range;
    for (const obstacle of this.map.obstacles) {
      const entry = segmentRectEntry(origin, fullEnd, obstacle);
      if (
        entry !== undefined &&
        origin.y + direction.y * entry * RULES.range <= obstacle.height &&
        origin.y + direction.y * entry * RULES.range >= 0
      ) {
        hitDistance = Math.min(hitDistance, entry * RULES.range);
      }
    }
    let victim: SelfState | undefined;
    for (const target of states) {
      if (!target.alive || target.id === shooter.id) {
        continue;
      }
      const dx = target.position.x - origin.x,
        dz = target.position.z - origin.z;
      const horizontal = direction.x * direction.x + direction.z * direction.z;
      const t = (dx * direction.x + dz * direction.z) / Math.max(0.01, horizontal);
      if (t < 0 || t > hitDistance) {
        continue;
      }
      const miss = Math.hypot(
        origin.x + direction.x * t - target.position.x,
        origin.z + direction.z * t - target.position.z,
      );
      const height = origin.y + direction.y * t;
      if (miss < RULES.radius && height >= 0.05 && height <= bodyHeight(target.stance)) {
        hitDistance = Math.max(0, t - Math.sqrt(RULES.radius ** 2 - miss ** 2));
        victim = target;
      }
    }
    const end = {
      x: quantize(origin.x + direction.x * hitDistance),
      y: quantize(origin.y + direction.y * hitDistance),
      z: quantize(origin.z + direction.z * hitDistance),
    };
    const shot = this.event('shot', `${shooter.id} fired`, shooter.id, shooter.team, origin, end);
    events.push(shot);
    this.observations.recordShot(shot, shooter.position);
    entity.set(Weapon, {
      ...weapon,
      ammo: weapon.ammo - 1,
      lastShotAt: this.tick,
      recoil: quantize(Math.min(1, weapon.recoil + 0.09)),
    });
    const transform = entity.get(Transform)!;
    entity.set(Transform, {
      ...transform,
      pitch: quantize(clamp(transform.pitch + 0.008 + weapon.recoil * 0.009, -1.35, 1.35)),
    });
    if (victim) {
      const target = this.entities.get(victim.id)!;
      const body = target.get(Body)!;
      const health = Math.max(0, body.health - this.rules.damage);
      target.set(Body, { ...body, health, suppression: Math.min(1, body.suppression + 0.35) });
      this.observations.recordDamage(victim.id, shooter.position, this.tick);
      if (health === 0 && body.health > 0) {
        const shooterBody = entity.get(Body)!;
        entity.set(Body, {
          ...shooterBody,
          kills: shooterBody.kills + (victim.team === shooter.team ? -1 : 1),
        });
        events.push(
          this.event(
            'kill',
            `${shooter.id} incapacitated ${victim.id}`,
            shooter.id,
            shooter.team,
            victim.position,
          ),
        );
      }
    }
    for (const target of states) {
      if (!target.alive || target.id === shooter.id || target.team === shooter.team) {
        continue;
      }
      const dx = end.x - origin.x,
        dz = end.z - origin.z;
      const projection = clamp(
        ((target.position.x - origin.x) * dx + (target.position.z - origin.z) * dz) /
          Math.max(0.01, dx * dx + dz * dz),
        0,
        1,
      );
      const close = Math.hypot(
        origin.x + projection * dx - target.position.x,
        origin.z + projection * dz - target.position.z,
      );
      if (close < 2) {
        const other = this.entities.get(target.id)!;
        const body = other.get(Body)!;
        other.set(Body, { ...body, suppression: quantize(Math.min(1, body.suppression + 0.1)) });
      }
    }
  }
  private revive(shooter: SelfState, states: Array<SelfState>, events: Array<SimEvent>): void {
    const target = states.find(
      (state) =>
        !state.alive &&
        state.team === shooter.team &&
        distance(state.position, shooter.position) < 1.5,
    );
    if (!target) {
      return;
    }
    const entity = this.entities.get(target.id)!;
    const body = entity.get(Body)!;
    entity.set(Body, {
      ...body,
      health: body.reviveTicks >= 89 ? 35 : body.health,
      reviveTicks: body.reviveTicks + 1,
    });
    if (body.reviveTicks >= 89) {
      events.push(
        this.event(
          'objective',
          `${shooter.id} revived ${target.id}`,
          shooter.id,
          shooter.team,
          target.position,
        ),
      );
    }
  }
  private updateObjective(events: Array<SimEvent>): void {
    const near = this.states.filter(
      (state) => state.alive && distance(state.position, this.objective.position) <= 3.4,
    );
    const teams = new Set(near.map((state) => state.team));
    if (teams.size === 1) {
      const owner = near[0]!.team;
      if (this.objective.owner !== owner) {
        this.objective.progress = Math.max(0, this.objective.progress - 1 / RULES.captureTicks);
        if (this.objective.progress === 0) {
          this.objective.owner = owner;
          events.push(
            this.event(
              'objective',
              `${owner.toUpperCase()} contesting relay`,
              undefined,
              owner,
              this.objective.position,
            ),
          );
        }
      } else {
        this.objective.progress = Math.min(1, this.objective.progress + 1 / RULES.captureTicks);
      }
      if (this.objective.progress >= 1) {
        this.status = 'complete';
        this.winner = owner;
        events.push(
          this.event(
            'objective',
            `${owner.toUpperCase()} secured the relay`,
            undefined,
            owner,
            this.objective.position,
          ),
        );
      }
    }
    this.objective.progress = quantize(this.objective.progress);
  }
  checksum(): string {
    return hashValue({
      kills: [...this.entities.keys()].map((id) => this.kills(id)),
      objective: this.objective,
      states: this.states,
      status: this.status,
      tick: this.tick,
      winner: this.winner,
    });
  }
  dispose(): void {
    if (!this.disposed) {
      this.observations.dispose();
      this.world.destroy();
      this.entities.clear();
      this.disposed = true;
    }
  }
  private assertActive(): void {
    if (this.disposed) {
      throw new Error('Simulation is disposed');
    }
  }
  private event(
    type: SimEvent['type'],
    text: string,
    agentId?: string,
    team?: TeamId,
    position?: Vec3,
    endPosition?: Vec3,
  ): SimEvent {
    return {
      agentId,
      endPosition: endPosition && { ...endPosition },
      id: `sim:${this.tick}:${this.eventSequence++}`,
      position: position && { ...position },
      team,
      text,
      tick: this.tick,
      type,
    };
  }
}
