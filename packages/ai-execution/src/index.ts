import { createActor, createMachine } from 'xstate';
import type {
  DecisionSnapshot,
  ExecutionView,
  MotorGoal,
  Plan,
  PlannedAction,
  Tick,
} from '@blacksite/ai-schema';
import { distance, findPath, isWalkable } from '@blacksite/ai-nav';
import { ReservationTable } from '@blacksite/ai-tactics';
import { assignmentWatch } from '@blacksite/ai-planning';
export const skillMachine = createMachine(
  {
    id: 'skill',
    initial: 'idle',
    states: {
      complete: { on: { START: 'running', STOP: 'disposed' } },
      disposed: { type: 'final' },
      failed: { on: { START: 'running', STOP: 'disposed' } },
      idle: { on: { START: 'running', STOP: 'disposed' } },
      interrupted: { on: { START: 'running', STOP: 'disposed' } },
      running: {
        exit: 'releaseClaims',
        on: { DONE: 'complete', FAILED: 'failed', INTERRUPT: 'interrupted', STOP: 'disposed' },
      },
    },
  },
  { actions: { releaseClaims: () => {} } },
);
export const agentMachine = createMachine({
  id: 'agent',
  states: {
    cognition: {
      initial: 'idle',
      states: {
        committed: { on: { COMPLETE: 'idle', FAILED: 'recover', INTERRUPT: 'recover' } },
        idle: { on: { COMMIT_PLAN: 'committed' } },
        recover: { on: { COMMIT_PLAN: 'committed' } },
      },
    },
    communication: {
      initial: 'available',
      states: {
        available: { on: { SPEAK: 'speaking' } },
        cooldown: { on: { RADIO_READY: 'available' } },
        speaking: { on: { SENT: 'cooldown' } },
      },
    },
    interaction: {
      initial: 'none',
      states: {
        active: { on: { COMPLETE: 'none', INTERRUPT: 'none' } },
        none: { on: { INTERACT: 'active' } },
      },
    },
    life: {
      initial: 'alive',
      states: { alive: { on: { DIED: 'dead' } }, dead: { type: 'final' } },
    },
    locomotion: {
      initial: 'stationary',
      states: {
        pathing: { on: { ARRIVED: 'stationary', BLOCKED: 'stuck' } },
        stationary: { on: { MOVE: 'pathing' } },
        stuck: { on: { ARRIVED: 'stationary', MOVE: 'pathing' } },
      },
    },
    weapon: {
      initial: 'ready',
      states: {
        aiming: { on: { FIRE: 'firing', RELAX: 'ready', RELOAD: 'reloading' } },
        firing: { on: { AIM: 'aiming', RELAX: 'ready', RELOAD: 'reloading' } },
        ready: { on: { AIM: 'aiming', RELOAD: 'reloading' } },
        reloading: { on: { LOADED: 'ready', RELAX: 'ready' } },
      },
    },
  },
  type: 'parallel',
});
export class SkillExecutor {
  private claimed = new Set<string>();
  private actor = createActor(
    skillMachine.provide({ actions: { releaseClaims: () => this.releaseClaims() } }),
  );
  private channels = createActor(agentMachine);
  private plan?: Plan;
  private index = 0;
  private startedAt = 0;
  private active?: PlannedAction;
  private lastInterrupt?: string;
  private failure?: string;
  private disposed = false;
  constructor(
    readonly agentId: string,
    readonly reservations: ReservationTable,
  ) {
    this.actor.start();
    this.channels.start();
  }
  commit(plan: Plan, tick: Tick): boolean {
    if (
      this.disposed ||
      plan.agentId !== this.agentId ||
      plan.requestedAtTick > tick ||
      plan.expiresAtTick <= tick ||
      !plan.actions.length
    ) {
      return false;
    }
    if (this.plan?.id === plan.id) {
      return true;
    }
    if (this.active) {
      this.actor.send({ type: 'INTERRUPT' });
    }
    this.releaseClaims();
    this.plan = structuredClone(plan);
    this.index = 0;
    this.active = undefined;
    this.startedAt = tick;
    this.failure = undefined;
    this.lastInterrupt = undefined;
    this.channels.send({ type: 'COMMIT_PLAN' });
    return true;
  }
  private releaseClaims() {
    for (const id of this.claimed) {
      this.reservations.release(id, this.agentId);
    }
    this.claimed.clear();
  }
  interrupt(event: string, _tick: Tick): void {
    this.lastInterrupt = event;
    this.actor.send({ type: 'INTERRUPT' });
    this.channels.send({ type: 'INTERRUPT' });
    this.releaseClaims();
    this.active = undefined;
    this.plan = undefined;
  }
  private fail(reason: string) {
    this.failure = reason;
    this.actor.send({ type: 'FAILED' });
    this.channels.send({ type: 'FAILED' });
    this.releaseClaims();
    this.active = undefined;
    this.plan = undefined;
  }
  tick(snapshot: DecisionSnapshot): {
    goal: MotorGoal;
    view: ExecutionView;
  } {
    const { self, tick } = snapshot;
    const watchSector = assignmentWatch(snapshot);
    const idle: MotorGoal = {
      fire: false,
      reload: false,
      speed: 0,
      stance: self.stance,
      targetConfidence: 0,
      watchSector,
    };
    if (!self.alive) {
      this.interrupt('DIED', tick);
      this.channels.send({ type: 'DIED' });
      return { goal: idle, view: this.view(tick) };
    }
    if (this.disposed) {
      return { goal: idle, view: this.view(tick) };
    }
    if (this.plan && this.plan.expiresAtTick <= tick) {
      this.fail('plan-expired');
    }
    if (this.plan?.goal === 'cover-sector' && !watchSector) {
      this.fail('watch-ended');
    }
    if (this.plan?.goal === 'cover-sector') {
      const committed = this.active ?? this.plan.actions[this.index];
      if (committed && snapshot.assignment && committed.resourceId !== snapshot.assignment.slotId) {
        this.fail('commitment-changed');
      }
    }
    if (snapshot.danger > 0.9 && this.active && this.active.skill !== 'fallback') {
      this.interrupt('GRENADE_DANGER', tick);
    }
    if (!this.active && this.plan) {
      const action = this.plan.actions[this.index];
      if (!action) {
        this.plan = undefined;
        this.channels.send({ type: 'COMPLETE' });
        return { goal: idle, view: this.view(tick) };
      }
      if (this.plan.requestedAtTick > tick) {
        this.fail('future-plan');
        return { goal: idle, view: this.view(tick) };
      }
      if (
        action.destination &&
        (!Object.values(action.destination).every(Number.isFinite) ||
          !isWalkable(snapshot.map, action.destination, 0.4) ||
          (distance(self.position, action.destination) > 0.65 &&
            !findPath(snapshot.map, self.position, action.destination).length))
      ) {
        this.fail('destination-unreachable');
        return { goal: idle, view: this.view(tick) };
      }
      if (
        this.plan.goal === 'fulfill-role' &&
        snapshot.assignment &&
        action.resourceId !== snapshot.assignment.slotId
      ) {
        this.fail('commitment-changed');
        return { goal: idle, view: this.view(tick) };
      }
      if (
        action.skill === 'engage' &&
        !snapshot.beliefs.some(
          (t) =>
            t.id === action.targetTrackId &&
            t.classification === 'enemy' &&
            t.confidence >= 0.4 &&
            t.expiresAt > tick &&
            tick - t.lastObservedAt <= 18,
        )
      ) {
        this.fail('observation-invalidated');
        return { goal: idle, view: this.view(tick) };
      }
      if (action.skill === 'reload' && self.reserveAmmo <= 0) {
        this.fail('no-reserve-ammo');
        return { goal: idle, view: this.view(tick) };
      }
      if (
        action.resourceId &&
        !this.reservations.claim(action.resourceId, this.agentId, tick, 15, 'skill')
      ) {
        this.fail('resource-blocked');
        return { goal: idle, view: this.view(tick) };
      }
      if (action.resourceId) {
        this.claimed.add(action.resourceId);
      }
      this.active = action;
      this.startedAt = tick;
      this.actor.send({ type: 'START' });
      this.channels.send({
        type: action.destination ? 'MOVE' : action.skill === 'reload' ? 'RELOAD' : 'AIM',
      });
    }
    const action = this.active;
    if (!action) {
      return { goal: idle, view: this.view(tick) };
    }
    if (
      action.resourceId &&
      !this.reservations.claim(action.resourceId, this.agentId, tick, 15, 'skill')
    ) {
      this.fail('resource-lost');
      return { goal: idle, view: this.view(tick) };
    }
    const elapsed = tick - this.startedAt;
    const arrived = action.destination && distance(self.position, action.destination) < 0.65;
    if (
      arrived ||
      (action.skill === 'reload' && elapsed > 1 && self.reloadingUntil <= tick && self.ammo >= 7) ||
      (!action.destination && elapsed >= action.durationTicks)
    ) {
      this.actor.send({ type: 'DONE' });
      this.channels.send({ type: action.skill === 'reload' ? 'LOADED' : 'ARRIVED' });
      this.index++;
      this.active = undefined;
      return { goal: idle, view: this.view(tick) };
    }
    if (action.destination && elapsed > action.durationTicks) {
      this.fail('movement-timeout');
      return { goal: idle, view: this.view(tick) };
    }
    const track = snapshot.beliefs.find((t) => t.id === action.targetTrackId && t.expiresAt > tick);
    if (
      action.skill === 'engage' &&
      (!track || tick - track.lastObservedAt > 18 || track.confidence < 0.4)
    ) {
      this.fail('observation-invalidated');
      return { goal: idle, view: this.view(tick) };
    }
    const fire = action.skill === 'engage' || action.skill === 'suppress';
    const goal: MotorGoal = {
      destination: action.destination,
      fire,
      lookAt: track
        ? { ...track.meanPosition, y: Math.max(0.2, track.meanPosition.y - 0.22) }
        : snapshot.order?.objective,
      reload: action.skill === 'reload',
      speed: action.skill === 'fallback' ? 1 : action.destination ? 0.8 : 0,
      stance: action.skill === 'hold' || action.skill === 'suppress' ? 'crouch' : 'stand',
      targetConfidence: track?.confidence ?? 0,
      targetTrackId: track?.id,
      watchSector,
    };
    this.channels.send({ type: goal.fire ? 'FIRE' : goal.reload ? 'RELOAD' : 'AIM' });
    return { goal, view: this.view(tick) };
  }
  private view(tick: Tick): ExecutionView {
    return {
      failure: this.failure,
      interrupt: this.lastInterrupt,
      progress: this.active
        ? Math.min(1, (tick - this.startedAt) / Math.max(1, this.active.durationTicks))
        : 0,
      skill: this.active?.skill ?? 'idle',
      state: String(this.actor.getSnapshot().value),
    };
  }
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.actor.send({ type: 'STOP' });
    this.releaseClaims();
    this.actor.stop();
    this.channels.stop();
    this.disposed = true;
    this.active = undefined;
    this.plan = undefined;
  }
}
