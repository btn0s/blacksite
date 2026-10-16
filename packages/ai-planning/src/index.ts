import type {
  Candidate,
  DecisionSnapshot,
  DecisionTrace,
  Plan,
  PlannedAction,
  SkillId,
  Vec3,
} from '@blacksite/ai-schema';
import { distance, hasSuppressionLane } from '@blacksite/ai-nav';
import { assignmentWatch } from './watch-sector';
export { assignmentWatch } from './watch-sector';
type Fact =
  | 'safe'
  | 'loaded'
  | 'at-slot'
  | 'threat'
  | 'engaged'
  | 'suppressing'
  | 'searched'
  | 'held';
const SUPPRESSIVE_MANEUVERS = new Set(['bound', 'flank', 'clear', 'breach', 'crossfire', 'suppress', 'revive']);
const SUPPRESS_MEMORY_TICKS = 150;
export type ActionDef = {
  baseCost: number;
  effects: Array<Fact>;
  executionSkill: SkillId;
  id: string;
  preconditions: Array<Fact>;
};
export const ACTIONS: ReadonlyArray<ActionDef> = [
  { baseCost: 1, effects: ['safe'], executionSkill: 'fallback', id: 'Fallback', preconditions: [] },
  {
    baseCost: 2,
    effects: ['loaded'],
    executionSkill: 'reload',
    id: 'ReloadBehindCover',
    preconditions: ['safe'],
  },
  {
    baseCost: 1,
    effects: ['at-slot'],
    executionSkill: 'move',
    id: 'MoveToSlot',
    preconditions: [],
  },
  {
    baseCost: 1,
    effects: ['engaged'],
    executionSkill: 'engage',
    id: 'EngageConfirmedThreat',
    preconditions: ['loaded', 'threat'],
  },
  {
    baseCost: 1,
    effects: ['suppressing'],
    executionSkill: 'suppress',
    id: 'SuppressLastKnown',
    preconditions: ['loaded'],
  },
  {
    baseCost: 1,
    effects: ['searched'],
    executionSkill: 'search',
    id: 'SearchRegion',
    preconditions: ['at-slot'],
  },
  { baseCost: 0.2, effects: ['held'], executionSkill: 'hold', id: 'HoldAngle', preconditions: [] },
];
export type PlannerOptions = {
  maxDepth?: number;
  maxExpansions?: number;
};
export function planIndividual(
  snapshot: DecisionSnapshot,
  options: PlannerOptions = {},
): {
  plan: Plan;
  trace: DecisionTrace;
} {
  const { assignment, beliefs, maneuver, self, tick } = snapshot;
  const watch = assignmentWatch(snapshot);
  const threat = [...beliefs]
    .filter(
      (t) =>
        t.classification === 'enemy' &&
        t.confidence > 0.55 &&
        t.expiresAt > tick &&
        tick - t.lastObservedAt < 18,
    )
    .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id))[0];
  const eye = { ...self.position, y: self.position.y + (self.stance === 'stand' ? 1.5 : 0.93) };
  const suppressTrack = [...beliefs]
    .filter(
      (t) =>
        t.classification === 'enemy' &&
        t.confidence > 0.3 &&
        t.expiresAt > tick &&
        tick - t.lastObservedAt > 18 &&
        tick - t.lastObservedAt <= SUPPRESS_MEMORY_TICKS &&
        distance(self.position, t.meanPosition) < 45 &&
        hasSuppressionLane(snapshot.map, eye, { ...t.meanPosition, y: 1 }),
    )
    .sort((a, b) => b.lastObservedAt - a.lastObservedAt || a.id.localeCompare(b.id))[0];
  const legalSlots = snapshot.candidates.filter((c) => c.applicable && c.score !== undefined);
  const best = legalSlots[0];
  const roleSlot = assignment ? legalSlots.find((c) => c.nodeId === assignment.slotId) : best;
  const coverValue = (c: (typeof legalSlots)[number]) =>
    (c.terms?.cover ?? 0) + (c.terms?.travel ?? 0) + (c.terms?.exposure ?? 0);
  const cover = [...legalSlots].sort((a, b) => coverValue(b) - coverValue(a))[0];
  const danger = Math.max(snapshot.danger, self.suppression * 0.4);
  const assignedDistance = assignment ? distance(self.position, assignment.position) : Infinity;
  const blockedByContract =
    maneuver?.kind === 'bound' &&
    !maneuver.supportReady &&
    assignment?.role !== 'support' &&
    assignment?.role !== 'overwatch';
  const roleBlocked = blockedByContract && !watch;
  const suppressor =
    !!maneuver &&
    SUPPRESSIVE_MANEUVERS.has(maneuver.kind) &&
    (assignment?.role === 'support' ||
      assignment?.role === 'overwatch' ||
      maneuver.kind === 'suppress');
  type Method = {
    allowed: Array<string>;
    applicable: boolean;
    goal: Fact;
    id: string;
    rejectReason?: string;
    score: number;
    terms: Record<string, number>;
  };
  const methods: Array<Method> = [
    {
      allowed: ['Fallback'],
      applicable: !!cover && (danger > 0.45 || self.health < 25),
      goal: 'safe',
      id: 'survive',
      rejectReason: 'no-immediate-danger-or-cover',
      score: danger * 12 + (self.health < 25 ? 6 : 0),
      terms: { danger: danger * 12, health: self.health < 25 ? 6 : 0 },
    },
    {
      allowed: ['Fallback', 'ReloadBehindCover'],
      applicable: self.ammo < 7 && self.reserveAmmo > 0,
      goal: 'loaded',
      id: 'reload',
      rejectReason: 'ammo-ready-or-no-reserve',
      score: self.ammo === 0 ? 15 : self.ammo < 7 ? 8 : 0,
      terms: { urgency: self.ammo === 0 ? 15 : 8 },
    },
    {
      allowed: ['EngageConfirmedThreat'],
      applicable: !!threat && self.ammo > 0,
      goal: 'engaged',
      id: 'engage',
      rejectReason: 'no-confirmed-recent-threat-or-ammo',
      score: 7 + (threat?.confidence ?? 0) * 3,
      terms: { confidence: (threat?.confidence ?? 0) * 3, urgency: 7 },
    },
    {
      allowed: ['SuppressLastKnown'],
      applicable:
        suppressor &&
        !threat &&
        !!suppressTrack &&
        self.ammo >= 8 &&
        danger < 0.45 &&
        (assignedDistance <= 2.5 || !roleSlot),
      goal: 'suppressing',
      id: 'suppress',
      rejectReason: 'not-support-or-no-recent-contact-lane',
      score: 7.5 + (suppressTrack?.confidence ?? 0),
      terms: { coordination: 7.5, confidence: suppressTrack?.confidence ?? 0 },
    },
    {
      allowed: ['MoveToSlot'],
      applicable: !!roleSlot && assignedDistance > 1.1 && !roleBlocked,
      goal: 'at-slot',
      id: 'fulfill-role',
      rejectReason: roleBlocked
        ? 'support-not-ready'
        : assignment && !roleSlot
          ? 'assigned-slot-unavailable'
          : 'no-slot-or-already-arrived',
      score: 5 + (assignment ? 2 : 0),
      terms: { commitment: assignment ? 2 : 0, objective: 5 },
    },
    {
      allowed: ['HoldAngle'],
      applicable: !!watch && assignedDistance <= 1.1,
      goal: 'held',
      id: 'cover-sector',
      rejectReason: 'no-live-watch-or-not-at-slot',
      score: 7,
      terms: { commitment: 7 },
    },
    {
      allowed: ['MoveToSlot', 'SearchRegion'],
      applicable:
        !threat &&
        beliefs.some((t) => t.classification !== 'friendly' && tick - t.lastObservedAt > 18) &&
        !!best &&
        !blockedByContract,
      goal: 'searched',
      id: 'search',
      rejectReason: 'no-lost-contact-or-support-not-ready',
      score: 4,
      terms: { informationGain: 4 },
    },
    {
      allowed: ['HoldAngle'],
      applicable: true,
      goal: 'held',
      id: 'hold',
      score: 1 + (blockedByContract ? 5 : 0),
      terms: { baseline: 1, coordination: blockedByContract ? 5 : 0 },
    },
  ];
  const candidates: Array<Candidate> = methods.map((m) => ({
    applicable: m.applicable,
    id: m.id,
    rejectReason: m.applicable ? undefined : m.rejectReason,
    score: m.score,
    terms: m.terms,
  }));
  const applicable = methods
    .filter((m) => m.applicable)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const bestMethod = applicable[0];
  if (!bestMethod) {
    throw new Error('Warden requires an applicable hold method');
  }
  const band = applicable.filter(
    (m) => m.score >= bestMethod.score - (1 - self.skill.tacticalReasoning) * 1.5,
  );
  const random = Number.isFinite(snapshot.random)
    ? Math.max(0, Math.min(0.999999, snapshot.random))
    : 0;
  const selected = band[Math.floor(random * band.length)] ?? bestMethod;
  const facts = new Set<Fact>();
  if (danger < 0.45 && self.health >= 25) {
    facts.add('safe');
  }
  if (self.ammo > 0) {
    facts.add('loaded');
  }
  if (selected.id === 'reload') {
    facts.delete('loaded');
  }
  if (assignedDistance < 1.1) {
    facts.add('at-slot');
  }
  if (threat) {
    facts.add('threat');
  }
  const maxExpansions = Math.max(0, options.maxExpansions ?? 24),
    maxDepth = options.maxDepth ?? 4;
  const queue: Array<{
    actions: Array<ActionDef>;
    cost: number;
    facts: Set<Fact>;
  }> = [{ actions: [], cost: 0, facts }];
  const seen = new Set<string>();
  let chosen: Array<ActionDef> | undefined,
    expansions = 0;
  while (queue.length && expansions < maxExpansions) {
    queue.sort((a, b) => a.cost - b.cost);
    const state = queue.shift()!;
    expansions++;
    if (state.facts.has(selected.goal)) {
      chosen = state.actions;
      break;
    }
    if (state.actions.length >= maxDepth) {
      continue;
    }
    const key = [...state.facts].sort().join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    for (const action of ACTIONS) {
      if (
        !selected.allowed.includes(action.id) ||
        !action.preconditions.every((f) => state.facts.has(f)) ||
        action.effects.every((f) => state.facts.has(f))
      ) {
        continue;
      }
      queue.push({
        actions: [...state.actions, action],
        cost: state.cost + action.baseCost,
        facts: new Set([...state.facts, ...action.effects]),
      });
    }
  }
  const limited = chosen === undefined;
  const fallback = ACTIONS.find((a) => a.id === 'HoldAngle')!;
  const movementSlot = selected.id === 'fulfill-role' ? roleSlot : best;
  const actions: Array<PlannedAction> = (chosen?.length ? chosen : [fallback]).map(
    (action, index) => {
      const destination: Vec3 | undefined =
        action.executionSkill === 'fallback'
          ? cover?.position
          : ['move', 'search'].includes(action.executionSkill)
            ? movementSlot?.position
            : undefined;
      const durationTicks =
        action.executionSkill === 'reload'
          ? 75
          : action.executionSkill === 'suppress'
            ? 60
          : action.executionSkill === 'move' || action.executionSkill === 'fallback'
            ? Math.max(
                45,
                Math.ceil((distance(self.position, destination ?? self.position) / 2.5) * 30) + 30,
              )
            : 30;
      return {
        destination: destination ? { ...destination } : undefined,
        durationTicks,
        id: `${action.id}:${index}`,
        resourceId:
          selected.id === 'cover-sector'
            ? assignment?.slotId
            : destination
              ? action.executionSkill === 'fallback'
                ? cover?.nodeId
                : movementSlot?.nodeId
              : undefined,
        skill: action.executionSkill,
        targetTrackId: action.executionSkill === 'suppress' ? suppressTrack?.id : threat?.id,
      };
    },
  );
  const plan: Plan = {
    actions,
    agentId: self.id,
    expiresAtTick: tick + Math.max(90, actions.reduce((s, a) => s + a.durationTicks, 0) + 30),
    goal: limited ? 'hold' : selected.id,
    id: `${self.id}:plan:${tick}`,
    requestedAtTick: tick,
    score: selected.score,
    snapshotVersion: snapshot.version,
  };
  const trace: DecisionTrace = {
    agentId: self.id,
    beliefVersion: snapshot.version,
    candidates: [...candidates, ...snapshot.candidates],
    deadline: limited ? 'expansion-limit' : 'within-budget',
    maneuverId: maneuver?.id,
    observationProvenance: [
      ...new Set(
        [...snapshot.beliefs, ...snapshot.sharedBeliefs]
          .flatMap((t) => t.provenance)
          .concat(watch?.observationProvenance ?? []),
      ),
    ].sort(),
    orderId: snapshot.order?.id,
    randomDraw: random,
    selected: plan.goal,
    tick,
  };
  return { plan, trace };
}
