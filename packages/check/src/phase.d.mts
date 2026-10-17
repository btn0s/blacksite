export declare const SLACK: number
export declare function within<T>(label: string, seconds: number, work: Promise<T>): Promise<T>
export declare function planned(budget: { hitchMs: number }, shotSeconds: number, contract: { model?: { scripts?: Record<string, number> } } | null, seconds: number): {
  frames(count: number): number
  shot(count: number): number
  script(name: string): number
}
