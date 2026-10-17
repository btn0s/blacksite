export type TimingSlot = {
  waitedSeconds: number
  hold(seconds: number): Promise<void>
  release(): Promise<void>
}
export declare function takeTimingSlot(options: { label: string; seconds: number; log: (line: string) => void; shared?: boolean; root?: string }): Promise<TimingSlot>
