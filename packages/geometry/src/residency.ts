export class ResidencyLedger {
  private readonly allocations = new Map<object, { pool: string; bytes: number }>()
  private readonly used = new Map<string, number>()
  private total = 0
  peakBytes = 0

  constructor(readonly capacity: number, readonly pools: Readonly<Record<string, number>>) {}

  available(pool?: string) {
    if (pool === undefined) return this.capacity - this.total
    return Math.min(this.capacity - this.total, (this.pools[pool] ?? this.capacity) - (this.used.get(pool) ?? 0))
  }

  reserve(owner: object, pool: string, bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.allocations.has(owner)) throw new Error('Invalid residency allocation')
    if (bytes > this.available(pool)) return false
    this.allocations.set(owner, { pool, bytes })
    this.used.set(pool, (this.used.get(pool) ?? 0) + bytes)
    this.total += bytes
    this.peakBytes = Math.max(this.peakBytes, this.total)
    return true
  }

  release(owner: object) {
    const allocation = this.allocations.get(owner)
    if (!allocation) return
    this.total -= allocation.bytes
    this.used.set(allocation.pool, this.used.get(allocation.pool)! - allocation.bytes)
    this.allocations.delete(owner)
  }

  snapshot() {
    return { capacity: this.capacity, bytes: this.total, peakBytes: this.peakBytes, pools: Object.fromEntries(this.used) }
  }
}
