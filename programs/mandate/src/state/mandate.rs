use anchor_lang::prelude::*;
use mandate_core::accounting::AccountingState;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum MandateStatus {
    /// Accepting bids; nothing awarded. The sponsor may still cancel and take everything back.
    Bidding,
    Awarded,
    Active,
    AwaitingFinalization,
    Closed,
    Cancelled,
}

/// One market-quality contract. PDA `[b"mandate", sponsor, mandate_id_le]`.
///
/// Economic terms (thresholds, schedule, reward) are fixed at creation and never change. The
/// accepted-provider fields and reward split are set once at award and are immutable afterwards.
/// The reward vault is a separate PDA token account owned by this account, so only this program,
/// signing with this account's seeds, can ever move the escrow.
#[account]
#[derive(InitSpace)]
pub struct Mandate {
    pub version: u8,
    pub bump: u8,
    pub sponsor: Pubkey,
    pub mandate_id: u64,
    pub market_config: Pubkey,
    /// The exact observer set version snapshotted at creation.
    pub observer_set: Pubkey,
    /// The reward vault token account (PDA `[b"vault", mandate]`).
    pub vault: Pubkey,

    pub created_at: i64,
    pub bidding_ends_at: i64,
    pub start_at: i64,
    pub epoch_seconds: i64,
    pub total_epochs: u32,
    pub end_at: i64,
    /// Last instant the sponsor may award (docs/adr/0009), fixed at creation from the protocol's parameters
    /// then in force, so later protocol changes can never move a live mandate's deadlines.
    pub acceptance_cutoff: i64,
    /// Instant the provider's position set locks; registration is allowed strictly before it.
    pub position_lock_at: i64,
    /// Measurement algorithm version attestations must carry, fixed at creation.
    pub algorithm_version: u32,
    /// How long after an epoch ends a quorum may still be attested, and before which an epoch cannot be
    /// finalized `Unavailable`. Fixed at creation.
    pub unavailable_recovery_seconds: i64,

    pub max_reward_raw: u64,
    pub accepted_reward_raw: u64,
    pub base_epoch_reward_raw: u64,
    pub final_epoch_extra_raw: u64,

    pub max_effective_spread_bps: u32,
    pub depth_band_bps: u32,
    pub min_pool_buy_depth_quote_raw: u64,
    pub min_pool_sell_depth_quote_raw: u64,
    pub min_provider_quote_in_band_raw: u64,
    pub min_provider_base_quote_eq_in_band_raw: u64,
    pub probe_quote_raw: u64,

    /// `Pubkey::default()` until a bid is accepted.
    pub accepted_bid: Pubkey,
    pub provider: Pubkey,
    pub position_set: Pubkey,

    pub compliant_epochs: u32,
    pub noncompliant_epochs: u32,
    pub unavailable_epochs: u32,
    pub finalized_epochs: u32,
    pub earned_reward_raw: u64,
    /// Sum of rewards of epochs finalized NonCompliant or Unavailable (docs/adr/0009).
    pub forfeited_reward_raw: u64,
    pub claimed_reward_raw: u64,
    pub sponsor_withdrawn_raw: u64,
    pub status: MandateStatus,
}

impl Mandate {
    pub fn has_accepted_bid(&self) -> bool {
        self.accepted_bid != Pubkey::default()
    }

    /// The exact-accounting view of this mandate. Once a bid is accepted, `accepted_reward_raw` is set;
    /// before that the accounting is not meaningful and callers must not use it.
    pub fn accounting(&self) -> AccountingState {
        AccountingState {
            max_reward_raw: self.max_reward_raw,
            accepted_reward_raw: self.accepted_reward_raw,
            total_epochs: self.total_epochs,
            finalized_epochs: self.finalized_epochs,
            compliant_epochs: self.compliant_epochs,
            noncompliant_epochs: self.noncompliant_epochs,
            unavailable_epochs: self.unavailable_epochs,
            earned_reward_raw: self.earned_reward_raw,
            forfeited_reward_raw: self.forfeited_reward_raw,
            claimed_reward_raw: self.claimed_reward_raw,
            sponsor_withdrawn_raw: self.sponsor_withdrawn_raw,
        }
    }
}
