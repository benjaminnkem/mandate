use anchor_lang::prelude::*;

use crate::constants::{MANDATE_SEED, POSITION_SET_SEED};
use crate::error::MandateError;
use crate::events::MandateActivated;
use crate::state::{Mandate, MandateStatus, PositionSet};

#[derive(Accounts)]
pub struct ActivateMandate<'info> {
    /// Anyone may activate: no sponsor or provider cooperation is required, so neither can hold the
    /// mandate hostage. The transaction fee payer is the only signer needed.
    #[account(
        mut,
        seeds = [MANDATE_SEED, mandate.sponsor.as_ref(), &mandate.mandate_id.to_le_bytes()],
        bump = mandate.bump,
        constraint = mandate.status == MandateStatus::Awarded @ MandateError::MandateNotAwarded
    )]
    pub mandate: Box<Account<'info, Mandate>>,
    /// Must exist: a mandate cannot activate without registered positions. Its address is derived from
    /// the mandate, so another mandate's set can never be substituted.
    #[account(
        seeds = [POSITION_SET_SEED, mandate.key().as_ref()],
        bump = position_set.bump,
        constraint = position_set.mandate == mandate.key() @ MandateError::InvalidPositionSet,
        constraint = position_set.provider == mandate.provider @ MandateError::UnauthorizedProvider,
        constraint = position_set.position_count >= 1 @ MandateError::PositionSetMissing
    )]
    pub position_set: Box<Account<'info, PositionSet>>,
}

/// Start the mandate. Requires the start time to have arrived, an accepted bid, and a registered (and,
/// by then, necessarily locked) position set. Moves no funds and reads no protocol flag: activation
/// finishes a commitment already made, so a pause does not block it.
pub fn handle_activate_mandate(ctx: Context<ActivateMandate>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let mandate = &mut ctx.accounts.mandate;
    require!(now >= mandate.start_at, MandateError::MandateNotStarted);
    // The start time is after the lock time by construction; assert it rather than assume it.
    require!(
        now >= mandate.position_lock_at,
        MandateError::PositionWindowOpen
    );

    mandate.position_set = ctx.accounts.position_set.key();
    mandate.status = MandateStatus::Active;

    emit!(MandateActivated {
        mandate: mandate.key(),
        position_set: mandate.position_set,
        provider: mandate.provider,
        start_at: mandate.start_at,
        activated_at: now,
    });
    Ok(())
}
