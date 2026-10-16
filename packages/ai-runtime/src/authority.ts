import type { TacticalSpatialQueries } from '@blacksite/ai-nav';
import type {
  AgentCommand,
  AttackTokenRules,
  IntentRules,
  Observation,
  SelfState,
  SimEvent,
  TeamId,
  Vec3,
} from '@blacksite/ai-schema';
export interface TacticalAuthority {
  checksum(): string;
  dispose(): void;
  generateObservations(): Map<string, Array<Observation>>;
  kills(id: string): number;
  readonly objective: {
    owner?: TeamId;
    position: Vec3;
    progress: number;
  };
  observation(id: string): Observation | undefined;
  readonly states: Array<SelfState>;
  readonly status: 'running' | 'complete';
  step(commands: ReadonlyArray<AgentCommand>): {
    checksum: string;
    commands: Array<AgentCommand>;
    events: Array<SimEvent>;
  };
  readonly tick: number;
  readonly winner?: TeamId | 'draw';
}
export type TacticalRuntimeOptions = {
  attackTokens?: AttackTokenRules;
  intents?: IntentRules;
  authority?: TacticalAuthority;
  controlledAgentIds?: ReadonlyArray<string>;
  spatial?: TacticalSpatialQueries;
};
