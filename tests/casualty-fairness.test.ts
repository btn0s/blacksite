import { expect, test, vi } from 'vitest';
import { TacticalRuntime } from '@blacksite/ai-runtime';
import { SquadCoordinator } from '@blacksite/ai-squad';
import { DEFAULT_CONFIG, type WatchSector } from '@blacksite/ai-schema';

const corruptions: { name: string; mutate: (watch: WatchSector) => void; reason: RegExp }[] = [
  {
    name: 'unreceived radio evidence',
    mutate: watch => { watch.source = 'radio'; watch.observationProvenance = ['fabricated-enemy-position']; },
    reason: /unreceived radio provenance/,
  },
  {
    name: 'an enemy masquerading as a public teammate casualty',
    mutate: watch => { watch.casualtyId = 'bravo-3'; },
    reason: /unknown team-status casualty or owner/,
  },
  {
    name: 'invented coordinates disguised as public teammate status',
    mutate: watch => { watch.source = 'team-status'; watch.observationProvenance = []; watch.lookAt = { x: 23, y: 1.4, z: 17 }; },
    reason: /team-status location must be the known casualty location/,
  },
];

test.each(corruptions)('authority rejects $name in a casualty order', ({ mutate, reason }) => {
  // Fault injection at the real cognition/authority boundary. An order is not
  // allowed to authorize new evidence merely by naming it in its provenance.
  const update = SquadCoordinator.prototype.update;
  let injected = false;
  const spy = vi.spyOn(SquadCoordinator.prototype, 'update').mockImplementation(function (this: SquadCoordinator, ...args) {
    const plan = update.apply(this, args);
    const watch = plan.assignments.find(assignment => assignment.watchSector)?.watchSector;
    if (plan.team === 'alpha' && watch) { mutate(watch); injected = true; }
    return plan;
  });
  const runtime = new TacticalRuntime({ ...DEFAULT_CONFIG, scenarioId: 'casualty', seed: 2048 });
  try {
    expect(() => { for (let tick = 0; tick < 210; tick++) runtime.step(); }).toThrow(reason);
    expect(injected).toBe(true);
  } finally { runtime.dispose(); spy.mockRestore(); }
});
