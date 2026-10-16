export type Tick = number;
export type EntityId = string;
export type TeamId = 'alpha' | 'bravo';
export type Vec3 = {
  x: number;
  y: number;
  z: number;
};
export type Stance = 'stand' | 'crouch' | 'prone';
export type Role =
  | 'point'
  | 'support'
  | 'overwatch'
  | 'flank'
  | 'leader'
  | 'medic'
  | 'reserve'
  | 'rear';
export type SkillId =
  | 'move'
  | 'hold'
  | 'engage'
  | 'reload'
  | 'fallback'
  | 'search'
  | 'revive'
  | 'suppress'
  | 'yield';
export type ManeuverKind =
  | 'move'
  | 'hold'
  | 'clear'
  | 'breach'
  | 'bound'
  | 'flank'
  | 'suppress'
  | 'crossfire'
  | 'search'
  | 'fallback'
  | 'revive';
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const AGENT_RADIUS = 0.34;
export type ContentVersions = {
  featureSchema: string;
  map: string;
  model: string;
  planner: string;
  simulation: string;
};
export const VERSIONS = {
  featureSchema: 'belief-1',
  map: 'tactical-layouts-2',
  model: 'symbolic-fallback',
  planner: 'symbolic-6',
  simulation: 'sim-1',
} as const;
export const Buttons = {
  aim: 2,
  fire: 1,
  jump: 16,
  leanLeft: 64,
  leanRight: 128,
  reload: 4,
  sprint: 32,
  use: 8,
  utility1: 256,
  utility2: 512,
} as const;
export type AgentCommand = {
  agentId: EntityId;
  buttons: number;
  lookDelta: {
    pitch: number;
    yaw: number;
  };
  move: {
    x: number;
    y: number;
  };
  source: 'human' | 'ai';
  sourceSequence: number;
  stance: Stance;
  tick: Tick;
};
export type SkillProfile = {
  aimAcquisition: number;
  aimTracking: number;
  communication: number;
  composure: number;
  mapKnowledge: number;
  movement: number;
  perception: number;
  reaction: number;
  recoilControl: number;
  tacticalReasoning: number;
};
export const DEFAULT_SKILL: SkillProfile = {
  aimAcquisition: 0.65,
  aimTracking: 0.62,
  communication: 0.7,
  composure: 0.7,
  mapKnowledge: 0.8,
  movement: 0.75,
  perception: 0.7,
  reaction: 0.65,
  recoilControl: 0.6,
  tacticalReasoning: 0.75,
};
export type Observation = {
  classification: 'unknown' | 'enemy' | 'friendly';
  confidence: number;
  expiresAt: Tick;
  id: string;
  observedAt: Tick;
  observerId: EntityId;
  parentId?: string;
  position: Vec3;
  receivedAt: Tick;
  regionId?: string;
  source: 'vision' | 'sound' | 'damage' | 'radio' | 'public';
  subjectId?: EntityId;
  uncertainty: number;
  velocity?: Vec3;
};
export type BeliefTrack = {
  classification: 'unknown' | 'enemy' | 'friendly';
  confidence: number;
  covariance: [number, number, number, number, number, number];
  expiresAt: Tick;
  firstObservedAt: Tick;
  id: string;
  lastObservedAt: Tick;
  lastUpdatedAt: Tick;
  meanPosition: Vec3;
  meanVelocity: Vec3;
  possibleRegions: Array<string>;
  provenance: Array<string>;
  provenanceId: string;
  receivedAt: Tick;
  source: Observation['source'] | 'inference';
  subjectId?: EntityId;
  uncertaintyRadius: number;
};
export type SelfState = {
  alive: boolean;
  ammo: number;
  health: number;
  id: EntityId;
  lastShotAt: Tick;
  pitch: number;
  position: Vec3;
  reloadingUntil: Tick;
  reserveAmmo: number;
  skill: SkillProfile;
  stance: Stance;
  suppression: number;
  team: TeamId;
  velocity: Vec3;
  yaw: number;
};
export type Rect = {
  depth: number;
  height: number;
  id: string;
  width: number;
  x: number;
  z: number;
};
export type TacticalNode = {
  capacity: number;
  cover: number;
  exposure: number;
  id: string;
  kind: 'cover' | 'entry' | 'overwatch' | 'objective' | 'rally' | 'search';
  neighbors: Array<string>;
  position: Vec3;
  regionId: string;
};
export type Region = {
  center: Vec3;
  id: string;
  name: string;
  neighbors: Array<string>;
};
export type TacticalMap = {
  depth: number;
  id: string;
  name: string;
  nodes: Array<TacticalNode>;
  objectives: Array<{
    id: string;
    position: Vec3;
    regionId: string;
  }>;
  obstacles: Array<Rect>;
  regions: Array<Region>;
  spawns: Record<TeamId, Array<Vec3>>;
  version: string;
  width: number;
};
export type SimulationRules = {
  damage?: number;
  spread?: number;
  suppressedSpread?: number;
};
export type RuntimeWorld = {
  initialAmmo?: number;
  initialHealth?: Record<EntityId, number>;
  map: TacticalMap;
  rules?: SimulationRules;
};
export { validateRuntimeWorld } from './world';
export type Reservation = {
  expiresAt: Tick;
  kind: 'slot' | 'portal' | 'skill';
  ownerId: EntityId;
  resourceId: string;
};
export type StrategicOrder = {
  id: string;
  issuedAt: Tick;
  objective: Vec3;
  objectiveId: string;
  posture: 'probe' | 'seize' | 'hold' | 'rotate' | 'retreat';
  risk: number;
  team: TeamId;
  tempo: number;
};
export type WatchSector = {
  casualtyId: EntityId;
  expiresAt: Tick;
  id: string;
  issuedAt: Tick;
  lookAt: Vec3;
  observationProvenance: Array<string>;
  source: 'team-status' | 'radio';
};
export type Assignment = {
  agentId: EntityId;
  position: Vec3;
  ready: boolean;
  role: Role;
  score: number;
  slotId: string;
  watchSector?: WatchSector;
};
export type SquadPlan = {
  assignments: Array<Assignment>;
  constraints: Array<string>;
  createdAt: Tick;
  expiresAt: Tick;
  id: string;
  kind: ManeuverKind;
  order: StrategicOrder;
  phase: 'prepare' | 'execute' | 'consolidate' | 'abort';
  supportReady: boolean;
  team: TeamId;
};
export type Candidate = {
  applicable: boolean;
  id: string;
  rejectReason?: string;
  score?: number;
  terms?: Record<string, number>;
};
export type TacticalCandidate = Candidate & {
  nodeId: string;
  position: Vec3;
};
export type DecisionSnapshot = {
  assignment?: Assignment;
  beliefs: ReadonlyArray<BeliefTrack>;
  candidates: ReadonlyArray<TacticalCandidate>;
  danger: number;
  friends: ReadonlyArray<SelfState>;
  maneuver?: SquadPlan;
  map: Readonly<TacticalMap>;
  order?: StrategicOrder;
  previousPlan?: Plan;
  random: number;
  self: Readonly<SelfState>;
  sharedBeliefs: ReadonlyArray<BeliefTrack>;
  tick: Tick;
  version: number;
};
export type PlannedAction = {
  destination?: Vec3;
  durationTicks: number;
  id: string;
  resourceId?: string;
  skill: SkillId;
  targetTrackId?: string;
};
export type Plan = {
  actions: Array<PlannedAction>;
  agentId: EntityId;
  expiresAtTick: Tick;
  goal: string;
  id: string;
  requestedAtTick: Tick;
  score: number;
  snapshotVersion: number;
};
export type PolicyMeta = {
  confidence: number;
  epistemicUncertainty: number;
  featureSchemaVersion: string;
  modelVersion: string;
};
export type PolicyResult<A> = PolicyMeta & {
  action: A;
};
export type DecisionTrace = {
  agentId: EntityId;
  beliefVersion: number;
  candidates: Array<Candidate>;
  deadline?: 'within-budget' | 'expansion-limit' | 'fallback';
  interrupt?: {
    event: string;
    from: string;
    to: string;
  };
  maneuverId?: string;
  model?: PolicyMeta;
  observationProvenance: Array<string>;
  orderId?: string;
  randomDraw?: number;
  selected: string;
  tick: Tick;
};
export type SquadMessage = {
  deliverAt: Tick;
  expiresAt: Tick;
  id: string;
  senderId: EntityId;
  sentAt: Tick;
  team: TeamId;
  urgency: number;
} & (
  | {
      observation: Observation;
      type: 'CONTACT';
    }
  | {
      ammo: 'low' | 'ready';
      health: 'low' | 'ready';
      type: 'STATUS';
    }
  | {
      orderId: string;
      result: 'accepted' | 'blocked' | 'complete' | 'failed';
      type: 'ACK';
    }
  | {
      need: 'cover' | 'smoke' | 'medic' | 'replan';
      type: 'REQUEST';
    }
  | {
      maneuverId: string;
      role: Role;
      slot?: string;
      type: 'INTENT';
    }
);
export type MotorGoal = {
  destination?: Vec3;
  fire: boolean;
  lookAt?: Vec3;
  reload: boolean;
  speed: number;
  stance: Stance;
  suppress?: boolean;
  targetConfidence: number;
  targetTrackId?: string;
  watchSector?: WatchSector;
};
export type ExecutionView = {
  failure?: string;
  interrupt?: string;
  progress: number;
  skill: SkillId | 'idle';
  state: string;
};
export type AgentView = SelfState & {
  attention: Vec3;
  beliefs: Array<BeliefTrack>;
  callsign: string;
  command?: AgentCommand;
  destination?: Vec3;
  execution: ExecutionView;
  fireGate: string;
  kills: number;
  path: Array<Vec3>;
  plan?: Plan;
  policyFallback: string;
  role: Role;
  trace?: DecisionTrace;
};
export type SimEvent = {
  agentId?: EntityId;
  endPosition?: Vec3;
  id: string;
  position?: Vec3;
  team?: TeamId;
  text: string;
  tick: Tick;
  type: 'contact' | 'radio' | 'shot' | 'kill' | 'order' | 'interrupt' | 'objective' | 'fallback' | 'intent';
};
export type RuntimeMetrics = {
  activeReservations: number;
  deadlineMisses: number;
  decisions: number;
  fairnessViolations: number;
  p50: number;
  p95: number;
  p99: number;
  pendingMessages: number;
  policyFallbacks: number;
  shots: number;
  tickMs: number;
};
export type RenderSnapshot = {
  agents: Array<AgentView>;
  checksum: string;
  events: Array<SimEvent>;
  metrics: RuntimeMetrics;
  objective: {
    owner?: TeamId;
    position: Vec3;
    progress: number;
  };
  reservations: Array<Reservation>;
  scenarioId: string;
  seed: number;
  sharedBeliefs: Record<TeamId, Array<BeliefTrack>>;
  squads: Array<SquadPlan>;
  status: 'running' | 'complete';
  tick: Tick;
  version: number;
  winner?: TeamId | 'draw';
};
export type Intent = 'advance' | 'flank' | 'cover' | 'engage' | 'suppress' | 'reload' | 'fallback' | 'search' | 'hold';
export type AttackTokenRules = {
  /** Agents per team allowed to hold the fire button at once. */
  count: number;
  /** Ticks a holder keeps its token before handing it on. */
  holdTicks: number;
  /** Ticks before a released holder may take a token again. */
  cooldownTicks: number;
  /** Ticks without trying to fire before a holder gives its token back. */
  idleTicks?: number;
};
export type IntentRules = {
  /** Ticks an agent waits in place after announcing a new advance or flank, so the callout leads the move. */
  leadTicks: number;
};
export type ScenarioId = 'crossfire' | 'breach' | 'search' | 'casualty' | 'low-ammo' | 'deadlock';
export type RuntimeConfig = {
  agentsPerTeam: number;
  maxTicks: number;
  policyMode: 'symbolic' | 'shadow' | 'hybrid';
  radioLatencyTicks: number;
  scenarioId: ScenarioId;
  seed: number;
  skill: SkillProfile;
};
export const DEFAULT_CONFIG: RuntimeConfig = {
  agentsPerTeam: 5,
  maxTicks: 3600,
  policyMode: 'symbolic',
  radioLatencyTicks: 12,
  scenarioId: 'crossfire',
  seed: 2048,
  skill: DEFAULT_SKILL,
};
export type ReplayFile = {
  checksums: Array<{
    hash: string;
    tick: Tick;
  }>;
  commands: Array<AgentCommand>;
  config: RuntimeConfig;
  format: 'cutting-edge-replay-1';
  versions: ContentVersions;
  world?: RuntimeWorld;
};
export type SnapshotDetail = 'full' | 'render';
export type WorkerRequest =
  | {
      config: RuntimeConfig;
      detail?: SnapshotDetail;
      type: 'init';
      world?: RuntimeWorld;
    }
  | {
      speed: number;
      type: 'play';
    }
  | {
      type: 'pause';
    }
  | {
      count?: number;
      type: 'step';
    }
  | {
      type: 'export';
    }
  | {
      command: AgentCommand;
      type: 'command';
    }
  | {
      type: 'dispose';
    };
export type WorkerResponse =
  | {
      map?: TacticalMap;
      snapshot: RenderSnapshot;
      type: 'snapshot';
    }
  | {
      replay: ReplayFile;
      type: 'replay';
    }
  | {
      message: string;
      type: 'error';
    };
