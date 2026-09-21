import type { AttestedMetrics, EpochAttestationAccount, MandateAccount } from "@mandate/solana";

/** Everything an observer reads from chain about one mandate, already decoded. Addresses are base58 strings. */
export interface MandateContext {
  readonly mandateAddress: string;
  readonly mandate: MandateAccount;
  readonly observerSetAddress: string;
  /** Observers in observer-set order (leader rotation depends on this order). */
  readonly observers: readonly string[];
  readonly threshold: number;
  readonly positionSetAddress: string;
  /** Registered position accounts, in registration order. */
  readonly positions: readonly string[];
  readonly market: { readonly pool: string; readonly baseMint: string; readonly quoteMint: string };
}

export interface OnchainAttestation {
  readonly observer: string;
  readonly observedSlot: bigint;
  readonly observedUnixTs: bigint;
  readonly algorithmVersion: number;
  readonly positionSet: string;
  /** Lowercase hex, 64 characters. */
  readonly payloadHash: string;
  readonly evidenceHash: string;
  readonly metrics: AttestedMetrics;
}

export interface SubmitInput {
  readonly mandateAddress: string;
  readonly observerSetAddress: string;
  readonly positionSetAddress: string;
  readonly epochIndex: number;
  readonly observedSlot: bigint;
  readonly observedUnixTs: bigint;
  readonly algorithmVersion: number;
  readonly payloadHash: string;
  readonly evidenceHash: string;
  readonly metrics: AttestedMetrics;
}

/**
 * The observer's only view of the chain. One instance is bound to exactly one observer key: it can sign and submit
 * only as that observer. Reads are of decoded program accounts; nothing else about the chain leaks into the job.
 */
export interface ChainPort {
  /** This port's observer public key (base58). */
  readonly observer: string;
  /** Current chain time in unix seconds. */
  nowUnix(): Promise<number>;
  loadContext(mandateAddress: string): Promise<MandateContext>;
  /** Attestations that exist on chain for this epoch, keyed by observer, for the given observers. */
  loadAttestations(
    mandateAddress: string,
    epochIndex: number,
    observers: readonly string[],
  ): Promise<ReadonlyMap<string, OnchainAttestation>>;
  /** Throws `AttestationExistsError` if this observer already attested this epoch. */
  submitAttestation(input: SubmitInput): Promise<{ readonly signature: string }>;
}

export const toOnchainAttestation = (a: EpochAttestationAccount): OnchainAttestation => ({
  observer: a.observer.toBase58(),
  observedSlot: a.observedSlot,
  observedUnixTs: a.observedUnixTs,
  algorithmVersion: a.algorithmVersion,
  positionSet: a.positionSet.toBase58(),
  payloadHash: bytesToHex(a.payloadHash),
  evidenceHash: bytesToHex(a.evidenceHash),
  metrics: a.metrics,
});

export const bytesToHex = (bytes: ArrayLike<number>): string =>
  Array.from({ length: bytes.length }, (_, i) =>
    (bytes[i] ?? 0).toString(16).padStart(2, "0"),
  ).join("");

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new RangeError("expected 64 lowercase hex characters");
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}
