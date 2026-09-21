use anchor_lang::prelude::*;

/// The five integer metrics settlement compares against the mandate's thresholds. Measured off chain by the
/// canonical algorithm (docs/methodology/measurement-v1.md); the program never trusts a verdict, only these
/// integers, and recomputes compliance itself at finalization.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub struct EpochMetrics {
    pub effective_spread_bps: u32,
    pub pool_buy_depth_quote_raw: u64,
    pub pool_sell_depth_quote_raw: u64,
    pub provider_quote_in_band_raw: u64,
    pub provider_base_quote_eq_in_band_raw: u64,
}

/// One observer's signed claim about one epoch. PDA `[b"attestation", mandate, epoch_index_le, observer]`,
/// so there is at most one per observer per epoch and it can never be replayed to another mandate or epoch.
///
/// It records facts only ("at slot S, these metrics, this evidence"). It accrues no reward and decides
/// nothing: settlement needs a quorum of matching attestations (Prompt 9).
#[account]
#[derive(InitSpace)]
pub struct EpochAttestation {
    pub version: u8,
    pub bump: u8,
    pub mandate: Pubkey,
    pub epoch_index: u32,
    pub observer: Pubkey,
    pub observed_slot: u64,
    pub observed_unix_ts: i64,
    pub algorithm_version: u32,
    /// The position set the observation was bound to.
    pub position_set: Pubkey,
    /// SHA-256 of the canonical payload every honest observer must reproduce exactly.
    pub payload_hash: [u8; 32],
    /// SHA-256 of `{payload_hash, snapshot_sha256}`: also identical across honest observers.
    pub evidence_hash: [u8; 32],
    pub metrics: EpochMetrics,
    pub created_at: i64,
}
