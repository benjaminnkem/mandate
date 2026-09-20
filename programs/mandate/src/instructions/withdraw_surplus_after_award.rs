use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use mandate_core::accounting::Amount;

use crate::constants::{MANDATE_SEED, PROTOCOL_SEED, USDC_DECIMALS, VAULT_SEED};
use crate::error::MandateError;
use crate::events::SponsorSurplusWithdrawn;
use crate::state::{Mandate, MandateStatus, ProtocolConfig};

#[derive(Accounts)]
pub struct WithdrawSurplusAfterAward<'info> {
    pub sponsor: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [MANDATE_SEED, mandate.sponsor.as_ref(), &mandate.mandate_id.to_le_bytes()],
        bump = mandate.bump,
        has_one = sponsor @ MandateError::UnauthorizedSponsor,
        constraint = matches!(
            mandate.status,
            MandateStatus::Awarded | MandateStatus::Active | MandateStatus::AwaitingFinalization
        ) @ MandateError::MandateNotAwarded
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
        token::authority = sponsor,
        token::token_program = token_program
    )]
    pub sponsor_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
}

/// Withdraw part or all of what the protocol rules currently release to the sponsor: the award surplus
/// (`max - accepted`), and later, once every epoch is resolved, forfeited rewards. Never touches the
/// accepted reward that the provider can still earn or has earned. The amount is computed by the same
/// pure accounting code the TypeScript domain uses, so the program cannot disagree with it.
/// Not blocked by a pause: sponsor refunds must always remain reachable.
pub fn handle_withdraw_surplus_after_award(
    ctx: Context<WithdrawSurplusAfterAward>,
    amount_raw: u64,
) -> Result<()> {
    let state = ctx.accounts.mandate.accounting();
    let amount = if amount_raw == 0 {
        // An explicit zero is a mistake, not "withdraw everything": use the exact amount.
        return Err(MandateError::NothingToWithdraw.into());
    } else {
        Amount::Exact(amount_raw)
    };
    let (next, moved) = state.sponsor_withdraw(amount).map_err(MandateError::from)?;

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
                to: ctx.accounts.sponsor_usdc.to_account_info(),
                authority: ctx.accounts.mandate.to_account_info(),
            },
            signer_seeds,
        ),
        moved,
        USDC_DECIMALS,
    )?;

    ctx.accounts.mandate.sponsor_withdrawn_raw = next.sponsor_withdrawn_raw;

    // The vault must equal the accounting's view, and still cover every amount the provider may earn.
    ctx.accounts.vault.reload()?;
    let expected = next.vault_balance_raw().map_err(MandateError::from)?;
    require_eq!(
        ctx.accounts.vault.amount,
        expected,
        MandateError::VaultMismatch
    );
    next.assert_invariants().map_err(MandateError::from)?;

    emit!(SponsorSurplusWithdrawn {
        mandate: ctx.accounts.mandate.key(),
        sponsor: ctx.accounts.sponsor.key(),
        amount_raw: moved,
        total_withdrawn_raw: next.sponsor_withdrawn_raw,
        vault_balance_raw: ctx.accounts.vault.amount,
    });
    Ok(())
}
