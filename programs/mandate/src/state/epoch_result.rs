use anchor_lang::prelude::*;

use super::attestation::EpochMetrics;

/// The final, immutable verdict on one epoch. Exactly one exists per (mandate, epoch): it is a PDA
/// `[b"epoch_result", mandate, epoch_index_le]` created with `init`, so a second finalization cannot happen.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum EpochOutcome {
    /// A quorum attested metrics that meet every threshold. The epoch's reward is earned.
    Compliant,
    /// A quorum attested metrics that miss at least one threshold. The reward is forfeited.
    NonCompliant,
    /// No quorum was attested before the recovery deadline. Distinct from `NonCompliant`: nothing was
    /// measured, so nothing is claimed about the provider's quality. The reward is forfeited.
    Unavailable,
}

#[account]
#[derive(InitSpace)]
pub struct EpochResult {
    pub version: u8,
    pub bump: u8,
    pub mandate: Pubkey,
    pub epoch_index: u32,
    pub outcome: EpochOutcome,
    /// Reward this epoch earned the provider: the epoch's exact share when `Compliant`, else 0.
    pub reward_earned_raw: u64,
    /// Reward this epoch's share forfeited to the sponsor: 0 when `Compliant`, else the epoch's exact share.
    pub reward_forfeited_raw: u64,
    /// Bit set of failed thresholds (mandate_core::compliance); 0 unless `NonCompliant`.
    pub failure_bits: u8,
    /// How many matching attestations backed the verdict; 0 when `Unavailable`.
    pub attestation_count: u8,
    /// The attested facts, identical across every counted attestation. All zero when `Unavailable`.
    pub observed_slot: u64,
    pub observed_unix_ts: i64,
    pub algorithm_version: u32,
    pub position_set: Pubkey,
    pub payload_hash: [u8; 32],
    pub evidence_hash: [u8; 32],
    pub metrics: EpochMetrics,
    pub finalized_by: Pubkey,
    pub finalized_at: i64,
}
