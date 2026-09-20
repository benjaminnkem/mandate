use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum VenueType {
    MeteoraDlmm,
}

/// An approved market. PDA `[b"market", pool]`.
///
/// The pool, mints, decimals, token programs and orientation are bound at creation and never change.
/// Approval is an allowlist and risk control, not proof of legal eligibility.
#[account]
#[derive(InitSpace)]
pub struct MarketConfig {
    pub version: u8,
    pub bump: u8,
    pub enabled: bool,
    pub venue_type: VenueType,
    pub pool: Pubkey,
    pub base_mint: Pubkey,
    pub base_token_program: Pubkey,
    pub base_decimals: u8,
    pub quote_mint: Pubkey,
    pub quote_token_program: Pubkey,
    pub quote_decimals: u8,
    /// True when the base (PreStocks) token is the pool's token X. Read from the pool at approval.
    pub base_is_x: bool,
    /// Hash of the dated off-chain review evidence (PreStocks API object, mint inspection, pool checks).
    pub prestocks_metadata_hash: [u8; 32],
    pub reviewed_at: i64,
}
