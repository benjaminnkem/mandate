use anchor_lang::prelude::*;

/// Global configuration. PDA `[b"protocol"]`. Holds protocol bounds and the admin identity.
///
/// The admin can configure markets and observer sets and pause *new* risk. The admin has no
/// instruction that moves reward-vault funds (none exists in the program), and cannot alter any
/// existing mandate's terms.
#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub version: u8,
    pub bump: u8,
    pub admin: Pubkey,
    /// `Pubkey::default()` when no transfer is pending.
    pub pending_admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub usdc_token_program: Pubkey,
    /// The Meteora DLMM program a market's pool account must be owned by.
    pub dlmm_program: Pubkey,
    pub paused_new_risk: bool,

    pub min_budget_raw: u64,
    pub max_budget_raw: u64,
    pub min_epoch_seconds: i64,
    pub max_epoch_seconds: i64,
    pub max_duration_seconds: i64,
    pub max_epochs: u32,
    pub max_spread_bps: u32,
    pub max_depth_band_bps: u32,
    pub max_positions: u8,
    pub min_probe_quote_raw: u64,
    pub max_probe_quote_raw: u64,
    pub min_start_lead_seconds: i64,
    pub position_lock_buffer_seconds: i64,
    pub min_setup_window_seconds: i64,
    pub unavailable_recovery_seconds: i64,

    /// Latest observer set version; `0` means none has been created yet. New mandates snapshot this.
    pub current_observer_set_version: u32,
}

impl ProtocolConfig {
    pub fn has_pending_admin(&self) -> bool {
        self.pending_admin != Pubkey::default()
    }
}
