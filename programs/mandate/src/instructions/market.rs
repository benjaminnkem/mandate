use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use mandate_core::meteora::{bind_pool_mints, read_lb_pair};

use crate::constants::{MARKET_SEED, MARKET_VERSION, PROTOCOL_SEED, USDC_DECIMALS};
use crate::error::MandateError;
use crate::events::{MarketConfigured, MarketEnabledChanged};
use crate::state::{MarketConfig, ProtocolConfig, VenueType};

#[derive(Accounts)]
pub struct UpsertMarket<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        has_one = admin @ MandateError::UnauthorizedAdmin
    )]
    pub protocol: Account<'info, ProtocolConfig>,
    /// The Meteora DLMM pool. Must be owned by the configured DLMM program; its mints are read and
    /// bound by `mandate_core::meteora` (fail-closed, verified against real mainnet bytes).
    /// CHECK: ownership and layout are validated in the handler and by the account constraint.
    #[account(
        constraint = *pool.owner == protocol.dlmm_program @ MandateError::InvalidMarket
    )]
    pub pool: UncheckedAccount<'info>,
    pub base_mint: InterfaceAccount<'info, Mint>,
    #[account(
        constraint = quote_mint.key() == protocol.usdc_mint @ MandateError::InvalidMarket,
        constraint = *quote_mint.to_account_info().owner == protocol.usdc_token_program
            @ MandateError::InvalidMarket,
        constraint = quote_mint.decimals == USDC_DECIMALS @ MandateError::InvalidMarket
    )]
    pub quote_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + MarketConfig::INIT_SPACE,
        seeds = [MARKET_SEED, pool.key().as_ref()],
        bump
    )]
    pub market: Account<'info, MarketConfig>,
    pub system_program: Program<'info, System>,
}

/// Create a market (disabled), or refresh the review hash and timestamp of an existing one.
///
/// Verified on chain: the pool is owned by the DLMM program, is exactly an `LbPair`, and trades exactly
/// `base_mint` against the configured USDC; mint token programs and decimals are read from the mints.
/// Not verifiable on chain, and therefore an explicit off-chain trust boundary: that the pool is
/// appropriate to pay for (liquidity, PreStocks lifecycle, Token-2022 extensions). That review is
/// pinned by `prestocks_metadata_hash` (docs/adr/0011).
///
/// The bindings of an existing market never change. New markets are refused while new risk is paused.
pub fn handle_upsert_market(
    ctx: Context<UpsertMarket>,
    prestocks_metadata_hash: [u8; 32],
) -> Result<()> {
    let base_key = ctx.accounts.base_mint.key();
    let quote_key = ctx.accounts.quote_mint.key();
    let base_is_x = {
        let data = ctx.accounts.pool.try_borrow_data()?;
        let view = read_lb_pair(&data).map_err(MandateError::from)?;
        bind_pool_mints(&view, &base_key.to_bytes(), &quote_key.to_bytes())
            .map_err(MandateError::from)?
    };
    let base_token_program = *ctx.accounts.base_mint.to_account_info().owner;
    let base_decimals = ctx.accounts.base_mint.decimals;
    let now = Clock::get()?.unix_timestamp;

    let pool_key = ctx.accounts.pool.key();
    let market = &mut ctx.accounts.market;
    let created = market.version == 0;
    if created {
        require!(
            !ctx.accounts.protocol.paused_new_risk,
            MandateError::ProtocolPaused
        );
        market.version = MARKET_VERSION;
        market.bump = ctx.bumps.market;
        market.enabled = false;
        market.venue_type = VenueType::MeteoraDlmm;
        market.pool = pool_key;
        market.base_mint = base_key;
        market.base_token_program = base_token_program;
        market.base_decimals = base_decimals;
        market.quote_mint = quote_key;
        market.quote_token_program = ctx.accounts.protocol.usdc_token_program;
        market.quote_decimals = USDC_DECIMALS;
        market.base_is_x = base_is_x;
    } else {
        // Bindings are immutable: any mismatch means the caller passed a different market's inputs.
        require!(
            market.pool == pool_key
                && market.base_mint == base_key
                && market.quote_mint == quote_key
                && market.base_token_program == base_token_program
                && market.base_decimals == base_decimals
                && market.base_is_x == base_is_x,
            MandateError::InvalidMarket
        );
    }
    market.prestocks_metadata_hash = prestocks_metadata_hash;
    market.reviewed_at = now;

    emit!(MarketConfigured {
        market: market.key(),
        pool: market.pool,
        base_mint: market.base_mint,
        quote_mint: market.quote_mint,
        base_decimals: market.base_decimals,
        base_is_x: market.base_is_x,
        prestocks_metadata_hash,
        enabled: market.enabled,
        reviewed_at: now,
        created,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetMarketEnabled<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        has_one = admin @ MandateError::UnauthorizedAdmin
    )]
    pub protocol: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.pool.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, MarketConfig>,
}

/// Enable or disable a market. Disabling is always allowed (it removes risk); enabling is refused
/// while new risk is paused. Disabling never touches existing mandates: they keep their bound market.
pub fn handle_set_market_enabled(ctx: Context<SetMarketEnabled>, enabled: bool) -> Result<()> {
    if enabled {
        require!(
            !ctx.accounts.protocol.paused_new_risk,
            MandateError::ProtocolPaused
        );
    }
    ctx.accounts.market.enabled = enabled;
    emit!(MarketEnabledChanged {
        market: ctx.accounts.market.key(),
        enabled,
    });
    Ok(())
}
