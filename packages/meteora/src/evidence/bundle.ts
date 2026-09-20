import {
  ALGORITHM_VERSION,
  MAX_BINARY_ITERATIONS,
  MAX_EXPANSION_STEPS,
  SEARCH_CAP_QUOTE_RAW,
  SEARCH_GROWTH_FACTOR,
  SEARCH_RESOLUTION_RAW,
} from "../algorithm/constants.ts";
import type { BoundaryProof } from "../algorithm/search.ts";
import { BIN_ARRAYS_PER_DIRECTION } from "../adapter/dlmm-engine.ts";
import type { PoolObservation } from "../adapter/pool.ts";
import { accountHashes } from "../adapter/snapshot.ts";
import { METEORA_DLMM_SDK_VERSION } from "../sdk.ts";
import { canonicalHash, type CanonicalValue } from "./canonical.ts";

export const EVIDENCE_SCHEMA_VERSION = 1;

/** What ties a measurement to the exact code that produced it. Supplied by the caller (CI, observer). */
export interface Provenance {
  /** Git commit of the algorithm source, or an explicit marker such as "uncommitted". */
  readonly algorithmSourceCommit: string;
  /** SHA-256 of the repository lockfile, so dependency versions are part of the evidence. */
  readonly lockfileSha256: string;
}

/** Where in the protocol this observation belongs. All null for a standalone read-only report. */
export interface MandateContext {
  readonly cluster: string;
  readonly mandate: string | null;
  readonly epochIndex: number | null;
  readonly positionSet: string | null;
}

/** Observer-specific facts that must not influence the agreed payload hash. */
export interface Transport {
  readonly observerInstanceId: string | null;
  readonly rpcHost: string | null;
  readonly snapshotLabel: string;
  readonly snapshotCapturedAt: string;
  readonly calls: readonly {
    readonly method: string;
    readonly contextSlot: number;
    readonly accountCount: number;
  }[];
}

const proofToCanonical = (proof: BoundaryProof): CanonicalValue => ({
  passing_input: proof.passingInput,
  passing_out: proof.passingOut,
  failing_input: proof.failingInput,
  failing_reason: proof.failingReason,
  cap_reached: proof.capReached,
  quote_calls: proof.quoteCalls,
});

export interface EvidenceBundle {
  /** The deterministic document every honest observer must reproduce exactly. */
  readonly payload: CanonicalValue;
  readonly payloadHash: string;
  /** Payload plus observer-specific transport metadata. */
  readonly evidence: CanonicalValue;
  readonly evidenceHash: string;
  /** The five settlement metrics, ready for an attestation. */
  readonly metrics: {
    readonly effectiveSpreadBps: number;
    readonly poolBuyDepthQuoteRaw: bigint;
    readonly poolSellDepthQuoteRaw: bigint;
    readonly providerQuoteInBandRaw: bigint;
    readonly providerBaseQuoteEqInBandRaw: bigint;
  };
  readonly observedSlot: bigint;
  readonly observedUnixTs: bigint;
}

export function buildEvidence(
  observation: PoolObservation,
  context: MandateContext,
  provenance: Provenance,
  inputs: { readonly probeQuoteRaw: bigint; readonly depthBandBps: bigint },
  transport: Omit<Transport, "snapshotLabel" | "snapshotCapturedAt" | "calls">,
): EvidenceBundle {
  const { measurement: m, pool, baseMintState: mint } = observation;

  const payload: CanonicalValue = {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    algorithm_version: ALGORITHM_VERSION,
    algorithm_constants: {
      search_cap_quote_raw: SEARCH_CAP_QUOTE_RAW,
      search_growth_factor: SEARCH_GROWTH_FACTOR,
      max_expansion_steps: MAX_EXPANSION_STEPS,
      search_resolution_raw: SEARCH_RESOLUTION_RAW,
      max_binary_iterations: MAX_BINARY_ITERATIONS,
      bin_arrays_per_direction: BIN_ARRAYS_PER_DIRECTION,
    },
    algorithm_source_commit: provenance.algorithmSourceCommit,
    lockfile_sha256: provenance.lockfileSha256,
    sdk: { name: "@meteora-ag/dlmm", version: METEORA_DLMM_SDK_VERSION },
    cluster: context.cluster,
    mandate: context.mandate,
    epoch_index: context.epochIndex,
    position_set: context.positionSet,
    market: {
      pool: pool.address,
      program_id: pool.programId,
      base_mint: pool.baseMint,
      quote_mint: pool.quoteMint,
      base_is_x: pool.baseIsX,
      active_bin_id: pool.activeId,
      bin_step: pool.binStep,
      base_factor: pool.baseFactor,
      variable_fee_control: pool.variableFeeControl,
      volatility_accumulator: pool.volatilityAccumulator,
      last_update_timestamp: pool.lastUpdateTimestamp,
    },
    provider: observation.provider,
    registered_positions: observation.registeredPositions,
    observation: {
      slot_min: observation.slots.minSlot,
      slot_max: observation.slots.maxSlot,
      clock_slot: observation.clock.slot,
      clock_epoch: observation.clock.epoch,
      clock_unix_ts: observation.clock.unixTimestamp,
    },
    inputs: { probe_quote_raw: inputs.probeQuoteRaw, depth_band_bps: inputs.depthBandBps },
    probe: { q0: m.probe.q0, b0: m.probe.b0, s0: m.probe.s0 },
    band: {
      lower_bin_id: m.band.lowerBinId,
      upper_bin_id: m.band.upperBinId,
      bins_below: m.band.binsBelow,
      bins_above: m.band.binsAbove,
    },
    metrics: {
      effective_spread_bps: m.metrics.effectiveSpreadBps,
      pool_buy_depth_quote_raw: m.metrics.poolBuyDepthQuoteRaw,
      pool_sell_depth_quote_raw: m.metrics.poolSellDepthQuoteRaw,
      provider_quote_in_band_raw: m.metrics.providerQuoteInBandRaw,
      provider_base_quote_eq_in_band_raw: m.metrics.providerBaseQuoteEqInBandRaw,
    },
    depth_proofs: { buy: proofToCanonical(m.buyDepth), sell: proofToCanonical(m.sellDepth) },
    provider_base_in_band_raw: m.providerBaseInBandRaw,
    provider_positions: m.provider.perPosition.map((p) => ({
      address: p.address,
      verdict: p.verdict,
      owner: p.owner,
      operator: p.operator,
      fee_owner: p.feeOwner,
      lower_bin_id: p.lowerBinId,
      upper_bin_id: p.upperBinId,
      covers_active_bin: p.coversActiveBin,
      bins_in_band: p.binsInBand,
      quote_in_band_raw: p.quoteInBandRaw,
      base_in_band_raw: p.baseInBandRaw,
    })),
    base_mint_state: {
      address: mint.address,
      program_id: mint.programId,
      decimals: mint.decimals,
      has_freeze_authority: mint.hasFreezeAuthority,
      extensions: mint.extensions,
      observation_epoch: mint.observationEpoch,
      effective_transfer_fee_bps: mint.effectiveTransferFeeBps,
      transfer_fee_schedule: mint.transferFeeSchedule
        ? {
            older_epoch: mint.transferFeeSchedule.olderEpoch,
            older_bps: mint.transferFeeSchedule.olderBps,
            newer_epoch: mint.transferFeeSchedule.newerEpoch,
            newer_bps: mint.transferFeeSchedule.newerBps,
          }
        : null,
      transfer_hook_program_id: mint.transferHookProgramId,
      paused: mint.paused,
      permanent_delegate: mint.permanentDelegate,
      scaled_ui_multiplier: mint.scaledUiMultiplier,
    },
    quote_mint: {
      address: observation.quoteMint.address,
      program_id: observation.quoteMint.programId,
      decimals: observation.quoteMint.decimals,
    },
    account_hashes: accountHashes(observation.snapshot),
  };

  const fullTransport: Transport = {
    ...transport,
    snapshotLabel: observation.snapshot.label,
    snapshotCapturedAt: observation.snapshot.capturedAt,
    calls: observation.snapshot.calls.map((call) => ({
      method: call.method,
      contextSlot: call.contextSlot,
      accountCount: call.addresses.length,
    })),
  };
  const evidence: CanonicalValue = {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    payload,
    transport: {
      observer_instance_id: fullTransport.observerInstanceId,
      rpc_host: fullTransport.rpcHost,
      snapshot_label: fullTransport.snapshotLabel,
      snapshot_captured_at: fullTransport.snapshotCapturedAt,
      calls: fullTransport.calls.map((c) => ({
        method: c.method,
        context_slot: c.contextSlot,
        account_count: c.accountCount,
      })),
    },
  };

  return {
    payload,
    payloadHash: canonicalHash(payload),
    evidence,
    evidenceHash: canonicalHash(evidence),
    metrics: m.metrics,
    observedSlot: BigInt(observation.slots.maxSlot),
    observedUnixTs: BigInt(observation.clock.unixTimestamp),
  };
}
