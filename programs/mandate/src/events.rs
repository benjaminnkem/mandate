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
