/**
 * Stable settlement error codes. These names match docs/TECHNICAL_SPEC.md section 20 and the
 * Rust `MandateCoreError` variants one for one; golden vectors assert them by name.
 */
export const DOMAIN_ERROR_CODES = [
  "ArithmeticOverflow",
  "DivisionByZero",
  "InvalidEpochLength",
  "InvalidTiming",
  "TooManyEpochs",
  "InvalidBudget",
  "InvalidThreshold",
  "BidExpired",
  "EpochOutOfRange",
  "EpochAlreadyFinalized",
  "NothingToClaim",
  "ClaimExceedsEarned",
  "NothingToWithdraw",
  "WithdrawExceedsAvailable",
  "InvariantViolation",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export class DomainError extends Error {
  override readonly name = "DomainError";
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.code = code;
  }
}

export function fail(code: DomainErrorCode, detail?: string): never {
  throw new DomainError(code, detail);
}
