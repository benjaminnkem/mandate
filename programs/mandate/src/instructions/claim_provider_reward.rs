use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use mandate_core::accounting::Amount;

use crate::constants::{MANDATE_SEED, PROTOCOL_SEED, USDC_DECIMALS, VAULT_SEED};
use crate::error::MandateError;
use crate::events::ProviderRewardClaimed;
use crate::state::{Mandate, MandateStatus, ProtocolConfig};

#[derive(Accounts)]
pub struct ClaimProviderReward<'info> {
    pub provider: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [MANDATE_SEED, mandate.sponsor.as_ref(), &mandate.mandate_id.to_le_bytes()],
        bump = mandate.bump,
        has_one = provider @ MandateError::UnauthorizedProvider,
        constraint = matches!(
            mandate.status,
            MandateStatus::Active | MandateStatus::AwaitingFinalization
        ) @ MandateError::MandateNotActive
    )]
    pub mandate: Box<Account<'info, Mandate>>,
    #[account(address = protocol.usdc_mint @ MandateError::InvalidUsdcAccount)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = protocol.usdc_token_program @ MandateError::InvalidUsdcAccount)]
    pub token_program: Interface<'info, TokenInterface>,
    #[account(
        mut,
        seeds = [VAULT_SEED, mandate.key().as_ref()],
        bump,
        address = mandate.vault @ MandateError::VaultMismatch,
        token::mint = usdc_mint,
        token::authority = mandate,
        token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = provider,
        token::token_program = token_program
    )]
    pub provider_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
}

/// Pay the provider part of what it has earned and not yet claimed. Only `earned - claimed` can ever move,
/// only to a token account the provider itself owns, and only when the provider signs; the sponsor, the admin
/// and observers have no path to this money. Not blocked by a pause: exits must always remain reachable. The
/// amount is computed by the same pure accounting code the TypeScript domain uses.
pub fn handle_claim_provider_reward(
    ctx: Context<ClaimProviderReward>,
    amount_raw: u64,
) -> Result<()> {
    let state = ctx.accounts.mandate.accounting();
    // An explicit zero is a mistake, not "claim everything": use the exact amount.
    require!(amount_raw != 0, MandateError::NothingToClaim);
    let (next, moved) = state
        .claim(Amount::Exact(amount_raw))
        .map_err(MandateError::from)?;

    let sponsor_key = ctx.accounts.mandate.sponsor;
    let id_bytes = ctx.accounts.mandate.mandate_id.to_le_bytes();
    let bump = [ctx.accounts.mandate.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[MANDATE_SEED, sponsor_key.as_ref(), &id_bytes, &bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.provider_usdc.to_account_info(),
                authority: ctx.accounts.mandate.to_account_info(),
            },
            signer_seeds,
        ),
        moved,
        USDC_DECIMALS,
    )?;

    ctx.accounts.mandate.claimed_reward_raw = next.claimed_reward_raw;

    ctx.accounts.vault.reload()?;
    let expected = next.vault_balance_raw().map_err(MandateError::from)?;
    require_eq!(
        ctx.accounts.vault.amount,
        expected,
        MandateError::VaultMismatch
    );
    next.assert_invariants().map_err(MandateError::from)?;

    emit!(ProviderRewardClaimed {
        mandate: ctx.accounts.mandate.key(),
        provider: ctx.accounts.provider.key(),
        amount_raw: moved,
        total_claimed_raw: next.claimed_reward_raw,
        vault_balance_raw: ctx.accounts.vault.amount,
    });
    Ok(())
}
