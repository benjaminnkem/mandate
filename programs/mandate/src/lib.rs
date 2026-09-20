//! Mandate: market-quality procurement on Solana.
//!
//! This step implements the protocol foundation only: protocol configuration, two-step admin
//! transfer, new-risk pause, immutable versioned observer sets and the approved market registry.
//! Mandates, bids, attestations and settlement arrive in later steps (docs/BUILD_PROMPTS.md).
//!
//! Authoritative design: docs/TECHNICAL_SPEC.md sections 5 and 6.
//!
//! Note on authority: no instruction in this program lets the admin move funds. Reward vaults do
//! not exist yet, and when they do they will be owned by program-derived addresses with no admin
//! withdrawal path.
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
}
