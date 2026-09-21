use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use mandate_core::timing::{acceptance_cutoff, build_schedule, position_lock_at, ScheduleBounds};
use mandate_core::validation::{validate_create_mandate, CreateMandateParams, ProtocolLimits};

use crate::constants::{
    CURRENT_ALGORITHM_VERSION, MANDATE_SEED, MANDATE_VERSION, MARKET_SEED, OBSERVER_SET_SEED,
    PROTOCOL_SEED, USDC_DECIMALS, VAULT_SEED,
};
use crate::error::MandateError;
use crate::events::MandateCreated;
use crate::state::{Mandate, MandateStatus, MarketConfig, ObserverSet, ProtocolConfig};

/// Everything a sponsor chooses. Nothing about the reward asset is client-controlled: the USDC mint
/// and token program come from `ProtocolConfig`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateMandateArgs {
    pub mandate_id: u64,
    pub max_reward_raw: u64,
    pub bidding_ends_at: i64,
    pub start_at: i64,
    pub duration_seconds: i64,
    pub epoch_seconds: i64,
    pub max_effective_spread_bps: u32,
    pub depth_band_bps: u32,
    pub min_pool_buy_depth_quote_raw: u64,
    pub min_pool_sell_depth_quote_raw: u64,
    pub min_provider_quote_in_band_raw: u64,
    pub min_provider_base_quote_eq_in_band_raw: u64,
    pub probe_quote_raw: u64,
}

#[derive(Accounts)]
#[instruction(args: CreateMandateArgs)]
pub struct CreateMandate<'info> {
    /// Signs, pays rent, and funds the escrow.
    #[account(mut)]
    pub sponsor: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    /// The approved market. Must be enabled and quoted in the protocol's USDC.
    #[account(
        seeds = [MARKET_SEED, market.pool.as_ref()],
        bump = market.bump,
        constraint = market.enabled @ MandateError::MarketDisabled,
        constraint = market.quote_mint == protocol.usdc_mint @ MandateError::InvalidMarket
    )]
    pub market: Box<Account<'info, MarketConfig>>,
    /// The protocol's current observer set, snapshotted into the mandate. Its address is derived from
    /// protocol state; before any set exists this account cannot be supplied.
    #[account(
        seeds = [OBSERVER_SET_SEED, &protocol.current_observer_set_version.to_le_bytes()],
        bump = observer_set.bump
    )]
    pub observer_set: Box<Account<'info, ObserverSet>>,
    #[account(address = protocol.usdc_mint @ MandateError::InvalidUsdcAccount)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = protocol.usdc_token_program @ MandateError::InvalidUsdcAccount)]
    pub token_program: Interface<'info, TokenInterface>,
    /// The sponsor's USDC account the escrow is taken from.
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = sponsor,
        token::token_program = token_program
    )]
    pub sponsor_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    /// A duplicate mandate id for the same sponsor derives the same address and cannot be created.
    #[account(
        init,
        payer = sponsor,
        space = 8 + Mandate::INIT_SPACE,
        seeds = [MANDATE_SEED, sponsor.key().as_ref(), &args.mandate_id.to_le_bytes()],
        bump
    )]
    pub mandate: Box<Account<'info, Mandate>>,
    /// The reward vault: a token account at a PDA whose token authority is the mandate account, so
    /// only this program signing with the mandate's seeds can move the escrow.
    #[account(
        init,
        payer = sponsor,
        seeds = [VAULT_SEED, mandate.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = mandate,
        token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub system_program: Program<'info, System>,
}

/// Create a mandate and escrow its maximum reward atomically: either the mandate exists and the vault
/// holds exactly `max_reward_raw` USDC, or nothing exists and nothing moved.
pub fn handle_create_mandate(ctx: Context<CreateMandate>, args: CreateMandateArgs) -> Result<()> {
    let protocol = &ctx.accounts.protocol;
    require!(!protocol.paused_new_risk, MandateError::ProtocolPaused);
    let now = Clock::get()?.unix_timestamp;

    let limits = ProtocolLimits {
        min_budget_raw: protocol.min_budget_raw,
        max_budget_raw: protocol.max_budget_raw,
        min_epoch_seconds: protocol.min_epoch_seconds,
        max_epoch_seconds: protocol.max_epoch_seconds,
        max_duration_seconds: protocol.max_duration_seconds,
        max_epochs: protocol.max_epochs,
        max_spread_bps: protocol.max_spread_bps,
        max_depth_band_bps: protocol.max_depth_band_bps,
        min_probe_quote_raw: protocol.min_probe_quote_raw,
        max_probe_quote_raw: protocol.max_probe_quote_raw,
        min_start_lead_seconds: protocol.min_start_lead_seconds,
        position_lock_buffer_seconds: protocol.position_lock_buffer_seconds,
        min_setup_window_seconds: protocol.min_setup_window_seconds,
    };
    let problems = validate_create_mandate(
        &CreateMandateParams {
            max_reward_raw: args.max_reward_raw,
            bidding_ends_at: args.bidding_ends_at,
            start_at: args.start_at,
            duration_seconds: args.duration_seconds,
            epoch_seconds: args.epoch_seconds,
            max_effective_spread_bps: args.max_effective_spread_bps,
            depth_band_bps: args.depth_band_bps,
            min_pool_buy_depth_quote_raw: args.min_pool_buy_depth_quote_raw,
            min_pool_sell_depth_quote_raw: args.min_pool_sell_depth_quote_raw,
            min_provider_quote_in_band_raw: args.min_provider_quote_in_band_raw,
            min_provider_base_quote_eq_in_band_raw: args.min_provider_base_quote_eq_in_band_raw,
            probe_quote_raw: args.probe_quote_raw,
        },
        &limits,
        now,
    );
    if let Some(problem) = problems.first() {
        return Err(MandateError::from(problem).into());
    }

    let schedule = build_schedule(
        args.start_at,
        args.duration_seconds,
        args.epoch_seconds,
        &ScheduleBounds {
            min_epoch_seconds: protocol.min_epoch_seconds,
            max_epoch_seconds: protocol.max_epoch_seconds,
            max_duration_seconds: protocol.max_duration_seconds,
            max_epochs: protocol.max_epochs,
        },
    )
    .map_err(MandateError::from)?;

    let sponsor_key = ctx.accounts.sponsor.key();
    let mandate_key = ctx.accounts.mandate.key();
    let vault_key = ctx.accounts.vault.key();

    let mandate = &mut ctx.accounts.mandate;
    mandate.version = MANDATE_VERSION;
    mandate.bump = ctx.bumps.mandate;
    mandate.sponsor = sponsor_key;
    mandate.mandate_id = args.mandate_id;
    mandate.market_config = ctx.accounts.market.key();
    mandate.observer_set = ctx.accounts.observer_set.key();
    mandate.vault = vault_key;
    mandate.created_at = now;
    mandate.bidding_ends_at = args.bidding_ends_at;
    mandate.start_at = schedule.start_at;
    mandate.epoch_seconds = schedule.epoch_seconds;
    mandate.total_epochs = schedule.total_epochs;
    mandate.end_at = schedule.end_at;
    mandate.acceptance_cutoff = acceptance_cutoff(
        schedule.start_at,
        protocol.position_lock_buffer_seconds,
        protocol.min_setup_window_seconds,
    )
    .map_err(MandateError::from)?;
    mandate.position_lock_at =
        position_lock_at(schedule.start_at, protocol.position_lock_buffer_seconds)
            .map_err(MandateError::from)?;
    mandate.algorithm_version = CURRENT_ALGORITHM_VERSION;
    mandate.unavailable_recovery_seconds = protocol.unavailable_recovery_seconds;
    mandate.max_reward_raw = args.max_reward_raw;
    mandate.accepted_reward_raw = 0;
    mandate.base_epoch_reward_raw = 0;
    mandate.final_epoch_extra_raw = 0;
    mandate.max_effective_spread_bps = args.max_effective_spread_bps;
    mandate.depth_band_bps = args.depth_band_bps;
    mandate.min_pool_buy_depth_quote_raw = args.min_pool_buy_depth_quote_raw;
    mandate.min_pool_sell_depth_quote_raw = args.min_pool_sell_depth_quote_raw;
    mandate.min_provider_quote_in_band_raw = args.min_provider_quote_in_band_raw;
    mandate.min_provider_base_quote_eq_in_band_raw = args.min_provider_base_quote_eq_in_band_raw;
    mandate.probe_quote_raw = args.probe_quote_raw;
    mandate.accepted_bid = Pubkey::default();
    mandate.provider = Pubkey::default();
    mandate.position_set = Pubkey::default();
    mandate.compliant_epochs = 0;
    mandate.noncompliant_epochs = 0;
    mandate.unavailable_epochs = 0;
    mandate.finalized_epochs = 0;
    mandate.earned_reward_raw = 0;
    mandate.forfeited_reward_raw = 0;
    mandate.claimed_reward_raw = 0;
    mandate.sponsor_withdrawn_raw = 0;
    mandate.status = MandateStatus::Bidding;

    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.sponsor_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.sponsor.to_account_info(),
            },
        ),
        args.max_reward_raw,
        USDC_DECIMALS,
    )?;

    // The vault must hold exactly the escrow. Anything else aborts the whole transaction.
    ctx.accounts.vault.reload()?;
    require_eq!(
        ctx.accounts.vault.amount,
        args.max_reward_raw,
        MandateError::VaultMismatch
    );

    emit!(MandateCreated {
        mandate: mandate_key,
        sponsor: sponsor_key,
        mandate_id: args.mandate_id,
        market_config: ctx.accounts.market.key(),
        observer_set: ctx.accounts.observer_set.key(),
        vault: vault_key,
        max_reward_raw: args.max_reward_raw,
        bidding_ends_at: args.bidding_ends_at,
        start_at: schedule.start_at,
        end_at: schedule.end_at,
        epoch_seconds: schedule.epoch_seconds,
        total_epochs: schedule.total_epochs,
        max_effective_spread_bps: args.max_effective_spread_bps,
        depth_band_bps: args.depth_band_bps,
        min_pool_buy_depth_quote_raw: args.min_pool_buy_depth_quote_raw,
        min_pool_sell_depth_quote_raw: args.min_pool_sell_depth_quote_raw,
        min_provider_quote_in_band_raw: args.min_provider_quote_in_band_raw,
        min_provider_base_quote_eq_in_band_raw: args.min_provider_base_quote_eq_in_band_raw,
        probe_quote_raw: args.probe_quote_raw,
    });
    Ok(())
}
