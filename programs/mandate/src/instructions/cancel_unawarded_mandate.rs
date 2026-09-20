use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::{MANDATE_SEED, PROTOCOL_SEED, USDC_DECIMALS, VAULT_SEED};
use crate::error::MandateError;
use crate::events::MandateCancelled;
use crate::state::{Mandate, MandateStatus, ProtocolConfig};

#[derive(Accounts)]
pub struct CancelUnawardedMandate<'info> {
    /// Must be the mandate's sponsor. Also receives the vault's rent.
    #[account(mut)]
    pub sponsor: Signer<'info>,
    /// Read for the USDC mint and token program only. Deliberately NOT gated on the pause flag: a
    /// pause must never trap a sponsor's escrow.
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
    /// Where the escrow returns. Any USDC account the sponsor owns.
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = sponsor,
        token::token_program = token_program
    )]
    pub sponsor_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
}

/// Cancel a mandate no bid has been accepted on, returning the exact vault balance to the sponsor.
///
/// Allowed at any time before a bid is accepted. The spec's "before a configured cutoff" is read as
/// "until award": once the acceptance deadline passes an unawarded mandate can never be awarded, so
/// refusing to refund it would strand the sponsor's own funds. No provider has committed anything
/// before award, so cancelling costs them nothing (docs/adr/0012).
pub fn handle_cancel_unawarded_mandate(ctx: Context<CancelUnawardedMandate>) -> Result<()> {
    let refunded_raw = ctx.accounts.vault.amount;

    let sponsor_key = ctx.accounts.mandate.sponsor;
    let id_bytes = ctx.accounts.mandate.mandate_id.to_le_bytes();
    let bump = [ctx.accounts.mandate.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[MANDATE_SEED, sponsor_key.as_ref(), &id_bytes, &bump]];

    if refunded_raw > 0 {
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
            refunded_raw,
            USDC_DECIMALS,
        )?;
    }
    token_interface::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.sponsor.to_account_info(),
            authority: ctx.accounts.mandate.to_account_info(),
        },
        signer_seeds,
    ))?;

    ctx.accounts.mandate.status = MandateStatus::Cancelled;
    emit!(MandateCancelled {
        mandate: ctx.accounts.mandate.key(),
        sponsor: ctx.accounts.sponsor.key(),
        refunded_raw,
    });
    Ok(())
}
