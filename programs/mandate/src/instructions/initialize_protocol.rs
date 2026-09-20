use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};
use mandate_core::protocol::{validate_protocol_params, ProtocolParams};

use crate::constants::{PROTOCOL_SEED, PROTOCOL_VERSION, USDC_DECIMALS};
use crate::error::MandateError;
use crate::events::ProtocolInitialized;
use crate::state::ProtocolConfig;

/// All protocol bounds. Validated by `mandate_core::protocol::validate_protocol_params`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeProtocolArgs {
    /// The admin identity. Deliberately an argument, separate from the upgrade authority that is
    /// allowed to initialise: the deploy key must not double as the day-to-day admin.
    pub admin: Pubkey,
    /// The Meteora DLMM program market pools must be owned by.
    pub dlmm_program: Pubkey,
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
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    /// Pays rent for the protocol account.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Must be the program's upgrade authority, so nobody can front-run initialisation.
    pub upgrade_authority: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [PROTOCOL_SEED],
        bump
    )]
    pub protocol: Account<'info, ProtocolConfig>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ MandateError::UnauthorizedInitializer
    )]
    pub program: Program<'info, crate::program::Mandate>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(upgrade_authority.key())
            @ MandateError::UnauthorizedInitializer
    )]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_protocol(
    ctx: Context<InitializeProtocol>,
    args: InitializeProtocolArgs,
) -> Result<()> {
    // The reward mint is exact: classic SPL Token USDC with 6 decimals. Token-2022 reward mints are
    // refused in v1 because their extensions (fees, hooks, freezing) would put reward accounting at
    // the mercy of the mint.
    require_keys_eq!(
        ctx.accounts.usdc_token_program.key(),
        anchor_spl::token::ID,
        MandateError::InvalidUsdcAccount
    );
    require_keys_eq!(
        *ctx.accounts.usdc_mint.to_account_info().owner,
        ctx.accounts.usdc_token_program.key(),
        MandateError::InvalidUsdcAccount
    );
    require_eq!(
        ctx.accounts.usdc_mint.decimals,
        USDC_DECIMALS,
        MandateError::InvalidUsdcAccount
    );
    require_keys_neq!(args.admin, Pubkey::default(), MandateError::InvalidAdmin);
    require_keys_neq!(
        args.dlmm_program,
        Pubkey::default(),
        MandateError::InvalidProtocolParams
    );

    validate_protocol_params(&ProtocolParams {
        min_budget_raw: args.min_budget_raw,
        max_budget_raw: args.max_budget_raw,
        min_epoch_seconds: args.min_epoch_seconds,
        max_epoch_seconds: args.max_epoch_seconds,
        max_duration_seconds: args.max_duration_seconds,
        max_epochs: args.max_epochs,
        max_spread_bps: args.max_spread_bps,
        max_depth_band_bps: args.max_depth_band_bps,
        max_positions: args.max_positions,
        min_probe_quote_raw: args.min_probe_quote_raw,
        max_probe_quote_raw: args.max_probe_quote_raw,
        min_start_lead_seconds: args.min_start_lead_seconds,
        position_lock_buffer_seconds: args.position_lock_buffer_seconds,
        min_setup_window_seconds: args.min_setup_window_seconds,
        unavailable_recovery_seconds: args.unavailable_recovery_seconds,
    })
    .map_err(MandateError::from)?;

    let protocol = &mut ctx.accounts.protocol;
    protocol.version = PROTOCOL_VERSION;
    protocol.bump = ctx.bumps.protocol;
    protocol.admin = args.admin;
    protocol.pending_admin = Pubkey::default();
    protocol.usdc_mint = ctx.accounts.usdc_mint.key();
    protocol.usdc_token_program = ctx.accounts.usdc_token_program.key();
    protocol.dlmm_program = args.dlmm_program;
    protocol.paused_new_risk = false;
    protocol.min_budget_raw = args.min_budget_raw;
    protocol.max_budget_raw = args.max_budget_raw;
    protocol.min_epoch_seconds = args.min_epoch_seconds;
    protocol.max_epoch_seconds = args.max_epoch_seconds;
    protocol.max_duration_seconds = args.max_duration_seconds;
    protocol.max_epochs = args.max_epochs;
    protocol.max_spread_bps = args.max_spread_bps;
    protocol.max_depth_band_bps = args.max_depth_band_bps;
    protocol.max_positions = args.max_positions;
    protocol.min_probe_quote_raw = args.min_probe_quote_raw;
    protocol.max_probe_quote_raw = args.max_probe_quote_raw;
    protocol.min_start_lead_seconds = args.min_start_lead_seconds;
    protocol.position_lock_buffer_seconds = args.position_lock_buffer_seconds;
    protocol.min_setup_window_seconds = args.min_setup_window_seconds;
    protocol.unavailable_recovery_seconds = args.unavailable_recovery_seconds;
    protocol.current_observer_set_version = 0;

    emit!(ProtocolInitialized {
        protocol: protocol.key(),
        admin: protocol.admin,
        usdc_mint: protocol.usdc_mint,
        dlmm_program: protocol.dlmm_program,
    });
    Ok(())
}
