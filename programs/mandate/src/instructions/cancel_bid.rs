use anchor_lang::prelude::*;

use crate::constants::{BID_SEED, MANDATE_SEED};
use crate::error::MandateError;
use crate::events::{BidCancelled, BidClosed};
use crate::state::{Bid, BidStatus, Mandate, MandateStatus};

#[derive(Accounts)]
pub struct CancelBid<'info> {
    pub provider: Signer<'info>,
    #[account(
        mut,
        seeds = [BID_SEED, bid.mandate.as_ref(), bid.provider.as_ref(), &bid.nonce.to_le_bytes()],
        bump = bid.bump,
        has_one = provider @ MandateError::UnauthorizedProvider
    )]
    pub bid: Box<Account<'info, Bid>>,
}

/// Withdraw an active bid. Allowed at any moment before acceptance, including after bidding closes, and
/// never blocked by a pause: a provider who no longer wants to be chosen must always be able to say so.
/// An accepted bid cannot be cancelled. Cancelling races acceptance: whichever executes first wins, and
/// the other fails because the bid is no longer active.
pub fn handle_cancel_bid(ctx: Context<CancelBid>) -> Result<()> {
    let bid = &mut ctx.accounts.bid;
    require!(bid.status == BidStatus::Active, MandateError::BidNotActive);
    bid.status = BidStatus::Cancelled;
    emit!(BidCancelled {
        bid: bid.key(),
        mandate: bid.mandate,
        provider: bid.provider,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseBid<'info> {
    /// Receives the bid account's rent.
    #[account(mut)]
    pub provider: Signer<'info>,
    #[account(
        mut,
        close = provider,
        seeds = [BID_SEED, bid.mandate.as_ref(), bid.provider.as_ref(), &bid.nonce.to_le_bytes()],
        bump = bid.bump,
        has_one = provider @ MandateError::UnauthorizedProvider,
        has_one = mandate @ MandateError::BidMismatch
    )]
    pub bid: Box<Account<'info, Bid>>,
    #[account(
        seeds = [MANDATE_SEED, mandate.sponsor.as_ref(), &mandate.mandate_id.to_le_bytes()],
        bump = mandate.bump
    )]
    pub mandate: Box<Account<'info, Mandate>>,
}

/// Reclaim a bid account's rent once it can no longer matter: after the provider cancelled it, or once
/// its mandate has left `Bidding` (awarded to someone else, or cancelled). The accepted bid is a
/// permanent record and can never be closed. Events keep the history of closed bids.
pub fn handle_close_bid(ctx: Context<CloseBid>) -> Result<()> {
    let bid = &ctx.accounts.bid;
    let closable = match bid.status {
        BidStatus::Cancelled | BidStatus::RejectedByAward => true,
        BidStatus::Active => ctx.accounts.mandate.status != MandateStatus::Bidding,
        BidStatus::Accepted => false,
    };
    require!(closable, MandateError::BidNotClosable);
    emit!(BidClosed {
        bid: bid.key(),
        mandate: bid.mandate,
        provider: bid.provider,
    });
    Ok(())
}
