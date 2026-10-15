import { planIndividual, type PlannerOptions } from '@blacksite/ai-planning';
import type { DecisionSnapshot, SkillProfile } from '@blacksite/ai-schema';
export type CounterfactualChange = {
  danger?: number;
  planner?: PlannerOptions;
  removeTrackId?: string;
  skill?: Partial<SkillProfile>;
};
export function runCounterfactual(recorded: DecisionSnapshot, change: CounterfactualChange) {
  const baselineSnapshot = structuredClone(recorded);
  const altered = structuredClone(recorded);
  if (change.danger !== undefined) {
    if (!Number.isFinite(change.danger) || change.danger < 0 || change.danger > 1) {
      throw new Error('Danger must be in [0, 1]');
    }
    altered.danger = change.danger;
  }
  if (change.skill) {
    for (const value of Object.values(change.skill)) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error('Skill values must be in [0, 1]');
      }
    }
    altered.self = { ...altered.self, skill: { ...altered.self.skill, ...change.skill } };
  }
  if (change.removeTrackId) {
    altered.beliefs = altered.beliefs.filter((track) => track.id !== change.removeTrackId);
    altered.sharedBeliefs = altered.sharedBeliefs.filter(
      (track) => track.id !== change.removeTrackId,
    );
  }
  const baseline = planIndividual(baselineSnapshot);
  const alternative = planIndividual(altered, change.planner);
  const ids = [
    ...new Set([
      ...baseline.trace.candidates.map((c) => c.id),
      ...alternative.trace.candidates.map((c) => c.id),
    ]),
  ];
  return {
    agentId: recorded.self.id,
    alternative,
    baseline,
    candidateDiff: ids.map((id) => ({
      after: alternative.trace.candidates.find((c) => c.id === id),
      before: baseline.trace.candidates.find((c) => c.id === id),
      id,
    })),
    changedSelection: baseline.trace.selected !== alternative.trace.selected,
    randomDraw: recorded.random,
    synthetic: true as const,
    tick: recorded.tick,
  };
}
