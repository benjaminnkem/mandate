use anchor_lang::prelude::*;
use mandate_core::positions::validate_position_set;

use crate::constants::{
    MANDATE_SEED, MAX_POSITIONS, POSITION_SET_SEED, POSITION_SET_VERSION, PROTOCOL_SEED,
};
use crate::error::MandateError;
use crate::events::PositionSetRegistered;
use crate::state::{Mandate, MandateStatus, PositionSet, ProtocolConfig};

#[derive(Accounts)]
pub struct RegisterPositions<'info> {
    /// The accepted provider. Pays the position set's rent on first registration.
    #[account(mut)]
    pub provider: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [MANDATE_SEED, mandate.sponsor.as_ref(), &mandate.mandate_id.to_le_bytes()],
        bump = mandate.bump,
        constraint = mandate.status == MandateStatus::Awarded @ MandateError::MandateNotAwarded,
        constraint = mandate.provider == provider.key() @ MandateError::UnauthorizedProvider
    )]
    pub mandate: Box<Account<'info, Mandate>>,
    #[account(
        init_if_needed,
        payer = provider,
        space = 8 + PositionSet::INIT_SPACE,
        seeds = [POSITION_SET_SEED, mandate.key().as_ref()],
        bump
    )]
    pub position_set: Box<Account<'info, PositionSet>>,
    pub system_program: Program<'info, System>,
}

/// Register (or, before the lock, replace) the provider's position accounts. The whole set is supplied
/// each time; a call fully replaces the previous set. After `position_lock_at` this always fails, so the
/// set that exists at the lock is the set for the whole mandate.
pub fn handle_register_positions(
    ctx: Context<RegisterPositions>,
    positions: Vec<Pubkey>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let mandate = &ctx.accounts.mandate;
    require!(
        now < mandate.position_lock_at,
        MandateError::PositionSetLocked
    );

    // Bound the vector before touching its contents.
    require!(
        positions.len() <= MAX_POSITIONS,
        MandateError::InvalidPositionSet
    );
    let keys: Vec<[u8; 32]> = positions.iter().map(Pubkey::to_bytes).collect();
    validate_position_set(&keys, ctx.accounts.protocol.max_positions)
        .map_err(MandateError::from)?;

    let count = u8::try_from(positions.len()).map_err(|_| MandateError::InvalidPositionSet)?;
    let mut slots = [Pubkey::default(); MAX_POSITIONS];
    for (slot, position) in slots.iter_mut().zip(positions.iter()) {
        *slot = *position;
    }

    let mandate_key = mandate.key();
    let provider_key = ctx.accounts.provider.key();
    let locked_at = mandate.position_lock_at;
    let set = &mut ctx.accounts.position_set;
    let replaced = set.version != 0;
    if !replaced {
        set.version = POSITION_SET_VERSION;
        set.bump = ctx.bumps.position_set;
        set.mandate = mandate_key;
        set.provider = provider_key;
        set.locked_at = locked_at;
    }
    set.position_count = count;
    set.positions = slots;

    emit!(PositionSetRegistered {
        position_set: set.key(),
        mandate: mandate_key,
        provider: provider_key,
        positions,
        locked_at,
        replaced,
    });
    Ok(())
}
