//! Mandate: market-quality procurement on Solana.
//!
//! Implemented so far: protocol configuration, two-step admin transfer, new-risk pause, immutable
//! versioned observer sets, the approved market registry, mandate creation with USDC escrow, open
//! bidding, award, the provider's locked position set, and activation. Attestations and settlement
//! arrive in later steps (docs/BUILD_PROMPTS.md).
//!
//! Authoritative design: docs/TECHNICAL_SPEC.md sections 5 and 6.
//!
//! Note on authority: no instruction lets the admin move funds. Reward vaults are token accounts at
//! program-derived addresses whose token authority is the mandate account itself, so only this
//! program, signing with that account's seeds, can move an escrow.
pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::MandateError;
pub use instructions::*;
pub use state::*;

declare_id!("T2GzQeoAYprQyUorm7r6jaRvmoPhtXuZ6vJYYBS1pzc");

#[program]
pub mod mandate {
    use super::*;

    /// Initialise the protocol. Only the program's upgrade authority may call this.
    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        args: InitializeProtocolArgs,
    ) -> Result<()> {
        instructions::initialize_protocol::handle_initialize_protocol(ctx, args)
    }

    /// Admin: nominate a successor admin (step one of two).
    pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::handle_propose_admin(ctx, new_admin)
    }

    /// Nominee: accept the admin role (step two of two).
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::handle_accept_admin(ctx)
    }

    /// Admin: withdraw a pending nomination.
    pub fn cancel_admin_transfer(ctx: Context<AdminOnly>) -> Result<()> {
        instructions::admin::handle_cancel_admin_transfer(ctx)
    }

    /// Admin: pause or resume new risk.
    pub fn set_paused_new_risk(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        instructions::admin::handle_set_paused_new_risk(ctx, paused)
    }

    /// Admin: create the next immutable observer set version and make it current.
    pub fn create_observer_set(
        ctx: Context<CreateObserverSet>,
        observers: Vec<Pubkey>,
        threshold: u8,
    ) -> Result<()> {
        instructions::create_observer_set::handle_create_observer_set(ctx, observers, threshold)
    }

    /// Admin: create (disabled) or refresh an approved market.
    pub fn upsert_market(
        ctx: Context<UpsertMarket>,
        prestocks_metadata_hash: [u8; 32],
    ) -> Result<()> {
        instructions::market::handle_upsert_market(ctx, prestocks_metadata_hash)
    }

    /// Admin: enable or disable a market.
    pub fn set_market_enabled(ctx: Context<SetMarketEnabled>, enabled: bool) -> Result<()> {
        instructions::market::handle_set_market_enabled(ctx, enabled)
    }

    /// Sponsor: create a mandate and escrow its maximum USDC reward atomically.
    pub fn create_mandate(ctx: Context<CreateMandate>, args: CreateMandateArgs) -> Result<()> {
        instructions::create_mandate::handle_create_mandate(ctx, args)
    }

    /// Sponsor: cancel a mandate no bid has been accepted on and take the escrow back.
    pub fn cancel_unawarded_mandate(ctx: Context<CancelUnawardedMandate>) -> Result<()> {
        instructions::cancel_unawarded_mandate::handle_cancel_unawarded_mandate(ctx)
    }

    /// Provider: place an open bid on a mandate. Nothing but rent is taken.
    pub fn submit_bid(
        ctx: Context<SubmitBid>,
        nonce: u64,
        requested_reward_raw: u64,
        valid_until: i64,
    ) -> Result<()> {
        instructions::submit_bid::handle_submit_bid(ctx, nonce, requested_reward_raw, valid_until)
    }

    /// Provider: withdraw an active bid.
    pub fn cancel_bid(ctx: Context<CancelBid>) -> Result<()> {
        instructions::cancel_bid::handle_cancel_bid(ctx)
    }

    /// Provider: reclaim the rent of a cancelled or unselected bid.
    pub fn close_bid(ctx: Context<CloseBid>) -> Result<()> {
        instructions::cancel_bid::handle_close_bid(ctx)
    }

    /// Sponsor: award the mandate to one bid, fixing provider, reward and epoch split.
    pub fn accept_bid(ctx: Context<AcceptBid>) -> Result<()> {
        instructions::accept_bid::handle_accept_bid(ctx)
    }

    /// Sponsor: withdraw what the rules currently release (the award surplus).
    pub fn withdraw_surplus_after_award(
        ctx: Context<WithdrawSurplusAfterAward>,
        amount_raw: u64,
    ) -> Result<()> {
        instructions::withdraw_surplus_after_award::handle_withdraw_surplus_after_award(
            ctx, amount_raw,
        )
    }

    /// Provider: register (or, before the lock, replace) the position accounts that will be measured.
    pub fn register_positions(
        ctx: Context<RegisterPositions>,
        positions: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::register_positions::handle_register_positions(ctx, positions)
    }

    /// Anyone: start an awarded mandate once its start time has arrived and positions are registered.
    pub fn activate_mandate(ctx: Context<ActivateMandate>) -> Result<()> {
        instructions::activate_mandate::handle_activate_mandate(ctx)
    }

    /// Sponsor: recover the escrow of an awarded mandate whose provider never registered positions.
    pub fn refund_unactivated_mandate(ctx: Context<RefundUnactivatedMandate>) -> Result<()> {
        instructions::refund_unactivated_mandate::handle_refund_unactivated_mandate(ctx)
    }
}
