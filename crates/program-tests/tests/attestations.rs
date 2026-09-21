#![allow(clippy::result_large_err)]

mod common;

use anchor_lang::error::ErrorCode;
use anchor_lang::ToAccountMetas;
use common::*;
use mandate::{MandateError, MandateStatus};
use solana_keypair::Keypair;
use solana_message::Instruction;
use solana_signer::Signer;

// Epoch 0 is [START_AT, START_AT + 300). Epoch e is [START_AT + 300e, START_AT + 300(e+1)).
// Attestations for epoch e close at START_AT + 300(e+1) + 3600 (the recovery deadline).
const E0_START: i64 = START_AT;
const E0_END: i64 = START_AT + EPOCH_SECONDS;

fn att(l: &Live, epoch: u32, observer_index: usize) -> mandate::EpochAttestation {
    l.env.load(&attestation_pda(
        &l.mandate,
        epoch,
        &l.observers[observer_index].pubkey(),
    ))
}

#[test]
fn an_observer_in_the_set_records_exactly_what_it_attested() {
    let mut l = Live::new();
    l.env.warp_time(E0_END);
    let mut args = args_for(0, E0_END - 10);
    args.payload_hash = [1; 32];
    args.evidence_hash = [2; 32];
    let sent = l.attest(0, args.clone()).expect("attest");

    let a = att(&l, 0, 0);
    let m: mandate::Mandate = l.env.load(&l.mandate);
    assert_eq!(a.version, mandate::ATTESTATION_VERSION);
    assert_eq!(
        (a.mandate, a.epoch_index, a.observer),
        (l.mandate, 0, l.observers[0].pubkey())
    );
    assert_eq!(
        (a.observed_slot, a.observed_unix_ts, a.algorithm_version),
        (448_786_149, E0_END - 10, 1)
    );
    assert_eq!(
        a.position_set, m.position_set,
        "bound to the mandate's activated position set"
    );
    assert_eq!((a.payload_hash, a.evidence_hash), ([1; 32], [2; 32]));
    assert_eq!(a.metrics, good_metrics());
    assert_eq!(a.created_at, E0_END);
    let e = events::<mandate::events::EpochAttested>(&sent.logs);
    assert_eq!(
        (e[0].epoch_index, e[0].observer, e[0].payload_hash),
        (0, l.observers[0].pubkey(), [1; 32])
    );
}

#[test]
fn an_attestation_accrues_nothing_and_moves_no_funds() {
    let mut l = Live::new();
    l.env.warp_time(E0_END);
    let before = l.env.account_data(&l.mandate);
    let vault = l.env.token_amount(&vault_pda(&l.mandate));
    l.attest(0, args_for(0, E0_END - 1)).unwrap();
    l.attest(1, args_for(0, E0_END - 1)).unwrap();
    assert_eq!(
        l.env.account_data(&l.mandate),
        before,
        "the mandate is untouched: no reward accrues at attestation"
    );
    assert_eq!(l.env.token_amount(&vault_pda(&l.mandate)), vault);
    let m: mandate::Mandate = l.env.load(&l.mandate);
    assert_eq!(
        (m.earned_reward_raw, m.finalized_epochs, m.status),
        (0, 0, MandateStatus::Active)
    );
}

#[test]
fn only_members_of_the_bound_observer_set_can_attest() {
    let mut l = Live::new();
    l.env.warp_time(E0_END);
    let outsider = l.env.provider();
    assert_fails_with(
        l.attest_as(&outsider, args_for(0, E0_END - 1)),
        MandateError::ObserverNotInSet,
    );
    // none of the protocol's other roles is an observer either
    let sponsor = Keypair::new_from_array(*l.sponsor.secret_bytes());
    let provider = Keypair::new_from_array(*l.provider.secret_bytes());
    let admin = Keypair::new_from_array(*l.env.admin.secret_bytes());
    l.env.svm.airdrop(&admin.pubkey(), 1_000_000_000).unwrap();
    for who in [&sponsor, &provider, &admin] {
        assert_fails_with(
            l.attest_as(who, args_for(0, E0_END - 1)),
            MandateError::ObserverNotInSet,
        );
    }
}

#[test]
fn the_observer_must_sign() {
    let mut l = Live::new();
    l.env.warp_time(E0_END);
    let mut ix = l.ix_attest(&l.observers[0].pubkey(), args_for(0, E0_END - 1));
    ix.accounts[0].is_signer = false;
    assert_fails_with_framework(l.env.send(&[ix], &[]), ErrorCode::AccountNotSigner);
}

#[test]
fn one_attestation_per_observer_per_epoch() {
    let mut l = Live::new();
    l.env.warp_time(E0_END);
    l.attest(0, args_for(0, E0_END - 1)).unwrap();
    let stored = l
        .env
        .account_data(&attestation_pda(&l.mandate, 0, &l.observers[0].pubkey()));
    let mut different = args_for(0, E0_END - 2);
    different.metrics.effective_spread_bps = 1;
    assert!(
        l.attest(0, different).is_err(),
        "a second attestation, even a different one, cannot overwrite the first"
    );
    assert_eq!(
        l.env
            .account_data(&attestation_pda(&l.mandate, 0, &l.observers[0].pubkey())),
        stored
    );
    // a different observer, and a different epoch, are separate accounts
    l.attest(1, args_for(0, E0_END - 1))
        .expect("another observer, same epoch");
    l.env.warp_time(E0_END + EPOCH_SECONDS);
    l.attest(0, args_for(1, E0_END + 10))
        .expect("same observer, next epoch");
}

#[test]
fn attestation_addresses_must_be_derived() {
    let mut l = Live::new();
    l.env.warp_time(E0_END);
    let m: mandate::Mandate = l.env.load(&l.mandate);
    let signer = Keypair::new_from_array(*l.observers[0].secret_bytes());
    // an address that is not (mandate, epoch, observer)
    let ix = l.ix_attest_with(
        &signer.pubkey(),
        args_for(0, E0_END - 1),
        m.observer_set,
        m.position_set,
        Some(keypair().pubkey()),
    );
    assert_fails_with_framework(l.env.send(&[ix], &[&signer]), ErrorCode::ConstraintSeeds);
    // another epoch's address for this epoch's data: a replay across epochs
    let ix = l.ix_attest_with(
        &signer.pubkey(),
        args_for(0, E0_END - 1),
        m.observer_set,
        m.position_set,
        Some(attestation_pda(&l.mandate, 1, &signer.pubkey())),
    );
    assert_fails_with_framework(l.env.send(&[ix], &[&signer]), ErrorCode::ConstraintSeeds);
    // another observer's address
    let ix = l.ix_attest_with(
        &signer.pubkey(),
        args_for(0, E0_END - 1),
        m.observer_set,
        m.position_set,
        Some(attestation_pda(&l.mandate, 0, &l.observers[1].pubkey())),
    );
    assert_fails_with_framework(l.env.send(&[ix], &[&signer]), ErrorCode::ConstraintSeeds);
}

#[test]
fn the_observation_must_fall_inside_its_epoch_to_the_second() {
    let mut l = Live::new();
    l.env.warp_time(E0_END + 10);
    assert_fails_with(
        l.attest(0, args_for(0, E0_START - 1)),
        MandateError::ObservationOutsideEpoch,
    );
    assert_fails_with(
        l.attest(0, args_for(0, E0_END)),
        MandateError::ObservationOutsideEpoch,
    );
    l.attest(0, args_for(0, E0_START))
        .expect("the first second of the epoch");
    l.attest(1, args_for(0, E0_END - 1))
        .expect("the last second of the epoch");
    // an observation inside epoch 1 cannot be filed under epoch 0, nor the reverse
    assert_fails_with(
        l.attest(2, args_for(0, E0_END + 5)),
        MandateError::ObservationOutsideEpoch,
    );
    assert_fails_with(
        l.attest(2, args_for(1, E0_END - 5)),
        MandateError::ObservationOutsideEpoch,
    );
}

#[test]
fn an_observation_cannot_be_dated_in_the_future() {
    let mut l = Live::new();
    l.env.warp_time(E0_START + 100);
    assert_fails_with(
        l.attest(0, args_for(0, E0_START + 101)),
        MandateError::ObservationInFuture,
    );
    l.attest(0, args_for(0, E0_START + 100))
        .expect("observed exactly now is allowed");
}

#[test]
fn attestations_close_at_the_recovery_deadline() {
    let mut l = Live::new();
    l.env.warp_time(E0_END + RECOVERY - 1);
    l.attest(0, args_for(0, E0_END - 1))
        .expect("one second before the deadline");
    l.env.warp_time(E0_END + RECOVERY);
    assert_fails_with(
        l.attest(1, args_for(0, E0_END - 1)),
        MandateError::AttestationWindowClosed,
    );
}

#[test]
fn an_epoch_outside_the_schedule_is_refused() {
    let mut l = Live::new();
    l.env.warp_time(E0_END);
    assert_fails_with(
        l.attest(0, args_for(72, E0_END - 1)),
        MandateError::EpochOutOfRange,
    );
    assert_fails_with(
        l.attest(0, args_for(u32::MAX, E0_END - 1)),
        MandateError::EpochOutOfRange,
    );
    let last = 71u32;
    let last_start = START_AT + 71 * EPOCH_SECONDS;
    l.env.warp_time(last_start + EPOCH_SECONDS);
    l.attest(0, args_for(last, last_start + 5))
        .expect("the final epoch is attestable");
}

#[test]
fn only_the_bound_algorithm_version_is_accepted() {
    let mut l = Live::new();
    l.env.warp_time(E0_END);
    for version in [0u32, 2, u32::MAX] {
        let mut args = args_for(0, E0_END - 1);
        args.algorithm_version = version;
        assert_fails_with(l.attest(0, args), MandateError::UnsupportedAlgorithm);
    }
    let m: mandate::Mandate = l.env.load(&l.mandate);
    assert_eq!(m.algorithm_version, 1, "the version is fixed at creation");
    l.attest(0, args_for(0, E0_END - 1)).expect("version 1");
}

#[test]
fn the_observer_set_and_position_set_are_the_ones_the_mandate_bound() {
    let mut l = Live::new();
    l.env.warp_time(E0_END);
    let m: mandate::Mandate = l.env.load(&l.mandate);
    let signer = Keypair::new_from_array(*l.observers[0].secret_bytes());

    // a newer observer set that happens to contain this observer must not stand in
    let admin = l.env.admin.pubkey();
    let ix = l.env.ix_create_observer_set(
        admin,
        observer_set_pda(2),
        vec![signer.pubkey(), keypair().pubkey()],
        1,
    );
    l.env.as_admin(&[ix]).unwrap();
    let ix = l.ix_attest_with(
        &signer.pubkey(),
        args_for(0, E0_END - 1),
        observer_set_pda(2),
        m.position_set,
        None,
    );
    assert_fails_with(
        l.env.send(&[ix], &[&signer]),
        MandateError::ObserverSetMismatch,
    );

    // another mandate's position set
    let other_set = position_set_pda(&keypair().pubkey());
    let ix = l.ix_attest_with(
        &signer.pubkey(),
        args_for(0, E0_END - 1),
        m.observer_set,
        other_set,
        None,
    );
    assert!(l.env.send(&[ix], &[&signer]).is_err());
    let ix = l.ix_attest_with(
        &signer.pubkey(),
        args_for(0, E0_END - 1),
        m.observer_set,
        l.env.pool,
        None,
    );
    assert!(l.env.send(&[ix], &[&signer]).is_err());
    assert!(l
        .env
        .account_data(&attestation_pda(&l.mandate, 0, &signer.pubkey()))
        .is_empty());
}

#[test]
fn another_mandates_valid_position_set_cannot_stand_in() {
    // The other mandate is real and active, and its position set really exists. Naming it here must fail:
    // an observation is bound to THIS mandate's activated set, not to any well-formed set.
    let mut l = Live::new();
    l.env.warp_time(E0_END);
    let m: mandate::Mandate = l.env.load(&l.mandate);
    let other: mandate::Mandate = l.env.load(&l.other_mandate);
    assert_ne!(m.position_set, other.position_set);
    assert_eq!(other.status, MandateStatus::Active);
    let signer = Keypair::new_from_array(*l.observers[0].secret_bytes());
    let ix = l.ix_attest_with(
        &signer.pubkey(),
        args_for(0, E0_END - 1),
        m.observer_set,
        other.position_set,
        None,
    );
    assert_fails_with(
        l.env.send(&[ix], &[&signer]),
        MandateError::PositionSetMismatch,
    );
    assert!(l
        .env
        .account_data(&attestation_pda(&l.mandate, 0, &signer.pubkey()))
        .is_empty());
}

#[test]
fn the_mandate_must_be_active() {
    // awarded, positions registered, but not yet activated
    let mut env = Env::ready();
    let (sponsor, usdc) = env.sponsor_with(5_000 * USDC);
    env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
        .unwrap();
    let mandate_key = mandate_pda(&sponsor.pubkey(), 1);
    let observer = env.provider();
    // a mandate that is still bidding has no position set at all
    let ix = Instruction {
        program_id: mandate::ID,
        accounts: mandate::accounts::SubmitAttestation {
            observer: observer.pubkey(),
            mandate: mandate_key,
            observer_set: observer_set_pda(1),
            position_set: position_set_pda(&mandate_key),
            attestation: attestation_pda(&mandate_key, 0, &observer.pubkey()),
            system_program: pk(SYSTEM_PROGRAM),
        }
        .to_account_metas(None),
        data: {
            use anchor_lang::InstructionData;
            mandate::instruction::SubmitAttestation {
                args: args_for(0, START_AT + 1),
            }
            .data()
        },
    };
    env.warp_time(START_AT + 10);
    assert!(env.send(&[ix], &[&observer]).is_err());
}

#[test]
fn metrics_and_hashes_are_sanity_checked() {
    let mut l = Live::new();
    l.env.warp_time(E0_END);
    let mut spread = args_for(0, E0_END - 1);
    spread.metrics.effective_spread_bps = 20_001;
    assert_fails_with(l.attest(0, spread), MandateError::InvalidMetrics);
    let mut ok_spread = args_for(0, E0_END - 1);
    ok_spread.metrics.effective_spread_bps = 20_000;
    l.attest(0, ok_spread)
        .expect("20_000 is the largest spread that can exist");
    let mut slot = args_for(0, E0_END - 1);
    slot.observed_slot = 0;
    assert_fails_with(l.attest(1, slot), MandateError::InvalidMetrics);
    let mut payload = args_for(0, E0_END - 1);
    payload.payload_hash = [0; 32];
    assert_fails_with(l.attest(1, payload), MandateError::InvalidHash);
    let mut evidence = args_for(0, E0_END - 1);
    evidence.evidence_hash = [0; 32];
    assert_fails_with(l.attest(1, evidence), MandateError::InvalidHash);
}

#[test]
fn extreme_metric_values_are_stored_exactly() {
    let mut l = Live::new();
    l.env.warp_time(E0_END);
    let mut args = args_for(0, E0_END - 1);
    args.metrics = mandate::EpochMetrics {
        effective_spread_bps: 0,
        pool_buy_depth_quote_raw: u64::MAX,
        pool_sell_depth_quote_raw: 0,
        provider_quote_in_band_raw: u64::MAX,
        provider_base_quote_eq_in_band_raw: 1,
    };
    l.attest(0, args.clone()).unwrap();
    assert_eq!(att(&l, 0, 0).metrics, args.metrics);
}

#[test]
fn pausing_does_not_block_attestation() {
    let mut l = Live::new();
    let ix = l.env.ix_set_paused(l.env.admin.pubkey(), true);
    l.env.as_admin(&[ix]).unwrap();
    l.env.warp_time(E0_END);
    l.attest(0, args_for(0, E0_END - 1))
        .expect("attestation continues for an active mandate during a pause");
}

#[test]
fn identical_observations_from_different_observers_are_stored_identically() {
    let mut l = Live::new();
    l.env.warp_time(E0_END);
    for i in 0..3 {
        l.attest(i, args_for(0, E0_END - 1)).unwrap();
    }
    let (a, b, c) = (att(&l, 0, 0), att(&l, 0, 1), att(&l, 0, 2));
    for other in [&b, &c] {
        assert_eq!(
            (
                a.payload_hash,
                a.evidence_hash,
                a.metrics,
                a.observed_slot,
                a.observed_unix_ts
            ),
            (
                other.payload_hash,
                other.evidence_hash,
                other.metrics,
                other.observed_slot,
                other.observed_unix_ts
            )
        );
    }
    assert_ne!((a.observer, b.observer), (b.observer, c.observer));
}
