use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::{MANDATE_SEED, POSITION_SET_SEED, PROTOCOL_SEED, USDC_DECIMALS, VAULT_SEED};
use crate::error::MandateError;
use crate::events::UnactivatedMandateRefunded;
use crate::state::{Mandate, MandateStatus, ProtocolConfig};

#[derive(Accounts)]
pub struct RefundUnactivatedMandate<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [MANDATE_SEED, mandate.sponsor.as_ref(), &mandate.mandate_id.to_le_bytes()],
        bump = mandate.bump,
        has_one = sponsor @ MandateError::UnauthorizedSponsor,
        constraint = mandate.status == MandateStatus::Awarded @ MandateError::MandateNotAwarded
    )]
    pub mandate: Box<Account<'info, Mandate>>,
    /// The position set PDA. It must NOT exist: proof that the provider never registered anything.
    /// CHECK: only its address (fixed by the seeds) and emptiness are read.
    #[account(seeds = [POSITION_SET_SEED, mandate.key().as_ref()], bump)]
    pub position_set: UncheckedAccount<'info>,
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

/// Recover the escrow of an awarded mandate that can no longer start.
///
/// After the position lock the provider can no longer register anything, so if no position set exists the
/// mandate can never activate and no epoch can ever be attested. The provider earned nothing (they did
/// nothing), and leaving the sponsor's funds stranded would help no one. This returns everything still in
/// the vault and voids the mandate (`Cancelled`). It is impossible once any position set exists: from then
/// on the mandate can activate, and the ordinary epoch rules (including `Unavailable`) apply. There is no
/// slashing in v1; this is a refund, not a penalty (docs/adr/0014).
pub fn handle_refund_unactivated_mandate(ctx: Context<RefundUnactivatedMandate>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= ctx.accounts.mandate.position_lock_at,
        MandateError::PositionWindowOpen
    );
    require!(
        ctx.accounts.position_set.data_is_empty()
            && ctx.accounts.position_set.owner == &anchor_lang::system_program::ID,
        MandateError::PositionSetExists
    );

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

    // Everything the sponsor put in has now been returned, either earlier as surplus or just now.
    let mandate = &mut ctx.accounts.mandate;
    mandate.sponsor_withdrawn_raw = mandate.max_reward_raw;
    mandate.status = MandateStatus::Cancelled;

    emit!(UnactivatedMandateRefunded {
        mandate: mandate.key(),
        sponsor: mandate.sponsor,
        refunded_raw,
    });
    Ok(())
}
