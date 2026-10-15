import { DIRECT_WORK_UNITS_PER_BUDGET_MS } from '../../destruction-graph/src/direct';

/** One shared nominal-time scale for sparse admission and the whole-step ladder. */
export const UNITS_PER_NOMINAL_MS = DIRECT_WORK_UNITS_PER_BUDGET_MS;
/**
 * The timed SIMD near-face replay measured 25,235 native rows/ms; round down to
 * 25,000. Keep this independent of sparse throughput so changing sparse admission
 * cannot silently reweight native work.
 */
export const NATIVE_ROWS_PER_NOMINAL_MS = 25_000;

/**
 * Step budget: the fixed physics rate never changes. A deterministic work estimate climbs a
 * ladder one rung at a time while over capacity and descends once under capacity for a while.
 * Work admission and fidelity depend only on simulation state and tick counts, so the same
 * command stream makes the same decisions regardless of wall-clock timing. Elapsed cost remains
 * telemetry. The existing speed, resting, exposure and age rules choose which bodies qualify.
 *
 *   1  sleep now: every awake body that is slow and resting is baked at once
 *   2  bake the slowest awake resting bodies, oldest first, a bounded number per tick
 *   3  defer sub-fracture of pieces that are not exposed; skip it entirely when far over budget
 *   4  tighten the small-debris cap
 */
export const STEP_BUDGET = {
  /** Climb a rung while the running cost exceeds this share of the work capacity. */
  engage: 0.85,
  /** Descend once the running cost has stayed under this share for `recoverTicks`. */
  recover: 0.6,
  /** Weight of the newest sample in the running cost. */
  smoothing: 0.5,
  /** Ticks over budget before the next rung engages. */
  escalateTicks: 2,
  /** Ticks under the recover share before a rung is released. */
  recoverTicks: 20,
  /** Past this share of the work capacity, sub-fracture is skipped outright instead of deferred. */
  skipFracture: 1.2,
  /** Rung 1 sleeps bodies slower than this (m/s, rad/s) that rest on something. */
  sleepSpeed: 0.8,
  sleepSpin: 1.5,
  /** Rung 1 also wants the body to have been slow for this many ticks, so one that merely starts from rest is left alone. */
  sleepAfterTicks: 3,
  /** The ladder only bakes rubble: islands of at most this many members, and loose pieces. */
  rubbleMembers: 8,
  /** Rung 2 never bakes a body faster than this (m/s); a body mid-air or mid-slide is left alone. */
  bakeSpeed: 3,
  /** Most bodies the ladder bakes in one tick. */
  bakesPerTick: 192,
  /**
   * From this rung, bodies thicker than `chunkyThickness` (m) on every axis drop full continuous
   * collision detection for soft prediction of `softCcdPrediction` (m). Not on the brief's ladder; it
   * is the cheapest fidelity to give up on a falling pile.
   */
  relaxCcdRung: 2,
  /** Fast rubble always keeps swept CCD, even on the highest budget rung. */
  fullCcdSpeed: 8,
  chunkyThickness: 0.45,
  softCcdPrediction: 0.5,
  /** The small-debris live cap while rung 4 is engaged. */
  tightDebrisCap: 120,
  /** Whole-step capacity at 30 Hz, on the same nominal-time scale as B2. */
  workUnitsPerStep: Math.round((1000 / 30) * UNITS_PER_NOMINAL_MS),
  /** B2 weighted-work quotas by rung; unfinished Cholesky work resumes next step. */
  structuralWorkByRung: [6, 6, 6, 4, 2].map(ms => Math.round(ms * UNITS_PER_NOMINAL_MS)),
  /** Source-compatible nominal scale; no wall-clock deadline uses these values. */
  structuralMsByRung: [6, 6, 6, 4, 2],
} as const;

export const MAX_RUNG = 4;

export interface StepWork {
  awakeBodies: number;
  awakeColliders: number;
  joints: number;
  /** Native contact points, each with one normal and two friction rows. */
  contactConstraints: number;
  solverIterations: number;
  /** Executed phase-weighted integer work from the direct solver. */
  structuralWork: number;
  /** Unserved work is queue telemetry, not work performed during this step. */
  deferredStructuralWork: number;
}

export class StepBudget {
  /** Running step cost in milliseconds; telemetry only. */
  cost = 0;
  /** Smoothed deterministic weighted-work estimate, used by every policy choice. */
  workCost = 0;
  readonly workCapacity: number;
  rung = 0;
  /** Off, the ladder never leaves rung 0; for comparing against the unbudgeted engine. */
  enabled = true;
  private over = 0;
  private under = 0;

  constructor(readonly dtMs: number) {
    this.workCapacity = Math.round(dtMs * UNITS_PER_NOMINAL_MS);
  }

  /** Fold in measured telemetry without changing physics policy. */
  observe(ms: number): void {
    this.cost =
      this.cost === 0
        ? ms
        : this.cost + (ms - this.cost) * STEP_BUDGET.smoothing;
  }

  /** Convert native rows and executed sparse work to the same nominal work units. */
  observeWork(work: StepWork): void {
    const nativeRows = 6 * work.awakeBodies + work.awakeColliders +
      6 * work.joints + 3 * work.contactConstraints;
    const nativeWork = Math.round(nativeRows * work.solverIterations *
      UNITS_PER_NOMINAL_MS / NATIVE_ROWS_PER_NOMINAL_MS);
    // Debt selects which retained work receives service. Charging it as executed
    // work creates a feedback loop: defer -> higher rung -> smaller quota -> defer.
    const cost = nativeWork + work.structuralWork;
    this.workCost = this.workCost === 0 ? cost :
      this.workCost + (cost - this.workCost) * STEP_BUDGET.smoothing;
  }

  /** Move the ladder for the coming step. Returns the rung now in force. */
  update(): number {
    if (!this.enabled) {
      return (this.rung = 0);
    }
    const share = this.workCost / this.workCapacity;
    if (share > STEP_BUDGET.engage) {
      this.under = 0;
      if (++this.over >= STEP_BUDGET.escalateTicks && this.rung < MAX_RUNG) {
        this.rung++;
        this.over = 0;
      }
    } else if (share < STEP_BUDGET.recover) {
      this.over = 0;
      if (++this.under >= STEP_BUDGET.recoverTicks && this.rung > 0) {
        this.rung--;
        this.under = 0;
      }
    } else {
      this.over = 0;
      this.under = 0;
    }
    return this.rung;
  }

  /** Whether sub-fracture should be skipped outright rather than only deferred where unexposed. */
  get skipFracture(): boolean {
    return this.rung >= 3 && this.workCost > STEP_BUDGET.skipFracture * this.workCapacity;
  }

  /**
   * How many bodies to bake this tick for rung 2: the share of the awake bodies that has to go for
   * the running cost to fall back to the recover share, taken in halves so the lagging cost
   * estimate does not overshoot.
   */
  quota(awake: number): number {
    const target = STEP_BUDGET.recover * this.workCapacity;
    if (this.workCost <= target) {
      return 0;
    }
    const needed = Math.ceil(awake * (1 - target / this.workCost) * 0.5);
    return Math.min(STEP_BUDGET.bakesPerTick, Math.max(8, needed));
  }
}
