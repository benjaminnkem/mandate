import { BorshAccountsCoder } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { MANDATE_IDL } from "./idl.ts";

const coder = new BorshAccountsCoder(MANDATE_IDL);

const snakeToCamel = (key: string): string =>
  key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

/**
 * Convert what Anchor's Borsh coder returns into plain values: `BN` becomes `bigint` (never a JavaScript
 * number, because amounts and timestamps must stay exact), snake_case keys become camelCase, and a unit-variant
 * enum such as `{ Active: {} }` becomes the string `"Active"`.
 */
function plain(value: unknown): unknown {
  if (BN.isBN(value)) return BigInt(value.toString());
  if (value instanceof PublicKey) return value;
  if (Array.isArray(value)) return (value as unknown[]).map(plain);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (
      entries.length === 1 &&
      entries[0] &&
      typeof entries[0][1] === "object" &&
      Object.keys(entries[0][1] as object).length === 0
    ) {
      return entries[0][0]; // { Variant: {} }
    }
    return Object.fromEntries(entries.map(([k, v]) => [snakeToCamel(k), plain(v)]));
  }
  return value;
}

export type AccountName =
  | "ProtocolConfig"
  | "ObserverSet"
  | "MarketConfig"
  | "Mandate"
  | "Bid"
  | "PositionSet"
  | "EpochAttestation";

/** Decode a program account by name. The caller states the shape it expects; nothing is guessed. */
// The generic is the caller's stated expectation of the decoded shape; the coder returns untyped data.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function decodeAccount<T>(name: AccountName, data: Uint8Array): T {
  return plain(coder.decode(name, Buffer.from(data))) as T;
}

export interface MetricsAccount {
  readonly effectiveSpreadBps: number;
  readonly poolBuyDepthQuoteRaw: bigint;
  readonly poolSellDepthQuoteRaw: bigint;
  readonly providerQuoteInBandRaw: bigint;
  readonly providerBaseQuoteEqInBandRaw: bigint;
}

export interface MandateAccount {
  readonly sponsor: PublicKey;
  readonly mandateId: bigint;
  readonly marketConfig: PublicKey;
  readonly observerSet: PublicKey;
  readonly vault: PublicKey;
  readonly startAt: bigint;
  readonly epochSeconds: bigint;
  readonly totalEpochs: number;
  readonly endAt: bigint;
  readonly algorithmVersion: number;
  readonly unavailableRecoverySeconds: bigint;
  readonly depthBandBps: number;
  readonly probeQuoteRaw: bigint;
  readonly maxEffectiveSpreadBps: number;
  readonly minPoolBuyDepthQuoteRaw: bigint;
  readonly minPoolSellDepthQuoteRaw: bigint;
  readonly minProviderQuoteInBandRaw: bigint;
  readonly minProviderBaseQuoteEqInBandRaw: bigint;
  readonly provider: PublicKey;
  readonly positionSet: PublicKey;
  readonly finalizedEpochs: number;
  readonly status:
    "Bidding" | "Awarded" | "Active" | "AwaitingFinalization" | "Closed" | "Cancelled";
}

export interface PositionSetAccount {
  readonly mandate: PublicKey;
  readonly provider: PublicKey;
  readonly positionCount: number;
  readonly positions: readonly PublicKey[];
  readonly lockedAt: bigint;
}

export interface ObserverSetAccount {
  readonly version: number;
  readonly observerCount: number;
  readonly threshold: number;
  readonly observers: readonly PublicKey[];
}

export interface MarketConfigAccount {
  readonly enabled: boolean;
  readonly pool: PublicKey;
  readonly baseMint: PublicKey;
  readonly quoteMint: PublicKey;
  readonly baseIsX: boolean;
}

export interface EpochAttestationAccount {
  readonly mandate: PublicKey;
  readonly epochIndex: number;
  readonly observer: PublicKey;
  readonly observedSlot: bigint;
  readonly observedUnixTs: bigint;
  readonly algorithmVersion: number;
  readonly positionSet: PublicKey;
  readonly payloadHash: readonly number[] | Uint8Array;
  readonly evidenceHash: readonly number[] | Uint8Array;
  readonly metrics: MetricsAccount;
  readonly createdAt: bigint;
}

/** Positions actually registered (the account stores a fixed-size array padded with default keys). */
export const registeredPositions = (set: PositionSetAccount): readonly PublicKey[] =>
  set.positions.slice(0, set.positionCount);

/** Observers actually in the set (the account stores a fixed-size array padded with default keys). */
export const setObservers = (set: ObserverSetAccount): readonly PublicKey[] =>
  set.observers.slice(0, set.observerCount);
