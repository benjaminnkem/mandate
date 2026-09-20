use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum BidStatus {
    Active,
    Cancelled,
    Accepted,
    /// Reserved for indexers: a bid that was active when another bid was awarded. The program does not
    /// need to write it (such a bid is closable because its mandate is no longer `Bidding`).
    RejectedByAward,
}

/// One provider bid. PDA `[b"bid", mandate, provider, nonce_le]`.
///
/// A bid holds no funds: placing one costs the provider only rent. The nonce lets a provider hold several
/// bids on one mandate without overwriting history; an address can never be reused while it exists.
#[account]
#[derive(InitSpace)]
pub struct Bid {
    pub version: u8,
    pub bump: u8,
    pub mandate: Pubkey,
    pub provider: Pubkey,
    pub nonce: u64,
    pub requested_reward_raw: u64,
    pub created_at: i64,
    pub valid_until: i64,
    pub status: BidStatus,
}
