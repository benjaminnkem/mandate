use anchor_lang::prelude::*;
use mandate_core::observers::validate_observer_set;

use crate::constants::{MAX_OBSERVERS, OBSERVER_SET_SEED, OBSERVER_SET_VERSION, PROTOCOL_SEED};
use crate::error::MandateError;
use crate::events::ObserverSetCreated;
use crate::state::{ObserverSet, ProtocolConfig};

#[derive(Accounts)]
pub struct CreateObserverSet<'info> {
    /// The admin, who also pays rent.
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        has_one = admin @ MandateError::UnauthorizedAdmin
    )]
    pub protocol: Account<'info, ProtocolConfig>,
    /// The next sequential version. Its address is derived from protocol state, so a caller can
    /// neither skip a version nor overwrite an existing one (the account must not exist).
    #[account(
        init,
        payer = admin,
        space = 8 + ObserverSet::INIT_SPACE,
        seeds = [
            OBSERVER_SET_SEED,
            &protocol.current_observer_set_version.saturating_add(1).to_le_bytes()
        ],
        bump
    )]
    pub observer_set: Account<'info, ObserverSet>,
    pub system_program: Program<'info, System>,
}

/// Create the next immutable observer set version and make it the protocol's current one.
/// Only mandates created afterwards snapshot it; existing mandates keep the version they bound.
pub fn handle_create_observer_set(
    ctx: Context<CreateObserverSet>,
    observers: Vec<Pubkey>,
    threshold: u8,
) -> Result<()> {
    // Bound the vector before touching its contents.
    require!(
        observers.len() <= MAX_OBSERVERS,
        MandateError::InvalidObserverSet
    );
    let keys: Vec<[u8; 32]> = observers.iter().map(Pubkey::to_bytes).collect();
    validate_observer_set(&keys, threshold, &ctx.accounts.protocol.admin.to_bytes())
        .map_err(MandateError::from)?;

    let next_version = ctx
        .accounts
        .protocol
        .current_observer_set_version
        .checked_add(1)
        .ok_or(MandateError::ArithmeticOverflow)?;

    let mut slots = [Pubkey::default(); MAX_OBSERVERS];
    for (slot, observer) in slots.iter_mut().zip(observers.iter()) {
        *slot = *observer;
    }
    let observer_count =
        u8::try_from(observers.len()).map_err(|_| MandateError::InvalidObserverSet)?;

    let set = &mut ctx.accounts.observer_set;
    set.version_tag = OBSERVER_SET_VERSION;
    set.bump = ctx.bumps.observer_set;
    set.version = next_version;
    set.observer_count = observer_count;
    set.threshold = threshold;
    set.observers = slots;
    set.created_at = Clock::get()?.unix_timestamp;

    ctx.accounts.protocol.current_observer_set_version = next_version;

    emit!(ObserverSetCreated {
        observer_set: set.key(),
        version: next_version,
        observer_count,
        threshold,
        observers,
    });
    Ok(())
}
