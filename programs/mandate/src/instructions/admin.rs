use anchor_lang::prelude::*;

use crate::constants::PROTOCOL_SEED;
use crate::error::MandateError;
use crate::events::{
    AdminTransferAccepted, AdminTransferCancelled, AdminTransferProposed, NewRiskPauseChanged,
};
use crate::state::ProtocolConfig;

/// Accounts for every instruction only the current admin may call.
#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        has_one = admin @ MandateError::UnauthorizedAdmin
    )]
    pub protocol: Account<'info, ProtocolConfig>,
    pub admin: Signer<'info>,
}

/// Step one of the two-step admin transfer: the current admin nominates a successor. Nothing changes
/// until the nominee accepts, so a typo can never hand the protocol to an address nobody controls.
pub fn handle_propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
    require_keys_neq!(new_admin, Pubkey::default(), MandateError::InvalidAdmin);
    require_keys_neq!(
        new_admin,
        ctx.accounts.protocol.admin,
        MandateError::InvalidAdmin
    );
    ctx.accounts.protocol.pending_admin = new_admin;
    emit!(AdminTransferProposed {
        admin: ctx.accounts.protocol.admin,
        pending_admin: new_admin,
    });
    Ok(())
}

/// The current admin withdraws a pending nomination.
pub fn handle_cancel_admin_transfer(ctx: Context<AdminOnly>) -> Result<()> {
    let protocol = &mut ctx.accounts.protocol;
    require!(protocol.has_pending_admin(), MandateError::NoPendingAdmin);
    let cancelled = protocol.pending_admin;
    protocol.pending_admin = Pubkey::default();
    emit!(AdminTransferCancelled {
        admin: protocol.admin,
        cancelled_pending_admin: cancelled,
    });
    Ok(())
}

/// Pause or resume *new* risk. Never blocks claims, refunds, attestation or finalisation
/// (docs/TECHNICAL_SPEC.md section 19); those instructions do not read this flag.
pub fn handle_set_paused_new_risk(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.protocol.paused_new_risk = paused;
    emit!(NewRiskPauseChanged { paused });
    Ok(())
}

/// Step two: the nominee proves control of their key by signing.
#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, ProtocolConfig>,
    #[account(
        constraint = protocol.has_pending_admin() @ MandateError::NoPendingAdmin,
        constraint = protocol.pending_admin == pending_admin.key()
            @ MandateError::UnauthorizedPendingAdmin
    )]
    pub pending_admin: Signer<'info>,
}

pub fn handle_accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let protocol = &mut ctx.accounts.protocol;
    let previous_admin = protocol.admin;
    protocol.admin = protocol.pending_admin;
    protocol.pending_admin = Pubkey::default();
    emit!(AdminTransferAccepted {
        previous_admin,
        new_admin: protocol.admin,
    });
    Ok(())
}
