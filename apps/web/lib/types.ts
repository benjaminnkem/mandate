/**
 * Shapes returned by `@mandate/api`. Every chain account travels over HTTP as plain JSON: u64/i64 fields are
 * decimal strings (never a JavaScript number), public keys are base58 strings, byte arrays are lowercase hex,
 * and a unit-variant enum (`Mandate.status`, `EpochResult.outcome`) is a bare string. These mirror
 * `@mandate/solana`'s decoded account interfaces field for field, but with string leaves instead of `bigint` /
 * `PublicKey`, and include every stored field (not only the ones the client package chose to type).
 */

export interface Row<T> {
  readonly address: string;
  /** The slot the indexer last read this account at. */
  readonly asOfSlot: string;
  readonly account: T;
}

export interface Meta {
  readonly cluster: string;
  readonly programId: string;
  readonly indexedSlot: string;
  readonly indexedAt: string | null;
  readonly staleSeconds: number | null;
  readonly stale: boolean;
  readonly source: "indexed-chain-state";
}

export interface Envelope<T> {
  readonly data: T;
  readonly meta: Meta;
}

export interface ApiErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

export type MandateStatus =
  "Bidding" | "Awarded" | "Active" | "AwaitingFinalization" | "Closed" | "Cancelled";

export interface MandateAccountJson {
  readonly sponsor: string;
  readonly mandateId: string;
  readonly marketConfig: string;
  readonly observerSet: string;
  readonly vault: string;
  readonly createdAt: string;
  readonly biddingEndsAt: string;
  readonly startAt: string;
  readonly epochSeconds: string;
  readonly totalEpochs: number;
  readonly endAt: string;
  readonly acceptanceCutoff: string;
  readonly positionLockAt: string;
  readonly algorithmVersion: number;
  readonly unavailableRecoverySeconds: string;
  readonly maxRewardRaw: string;
  readonly acceptedRewardRaw: string;
  readonly baseEpochRewardRaw: string;
  readonly finalEpochExtraRaw: string;
  readonly maxEffectiveSpreadBps: number;
  readonly depthBandBps: number;
  readonly minPoolBuyDepthQuoteRaw: string;
  readonly minPoolSellDepthQuoteRaw: string;
  readonly minProviderQuoteInBandRaw: string;
  readonly minProviderBaseQuoteEqInBandRaw: string;
  readonly probeQuoteRaw: string;
  readonly acceptedBid: string;
  readonly provider: string;
  readonly positionSet: string;
  readonly compliantEpochs: number;
  readonly noncompliantEpochs: number;
  readonly unavailableEpochs: number;
  readonly finalizedEpochs: number;
  readonly earnedRewardRaw: string;
  readonly forfeitedRewardRaw: string;
  readonly claimedRewardRaw: string;
  readonly sponsorWithdrawnRaw: string;
  readonly status: MandateStatus;
}

export type BidStatus = "Active" | "Cancelled" | "Accepted" | "RejectedByAward";

export interface BidAccountJson {
  readonly mandate: string;
  readonly provider: string;
  readonly nonce: string;
  readonly requestedRewardRaw: string;
  readonly createdAt: string;
  readonly validUntil: string;
  readonly status: BidStatus;
}

export interface PositionSetAccountJson {
  readonly mandate: string;
  readonly provider: string;
  readonly positionCount: number;
  readonly positions: readonly string[];
  readonly lockedAt: string;
}

export interface MarketConfigAccountJson {
  readonly enabled: boolean;
  readonly pool: string;
  readonly baseMint: string;
  readonly quoteMint: string;
  readonly baseDecimals: number;
  readonly quoteDecimals: number;
  readonly baseIsX: boolean;
  readonly prestocksMetadataHash: string;
  readonly reviewedAt: string;
}

export interface MetricsJson {
  readonly effectiveSpreadBps: number;
  readonly poolBuyDepthQuoteRaw: string;
  readonly poolSellDepthQuoteRaw: string;
  readonly providerQuoteInBandRaw: string;
  readonly providerBaseQuoteEqInBandRaw: string;
}

export interface EpochAttestationAccountJson {
  readonly mandate: string;
  readonly epochIndex: number;
  readonly observer: string;
  readonly observedSlot: string;
  readonly observedUnixTs: string;
  readonly algorithmVersion: number;
  readonly positionSet: string;
  readonly payloadHash: string;
  readonly evidenceHash: string;
  readonly metrics: MetricsJson;
  readonly createdAt: string;
}

export type EpochOutcome = "Compliant" | "NonCompliant" | "Unavailable";

export interface EpochResultAccountJson {
  readonly mandate: string;
  readonly epochIndex: number;
  readonly outcome: EpochOutcome;
  readonly rewardEarnedRaw: string;
  readonly rewardForfeitedRaw: string;
  readonly failureBits: number;
  readonly attestationCount: number;
  readonly observedSlot: string;
  readonly observedUnixTs: string;
  readonly algorithmVersion: number;
  readonly positionSet: string;
  readonly payloadHash: string;
  readonly evidenceHash: string;
  readonly metrics: MetricsJson;
  readonly finalizedBy: string;
  readonly finalizedAt: string;
}

export interface AmountPairJson {
  readonly raw: string;
  readonly usdc: string;
}

export interface MandateAccounting {
  readonly deposited: AmountPairJson;
  readonly accepted: AmountPairJson;
  readonly earned: AmountPairJson;
  readonly forfeited: AmountPairJson;
  readonly unresolved: AmountPairJson;
  readonly claimed: AmountPairJson;
  readonly claimableByProvider: AmountPairJson;
  readonly sponsorWithdrawn: AmountPairJson;
  readonly withdrawableBySponsor: AmountPairJson;
  readonly expectedVault: AmountPairJson;
  readonly error?: string;
}

export interface VaultReconciliation {
  readonly ok: boolean;
  readonly checkedAt: string;
  readonly expectedRaw: string;
  readonly actualRaw: string | null;
  readonly findings: unknown;
}

export interface MandateDetail extends Row<MandateAccountJson> {
  readonly accounting: MandateAccounting;
  readonly positionSet: Row<PositionSetAccountJson> | null;
  readonly vaultReconciliation: VaultReconciliation | null;
}

export interface MandateListResponse {
  readonly mandates: readonly Row<MandateAccountJson>[];
  readonly nextAfter: string | null;
}

export interface EpochTimelineEntry {
  readonly epoch: number;
  readonly outcome: EpochOutcome | "Pending";
  readonly result: Row<EpochResultAccountJson> | null;
  readonly attestationCount: number;
}

export interface EpochTimeline {
  readonly totalEpochs: number;
  readonly epochs: readonly EpochTimelineEntry[];
}

export interface AttestationAgreementGroup {
  readonly evidenceHash: string;
  readonly payloadHash: string;
  readonly observers: readonly string[];
}

export interface EvidenceResponse {
  readonly epoch: number;
  readonly outcome: EpochOutcome | "Pending";
  readonly result: Row<EpochResultAccountJson> | null;
  readonly attestations: readonly Row<EpochAttestationAccountJson>[];
  readonly agreement: {
    readonly groups: readonly AttestationAgreementGroup[];
    readonly unanimous: boolean;
  };
  readonly evidence:
    | {
        readonly evidenceHash: string;
        readonly payloadHash: string;
        readonly snapshotSha256: string | null;
        readonly algorithmVersion: number;
        readonly algorithmSourceCommit: string | null;
        readonly lockfileSha256: string | null;
        readonly observedSlot: string;
        readonly observedUnixTs: string;
        readonly snapshotUrl: string | null;
      }
    | { readonly evidenceHash: string; readonly note: string };
  readonly howToReproduce: {
    readonly statement: string;
    readonly parameters: {
      readonly pool: string | null;
      readonly baseMint: string | null;
      readonly quoteMint: string | null;
      readonly provider: string;
      readonly positions: readonly string[] | null;
      readonly probeQuoteRaw: string;
      readonly depthBandBps: number;
      readonly algorithmVersion: number;
    };
    readonly expected: {
      readonly payloadHash: string | null;
      readonly evidenceHash: string;
      readonly metrics: MetricsJson | null;
    };
  };
}

export interface MarketQuality {
  readonly pool: string;
  readonly market: Row<MarketConfigAccountJson>;
  readonly latestAttestedEpoch: {
    readonly mandate: string;
    readonly epochIndex: number;
    readonly outcome: EpochOutcome;
    readonly observedUnixTs: string;
    readonly observedSlot: string;
    readonly evidenceHash: string;
    readonly payloadHash: string;
    readonly aggregatePool: {
      readonly effectiveSpreadBps: number;
      readonly buyDepthQuoteRaw: string;
      readonly sellDepthQuoteRaw: string;
    };
    readonly providerContribution: {
      readonly quoteInBandRaw: string;
      readonly baseQuoteEqInBandRaw: string;
    };
  } | null;
  readonly note: string | null;
}

export interface PrestocksAsset {
  readonly contract_address: string;
  readonly [key: string]: unknown;
}

/** An unsigned transaction bundle as every `POST /v1/tx/*` route returns it. */
export interface TxBundle {
  readonly transaction: string;
  readonly encoding: string;
  readonly signer: string;
  readonly expiresAfterBlockHeight: number;
  readonly network: { readonly cluster: string; readonly programId: string };
  readonly summary: Record<string, unknown>;
  readonly notice: string;
}
