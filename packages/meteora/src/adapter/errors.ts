export type UnobservableReason =
  "MintPaused" | "TransferHookActive" | "PoolMismatch" | "SnapshotIncomplete";

/**
 * The venue state cannot support a valid measurement. This is deliberately a different type from a
 * non-compliant result: it maps to an `Unavailable` epoch (docs/PRD.md section 6.9) and must never
 * be reported to a provider as their failure.
 */
export class UnobservableError extends Error {
  override readonly name = "UnobservableError";
  readonly reason: UnobservableReason;

  constructor(reason: UnobservableReason, detail?: string) {
    super(detail === undefined ? reason : `${reason}: ${detail}`);
    this.reason = reason;
  }
}
