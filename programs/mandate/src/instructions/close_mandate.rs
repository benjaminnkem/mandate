use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface};

use crate::constants::{MANDATE_SEED, PROTOCOL_SEED, VAULT_SEED};
use crate::error::MandateError;
use crate::events::MandateClosed;
use crate::state::{Mandate, MandateStatus, ProtocolConfig};

#[derive(Accounts)]
pub struct CloseMandate<'info> {
    /// Anyone may close a finished mandate; the freed rent always goes to the sponsor who paid it.
    pub caller: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [MANDATE_SEED, mandate.sponsor.as_ref(), &mandate.mandate_id.to_le_bytes()],
        bump = mandate.bump,
        constraint = mandate.status == MandateStatus::AwaitingFinalization @ MandateError::MandateNotClosable
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
    /// CHECK: must be the mandate's sponsor; receives only the vault account's rent lamports.
    #[account(mut, address = mandate.sponsor @ MandateError::UnauthorizedSponsor)]
    pub rent_receiver: UncheckedAccount<'info>,
}

/// Close the emptied reward vault of a fully settled mandate and mark the mandate `Closed`. Only possible
/// when every epoch is resolved and the vault holds exactly zero, which by the conservation invariant means
/// the provider has claimed everything it earned and the sponsor has withdrawn everything released to it.
/// The `Mandate` account and every `EpochResult` are kept as the permanent record; nothing that could still
/// be owed is ever closed.
pub fn handle_close_mandate(ctx: Context<CloseMandate>) -> Result<()> {
    let state = ctx.accounts.mandate.accounting();
    require!(
        state.all_epochs_resolved()
            && state.claimable_raw().map_err(MandateError::from)? == 0
            && state
                .sponsor_withdrawable_raw()
                .map_err(MandateError::from)?
                == 0
            && ctx.accounts.vault.amount == 0
            && state.vault_balance_raw().map_err(MandateError::from)? == 0,
        MandateError::MandateNotClosable
    );

    let sponsor_key = ctx.accounts.mandate.sponsor;
    let id_bytes = ctx.accounts.mandate.mandate_id.to_le_bytes();
    let bump = [ctx.accounts.mandate.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[MANDATE_SEED, sponsor_key.as_ref(), &id_bytes, &bump]];
    token_interface::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.rent_receiver.to_account_info(),
            authority: ctx.accounts.mandate.to_account_info(),
        },
        signer_seeds,
    ))?;

    ctx.accounts.mandate.status = MandateStatus::Closed;
    emit!(MandateClosed {
        mandate: ctx.accounts.mandate.key(),
        sponsor: sponsor_key,
        earned_reward_raw: ctx.accounts.mandate.earned_reward_raw,
        claimed_reward_raw: ctx.accounts.mandate.claimed_reward_raw,
        sponsor_withdrawn_raw: ctx.accounts.mandate.sponsor_withdrawn_raw,
    });
    Ok(())
}
