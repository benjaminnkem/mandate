/** An attestation already on chain for this observer and epoch differs from what this observer holds. Never silent. */
export class AttestationConflictError extends Error {
  override readonly name = "AttestationConflictError";
}

/** Evidence already stored under a key differs from what is being stored. Evidence is immutable. */
export class EvidenceConflictError extends Error {
  override readonly name = "EvidenceConflictError";
}

/** The chain rejected a submission because this observer's attestation for the epoch already exists. */
export class AttestationExistsError extends Error {
  override readonly name = "AttestationExistsError";
}

export class ObserverConfigError extends Error {
  override readonly name = "ObserverConfigError";
}
