import {
  VERSIONS,
  type AgentCommand,
  type ReplayFile,
  type RuntimeConfig,
  type RuntimeWorld,
  type RuntimeMetrics,
} from '@blacksite/ai-schema';
export class PerformanceWindow {
  private samples: Array<number> = [];
  record(milliseconds: number): void {
    if (Number.isFinite(milliseconds) && milliseconds >= 0) {
      this.samples.push(milliseconds);
    }
    if (this.samples.length > 600) {
      this.samples.shift();
    }
  }
  snapshot(): Pick<RuntimeMetrics, 'tickMs' | 'p50' | 'p95' | 'p99'> {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const percentile = (p: number) =>
      sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
    return {
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      tickMs: this.samples.at(-1) ?? 0,
    };
  }
}
export class ReplayRecorder {
  private commands: Array<AgentCommand> = [];
  private checksums: Array<{
    hash: string;
    tick: number;
  }> = [];
  constructor(
    private readonly config: RuntimeConfig,
    private readonly world?: RuntimeWorld,
  ) {}
  record(tick: number, commands: ReadonlyArray<AgentCommand>, hash: string): void {
    this.commands.push(...commands.map((command) => structuredClone(command)));
    this.checksums.push({ hash, tick });
  }
  export(): ReplayFile {
    return {
      config: structuredClone(this.config),
      format: 'cutting-edge-replay-1',
      versions: { ...VERSIONS, ...(this.world ? { map: this.world.map.version } : {}) },
      ...(this.world ? { world: structuredClone(this.world) } : {}),
      checksums: this.checksums.map((value) => ({ ...value })),
      commands: structuredClone(this.commands),
    };
  }
}
export function commandStreamDigest(commands: ReadonlyArray<AgentCommand>): string {
  let hash = 0x81_1c_9d_c5;
  for (const command of commands) {
    const text = JSON.stringify(command);
    for (let index = 0; index < text.length; index++) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 0x01_00_01_93);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
