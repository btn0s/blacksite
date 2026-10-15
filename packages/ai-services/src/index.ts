import { Context, Data, Effect, Layer, ManagedRuntime } from 'effect';
import { TacticalRuntime } from '@blacksite/ai-runtime';
import type {
  AgentCommand,
  RenderSnapshot,
  ReplayFile,
  RuntimeConfig,
  RuntimeWorld,
  TacticalMap,
} from '@blacksite/ai-schema';
export {
  ModelRegistryService,
  PolicyInferenceService,
  signedModelRegistryLayer,
  inferWithDeadline,
} from './model-registry';
export class AuthorityError extends Data.TaggedError('AuthorityError')<{
  cause: unknown;
  operation: string;
}> {
  get message() {
    return `${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}
export class AuthorityService extends Context.Tag('@ce/Authority')<
  AuthorityService,
  {
    readonly map: TacticalMap;
    readonly replay: () => Effect.Effect<ReplayFile, AuthorityError>;
    readonly snapshot: () => Effect.Effect<RenderSnapshot, AuthorityError>;
    readonly step: (
      commands?: Array<AgentCommand>,
    ) => Effect.Effect<RenderSnapshot, AuthorityError>;
  }
>() {}
const attempt = <T>(operation: string, body: () => T) =>
  Effect.try({ catch: (cause) => new AuthorityError({ cause, operation }), try: body });
export function offlineDeterministicLayer(config: RuntimeConfig, world?: RuntimeWorld) {
  return Layer.scoped(
    AuthorityService,
    Effect.acquireRelease(
      attempt('initialize', () => new TacticalRuntime(config, world)),
      (runtime) => Effect.sync(() => runtime.dispose()),
    ).pipe(
      Effect.map((runtime) => ({
        map: runtime.map,
        replay: () => attempt('replay', () => runtime.exportReplay()),
        snapshot: () => attempt('snapshot', () => runtime.snapshot()),
        step: (commands?: Array<AgentCommand>) => attempt('step', () => runtime.step(commands)),
      })),
    ),
  );
}
export const browserWorkerLayer = offlineDeterministicLayer;
export const serverAuthoritativeLayer = offlineDeterministicLayer;
export const createAuthority = (config: RuntimeConfig, world?: RuntimeWorld) =>
  ManagedRuntime.make(offlineDeterministicLayer(config, world));
export type ManagedAuthority = ReturnType<typeof createAuthority>;
export class ReplayService extends Context.Tag('@ce/Replay')<
  ReplayService,
  {
    load: (id: string) => Effect.Effect<ReplayFile | undefined>;
    save: (id: string, replay: ReplayFile) => Effect.Effect<void>;
  }
>() {}
export const memoryReplayLayer = Layer.sync(ReplayService, () => {
  const records = new Map<string, ReplayFile>();
  return {
    load: (id: string) =>
      Effect.sync(() => {
        const replay = records.get(id);
        return replay ? structuredClone(replay) : undefined;
      }),
    save: (id: string, value: ReplayFile) =>
      Effect.sync(() => {
        records.set(id, structuredClone(value));
      }),
  };
});
