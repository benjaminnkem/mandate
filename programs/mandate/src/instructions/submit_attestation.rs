use anchor_lang::prelude::*;
use mandate_core::timing::{epoch_bounds, EpochBounds};

use crate::constants::{
    ATTESTATION_SEED, ATTESTATION_VERSION, MANDATE_SEED, MAX_SPREAD_BPS_ATTESTABLE,
    SUPPORTED_ALGORITHM_VERSIONS,
};
use crate::error::MandateError;
use crate::events::EpochAttested;
use crate::state::{
    EpochAttestation, EpochMetrics, Mandate, MandateStatus, ObserverSet, PositionSet,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SubmitAttestationArgs {
    pub epoch_index: u32,
    pub observed_slot: u64,
    pub observed_unix_ts: i64,
    pub algorithm_version: u32,
    pub payload_hash: [u8; 32],
    pub evidence_hash: [u8; 32],
    pub metrics: EpochMetrics,
}

#[derive(Accounts)]
#[instruction(args: SubmitAttestationArgs)]
pub struct SubmitAttestation<'info> {
    /// An observer key from the mandate's snapshotted set. Signs, and pays the attestation's rent.
    #[account(mut)]
    pub observer: Signer<'info>,
    #[account(
        seeds = [MANDATE_SEED, mandate.sponsor.as_ref(), &mandate.mandate_id.to_le_bytes()],
        bump = mandate.bump,
        constraint = matches!(
            mandate.status,
            MandateStatus::Active | MandateStatus::AwaitingFinalization
        ) @ MandateError::MandateNotActive
    )]
    pub mandate: Box<Account<'info, Mandate>>,
    /// The exact observer set this mandate bound at creation. No other version can stand in.
    #[account(address = mandate.observer_set @ MandateError::ObserverSetMismatch)]
    pub observer_set: Box<Account<'info, ObserverSet>>,
    /// The exact position set this mandate activated with. The observation is bound to it.
    #[account(address = mandate.position_set @ MandateError::PositionSetMismatch)]
    pub position_set: Box<Account<'info, PositionSet>>,
    /// One per observer per epoch: a second submission derives the same address and fails.
    #[account(
        init,
        payer = observer,
        space = 8 + EpochAttestation::INIT_SPACE,
        seeds = [
            ATTESTATION_SEED,
            mandate.key().as_ref(),
            &args.epoch_index.to_le_bytes(),
            observer.key().as_ref()
        ],
        bump
    )]
    pub attestation: Box<Account<'info, EpochAttestation>>,
    pub system_program: Program<'info, System>,
}

/// Record one observer's measurement of one epoch. Checks who may attest, for which epoch, when, and against
/// which bindings; stores the integers and hashes; accrues nothing.
pub fn handle_submit_attestation(
    ctx: Context<SubmitAttestation>,
    args: SubmitAttestationArgs,
) -> Result<()> {
    let mandate = &ctx.accounts.mandate;
    let observer_key = ctx.accounts.observer.key();

    // Who: a member of the bound observer set.
    let set = &ctx.accounts.observer_set;
    let members = set
        .observers
        .get(..usize::from(set.observer_count))
        .ok_or(MandateError::ObserverNotInSet)?;
    require!(
        members.contains(&observer_key),
        MandateError::ObserverNotInSet
    );

    // What: a supported algorithm, the one this mandate bound.
    require!(
        args.algorithm_version == mandate.algorithm_version
            && SUPPORTED_ALGORITHM_VERSIONS.contains(&args.algorithm_version),
        MandateError::UnsupportedAlgorithm
    );

    // Which epoch, and when. The observation must fall inside the epoch's half-open window and cannot be
    // dated in the future; attestations close at the recovery deadline.
    require!(
        args.epoch_index < mandate.total_epochs,
        MandateError::EpochOutOfRange
    );
    let EpochBounds {
        epoch_start,
        epoch_end,
        recovery_deadline,
    } = epoch_bounds(
        mandate.start_at,
        mandate.epoch_seconds,
        mandate.total_epochs,
        args.epoch_index,
        mandate.unavailable_recovery_seconds,
    )
    .map_err(MandateError::from)?;
    require!(
        args.observed_unix_ts >= epoch_start && args.observed_unix_ts < epoch_end,
        MandateError::ObservationOutsideEpoch
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        args.observed_unix_ts <= now,
        MandateError::ObservationInFuture
    );
    require!(
        now < recovery_deadline,
        MandateError::AttestationWindowClosed
    );

    // Sanity of what is stored: a real slot, non-empty hashes, a spread that can exist.
    require!(args.observed_slot > 0, MandateError::InvalidMetrics);
    require!(
        args.payload_hash != [0u8; 32] && args.evidence_hash != [0u8; 32],
        MandateError::InvalidHash
    );
    require!(
        args.metrics.effective_spread_bps <= MAX_SPREAD_BPS_ATTESTABLE,
        MandateError::InvalidMetrics
    );

    let attestation_key = ctx.accounts.attestation.key();
    let mandate_key = mandate.key();
    let position_set_key = ctx.accounts.position_set.key();
    let a = &mut ctx.accounts.attestation;
    a.version = ATTESTATION_VERSION;
    a.bump = ctx.bumps.attestation;
    a.mandate = mandate_key;
    a.epoch_index = args.epoch_index;
    a.observer = observer_key;
    a.observed_slot = args.observed_slot;
    a.observed_unix_ts = args.observed_unix_ts;
    a.algorithm_version = args.algorithm_version;
    a.position_set = position_set_key;
    a.payload_hash = args.payload_hash;
    a.evidence_hash = args.evidence_hash;
    a.metrics = args.metrics;
    a.created_at = now;

    emit!(EpochAttested {
        attestation: attestation_key,
        mandate: mandate_key,
        epoch_index: args.epoch_index,
        observer: observer_key,
        observed_slot: args.observed_slot,
        observed_unix_ts: args.observed_unix_ts,
        algorithm_version: args.algorithm_version,
        payload_hash: args.payload_hash,
        evidence_hash: args.evidence_hash,
    });
    Ok(())
}
