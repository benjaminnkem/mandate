use anchor_lang::prelude::*;
use mandate_core::timing::acceptance_cutoff;
use mandate_core::validation::{validate_bid, BidParams};

use crate::constants::{BID_SEED, BID_VERSION, MANDATE_SEED, PROTOCOL_SEED};
use crate::error::MandateError;
use crate::events::BidSubmitted;
use crate::state::{Bid, BidStatus, Mandate, MandateStatus, ProtocolConfig};

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct SubmitBid<'info> {
    /// The bidding provider. Pays the bid account's rent; nothing else is ever taken from them.
    #[account(mut)]
    pub provider: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [MANDATE_SEED, mandate.sponsor.as_ref(), &mandate.mandate_id.to_le_bytes()],
        bump = mandate.bump,
        constraint = mandate.status == MandateStatus::Bidding @ MandateError::MandateNotBidding,
        constraint = !mandate.has_accepted_bid() @ MandateError::BidAlreadyAccepted
    )]
    pub mandate: Box<Account<'info, Mandate>>,
    /// The same provider may hold several bids on one mandate by using distinct nonces. Reusing a nonce
    /// derives an address that already exists and fails.
    #[account(
        init,
        payer = provider,
        space = 8 + Bid::INIT_SPACE,
        seeds = [BID_SEED, mandate.key().as_ref(), provider.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub bid: Box<Account<'info, Bid>>,
    pub system_program: Program<'info, System>,
}

/// Place an open bid. No funds or capital move; the requested reward is only a proposal until the
/// sponsor accepts it.
pub fn handle_submit_bid(
    ctx: Context<SubmitBid>,
    nonce: u64,
    requested_reward_raw: u64,
    valid_until: i64,
) -> Result<()> {
    let protocol = &ctx.accounts.protocol;
    let mandate = &ctx.accounts.mandate;
    require!(!protocol.paused_new_risk, MandateError::ProtocolPaused);
    let now = Clock::get()?.unix_timestamp;
    require!(now < mandate.bidding_ends_at, MandateError::BiddingClosed);

    let cutoff = acceptance_cutoff(
        mandate.start_at,
        protocol.position_lock_buffer_seconds,
        protocol.min_setup_window_seconds,
    )
    .map_err(MandateError::from)?;
    let problems = validate_bid(&BidParams {
        requested_reward_raw,
        valid_until,
        max_reward_raw: mandate.max_reward_raw,
        now,
        total_epochs: mandate.total_epochs,
        acceptance_cutoff: cutoff,
    });
    if let Some(problem) = problems.first() {
        return Err(MandateError::from(problem).into());
    }

    let bid_key = ctx.accounts.bid.key();
    let mandate_key = mandate.key();
    let provider_key = ctx.accounts.provider.key();
    let bid = &mut ctx.accounts.bid;
    bid.version = BID_VERSION;
    bid.bump = ctx.bumps.bid;
    bid.mandate = mandate_key;
    bid.provider = provider_key;
    bid.nonce = nonce;
    bid.requested_reward_raw = requested_reward_raw;
    bid.created_at = now;
    bid.valid_until = valid_until;
    bid.status = BidStatus::Active;

    emit!(BidSubmitted {
        bid: bid_key,
        mandate: mandate_key,
        provider: provider_key,
        nonce,
        requested_reward_raw,
        valid_until,
        created_at: now,
    });
    Ok(())
}
