use anchor_lang::prelude::*;
use mandate_core::accounting::EpochOutcome as CoreOutcome;
use mandate_core::timing::epoch_bounds;

use crate::constants::{EPOCH_RESULT_SEED, EPOCH_RESULT_VERSION, MANDATE_SEED};
use crate::error::MandateError;
use crate::events::EpochFinalized;
use crate::instructions::finalize_epoch::apply_outcome;
use crate::state::{EpochMetrics, EpochOutcome, EpochResult, Mandate, MandateStatus};

#[derive(Accounts)]
#[instruction(epoch_index: u32)]
pub struct FinalizeUnavailableEpoch<'info> {
    /// Anyone. Gains no authority: the deadline, not the caller, decides.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [MANDATE_SEED, mandate.sponsor.as_ref(), &mandate.mandate_id.to_le_bytes()],
        bump = mandate.bump,
        constraint = mandate.status == MandateStatus::Active @ MandateError::MandateNotActive
    )]
    pub mandate: Box<Account<'info, Mandate>>,
    /// `init`: if any result already exists for this epoch (of any outcome) this fails.
    #[account(
        init,
        payer = payer,
        space = 8 + EpochResult::INIT_SPACE,
        seeds = [EPOCH_RESULT_SEED, mandate.key().as_ref(), &epoch_index.to_le_bytes()],
        bump
    )]
    pub epoch_result: Box<Account<'info, EpochResult>>,
    pub system_program: Program<'info, System>,
}

/// Resolve an epoch nobody attested as `Unavailable`, with reward 0. Only possible once the immutable
/// recovery deadline (epoch end plus the mandate's recovery window) has passed. There is no admin or
/// observer shortcut before it, and the outcome is never `NonCompliant`: nothing was measured.
pub fn handle_finalize_unavailable_epoch(
    ctx: Context<FinalizeUnavailableEpoch>,
    epoch_index: u32,
) -> Result<()> {
    let mandate_key = ctx.accounts.mandate.key();
    let m = &ctx.accounts.mandate;
    require!(epoch_index < m.total_epochs, MandateError::EpochOutOfRange);
    let bounds = epoch_bounds(
        m.start_at,
        m.epoch_seconds,
        m.total_epochs,
        epoch_index,
        m.unavailable_recovery_seconds,
    )
    .map_err(MandateError::from)?;
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= bounds.recovery_deadline,
        MandateError::RecoveryNotElapsed
    );

    let payer = ctx.accounts.payer.key();
    let (earned, forfeited) = apply_outcome(
        &mut ctx.accounts.mandate,
        epoch_index,
        CoreOutcome::Unavailable,
    )?;

    let r = &mut ctx.accounts.epoch_result;
    r.version = EPOCH_RESULT_VERSION;
    r.bump = ctx.bumps.epoch_result;
    r.mandate = mandate_key;
    r.epoch_index = epoch_index;
    r.outcome = EpochOutcome::Unavailable;
    r.reward_earned_raw = earned;
    r.reward_forfeited_raw = forfeited;
    r.failure_bits = 0;
    r.attestation_count = 0;
    r.observed_slot = 0;
    r.observed_unix_ts = 0;
    r.algorithm_version = 0;
    r.position_set = Pubkey::default();
    r.payload_hash = [0u8; 32];
    r.evidence_hash = [0u8; 32];
    r.metrics = EpochMetrics {
        effective_spread_bps: 0,
        pool_buy_depth_quote_raw: 0,
        pool_sell_depth_quote_raw: 0,
        provider_quote_in_band_raw: 0,
        provider_base_quote_eq_in_band_raw: 0,
    };
    r.finalized_by = payer;
    r.finalized_at = now;

    let m = &ctx.accounts.mandate;
    emit!(EpochFinalized {
        mandate: mandate_key,
        epoch_index,
        outcome: 2,
        reward_earned_raw: earned,
        reward_forfeited_raw: forfeited,
        failure_bits: 0,
        attestation_count: 0,
        payload_hash: [0u8; 32],
        evidence_hash: [0u8; 32],
        finalized_epochs: m.finalized_epochs,
        earned_reward_raw: m.earned_reward_raw,
        finalized_by: payer,
    });
    Ok(())
}
