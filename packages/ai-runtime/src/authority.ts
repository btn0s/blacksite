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
  /** Limit how many AI agents per team may fire at once; the rest aim and wait with fireGate 'attack-token'. */
  attackTokens?: AttackTokenRules;
  /** Emit an 'intent' event when an AI agent's activity changes, and hold new moves for leadTicks. */
  intents?: IntentRules;
  authority?: TacticalAuthority;
  controlledAgentIds?: ReadonlyArray<string>;
  spatial?: TacticalSpatialQueries;
};
