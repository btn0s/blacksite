import { describe, expect, it } from 'vitest';
import { TacticalRuntime, verifyReplay } from '@blacksite/ai-runtime';
import { DEFAULT_CONFIG } from '@blacksite/ai-schema';

function recordedCommands() {
  const runtime = new TacticalRuntime({ ...DEFAULT_CONFIG, agentsPerTeam: 1, maxTicks: 12 });
  try {
    for (let i = 0; i < 12; i++) runtime.step();
    return runtime.exportReplay();
  } finally { runtime.dispose(); }
}

describe('command replay content compatibility', () => {
  it('can diagnose a historical controller when its physics and map are still installed', () => {
    const replay = recordedCommands();
    replay.versions.planner = 'historical-controller';
    replay.versions.model = 'historical-policy';
    replay.versions.featureSchema = 'historical-features';
    expect(verifyReplay(replay)).toEqual({ valid: true, checkedTicks: 12 });
    expect(replay.versions.planner).toBe('historical-controller');
  });

  it.each(['simulation', 'map'] as const)('rejects unavailable %s content before stepping', component => {
    const replay = recordedCommands();
    replay.versions[component] = 'unavailable-content';
    expect(verifyReplay(replay)).toMatchObject({ valid: false, checkedTicks: 0 });
  });
});
