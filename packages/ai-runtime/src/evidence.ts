export function pruneEvidenceLedger(
  ledger: Map<string, number>,
  tick: number,
  liveProvenance: Iterable<string>,
): void {
  const referenced = new Set(liveProvenance);
  for (const [id, expiry] of ledger) {
    if (expiry < tick && !referenced.has(id)) {
      ledger.delete(id);
    }
  }
}
