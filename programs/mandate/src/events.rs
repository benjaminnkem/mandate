use anchor_lang::prelude::*;

#[event]
pub struct ProtocolInitialized {
    pub protocol: Pubkey,
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub dlmm_program: Pubkey,
}

#[event]
pub struct AdminTransferProposed {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
}

#[event]
pub struct AdminTransferAccepted {
    pub previous_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct AdminTransferCancelled {
    pub admin: Pubkey,
    pub cancelled_pending_admin: Pubkey,
}

#[event]
pub struct NewRiskPauseChanged {
    pub paused: bool,
}

#[event]
pub struct ObserverSetCreated {
    pub observer_set: Pubkey,
    pub version: u32,
    pub observer_count: u8,
    pub threshold: u8,
    pub observers: Vec<Pubkey>,
}

#[event]
pub struct MarketConfigured {
    pub market: Pubkey,
    pub pool: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub base_decimals: u8,
    pub base_is_x: bool,
    pub prestocks_metadata_hash: [u8; 32],
    pub enabled: bool,
    pub reviewed_at: i64,
    /// True when this call created the market, false when it refreshed an existing one.
    pub created: bool,
}

#[event]
pub struct MarketEnabledChanged {
    pub market: Pubkey,
    pub enabled: bool,
}

#[event]
pub struct MandateCreated {
    pub mandate: Pubkey,
    pub sponsor: Pubkey,
    pub mandate_id: u64,
    pub market_config: Pubkey,
    pub observer_set: Pubkey,
    pub vault: Pubkey,
    pub max_reward_raw: u64,
    pub bidding_ends_at: i64,
    pub start_at: i64,
    pub end_at: i64,
    pub epoch_seconds: i64,
    pub total_epochs: u32,
    pub max_effective_spread_bps: u32,
    pub depth_band_bps: u32,
    pub min_pool_buy_depth_quote_raw: u64,
    pub min_pool_sell_depth_quote_raw: u64,
    pub min_provider_quote_in_band_raw: u64,
    pub min_provider_base_quote_eq_in_band_raw: u64,
    pub probe_quote_raw: u64,
}

#[event]
pub struct MandateCancelled {
    pub mandate: Pubkey,
    pub sponsor: Pubkey,
    /// Exact USDC returned to the sponsor.
    pub refunded_raw: u64,
}

#[event]
pub struct BidSubmitted {
    pub bid: Pubkey,
    pub mandate: Pubkey,
    pub provider: Pubkey,
    pub nonce: u64,
    pub requested_reward_raw: u64,
    pub valid_until: i64,
    pub created_at: i64,
}

#[event]
pub struct BidCancelled {
    pub bid: Pubkey,
    pub mandate: Pubkey,
    pub provider: Pubkey,
}

#[event]
pub struct BidClosed {
    pub bid: Pubkey,
    pub mandate: Pubkey,
    pub provider: Pubkey,
}

#[event]
pub struct BidAccepted {
    pub mandate: Pubkey,
    pub bid: Pubkey,
    pub provider: Pubkey,
    pub accepted_reward_raw: u64,
    pub base_epoch_reward_raw: u64,
    pub final_epoch_extra_raw: u64,
    /// `max_reward_raw - accepted_reward_raw`, withdrawable by the sponsor immediately.
    pub surplus_raw: u64,
}

#[event]
pub struct SponsorSurplusWithdrawn {
    pub mandate: Pubkey,
    pub sponsor: Pubkey,
    pub amount_raw: u64,
    pub total_withdrawn_raw: u64,
    pub vault_balance_raw: u64,
}

#[event]
pub struct PositionSetRegistered {
    pub position_set: Pubkey,
    pub mandate: Pubkey,
    pub provider: Pubkey,
    pub positions: Vec<Pubkey>,
    pub locked_at: i64,
    /// True when this call replaced an earlier registration (only possible before the lock).
    pub replaced: bool,
}

#[event]
pub struct MandateActivated {
    pub mandate: Pubkey,
    pub position_set: Pubkey,
    pub provider: Pubkey,
    pub start_at: i64,
    pub activated_at: i64,
}

#[event]
pub struct UnactivatedMandateRefunded {
    pub mandate: Pubkey,
    pub sponsor: Pubkey,
    /// Exact USDC returned: everything still in the vault.
    pub refunded_raw: u64,
}
