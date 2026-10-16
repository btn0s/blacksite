import {
  DEFAULT_CONFIG,
  VERSIONS,
  validateRuntimeWorld,
  Buttons,
  type AgentCommand,
  type AgentView,
  type AttackTokenRules,
  type Intent,
  type IntentRules,
  type Role,
  type DecisionSnapshot,
  type DecisionTrace,
  type ExecutionView,
  type MotorGoal,
  type Observation,
  type Plan,
  type RenderSnapshot,
  type ReplayFile,
  type RuntimeConfig,
  type RuntimeWorld,
  type RuntimeMetrics,
  type SelfState,
  type SimEvent,
  type SquadPlan,
  type StrategicOrder,
  type TacticalCandidate,
  type TacticalMap,
  type TeamId,
  type Vec3,
  type WatchSector,
} from '@blacksite/ai-schema';
import {
  AuthoritativeSimulation,
  distance,
  neutralCommand,
  normalizeCommand,
  randomAt,
} from '@blacksite/sim-core';
import { createScenario } from '@blacksite/ai-scenarios';
import { BeliefStore, RadioNetwork } from '@blacksite/ai-belief';
import { findPath, registerTacticalSpatialQueries } from '@blacksite/ai-nav';
import { ReservationTable, scorePositions } from '@blacksite/ai-tactics';
import { planIndividual } from '@blacksite/ai-planning';
import { chooseStrategicOrder, SquadCoordinator } from '@blacksite/ai-squad';
import { SkillExecutor } from '@blacksite/ai-execution';
import { MotorController } from '@blacksite/ai-motor';
import { PerformanceWindow, ReplayRecorder } from '@blacksite/ai-telemetry';
import { pruneEvidenceLedger } from './evidence';
import type { TacticalAuthority, TacticalRuntimeOptions } from './authority';
export type { TacticalAuthority, TacticalRuntimeOptions } from './authority';
type AgentCognition = {
  alive: boolean;
  attention: Vec3;
  belief: BeliefStore;
  candidates: Array<TacticalCandidate>;
  command?: AgentCommand;
  evidence: Map<string, number>;
  executor: SkillExecutor;
  fireGate: string;
  goal: MotorGoal;
  lastDecision?: DecisionSnapshot;
  lastHealth: number;
  lastPosition: Vec3;
  motor: MotorController;
  nextPathTick: number;
  nextTacticalTick: number;
  path: Array<Vec3>;
  pathDestination?: Vec3;
  plan?: Plan;
  radioAt: number;
  sawThreat: boolean;
  stationaryTicks: number;
  trace?: DecisionTrace;
  view: ExecutionView;
  watchKey?: string;
  intent?: Intent;
  holdUntil: number;
  token?: { since: number; lastWanted: number };
  tokenCooldownUntil: number;
};
type TeamCognition = {
  authorizedWatches: Map<string, WatchSector>;
  casualties: Map<
    string,
    {
      observedAt: number;
      position: Vec3;
    }
  >;
  coordinator: SquadCoordinator;
  evidence: Map<string, number>;
  membersAlive: number;
  order?: StrategicOrder;
  plan?: SquadPlan;
  reservations: ReservationTable;
  shared: BeliefStore;
};
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      freeze(child);
    }
  }
  return value;
}
function validateConfig(config: RuntimeConfig): RuntimeConfig {
  if (
    !Number.isInteger(config.seed) ||
    !Number.isInteger(config.agentsPerTeam) ||
    config.agentsPerTeam < 1 ||
    config.agentsPerTeam > 8 ||
    !Number.isInteger(config.maxTicks) ||
    config.maxTicks < 1 ||
    config.maxTicks > 36_000 ||
    !Number.isInteger(config.radioLatencyTicks) ||
    config.radioLatencyTicks < 1 ||
    config.radioLatencyTicks > 300
  ) {
    throw new Error('Invalid runtime seed, agent count, tick limit, or radio latency');
  }
  if (!['symbolic', 'shadow', 'hybrid'].includes(config.policyMode)) {
    throw new Error('Invalid policy mode');
  }
  if (
    Object.keys(DEFAULT_CONFIG.skill).some((key) => {
      const value = config.skill[key as keyof typeof config.skill];
      return !Number.isFinite(value) || value < 0 || value > 1;
    })
  ) {
    throw new Error('Skill dimensions must be finite values in [0,1]');
  }
  return structuredClone(config);
}
function worldSetup(config: RuntimeConfig, world?: RuntimeWorld) {
  if (!world) {
    return createScenario(config.scenarioId, config.agentsPerTeam);
  }
  return {
    initialAmmo: world.initialAmmo,
    initialHealth: (team: TeamId, index: number) =>
      world.initialHealth?.[`${team}-${index + 1}`] ?? 100,
    map: world.map,
    rules: world.rules,
  };
}
export function intentOf(view: ExecutionView, plan: Plan | undefined, role: Role | undefined): Intent | undefined {
  switch (view.skill) {
    case 'move':
      if (plan?.goal === 'fulfill-role') {
        return role === 'flank' ? 'flank' : role === 'point' ? 'advance' : 'cover';
      }
      return plan?.goal === 'survive' ? 'fallback' : 'cover';
    case 'engage':
    case 'suppress':
    case 'reload':
    case 'fallback':
    case 'search':
    case 'hold':
      return view.skill;
    default:
      return undefined;
  }
}
const LEADING: ReadonlySet<Intent> = new Set(['advance', 'flank']);
const createTeam = (id: TeamId): TeamCognition => ({
  authorizedWatches: new Map(),
  casualties: new Map(),
  coordinator: new SquadCoordinator(id),
  evidence: new Map(),
  membersAlive: 0,
  reservations: new ReservationTable(),
  shared: new BeliefStore(`shared:${id}`),
});

export class TacticalRuntime {
  readonly map: TacticalMap;
  readonly config: RuntimeConfig;
  private readonly customWorld?: RuntimeWorld;
  private readonly sim: TacticalAuthority;
  private readonly controlledAgentIds: ReadonlySet<string>;
  private readonly attackTokens?: AttackTokenRules;
  private readonly intents?: IntentRules;
  private readonly agents = new Map<string, AgentCognition>();
  private readonly teams: Record<TeamId, TeamCognition>;
  private readonly radio: RadioNetwork;
  private readonly performance = new PerformanceWindow();
  private readonly replay?: ReplayRecorder;
  private events: Array<SimEvent> = [];
  private disposed = false;
  private metrics: Omit<RuntimeMetrics, 'tickMs' | 'p50' | 'p95' | 'p99'> = {
    activeReservations: 0,
    deadlineMisses: 0,
    decisions: 0,
    fairnessViolations: 0,
    pendingMessages: 0,
    policyFallbacks: 0,
    shots: 0,
  };
  constructor(
    config: RuntimeConfig = DEFAULT_CONFIG,
    world?: RuntimeWorld,
    options: TacticalRuntimeOptions = {},
  ) {
    this.config = validateConfig(config);
    this.customWorld =
      world === undefined
        ? undefined
        : freeze(
            validateRuntimeWorld(world, this.config.agentsPerTeam, options.authority !== undefined),
          );
    const scenario = worldSetup(this.config, this.customWorld);
    this.map = freeze(scenario.map);
    if (options.spatial) {
      registerTacticalSpatialQueries(this.map, options.spatial);
    }
    this.sim =
      options.authority ??
      new AuthoritativeSimulation({
        config: this.config,
        initialAmmo: scenario.initialAmmo,
        initialHealth: scenario.initialHealth,
        map: this.map,
        rules: 'rules' in scenario ? scenario.rules : undefined,
      });
    this.controlledAgentIds = new Set(options.controlledAgentIds);
    const tokens = options.attackTokens;
    if (
      tokens &&
      (!Number.isInteger(tokens.count) ||
        tokens.count < 0 ||
        tokens.count > 64 ||
        ![tokens.holdTicks, tokens.cooldownTicks, tokens.idleTicks ?? 0].every(
          (value) => Number.isInteger(value) && value >= 0 && value <= 36_000,
        ))
    ) {
      throw new Error('Invalid attack token rules');
    }
    if (
      options.intents &&
      (!Number.isInteger(options.intents.leadTicks) ||
        options.intents.leadTicks < 0 ||
        options.intents.leadTicks > 300)
    ) {
      throw new Error('Invalid intent rules');
    }
    this.attackTokens = tokens && { ...tokens };
    this.intents = options.intents && { ...options.intents };
    const initialStates = structuredClone(this.sim.states);
    const ids = new Set(initialStates.map((self) => self.id));
    if (
      this.sim.tick !== 0 ||
      ids.size !== initialStates.length ||
      initialStates.length === 0 ||
      initialStates.some((self) => !['alpha', 'bravo'].includes(self.team))
    ) {
      throw new Error(
        'Tactical authority must start at tick 0 with unique agents on alpha/bravo teams',
      );
    }
    for (const id of this.controlledAgentIds) {
      if (!ids.has(id)) {
        throw new Error(`Unknown controlled agent: ${id}`);
      }
    }
    this.radio = new RadioNetwork({
      bandwidthTicks: 4,
      latencyTicks: config.radioLatencyTicks,
      lossRate: 0.035,
      maxQueue: 32,
    });
    this.replay = options.authority ? undefined : new ReplayRecorder(this.config, this.customWorld);
    this.teams = { alpha: createTeam('alpha'), bravo: createTeam('bravo') };
    for (const self of initialStates) {
      this.agents.set(self.id, {
        alive: self.alive,
        attention: {
          x: self.position.x + (self.team === 'alpha' ? 5 : -5),
          y: self.position.y + 1.4,
          z: self.position.z,
        },
        belief: new BeliefStore(self.id),
        candidates: [],
        evidence: new Map(),
        executor: new SkillExecutor(self.id, this.teams[self.team].reservations),
        fireGate: 'no-target',
        goal: { fire: false, reload: false, speed: 0, stance: 'stand', targetConfidence: 0 },
        lastHealth: self.health,
        lastPosition: { ...self.position },
        motor: new MotorController(self.id, this.teams[self.team].reservations),
        nextPathTick: 0,
        nextTacticalTick: 0,
        path: [],
        radioAt: -100,
        sawThreat: false,
        stationaryTicks: 0,
        view: { progress: 0, skill: 'idle', state: 'idle' },
        holdUntil: 0,
        tokenCooldownUntil: 0,
      });
    }
    this.coordinate(0, initialStates, true);
  }
  step(overrides: Array<AgentCommand> = []): RenderSnapshot {
    this.assertActive();
    if (this.sim.status === 'complete') {
      return this.snapshot();
    }
    const started = performance.now();
    const tick = this.sim.tick + 1;
    const states = freeze(structuredClone(this.sim.states));
    const observations =
      tick % 2 === 1 ? this.sim.generateObservations() : new Map<string, Array<Observation>>();
    this.deliverRadio(tick, states, observations);
    for (const self of states) {
      const agent = this.agents.get(self.id)!;
      const incoming = observations.get(self.id) ?? [];
      for (const observation of incoming) {
        agent.evidence.set(observation.id, observation.expiresAt + 300);
        if (observation.parentId) {
          agent.evidence.set(observation.parentId, observation.expiresAt + 300);
        }
      }
      agent.belief.integrate(incoming, tick);
      pruneEvidenceLedger(
        agent.evidence,
        tick,
        agent.belief.snapshot().flatMap((track) => track.provenance),
      );
      if (self.alive) {
        this.sendContact(self, agent, incoming, tick);
      }
      if (!self.alive && agent.alive) {
        agent.executor.interrupt('DIED', tick);
        agent.motor.dispose();
        this.teams[self.team].reservations.releaseOwner(self.id);
        agent.plan = undefined;
        agent.view = { interrupt: 'DIED', progress: 0, skill: 'idle', state: 'incapacitated' };
        agent.path = [];
        agent.goal = {
          fire: false,
          reload: false,
          speed: 0,
          stance: self.stance,
          targetConfidence: 0,
        };
        agent.fireGate = 'not-alive';
      }
      agent.alive = self.alive;
    }
    this.coordinate(tick, states);
    const explicit = new Map(
      overrides
        .filter((command) => command.tick === tick)
        .map((command) => [command.agentId, command]),
    );
    const output: Array<AgentCommand> = [];
    for (let index = 0; index < states.length; index++) {
      const self = states[index]!,
        agent = this.agents.get(self.id)!,
        team = this.teams[self.team];
      if (this.controlledAgentIds.has(self.id)) {
        const supplied = explicit.get(self.id);
        agent.command =
          self.alive && supplied?.source === 'human'
            ? normalizeCommand(supplied, tick)
            : { ...neutralCommand(tick, self.id, 'human'), stance: self.stance };
        if (self.alive) {
          agent.view = { progress: 0, skill: 'idle', state: 'controlled' };
        }
        agent.attention = {
          x: self.position.x + Math.sin(self.yaw) * 8,
          y: self.position.y + 1.5 + Math.sin(self.pitch) * 8,
          z: self.position.z + Math.cos(self.yaw) * 8,
        };
        agent.fireGate = self.alive ? 'human-controlled' : 'not-alive';
        agent.lastHealth = self.health;
        output.push(agent.command);
        continue;
      }
      if (!self.alive) {
        output.push(neutralCommand(tick, self.id));
        continue;
      }
      const snapshot = this.buildDecisionSnapshot(tick, self, states, agent, team);
      const watchKey = snapshot.assignment?.watchSector
        ? `${snapshot.assignment.watchSector.id}/${snapshot.assignment.slotId}`
        : undefined;
      const watchChanged = watchKey !== agent.watchKey;
      agent.watchKey = watchKey;
      const newThreat = snapshot.beliefs.some(
        (track) =>
          track.classification === 'enemy' &&
          track.confidence > 0.55 &&
          tick - track.lastObservedAt <= 3,
      );
      const damageInterrupt = self.health < agent.lastHealth - 20 && self.health < 30;
      if (damageInterrupt && agent.plan?.goal !== 'survive') {
        agent.executor.interrupt('HEAVY_DAMAGE', tick);
        this.addEvent({
          agentId: self.id,
          id: `interrupt:${tick}:${self.id}`,
          team: self.team,
          text: `${self.id} broke commitment after heavy damage`,
          tick,
          type: 'interrupt',
        });
        agent.plan = undefined;
      }
      const due =
        watchChanged ||
        (tick + index * 2) % 6 === 0 ||
        !agent.plan ||
        (newThreat &&
          !agent.sawThreat &&
          agent.plan.goal !== 'engage' &&
          agent.plan.goal !== 'reload');
      agent.sawThreat = newThreat;
      if (due) {
        const candidates =
          watchChanged || tick >= agent.nextTacticalTick || !agent.candidates.length
            ? scorePositions(snapshot, team.reservations)
            : agent.candidates;
        if (candidates !== agent.candidates) {
          agent.nextTacticalTick = tick + 30;
        }
        agent.candidates = candidates;
        const decision = freeze({ ...snapshot, candidates });
        agent.lastDecision = decision;
        const planned = planIndividual(decision);
        this.audit(planned.trace, agent, team, tick);
        const active = agent.view.state === 'running';
        const commitmentChanged =
          ['fulfill-role', 'cover-sector'].includes(agent.plan?.goal ?? '') &&
          agent.plan?.actions[0]?.resourceId !== snapshot.assignment?.slotId;
        const keepPrefix =
          active &&
          agent.plan &&
          agent.plan.expiresAtTick > tick + 6 &&
          agent.plan.goal === planned.plan.goal &&
          !commitmentChanged &&
          !watchChanged;
        agent.trace = freeze(planned.trace);
        if (!keepPrefix && agent.executor.commit(planned.plan, tick)) {
          agent.plan = freeze(planned.plan);
          agent.nextPathTick = 0;
        }
        this.metrics.decisions++;
        if (planned.trace.deadline === 'expansion-limit') {
          this.metrics.deadlineMisses++;
        }
      }
      const executionSnapshot = freeze({
        ...snapshot,
        candidates: agent.candidates,
        previousPlan: agent.plan,
      });
      const { goal, view } = agent.executor.tick(executionSnapshot);
      agent.goal = goal;
      agent.view = view;
      if (
        view.state === 'failed' ||
        view.state === 'interrupted' ||
        (view.skill === 'idle' && view.state === 'complete')
      ) {
        agent.plan = undefined;
      }
      if (goal.destination) {
        const changed =
          !agent.pathDestination || distance(agent.pathDestination, goal.destination) > 0.1;
        if (changed || tick >= agent.nextPathTick) {
          agent.path = findPath(this.map, self.position, goal.destination);
          agent.pathDestination = { ...goal.destination };
          agent.nextPathTick = tick + 15;
        }
      } else {
        agent.path = [];
        agent.pathDestination = undefined;
      }
      const moved = distance(agent.lastPosition, self.position);
      agent.stationaryTicks = goal.destination && moved < 0.01 ? agent.stationaryTicks + 1 : 0;
      agent.lastPosition = { ...self.position };
      if (agent.stationaryTicks > 75) {
        agent.executor.interrupt('PATH_BLOCKED', tick);
        agent.plan = undefined;
        agent.nextPathTick = 0;
        agent.stationaryTicks = 0;
        this.addEvent({
          agentId: self.id,
          id: `blocked:${tick}:${self.id}`,
          team: self.team,
          text: `${self.id} requested route repair`,
          tick,
          type: 'interrupt',
        });
      }
      const motor = agent.motor.step(executionSnapshot, goal, agent.path);
      agent.attention = motor.attention;
      agent.fireGate = motor.fireGate;
      let command = motor.command;
      if (this.intents) {
        const intent = intentOf(view, agent.plan, snapshot.assignment?.role);
        if (intent && intent !== agent.intent) {
          this.addEvent({
            agentId: self.id,
            id: `intent:${tick}:${self.id}`,
            position: { ...self.position },
            team: self.team,
            text: intent,
            tick,
            type: 'intent',
          });
          if (LEADING.has(intent)) {
            agent.holdUntil = tick + this.intents.leadTicks;
          }
        }
        agent.intent = intent ?? agent.intent;
        if (tick < agent.holdUntil && (command.move.x || command.move.y)) {
          command = { ...command, move: { x: 0, y: 0 } };
        }
      }
      agent.command = explicit.get(self.id) ?? command;
      agent.lastHealth = self.health;
      output.push(agent.command);
      if (this.config.policyMode !== 'symbolic') {
        this.metrics.policyFallbacks++;
      }
    }
    if (this.attackTokens) {
      this.allocateAttackTokens(tick, states, output);
    }
    const result = this.sim.step(output);
    if (this.sim.tick !== tick) {
      throw new Error('Tactical authority must advance exactly one tick per step');
    }
    for (const event of result.events) {
      this.addEvent(event);
      if (event.type === 'shot') {
        this.metrics.shots++;
      }
    }
    for (const command of result.commands) {
      this.agents.get(command.agentId)!.command = command;
    }
    const after = structuredClone(this.sim.states);
    let casualty = false;
    for (const self of after) {
      const agent = this.agents.get(self.id)!;
      if (!self.alive && agent.alive) {
        casualty = true;
        agent.alive = false;
        agent.executor.interrupt('DIED', tick);
        agent.motor.dispose();
        agent.plan = undefined;
        this.teams[self.team].reservations.releaseOwner(self.id);
        agent.view = { interrupt: 'DIED', progress: 0, skill: 'idle', state: 'incapacitated' };
        agent.path = [];
        agent.goal = {
          fire: false,
          reload: false,
          speed: 0,
          stance: self.stance,
          targetConfidence: 0,
        };
        agent.fireGate = 'not-alive';
      }
    }
    if (casualty) {
      this.coordinate(tick, freeze(after));
    }
    this.replay?.record(this.sim.tick, result.commands, result.checksum);
    this.metrics.pendingMessages = this.radio.pendingCount;
    this.metrics.activeReservations =
      this.teams.alpha.reservations.snapshot().length +
      this.teams.bravo.reservations.snapshot().length;
    this.performance.record(performance.now() - started);
    return this.snapshot();
  }
  /** Agents that hold an attack token on a team, in the order they took it. */
  attackTokenHolders(team: TeamId): Array<string> {
    this.assertActive();
    return [...this.agents]
      .filter(([id, agent]) => agent.token && this.sim.states.some((state) => state.id === id && state.team === team))
      .sort((a, b) => a[1].token!.since - b[1].token!.since || a[0].localeCompare(b[0]))
      .map(([id]) => id);
  }
  private allocateAttackTokens(tick: number, states: ReadonlyArray<SelfState>, output: Array<AgentCommand>): void {
    const rules = this.attackTokens!;
    const idle = rules.idleTicks ?? 15;
    for (const team of ['alpha', 'bravo'] as const) {
      const holders: Array<AgentCognition> = [];
      for (let index = 0; index < states.length; index++) {
        const self = states[index]!;
        if (self.team !== team || this.controlledAgentIds.has(self.id)) {
          continue;
        }
        const agent = this.agents.get(self.id)!;
        const wants = self.alive && (output[index]!.buttons & Buttons.fire) !== 0;
        if (agent.token) {
          if (wants) {
            agent.token.lastWanted = tick;
          }
          const expired = tick - agent.token.since >= rules.holdTicks;
          if (!self.alive || expired || tick - agent.token.lastWanted > idle) {
            agent.token = undefined;
            agent.tokenCooldownUntil = tick + (self.alive ? rules.cooldownTicks : 0);
          } else {
            holders.push(agent);
          }
        }
      }
      for (let index = 0; index < states.length; index++) {
        const self = states[index]!;
        if (self.team !== team || this.controlledAgentIds.has(self.id)) {
          continue;
        }
        const agent = this.agents.get(self.id)!;
        const command = output[index]!;
        if (!self.alive || !(command.buttons & Buttons.fire) || agent.token) {
          continue;
        }
        if (holders.length < rules.count && tick >= agent.tokenCooldownUntil) {
          agent.token = { since: tick, lastWanted: tick };
          holders.push(agent);
          continue;
        }
        const held = { ...command, buttons: command.buttons & ~Buttons.fire };
        output[index] = held;
        agent.command = held;
        agent.fireGate = 'attack-token';
      }
    }
  }
  decisionSnapshot(agentId: string): DecisionSnapshot | undefined {
    this.assertActive();
    const snapshot = this.agents.get(agentId)?.lastDecision;
    return snapshot && structuredClone(snapshot);
  }
  private buildDecisionSnapshot(
    tick: number,
    self: SelfState,
    states: Array<SelfState>,
    agent: AgentCognition,
    team: TeamCognition,
  ): DecisionSnapshot {
    const friends = states.filter((friend) => friend.team === self.team && friend.id !== self.id);
    return freeze({
      assignment: team.plan?.assignments.find((assignment) => assignment.agentId === self.id),
      beliefs: agent.belief.snapshot(),
      candidates: agent.candidates,
      danger: self.suppression * 0.6,
      friends,
      maneuver: team.plan,
      map: this.map,
      order: team.order,
      previousPlan: agent.plan,
      random: randomAt(this.config.seed, `${self.id}:planner`, tick),
      self,
      sharedBeliefs: team.shared.snapshot(),
      tick,
      version: agent.belief.version,
    });
  }
  private coordinate(tick: number, states: Array<SelfState>, force = false): void {
    for (const id of ['alpha', 'bravo'] as const) {
      const team = this.teams[id],
        members = states.filter((state) => state.team === id),
        alive = members.filter((member) => member.alive).length;
      team.shared.advance(tick);
      team.reservations.expire(tick);
      for (const member of members) {
        if (!member.alive && !team.casualties.has(member.id)) {
          team.casualties.set(member.id, { observedAt: tick, position: { ...member.position } });
        }
      }
      for (const [watchId, watch] of team.authorizedWatches) {
        if (watch.expiresAt <= tick) {
          team.authorizedWatches.delete(watchId);
        }
      }
      pruneEvidenceLedger(team.evidence, tick, [
        ...team.shared.snapshot().flatMap((track) => track.provenance),
        ...[...team.authorizedWatches.values()].flatMap((watch) => watch.observationProvenance),
      ]);
      if (force || tick % 60 === 0 || !team.order) {
        team.order = freeze(
          chooseStrategicOrder(id, tick, freeze(members), freeze(team.shared.snapshot()), this.map),
        );
      }
      if (force || tick % 15 === 0 || team.membersAlive !== alive) {
        const previous = team.plan;
        team.plan = freeze(
          team.coordinator.update(
            tick,
            freeze(members),
            freeze(team.shared.snapshot()),
            this.map,
            team.order,
            team.reservations,
          ),
        );
        this.auditWatches(team, members, tick);
        if (previous?.id !== team.plan.id) {
          this.addEvent({
            id: `order:${tick}:${id}`,
            team: id,
            text: `${id.toUpperCase()} · ${team.plan.kind} / ${team.plan.phase}`,
            tick,
            type: 'order',
          });
        }
      }
      team.membersAlive = alive;
    }
  }
  private sendContact(
    self: SelfState,
    agent: AgentCognition,
    observations: Array<Observation>,
    tick: number,
  ): void {
    if (tick - agent.radioAt < 45) {
      return;
    }
    const contact = observations
      .filter(
        (observation) =>
          observation.source === 'vision' &&
          observation.classification === 'enemy' &&
          observation.confidence > 0.65,
      )
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (!contact) {
      return;
    }
    const compressed = {
      ...structuredClone(contact),
      confidence: contact.confidence * 0.8,
      position: {
        x: Math.round(contact.position.x),
        y: Math.round(contact.position.y * 2) / 2,
        z: Math.round(contact.position.z),
      },
      uncertainty: contact.uncertainty + 1.2,
      velocity: undefined,
    };
    const sent = this.radio.send(
      {
        deliverAt: tick + this.config.radioLatencyTicks,
        expiresAt: tick + 90,
        id: `contact:${tick}:${self.id}`,
        observation: compressed,
        senderId: self.id,
        sentAt: tick,
        team: self.team,
        type: 'CONTACT',
        urgency: 0.8,
      },
      tick,
      randomAt(this.config.seed, `${self.id}:radio`, tick),
    );
    agent.radioAt = tick;
    if (sent) {
      this.addEvent({
        agentId: self.id,
        id: `sent:${tick}:${self.id}`,
        team: self.team,
        text: `${self.id} called contact in ${contact.regionId ?? 'unknown sector'}`,
        tick,
        type: 'contact',
      });
    }
  }
  private deliverRadio(
    tick: number,
    states: Array<SelfState>,
    incoming: Map<string, Array<Observation>>,
  ): void {
    for (const message of this.radio.deliver(tick)) {
      if (message.type !== 'CONTACT') {
        continue;
      }
      const root = this.sim.observation(message.observation.id);
      const sender = states.find((state) => state.id === message.senderId);
      if (
        !root ||
        root.observerId !== message.senderId ||
        sender?.team !== message.team ||
        message.deliverAt < message.sentAt + this.config.radioLatencyTicks
      ) {
        this.metrics.fairnessViolations++;
        throw new Error('Radio provenance or latency violation');
      }
      const evidence = (observerId: string): Observation => ({
        ...structuredClone(message.observation),
        expiresAt: Math.min(message.expiresAt, root.expiresAt),
        id: `radio:${message.id}:${observerId}`,
        observerId,
        parentId: root.id,
        receivedAt: tick,
        source: 'radio',
      });
      const sharedEvidence = evidence(`shared:${message.team}`);
      this.teams[message.team].evidence.set(root.id, sharedEvidence.expiresAt + 300);
      this.teams[message.team].evidence.set(sharedEvidence.id, sharedEvidence.expiresAt + 300);
      this.teams[message.team].shared.integrate([sharedEvidence], tick);
      for (const receiver of states) {
        if (receiver.team === message.team && receiver.alive && receiver.id !== message.senderId) {
          const batch = incoming.get(receiver.id) ?? [];
          batch.push(evidence(receiver.id));
          incoming.set(receiver.id, batch);
        }
      }
      this.addEvent({
        agentId: message.senderId,
        id: `received:${message.id}`,
        team: message.team,
        text: `${message.senderId} contact received · ${tick - message.sentAt} ticks latency`,
        tick,
        type: 'radio',
      });
    }
  }
  private audit(
    trace: DecisionTrace,
    agent: AgentCognition,
    team: TeamCognition,
    tick: number,
  ): void {
    const communicated = new Set([
      ...team.shared.snapshot().flatMap((track) => track.provenance),
      ...team.evidence.keys(),
    ]);
    for (const id of trace.observationProvenance) {
      if (!agent.evidence.has(id) && !communicated.has(id)) {
        this.metrics.fairnessViolations++;
        throw new Error(`Unproven decision evidence at tick ${tick}: ${id}`);
      }
    }
  }
  private auditWatches(team: TeamCognition, members: Array<SelfState>, tick: number): void {
    const watches = team.plan?.assignments.filter((assignment) => assignment.watchSector) ?? [];
    const invalid = (reason: string): never => {
      this.metrics.fairnessViolations++;
      throw new Error(`Invalid squad watch at tick ${tick}: ${reason}`);
    };
    if (watches.length > 1) {
      invalid('multiple owners');
    }
    for (const assignment of watches) {
      const watch = assignment.watchSector!,
        casualty = team.casualties.get(watch.casualtyId);
      if (
        !members.some((member) => member.id === assignment.agentId && member.alive) ||
        !casualty ||
        !members.some((member) => member.id === watch.casualtyId && !member.alive)
      ) {
        invalid('unknown team-status casualty or owner');
      }
      if (
        !Number.isFinite(watch.issuedAt) ||
        !Number.isFinite(watch.expiresAt) ||
        watch.issuedAt < casualty!.observedAt ||
        watch.issuedAt > tick ||
        watch.expiresAt <= tick ||
        watch.expiresAt > watch.issuedAt + 240 ||
        !Object.values(watch.lookAt).every(Number.isFinite)
      ) {
        invalid('unbounded or malformed watch');
      }
      if (watch.source === 'team-status') {
        if (
          watch.observationProvenance.length ||
          Math.hypot(watch.lookAt.x - casualty!.position.x, watch.lookAt.z - casualty!.position.z) >
            1e-6
        ) {
          invalid('team-status location must be the known casualty location');
        }
      } else if (watch.source === 'radio') {
        if (
          !watch.observationProvenance.length ||
          !watch.observationProvenance.every((id) => team.evidence.has(id))
        ) {
          invalid('unreceived radio provenance');
        }
        const previous = team.authorizedWatches.get(watch.id);
        const retained = previous && JSON.stringify(previous) === JSON.stringify(watch);
        const current = team.shared
          .snapshot()
          .some(
            (track) =>
              track.expiresAt > tick &&
              distance(track.meanPosition, watch.lookAt) < 1e-6 &&
              watch.observationProvenance.every((id) => track.provenance.includes(id)),
          );
        if (!retained && !current) {
          invalid('radio point not derived from the common picture');
        }
      } else {
        invalid('unknown source');
      }
      team.authorizedWatches.set(watch.id, freeze(structuredClone(watch)));
    }
  }
  snapshot(): RenderSnapshot {
    this.assertActive();
    const agents: Array<AgentView> = structuredClone(this.sim.states).map((self) => {
      const agent = this.agents.get(self.id)!,
        team = this.teams[self.team];
      return {
        ...self,
        attention: { ...agent.attention },
        beliefs: agent.belief.snapshot(),
        callsign: `${self.team === 'alpha' ? 'A' : 'B'}${self.id.split('-')[1]}`,
        command: agent.command && structuredClone(agent.command),
        destination: agent.goal.destination && { ...agent.goal.destination },
        execution: { ...agent.view },
        fireGate: agent.fireGate,
        kills: this.sim.kills(self.id),
        path: agent.path.map((point) => ({ ...point })),
        plan: agent.plan,
        policyFallback:
          this.config.policyMode === 'symbolic'
            ? 'symbolic motor'
            : 'no validated model installed; symbolic fallback',
        role:
          team.plan?.assignments.find((assignment) => assignment.agentId === self.id)?.role ??
          'reserve',
        trace: agent.trace,
      };
    });
    return {
      agents,
      checksum: this.sim.checksum(),
      events: [...this.events],
      metrics: { ...this.metrics, ...this.performance.snapshot() },
      objective: structuredClone(this.sim.objective),
      reservations: (['alpha', 'bravo'] as const).flatMap((team) =>
        this.teams[team].reservations
          .snapshot()
          .map((lease) => ({ ...lease, resourceId: `${team}/${lease.resourceId}` })),
      ),
      scenarioId: this.customWorld?.map.id ?? this.config.scenarioId,
      seed: this.config.seed,
      sharedBeliefs: {
        alpha: this.teams.alpha.shared.snapshot(),
        bravo: this.teams.bravo.shared.snapshot(),
      },
      squads: [this.teams.alpha.plan, this.teams.bravo.plan].filter(
        (plan): plan is SquadPlan => !!plan,
      ),
      status: this.sim.status,
      tick: this.sim.tick,
      version: 1,
      winner: this.sim.winner,
    };
  }
  exportReplay(): ReplayFile {
    this.assertActive();
    if (!this.replay) {
      throw new Error(
        'External authority cannot export a reference-simulation replay; use the host engine recorder and verifier',
      );
    }
    return this.replay.export();
  }
  dispose(): void {
    if (!this.disposed) {
      for (const agent of this.agents.values()) {
        agent.executor.dispose();
        agent.motor.dispose();
      }
      this.sim.dispose();
      this.disposed = true;
    }
  }
  private addEvent(event: SimEvent): void {
    this.events.push(freeze(event));
    if (this.events.length > 100) {
      this.events.shift();
    }
  }
  private assertActive(): void {
    if (this.disposed) {
      throw new Error('Runtime is disposed');
    }
  }
}
export type ReplayVerification = {
  actual?: string;
  checkedTicks: number;
  expected?: string;
  mismatchTick?: number;
  reason?: string;
  valid: boolean;
};
export function verifyReplay(replay: ReplayFile): ReplayVerification {
  if (replay?.format !== 'cutting-edge-replay-1') {
    return {
      checkedTicks: 0,
      reason: 'Replay format is incompatible with the reference simulation',
      valid: false,
    };
  }
  if (replay.versions?.simulation !== VERSIONS.simulation) {
    return {
      checkedTicks: 0,
      reason:
        'External or unavailable authority cannot use the reference-simulation verifier; use its host engine verifier',
      valid: false,
    };
  }
  let config: RuntimeConfig, world: RuntimeWorld | undefined;
  try {
    config = validateConfig(replay.config);
    world =
      replay.world === undefined
        ? undefined
        : validateRuntimeWorld(replay.world, config.agentsPerTeam);
  } catch (error) {
    return {
      checkedTicks: 0,
      reason: error instanceof Error ? error.message : 'Invalid replay setup',
      valid: false,
    };
  }
  if (replay.versions.map !== (world?.map.version ?? VERSIONS.map)) {
    return {
      checkedTicks: 0,
      reason: 'Replay authoritative map version is incompatible',
      valid: false,
    };
  }
  if (!Array.isArray(replay.commands) || !Array.isArray(replay.checksums)) {
    return { checkedTicks: 0, reason: 'Invalid replay command or checksum records', valid: false };
  }
  if (
    replay.commands.some(
      (command) =>
        !command || typeof command.agentId !== 'string' || !Number.isInteger(command.tick),
    ) ||
    replay.checksums.some(
      (check) => !check || !Number.isInteger(check.tick) || typeof check.hash !== 'string',
    )
  ) {
    return { checkedTicks: 0, reason: 'Malformed replay record', valid: false };
  }
  let scenario: ReturnType<typeof worldSetup>;
  try {
    scenario = worldSetup(config, world);
  } catch (error) {
    return {
      checkedTicks: 0,
      reason: error instanceof Error ? error.message : 'Invalid replay scenario',
      valid: false,
    };
  }
  const commands = new Map<number, Array<AgentCommand>>();
  for (const command of replay.commands) {
    const batch = commands.get(command.tick) ?? [];
    batch.push(command);
    commands.set(command.tick, batch);
  }
  const sim = new AuthoritativeSimulation({
    config,
    initialAmmo: scenario.initialAmmo,
    initialHealth: scenario.initialHealth,
    map: scenario.map,
    rules: 'rules' in scenario ? scenario.rules : undefined,
  });
  let checkedTicks = 0;
  try {
    for (const expected of replay.checksums) {
      if (expected.tick !== sim.tick + 1 || sim.status === 'complete') {
        return {
          checkedTicks,
          mismatchTick: expected.tick,
          reason: 'Non-contiguous replay checksums',
          valid: false,
        };
      }
      const result = sim.step(commands.get(expected.tick) ?? []);
      if (result.checksum !== expected.hash) {
        return {
          actual: result.checksum,
          checkedTicks,
          expected: expected.hash,
          mismatchTick: expected.tick,
          valid: false,
        };
      }
      checkedTicks++;
    }
    const lastTick = replay.checksums.at(-1)?.tick ?? 0;
    if (replay.commands.some((command) => command.tick > lastTick || command.tick < 1)) {
      return { checkedTicks, reason: 'Commands fall outside checksum range', valid: false };
    }
    return { checkedTicks, valid: true };
  } finally {
    sim.dispose();
  }
}
