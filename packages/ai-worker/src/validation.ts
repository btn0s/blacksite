import {
  DEFAULT_CONFIG,
  validateRuntimeWorld,
  type AgentCommand,
  type RuntimeConfig,
  type WorkerRequest,
} from '@blacksite/ai-schema';
export const SCENARIO_IDS = [
  'crossfire',
  'breach',
  'search',
  'casualty',
  'low-ammo',
  'deadlock',
] as const;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  finite(value) && Number.isInteger(value) && value >= min && value <= max;
export function isCommand(value: unknown): value is AgentCommand {
  if (!record(value) || !record(value.move) || !record(value.lookDelta)) {
    return false;
  }
  return (
    integer(value.tick, 0, 1e9) &&
    typeof value.agentId === 'string' &&
    value.agentId.length <= 64 &&
    finite(value.move.x) &&
    finite(value.move.y) &&
    Math.abs(value.move.x) <= 1 &&
    Math.abs(value.move.y) <= 1 &&
    finite(value.lookDelta.yaw) &&
    finite(value.lookDelta.pitch) &&
    Math.abs(value.lookDelta.yaw) <= Math.PI &&
    Math.abs(value.lookDelta.pitch) <= Math.PI &&
    ['stand', 'crouch', 'prone'].includes(String(value.stance)) &&
    integer(value.buttons, 0, 1023) &&
    ['human', 'ai'].includes(String(value.source)) &&
    integer(value.sourceSequence, 0, 1e9)
  );
}
export function isConfig(value: unknown): value is RuntimeConfig {
  if (!record(value) || !record(value.skill)) {
    return false;
  }
  return (
    integer(value.seed, 0, 0xff_ff_ff_ff) &&
    SCENARIO_IDS.includes(value.scenarioId as RuntimeConfig['scenarioId']) &&
    integer(value.agentsPerTeam, 1, 8) &&
    integer(value.maxTicks, 30, 36_000) &&
    integer(value.radioLatencyTicks, 1, 300) &&
    ['symbolic', 'shadow', 'hybrid'].includes(String(value.policyMode)) &&
    Object.keys(DEFAULT_CONFIG.skill).every((key) => {
      const n = (value.skill as Record<string, unknown>)[key];
      return finite(n) && n >= 0 && n <= 1;
    })
  );
}
export function parseRequest(value: unknown): WorkerRequest {
  if (!record(value)) {
    throw new Error('Invalid worker request');
  }
  switch (value.type) {
    case 'init':
      if (isConfig(value.config)) {
        return {
          config: structuredClone(value.config),
          type: 'init',
          ...(value.world === undefined
            ? {}
            : { world: validateRuntimeWorld(value.world, value.config.agentsPerTeam) }),
        };
      }
      break;
    case 'play':
      if ([0.25, 0.5, 1, 2, 4, 8].includes(value.speed as number)) {
        return { speed: value.speed as number, type: 'play' };
      }
      break;
    case 'pause':
    case 'export':
    case 'dispose':
      return { type: value.type };
    case 'step':
      if (value.count === undefined || integer(value.count, 1, 120)) {
        return { count: value.count as number | undefined, type: 'step' };
      }
      break;
    case 'command':
      if (isCommand(value.command)) {
        return { command: structuredClone(value.command), type: 'command' };
      }
      break;
  }
  throw new Error(`Invalid ${String(value.type)} request`);
}
