#![allow(clippy::result_large_err)]

mod common;

use common::*;
use mandate::{EpochMetrics, EpochOutcome, MandateError, MandateStatus};
use solana_signer::Signer;

const ACCEPTED: u64 = 900 * USDC;
const EPOCHS: u64 = 72;
const SHARE: u64 = ACCEPTED / EPOCHS; // 12.5 USDC, exact

/// Thresholds of `valid_mandate_args`.
fn at_threshold() -> EpochMetrics {
    EpochMetrics {
        effective_spread_bps: 400,
        pool_buy_depth_quote_raw: 8_000 * USDC,
        pool_sell_depth_quote_raw: 8_000 * USDC,
        provider_quote_in_band_raw: 5_000 * USDC,
        provider_base_quote_eq_in_band_raw: 5_000 * USDC,
    }
}

fn args_with(epoch: u32, metrics: EpochMetrics) -> mandate::SubmitAttestationArgs {
    let mut a = args_for(epoch, Live::epoch_end(epoch) - 5);
    a.metrics = metrics;
    a
}

fn compliant(epoch: u32) -> mandate::SubmitAttestationArgs {
    let mut m = at_threshold();
    m.effective_spread_bps = 251;
    m.pool_buy_depth_quote_raw += 1_000 * USDC;
    m.provider_quote_in_band_raw += 91_107_867;
    args_with(epoch, m)
}

fn finalized_ok(
    l: &mut Live,
    epoch: u32,
    observers: &[usize],
    args: &mandate::SubmitAttestationArgs,
) {
    l.attest_many(observers, args);
    l.env.warp_time(Live::epoch_end(epoch));
    l.finalize_with_observers(epoch, observers)
        .expect("finalize");
}

#[test]
fn two_of_three_finalizes_a_compliant_epoch_and_accrues_exactly_one_share() {
    let mut l = Live::new();
    let args = compliant(0);
    l.attest_many(&[0, 2], &args);
    l.env.warp_time(Live::epoch_end(0));
    let vault_before = l.env.token_amount(&vault_pda(&l.mandate));
    let sent = l.finalize_with_observers(0, &[0, 2]).expect("finalize");

    let r = l.result(0);
    assert_eq!(r.outcome, EpochOutcome::Compliant);
    assert_eq!((r.reward_earned_raw, r.reward_forfeited_raw), (SHARE, 0));
    assert_eq!((r.failure_bits, r.attestation_count), (0, 2));
    assert_eq!(
        (r.payload_hash, r.evidence_hash),
        (args.payload_hash, args.evidence_hash)
    );
    assert_eq!(r.metrics, args.metrics);
    assert_eq!(r.observed_slot, args.observed_slot);
    assert_eq!(r.finalized_by, l.env.payer.pubkey());

    let m = l.mandate_state();
    assert_eq!((m.finalized_epochs, m.compliant_epochs), (1, 1));
    assert_eq!(
        (
            m.earned_reward_raw,
            m.forfeited_reward_raw,
            m.claimed_reward_raw
        ),
        (SHARE, 0, 0)
    );
    assert_eq!(m.status, MandateStatus::Active);
    assert_eq!(
        l.env.token_amount(&vault_pda(&l.mandate)),
        vault_before,
        "finalization moves no funds"
    );

    let e = events::<mandate::events::EpochFinalized>(&sent.logs);
    assert_eq!(
        (e[0].outcome, e[0].reward_earned_raw, e[0].earned_reward_raw),
        (0, SHARE, SHARE)
    );
}

#[test]
fn three_of_three_also_finalizes() {
    let mut l = Live::new();
    finalized_ok(&mut l, 0, &[0, 1, 2], &compliant(0));
    assert_eq!(l.result(0).attestation_count, 3);
}

#[test]
fn one_of_three_is_not_a_quorum() {
    let mut l = Live::new();
    l.attest_many(&[1], &compliant(0));
    l.env.warp_time(Live::epoch_end(0));
    assert_fails_with(
        l.finalize_with_observers(0, &[1]),
        MandateError::QuorumNotReached,
    );
    assert_fails_with(l.finalize(0, &[]), MandateError::QuorumNotReached);
    assert_eq!(l.mandate_state().finalized_epochs, 0);
}

#[test]
fn the_same_observer_cannot_be_counted_twice() {
    let mut l = Live::new();
    l.attest_many(&[0], &compliant(0));
    l.env.warp_time(Live::epoch_end(0));
    let a = attestation_pda(&l.mandate, 0, &l.observers[0].pubkey());
    assert_fails_with(l.finalize(0, &[a, a]), MandateError::DuplicateAttestation);
}

#[test]
fn a_mismatching_attestation_is_rejected_never_averaged() {
    for tweak in 0..8 {
        let mut l = Live::new();
        let base = compliant(0);
        let mut other = base.clone();
        match tweak {
            0 => other.payload_hash = [0xCC; 32],
            1 => other.evidence_hash = [0xCC; 32],
            2 => other.observed_slot += 1,
            3 => other.observed_unix_ts -= 1,
            4 => other.metrics.effective_spread_bps -= 1,
            5 => other.metrics.pool_buy_depth_quote_raw += 1,
            6 => other.metrics.provider_quote_in_band_raw += 1,
            _ => other.metrics.provider_base_quote_eq_in_band_raw -= 1,
        }
        l.env.warp_time(Live::epoch_end(0) - 1);
        l.attest(0, base).unwrap();
        l.attest(1, other).unwrap();
        l.env.warp_time(Live::epoch_end(0));
        assert_fails_with(
            l.finalize_with_observers(0, &[0, 1]),
            MandateError::AttestationMismatch,
        );
        assert_eq!(l.mandate_state().finalized_epochs, 0, "case {tweak}");
    }
}

#[test]
fn one_dishonest_observer_cannot_block_an_honest_quorum() {
    let mut l = Live::new();
    let honest = compliant(0);
    let mut bad = honest.clone();
    bad.metrics.effective_spread_bps = 9_000;
    l.env.warp_time(Live::epoch_end(0) - 1);
    l.attest(0, honest.clone()).unwrap();
    l.attest(1, bad).unwrap();
    l.attest(2, honest).unwrap();
    l.env.warp_time(Live::epoch_end(0));
    // The caller presents only the matching pair; the outlier is simply not counted.
    l.finalize_with_observers(0, &[0, 2]).expect("honest pair");
    assert_eq!(l.result(0).outcome, EpochOutcome::Compliant);
}

#[test]
fn exactly_meeting_every_threshold_is_compliant() {
    let mut l = Live::new();
    finalized_ok(&mut l, 0, &[0, 1], &args_with(0, at_threshold()));
    assert_eq!(l.result(0).outcome, EpochOutcome::Compliant);
}

#[test]
fn one_unit_on_the_wrong_side_of_any_single_threshold_is_noncompliant() {
    type Break = fn(&mut EpochMetrics);
    let cases: [(u8, Break); 5] = [
        (1, |m| m.effective_spread_bps += 1),
        (2, |m| m.pool_buy_depth_quote_raw -= 1),
        (4, |m| m.pool_sell_depth_quote_raw -= 1),
        (8, |m| m.provider_quote_in_band_raw -= 1),
        (16, |m| m.provider_base_quote_eq_in_band_raw -= 1),
    ];
    for (bit, change) in cases {
        let mut l = Live::new();
        let mut metrics = at_threshold();
        change(&mut metrics);
        finalized_ok(&mut l, 0, &[0, 1], &args_with(0, metrics));
        let r = l.result(0);
        assert_eq!(r.outcome, EpochOutcome::NonCompliant, "bit {bit}");
        assert_eq!(r.failure_bits, bit);
        assert_eq!((r.reward_earned_raw, r.reward_forfeited_raw), (0, SHARE));
        let m = l.mandate_state();
        assert_eq!(
            (
                m.noncompliant_epochs,
                m.compliant_epochs,
                m.unavailable_epochs
            ),
            (1, 0, 0)
        );
        assert_eq!((m.earned_reward_raw, m.forfeited_reward_raw), (0, SHARE));
    }
}

#[test]
fn a_verdict_is_recomputed_from_integers_and_never_averaged_across_epochs() {
    let mut l = Live::new();
    finalized_ok(&mut l, 0, &[0, 1], &compliant(0));
    let mut bad = at_threshold();
    bad.effective_spread_bps = 401;
    finalized_ok(&mut l, 1, &[1, 2], &args_with(1, bad));
    finalized_ok(&mut l, 2, &[0, 2], &compliant(2));
    let m = l.mandate_state();
    assert_eq!(
        (
            m.compliant_epochs,
            m.noncompliant_epochs,
            m.finalized_epochs
        ),
        (2, 1, 3)
    );
    assert_eq!(
        (m.earned_reward_raw, m.forfeited_reward_raw),
        (2 * SHARE, SHARE)
    );
}

#[test]
fn an_epoch_cannot_be_finalized_twice() {
    let mut l = Live::new();
    finalized_ok(&mut l, 0, &[0, 1], &compliant(0));
    let before = l.env.account_data(&l.mandate);
    // Same quorum again, a different quorum, and the unavailable path: all refused, nothing moves.
    assert!(l.finalize_with_observers(0, &[0, 1]).is_err());
    l.attest(2, compliant(0)).ok();
    assert!(l.finalize_with_observers(0, &[1, 2]).is_err());
    l.env.warp_time(Live::epoch_end(0) + RECOVERY);
    assert!(l.finalize_unavailable(0).is_err());
    assert_eq!(l.env.account_data(&l.mandate), before);
}

#[test]
fn an_epoch_cannot_be_finalized_before_it_ends() {
    let mut l = Live::new();
    l.attest_many(&[0, 1], &compliant(0));
    l.env.warp_time(Live::epoch_end(0) - 1);
    assert_fails_with(
        l.finalize_with_observers(0, &[0, 1]),
        MandateError::EpochNotEnded,
    );
    l.env.warp_time(Live::epoch_end(0));
    l.finalize_with_observers(0, &[0, 1])
        .expect("at the boundary");
}

#[test]
fn an_epoch_outside_the_schedule_is_refused() {
    let mut l = Live::new();
    l.env.warp_time(Live::epoch_end(80));
    assert_fails_with(l.finalize(72, &[]), MandateError::EpochOutOfRange);
    assert_fails_with(l.finalize_unavailable(72), MandateError::EpochOutOfRange);
}

#[test]
fn the_final_epoch_earns_the_exact_remainder() {
    let mut l = Live::new();
    // Reshape the mandate to 3 epochs and an accepted reward of 100 raw units: base 33, final 34.
    let key = l.mandate;
    l.env.update_account::<mandate::Mandate>(&key, |m| {
        m.total_epochs = 3;
        m.accepted_reward_raw = 100;
    });
    for e in 0..3 {
        finalized_ok(&mut l, e, &[0, 1], &compliant(e));
    }
    assert_eq!(
        [
            l.result(0).reward_earned_raw,
            l.result(1).reward_earned_raw,
            l.result(2).reward_earned_raw
        ],
        [33, 33, 34]
    );
    let m = l.mandate_state();
    assert_eq!(
        m.earned_reward_raw, 100,
        "the total earnable equals the accepted reward exactly"
    );
    assert_eq!(
        m.status,
        MandateStatus::AwaitingFinalization,
        "all epochs resolved"
    );
    assert_eq!(m.finalized_epochs, 3);
}

#[test]
fn a_mixed_mandate_resolves_every_reward_unit_exactly() {
    let mut l = Live::new();
    let key = l.mandate;
    l.env.update_account::<mandate::Mandate>(&key, |m| {
        m.total_epochs = 3;
        m.accepted_reward_raw = 100;
    });
    finalized_ok(&mut l, 0, &[0, 1], &compliant(0));
    let mut bad = at_threshold();
    bad.pool_sell_depth_quote_raw = 0;
    finalized_ok(&mut l, 1, &[0, 1], &args_with(1, bad));
    l.env.warp_time(Live::epoch_end(2) + RECOVERY);
    l.finalize_unavailable(2).expect("unavailable");
    let m = l.mandate_state();
    assert_eq!((m.earned_reward_raw, m.forfeited_reward_raw), (33, 33 + 34));
    assert_eq!(
        m.earned_reward_raw + m.forfeited_reward_raw,
        m.accepted_reward_raw
    );
    assert_eq!(
        (
            m.compliant_epochs,
            m.noncompliant_epochs,
            m.unavailable_epochs
        ),
        (1, 1, 1)
    );
    assert_eq!(m.status, MandateStatus::AwaitingFinalization);
}

#[test]
fn unavailable_only_after_the_immutable_recovery_deadline() {
    let mut l = Live::new();
    let deadline = Live::epoch_end(0) + RECOVERY;
    for t in [Live::epoch_end(0), deadline - 1] {
        l.env.warp_time(t);
        assert_fails_with(l.finalize_unavailable(0), MandateError::RecoveryNotElapsed);
    }
    // Neither the admin nor an observer has a shortcut: the instruction takes no such signer, and even a
    // quorum's attestations do not move the deadline.
    l.env.warp_time(deadline);
    let sent = l.finalize_unavailable(0).expect("at the deadline");
    let r = l.result(0);
    assert_eq!(r.outcome, EpochOutcome::Unavailable);
    assert_ne!(r.outcome, EpochOutcome::NonCompliant);
    assert_eq!(
        (
            r.reward_earned_raw,
            r.reward_forfeited_raw,
            r.attestation_count
        ),
        (0, SHARE, 0)
    );
    assert_eq!((r.payload_hash, r.evidence_hash), ([0; 32], [0; 32]));
    let m = l.mandate_state();
    assert_eq!(
        (
            m.unavailable_epochs,
            m.noncompliant_epochs,
            m.compliant_epochs
        ),
        (1, 0, 0)
    );
    assert_eq!((m.earned_reward_raw, m.forfeited_reward_raw), (0, SHARE));
    assert_eq!(
        events::<mandate::events::EpochFinalized>(&sent.logs)[0].outcome,
        2
    );
}

#[test]
fn a_finalized_epoch_cannot_later_be_declared_unavailable_and_vice_versa() {
    let mut l = Live::new();
    l.env.warp_time(Live::epoch_end(0) + RECOVERY);
    l.finalize_unavailable(0).unwrap();
    // Attestations are closed at the deadline, so none can follow; finalizing over an existing result fails.
    assert!(l.finalize_with_observers(0, &[0, 1]).is_err());
    assert_eq!(l.result(0).outcome, EpochOutcome::Unavailable);
}

#[test]
fn a_different_observer_set_cannot_be_substituted() {
    let mut l = Live::new();
    // A later observer set version containing the same observers but a lower threshold.
    let admin = l.env.admin.pubkey();
    let ix = l.env.ix_create_observer_set(
        admin,
        observer_set_pda(2),
        l.observers.iter().map(|k| k.pubkey()).collect(),
        1,
    );
    l.env.as_admin(&[ix]).expect("v2");
    l.attest_many(&[0], &compliant(0));
    l.env.warp_time(Live::epoch_end(0));
    let a = attestation_pda(&l.mandate, 0, &l.observers[0].pubkey());
    let ix = l.ix_finalize_with(0, observer_set_pda(2), &[a]);
    assert_fails_with(l.env.send(&[ix], &[]), MandateError::ObserverSetMismatch);
    assert_eq!(l.mandate_state().finalized_epochs, 0);
}

#[test]
fn attestations_from_another_mandate_or_epoch_cannot_be_replayed() {
    let mut l = Live::new();
    // A genuine attestation set on the *other* mandate, and epoch 1 attestations on this one.
    l.env.warp_time(Live::epoch_end(0) - 1);
    let other = l.other_mandate;
    for i in [0usize, 1] {
        let signer = solana_keypair::Keypair::new_from_array(*l.observers[i].secret_bytes());
        let m: mandate::Mandate = l.env.load(&other);
        let mut ix = l.ix_attest_with(
            &signer.pubkey(),
            compliant(0),
            m.observer_set,
            m.position_set,
            None,
        );
        ix.accounts[1].pubkey = other;
        ix.accounts[4].pubkey = attestation_pda(&other, 0, &signer.pubkey());
        l.env.send(&[ix], &[&signer]).expect("attest other");
    }
    l.env.warp_time(Live::epoch_end(0));
    let foreign: Vec<_> = [0usize, 1]
        .iter()
        .map(|i| attestation_pda(&other, 0, &l.observers[*i].pubkey()))
        .collect();
    assert_fails_with(l.finalize(0, &foreign), MandateError::AttestationInvalid);

    l.attest_many(&[0, 1], &compliant(1));
    let wrong_epoch: Vec<_> = [0usize, 1]
        .iter()
        .map(|i| attestation_pda(&l.mandate, 1, &l.observers[*i].pubkey()))
        .collect();
    l.env.warp_time(Live::epoch_end(1));
    assert_fails_with(
        l.finalize(0, &wrong_epoch),
        MandateError::AttestationInvalid,
    );
    assert_eq!(l.mandate_state().finalized_epochs, 0);
}

#[test]
fn arbitrary_accounts_are_not_attestations() {
    let mut l = Live::new();
    l.env.warp_time(Live::epoch_end(0));
    let m = l.mandate;
    assert_fails_with(l.finalize(0, &[m, m]), MandateError::AttestationInvalid);
    assert_fails_with(
        l.finalize(0, &[keypair().pubkey(), keypair().pubkey()]),
        MandateError::AttestationInvalid,
    );
    let too_many: Vec<_> = (0..6).map(|_| m).collect();
    assert_fails_with(l.finalize(0, &too_many), MandateError::TooManyAttestations);
}

#[test]
fn an_attestation_bound_to_another_position_set_is_not_counted() {
    let mut l = Live::new();
    l.attest_many(&[0, 1], &compliant(0));
    let victim = attestation_pda(&l.mandate, 0, &l.observers[1].pubkey());
    l.env
        .update_account::<mandate::EpochAttestation>(&victim, |a| {
            a.position_set = keypair().pubkey()
        });
    l.env.warp_time(Live::epoch_end(0));
    assert_fails_with(
        l.finalize_with_observers(0, &[0, 1]),
        MandateError::AttestationMismatch,
    );
}

#[test]
fn only_an_active_mandate_can_be_finalized() {
    let mut l = Live::new();
    l.attest_many(&[0, 1], &compliant(0));
    l.env.warp_time(Live::epoch_end(0));
    let key = l.mandate;
    l.env
        .update_account::<mandate::Mandate>(&key, |m| m.status = MandateStatus::Cancelled);
    assert_fails_with(
        l.finalize_with_observers(0, &[0, 1]),
        MandateError::MandateNotActive,
    );
    assert_fails_with(l.finalize_unavailable(0), MandateError::MandateNotActive);
}

#[test]
fn pausing_new_risk_never_blocks_settlement() {
    let mut l = Live::new();
    let admin = l.env.admin.pubkey();
    let ix = l.env.ix_set_paused(admin, true);
    l.env.as_admin(&[ix]).expect("pause");
    finalized_ok(&mut l, 0, &[0, 1], &compliant(0));
    l.env.warp_time(Live::epoch_end(1) + RECOVERY);
    l.finalize_unavailable(1).expect("unavailable while paused");
}

#[test]
fn epochs_can_be_finalized_out_of_order_and_reward_shares_follow_the_epoch_index() {
    let mut l = Live::new();
    finalized_ok(&mut l, 5, &[0, 1], &compliant(5));
    finalized_ok(&mut l, 2, &[1, 2], &compliant(2));
    let m = l.mandate_state();
    assert_eq!((m.finalized_epochs, m.earned_reward_raw), (2, 2 * SHARE));
}
