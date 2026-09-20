use anchor_lang::prelude::*;
use mandate_core::reward::split_reward;
use mandate_core::timing::acceptance_cutoff;

use crate::constants::{BID_SEED, MANDATE_SEED, PROTOCOL_SEED};
use crate::error::MandateError;
use crate::events::BidAccepted;
use crate::state::{Bid, BidStatus, Mandate, MandateStatus, ProtocolConfig};

#[derive(Accounts)]
pub struct AcceptBid<'info> {
    pub sponsor: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [MANDATE_SEED, mandate.sponsor.as_ref(), &mandate.mandate_id.to_le_bytes()],
        bump = mandate.bump,
        has_one = sponsor @ MandateError::UnauthorizedSponsor,
        constraint = mandate.status == MandateStatus::Bidding @ MandateError::MandateNotBidding,
        constraint = !mandate.has_accepted_bid() @ MandateError::BidAlreadyAccepted
    )]
    pub mandate: Box<Account<'info, Mandate>>,
    #[account(
        mut,
        seeds = [BID_SEED, mandate.key().as_ref(), bid.provider.as_ref(), &bid.nonce.to_le_bytes()],
        bump = bid.bump,
        has_one = mandate @ MandateError::BidMismatch
    )]
    pub bid: Box<Account<'info, Bid>>,
}

/// Award the mandate to one bid. Fixes the provider, the reward and the exact per-epoch split forever.
/// Transfers nothing: the provider receives no reward upfront, and the surplus (`max - accepted`) stays
/// in the vault until the sponsor withdraws it.
pub fn handle_accept_bid(ctx: Context<AcceptBid>) -> Result<()> {
    let protocol = &ctx.accounts.protocol;
    require!(!protocol.paused_new_risk, MandateError::ProtocolPaused);
    let now = Clock::get()?.unix_timestamp;

    let bid = &ctx.accounts.bid;
    require!(bid.status == BidStatus::Active, MandateError::BidNotActive);
    require!(bid.valid_until >= now, MandateError::BidExpired);

    let mandate = &mut ctx.accounts.mandate;
    let cutoff = acceptance_cutoff(
        mandate.start_at,
        protocol.position_lock_buffer_seconds,
        protocol.min_setup_window_seconds,
    )
    .map_err(MandateError::from)?;
    require!(now <= cutoff, MandateError::AcceptanceClosed);

    // Re-check the bounds the bid was validated against; the mandate's terms cannot have changed, but
    // acceptance must never depend on that assumption.
    require!(
        bid.requested_reward_raw >= 1
            && bid.requested_reward_raw <= mandate.max_reward_raw
            && bid.requested_reward_raw >= u64::from(mandate.total_epochs),
        MandateError::InvalidBudget
    );

    let split =
        split_reward(bid.requested_reward_raw, mandate.total_epochs).map_err(MandateError::from)?;
    let surplus_raw = mandate
        .max_reward_raw
        .checked_sub(bid.requested_reward_raw)
        .ok_or(MandateError::ArithmeticOverflow)?;

    mandate.accepted_bid = bid.key();
    mandate.provider = bid.provider;
    mandate.accepted_reward_raw = bid.requested_reward_raw;
    mandate.base_epoch_reward_raw = split.base;
    mandate.final_epoch_extra_raw = split.extra;
    mandate.status = MandateStatus::Awarded;

    let bid = &mut ctx.accounts.bid;
    bid.status = BidStatus::Accepted;

    emit!(BidAccepted {
        mandate: mandate.key(),
        bid: bid.key(),
        provider: bid.provider,
        accepted_reward_raw: mandate.accepted_reward_raw,
        base_epoch_reward_raw: split.base,
        final_epoch_extra_raw: split.extra,
        surplus_raw,
    });
    Ok(())
}
