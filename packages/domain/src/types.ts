/**
 * Canonical domain types. Field names and widths mirror docs/TECHNICAL_SPEC.md section 5 (Rust
 * `snake_case` fields become `camelCase`). Raw token amounts and timestamps are `bigint`:
 * u64 amounts, i64 unix seconds. Counters that the program keeps as u32/u8 are plain `number`
 * because they are bounded far below 2^53 and never enter settlement arithmetic as money.
 */

/** Base58 Solana address. */
export type Address = string;

/** 32-byte hash as 64 lowercase hex characters. */
export type Hex32 = string;

export const MandateStatus = {
  Bidding: "Bidding",
  Awarded: "Awarded",
  Active: "Active",
  AwaitingFinalization: "AwaitingFinalization",
  Closed: "Closed",
  Cancelled: "Cancelled",
} as const;
export type MandateStatus = (typeof MandateStatus)[keyof typeof MandateStatus];

export const BidStatus = {
  Active: "Active",
  Cancelled: "Cancelled",
  Accepted: "Accepted",
  RejectedByAward: "RejectedByAward",
} as const;
export type BidStatus = (typeof BidStatus)[keyof typeof BidStatus];

export const EpochStatus = {
  Compliant: "Compliant",
  NonCompliant: "NonCompliant",
  Unavailable: "Unavailable",
} as const;
export type EpochStatus = (typeof EpochStatus)[keyof typeof EpochStatus];

export const VenueType = { MeteoraDlmm: "MeteoraDlmm" } as const;
export type VenueType = (typeof VenueType)[keyof typeof VenueType];

export interface ProtocolConfig {
  readonly version: number;
  readonly bump: number;
  readonly admin: Address;
  readonly pendingAdmin: Address;
  readonly usdcMint: Address;
  readonly usdcTokenProgram: Address;
  readonly pausedNewRisk: boolean;
  readonly minBudgetRaw: bigint;
  readonly maxBudgetRaw: bigint;
  readonly minEpochSeconds: bigint;
  readonly maxEpochSeconds: bigint;
  readonly maxDurationSeconds: bigint;
  readonly maxEpochs: number;
  readonly maxSpreadBps: number;
  readonly maxDepthBandBps: number;
  readonly maxPositions: number;
  readonly minProbeQuoteRaw: bigint;
  readonly maxProbeQuoteRaw: bigint;
  readonly minStartLeadSeconds: bigint;
  readonly positionLockBufferSeconds: bigint;
  readonly minSetupWindowSeconds: bigint;
  readonly unavailableRecoverySeconds: bigint;
  readonly currentObserverSetVersion: number;
}

export interface ObserverSet {
  readonly version: number;
  readonly bump: number;
  readonly observerCount: number;
  readonly threshold: number;
  readonly observers: readonly Address[];
  readonly createdAt: bigint;
}

export interface MarketConfig {
  readonly version: number;
  readonly bump: number;
  readonly enabled: boolean;
  readonly venueType: VenueType;
  readonly pool: Address;
  readonly baseMint: Address;
  readonly baseTokenProgram: Address;
  readonly baseDecimals: number;
  readonly quoteMint: Address;
  readonly quoteTokenProgram: Address;
  readonly quoteDecimals: number;
  readonly prestocksMetadataHash: Hex32;
  readonly reviewedAt: bigint;
}

/** The economic thresholds a mandate fixes at creation. Immutable after award. */
export interface Thresholds {
  readonly maxEffectiveSpreadBps: number;
  readonly minPoolBuyDepthQuoteRaw: bigint;
  readonly minPoolSellDepthQuoteRaw: bigint;
  readonly minProviderQuoteInBandRaw: bigint;
  readonly minProviderBaseQuoteEqInBandRaw: bigint;
}

export interface Mandate extends Thresholds {
  readonly version: number;
  readonly bump: number;
  readonly sponsor: Address;
  readonly mandateId: bigint;
  readonly marketConfig: Address;
  readonly observerSet: Address;

  readonly createdAt: bigint;
  readonly biddingEndsAt: bigint;
  readonly startAt: bigint;
  readonly epochSeconds: bigint;
  readonly totalEpochs: number;
  readonly endAt: bigint;

  readonly maxRewardRaw: bigint;
  readonly acceptedRewardRaw: bigint;
  readonly baseEpochRewardRaw: bigint;
  readonly finalEpochExtraRaw: bigint;

  readonly depthBandBps: number;
  readonly probeQuoteRaw: bigint;

  readonly acceptedBid: Address;
  readonly provider: Address;
  readonly positionSet: Address;

  readonly compliantEpochs: number;
  readonly noncompliantEpochs: number;
  readonly unavailableEpochs: number;
  readonly finalizedEpochs: number;
  readonly earnedRewardRaw: bigint;
  /**
   * Sum of the rewards of epochs finalized NonCompliant or Unavailable. Needed to derive the
   * unresolved amount exactly, because the final epoch carries the remainder and therefore a
   * different reward. Added to the spec's suggested Mandate struct (docs/TECHNICAL_SPEC.md 5.5).
   */
  readonly forfeitedRewardRaw: bigint;
  readonly claimedRewardRaw: bigint;
  readonly sponsorWithdrawnRaw: bigint;
  readonly status: MandateStatus;
}

export interface Bid {
  readonly version: number;
  readonly bump: number;
  readonly mandate: Address;
  readonly provider: Address;
  readonly nonce: bigint;
  readonly requestedRewardRaw: bigint;
  readonly createdAt: bigint;
  readonly validUntil: bigint;
  readonly status: BidStatus;
}

export interface PositionSet {
  readonly version: number;
  readonly bump: number;
  readonly mandate: Address;
  readonly provider: Address;
  readonly positionCount: number;
  readonly positions: readonly Address[];
  readonly lockedAt: bigint;
}

export interface EpochMetrics {
  readonly effectiveSpreadBps: number;
  readonly poolBuyDepthQuoteRaw: bigint;
  readonly poolSellDepthQuoteRaw: bigint;
  readonly providerQuoteInBandRaw: bigint;
  readonly providerBaseQuoteEqInBandRaw: bigint;
}

export interface EpochAttestation {
  readonly version: number;
  readonly bump: number;
  readonly mandate: Address;
  readonly epochIndex: number;
  readonly observer: Address;
  readonly observedSlot: bigint;
  readonly observedUnixTs: bigint;
  readonly algorithmVersion: number;
  readonly positionSet: Address;
  readonly payloadHash: Hex32;
  readonly evidenceHash: Hex32;
  readonly metrics: EpochMetrics;
  readonly createdAt: bigint;
}

export interface EpochResult {
  readonly version: number;
  readonly bump: number;
  readonly mandate: Address;
  readonly epochIndex: number;
  readonly observedSlot: bigint;
  readonly observedUnixTs: bigint;
  readonly algorithmVersion: number;
  readonly payloadHash: Hex32;
  readonly evidenceHash: Hex32;
  readonly metrics: EpochMetrics;
  readonly status: EpochStatus;
  readonly rewardEarnedRaw: bigint;
  readonly finalizedAt: bigint;
}
