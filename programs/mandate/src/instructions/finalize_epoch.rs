use anchor_lang::prelude::*;
use mandate_core::accounting::{AccountingState, EpochOutcome as CoreOutcome};
use mandate_core::compliance::{
    evaluate_compliance, ComplianceFailure, EpochMetrics as CoreMetrics, Thresholds,
};
use mandate_core::reward::epoch_reward;
use mandate_core::timing::epoch_bounds;

use crate::constants::{
    ATTESTATION_SEED, EPOCH_RESULT_SEED, EPOCH_RESULT_VERSION, MANDATE_SEED, MAX_OBSERVERS,
};
use crate::error::MandateError;
use crate::events::EpochFinalized;
use crate::state::{
    EpochAttestation, EpochMetrics, EpochOutcome, EpochResult, Mandate, MandateStatus, ObserverSet,
    PositionSet,
};

#[derive(Accounts)]
#[instruction(epoch_index: u32)]
pub struct FinalizeEpoch<'info> {
    /// Anyone. Pays the result account's rent; gains no authority over the verdict.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [MANDATE_SEED, mandate.sponsor.as_ref(), &mandate.mandate_id.to_le_bytes()],
        bump = mandate.bump,
        constraint = mandate.status == MandateStatus::Active @ MandateError::MandateNotActive
    )]
    pub mandate: Box<Account<'info, Mandate>>,
    /// The exact set this mandate bound at creation; no other version can stand in.
    #[account(address = mandate.observer_set @ MandateError::ObserverSetMismatch)]
    pub observer_set: Box<Account<'info, ObserverSet>>,
    #[account(address = mandate.position_set @ MandateError::PositionSetMismatch)]
    pub position_set: Box<Account<'info, PositionSet>>,
    /// One per (mandate, epoch). `init` makes a second finalization impossible.
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

/// The facts every counted attestation must agree on exactly.
#[derive(PartialEq, Eq, Clone, Copy)]
struct Agreed {
    observed_slot: u64,
    observed_unix_ts: i64,
    algorithm_version: u32,
    position_set: Pubkey,
    payload_hash: [u8; 32],
    evidence_hash: [u8; 32],
    metrics: EpochMetrics,
}

impl From<&EpochAttestation> for Agreed {
    fn from(a: &EpochAttestation) -> Self {
        Self {
            observed_slot: a.observed_slot,
            observed_unix_ts: a.observed_unix_ts,
            algorithm_version: a.algorithm_version,
            position_set: a.position_set,
            payload_hash: a.payload_hash,
            evidence_hash: a.evidence_hash,
            metrics: a.metrics,
        }
    }
}

/// Record one epoch's final outcome in the mandate's counters and return `(earned, forfeited)` for that
/// epoch. When the last epoch resolves the mandate moves to `AwaitingFinalization`: nothing more can be
/// measured and only the exit paths remain. Shared by both finalization instructions so the accounting can
/// never diverge between them.
pub(crate) fn apply_outcome(
    mandate: &mut Mandate,
    epoch_index: u32,
    outcome: CoreOutcome,
) -> Result<(u64, u64)> {
    let before: AccountingState = mandate.accounting();
    let after = before
        .finalize_epoch(epoch_index, outcome, false)
        .map_err(MandateError::from)?;
    after
        .assert_invariants()
        .map_err(|_| MandateError::VaultMismatch)?;
    let reward = epoch_reward(
        mandate.accepted_reward_raw,
        mandate.total_epochs,
        epoch_index,
    )
    .map_err(MandateError::from)?;
    mandate.store_accounting(&after);
    if after.all_epochs_resolved() {
        mandate.status = MandateStatus::AwaitingFinalization;
    }
    Ok(match outcome {
        CoreOutcome::Compliant => (reward, 0),
        _ => (0, reward),
    })
}

/// Finalize `epoch_index` from a threshold of attestations passed as remaining accounts. Every supplied
/// attestation must be a real, distinct, in-set observer's attestation for this exact mandate and epoch, and
/// all of them must agree bit for bit. Disagreement is rejected, never averaged: the caller chooses which
/// attestations to present, so one dishonest observer cannot block a quorum of honest ones.
pub fn handle_finalize_epoch<'info>(
    ctx: Context<'info, FinalizeEpoch<'info>>,
    epoch_index: u32,
) -> Result<()> {
    let mandate_key = ctx.accounts.mandate.key();
    let (start_at, epoch_seconds, total_epochs, recovery) = {
        let m = &ctx.accounts.mandate;
        (
            m.start_at,
            m.epoch_seconds,
            m.total_epochs,
            m.unavailable_recovery_seconds,
        )
    };
    require!(epoch_index < total_epochs, MandateError::EpochOutOfRange);
    let bounds = epoch_bounds(start_at, epoch_seconds, total_epochs, epoch_index, recovery)
        .map_err(MandateError::from)?;
    let now = Clock::get()?.unix_timestamp;
    require!(now >= bounds.epoch_end, MandateError::EpochNotEnded);

    let set = &ctx.accounts.observer_set;
    let members = set
        .observers
        .get(..usize::from(set.observer_count))
        .ok_or(MandateError::ObserverNotInSet)?;
    let attestations = ctx.remaining_accounts;
    require!(
        attestations.len() <= MAX_OBSERVERS,
        MandateError::TooManyAttestations
    );

    let mut seen: Vec<Pubkey> = Vec::with_capacity(attestations.len());
    let mut agreed: Option<Agreed> = None;
    for info in attestations {
        let attestation: Account<EpochAttestation> =
            Account::try_from(info).map_err(|_| MandateError::AttestationInvalid)?;
        require!(
            attestation.mandate == mandate_key && attestation.epoch_index == epoch_index,
            MandateError::AttestationInvalid
        );
        // The address must be the canonical PDA for (mandate, epoch, observer).
        let expected = Pubkey::create_program_address(
            &[
                ATTESTATION_SEED,
                mandate_key.as_ref(),
                &epoch_index.to_le_bytes(),
                attestation.observer.as_ref(),
                &[attestation.bump],
            ],
            &crate::ID,
        )
        .map_err(|_| MandateError::AttestationInvalid)?;
        require_keys_eq!(expected, info.key(), MandateError::AttestationInvalid);
        require!(
            members.contains(&attestation.observer),
            MandateError::ObserverNotInSet
        );
        require!(
            !seen.contains(&attestation.observer),
            MandateError::DuplicateAttestation
        );
        seen.push(attestation.observer);

        let facts = Agreed::from(&*attestation);
        require_keys_eq!(
            facts.position_set,
            ctx.accounts.position_set.key(),
            MandateError::AttestationMismatch
        );
        require!(
            facts.algorithm_version == ctx.accounts.mandate.algorithm_version,
            MandateError::AttestationMismatch
        );
        match agreed {
            None => agreed = Some(facts),
            Some(first) => require!(first == facts, MandateError::AttestationMismatch),
        }
    }
    require!(
        seen.len() >= usize::from(set.threshold) && set.threshold >= 1,
        MandateError::QuorumNotReached
    );
    let facts = agreed.ok_or(MandateError::QuorumNotReached)?;

    // Compliance is recomputed here from the stored thresholds and the attested integers. No verdict
    // from any observer is ever read.
    let m = &ctx.accounts.mandate;
    let compliance = evaluate_compliance(
        &CoreMetrics {
            effective_spread_bps: facts.metrics.effective_spread_bps,
            pool_buy_depth_quote_raw: facts.metrics.pool_buy_depth_quote_raw,
            pool_sell_depth_quote_raw: facts.metrics.pool_sell_depth_quote_raw,
            provider_quote_in_band_raw: facts.metrics.provider_quote_in_band_raw,
            provider_base_quote_eq_in_band_raw: facts.metrics.provider_base_quote_eq_in_band_raw,
        },
        &Thresholds {
            max_effective_spread_bps: m.max_effective_spread_bps,
            min_pool_buy_depth_quote_raw: m.min_pool_buy_depth_quote_raw,
            min_pool_sell_depth_quote_raw: m.min_pool_sell_depth_quote_raw,
            min_provider_quote_in_band_raw: m.min_provider_quote_in_band_raw,
            min_provider_base_quote_eq_in_band_raw: m.min_provider_base_quote_eq_in_band_raw,
        },
    );
    let mut failure_bits = 0u8;
    for (bit, failure) in ComplianceFailure::ALL.iter().enumerate() {
        if compliance.contains(*failure) {
            failure_bits |= 1u8 << bit;
        }
    }
    let (core_outcome, outcome) = if compliance.is_compliant() {
        (CoreOutcome::Compliant, EpochOutcome::Compliant)
    } else {
        (CoreOutcome::NonCompliant, EpochOutcome::NonCompliant)
    };

    let attestation_count =
        u8::try_from(seen.len()).map_err(|_| MandateError::ArithmeticOverflow)?;
    let payer = ctx.accounts.payer.key();
    let position_set = ctx.accounts.position_set.key();
    let (earned, forfeited) = apply_outcome(&mut ctx.accounts.mandate, epoch_index, core_outcome)?;

    let r = &mut ctx.accounts.epoch_result;
    r.version = EPOCH_RESULT_VERSION;
    r.bump = ctx.bumps.epoch_result;
    r.mandate = mandate_key;
    r.epoch_index = epoch_index;
    r.outcome = outcome;
    r.reward_earned_raw = earned;
    r.reward_forfeited_raw = forfeited;
    r.failure_bits = failure_bits;
    r.attestation_count = attestation_count;
    r.observed_slot = facts.observed_slot;
    r.observed_unix_ts = facts.observed_unix_ts;
    r.algorithm_version = facts.algorithm_version;
    r.position_set = position_set;
    r.payload_hash = facts.payload_hash;
    r.evidence_hash = facts.evidence_hash;
    r.metrics = facts.metrics;
    r.finalized_by = payer;
    r.finalized_at = now;

    let m = &ctx.accounts.mandate;
    emit!(EpochFinalized {
        mandate: mandate_key,
        epoch_index,
        outcome: if outcome == EpochOutcome::Compliant {
            0
        } else {
            1
        },
        reward_earned_raw: earned,
        reward_forfeited_raw: forfeited,
        failure_bits,
        attestation_count,
        payload_hash: facts.payload_hash,
        evidence_hash: facts.evidence_hash,
        finalized_epochs: m.finalized_epochs,
        earned_reward_raw: m.earned_reward_raw,
        finalized_by: payer,
    });
    Ok(())
}
