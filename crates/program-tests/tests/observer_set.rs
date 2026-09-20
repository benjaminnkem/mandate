#![allow(clippy::result_large_err)]

mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use mandate::MandateError;
use solana_signer::Signer;

fn setup() -> Env {
    let mut env = Env::new();
    env.initialize_ok();
    env
}

fn keys(n: usize) -> Vec<Pubkey> {
    (0..n).map(|_| keypair().pubkey()).collect()
}

fn create(env: &mut Env, version: u32, observers: Vec<Pubkey>, threshold: u8) -> Sent {
    let admin = env.admin.pubkey();
    let ix = env.ix_create_observer_set(admin, observer_set_pda(version), observers, threshold);
    env.as_admin(&[ix])
}

#[test]
fn creates_the_first_version_and_makes_it_current() {
    let mut env = setup();
    let observers = keys(3);
    let sent = create(&mut env, 1, observers.clone(), 2).expect("create");

    let set: mandate::ObserverSet = env.load(&observer_set_pda(1));
    assert_eq!(set.version, 1);
    assert_eq!(set.observer_count, 3);
    assert_eq!(set.threshold, 2);
    assert_eq!(&set.observers[..3], observers.as_slice());
    assert_eq!(
        &set.observers[3..],
        &[Pubkey::default(); 2],
        "unused slots are the default key"
    );
    assert_eq!(set.created_at, NOW);
    let bump = Pubkey::find_program_address(
        &[mandate::OBSERVER_SET_SEED, &1u32.to_le_bytes()],
        &mandate::ID,
    )
    .1;
    assert_eq!(set.bump, bump);

    let protocol: mandate::ProtocolConfig = env.load(&protocol_pda());
    assert_eq!(protocol.current_observer_set_version, 1);

    let emitted = events::<mandate::events::ObserverSetCreated>(&sent.logs);
    assert_eq!(emitted.len(), 1);
    assert_eq!(
        (
            emitted[0].version,
            emitted[0].observer_count,
            emitted[0].threshold
        ),
        (1, 3, 2)
    );
    assert_eq!(emitted[0].observers, observers);
}

#[test]
fn a_new_version_never_touches_an_earlier_one() {
    let mut env = setup();
    create(&mut env, 1, keys(3), 2).unwrap();
    let before = env.account_data(&observer_set_pda(1));

    create(&mut env, 2, keys(5), 4).unwrap();
    let protocol: mandate::ProtocolConfig = env.load(&protocol_pda());
    assert_eq!(protocol.current_observer_set_version, 2);
    assert_eq!(
        env.account_data(&observer_set_pda(1)),
        before,
        "version 1 is byte-for-byte unchanged"
    );
    let v2: mandate::ObserverSet = env.load(&observer_set_pda(2));
    assert_eq!((v2.observer_count, v2.threshold), (5, 4));
}

#[test]
fn an_existing_version_can_never_be_recreated_or_overwritten() {
    let mut env = setup();
    create(&mut env, 1, keys(3), 2).unwrap();
    let before = env.account_data(&observer_set_pda(1));
    // Asking for version 1 again: the program expects version 2's address, so the seeds do not match.
    let result = create(&mut env, 1, keys(3), 1);
    assert_fails_with_framework(result, anchor_lang::error::ErrorCode::ConstraintSeeds);
    assert_eq!(env.account_data(&observer_set_pda(1)), before);
}

#[test]
fn versions_are_strictly_sequential() {
    let mut env = setup();
    // Skipping ahead is a seeds mismatch.
    let result = create(&mut env, 2, keys(3), 2);
    assert_fails_with_framework(result, anchor_lang::error::ErrorCode::ConstraintSeeds);
    create(&mut env, 1, keys(3), 2).unwrap();
    let result = create(&mut env, 3, keys(3), 2);
    assert_fails_with_framework(result, anchor_lang::error::ErrorCode::ConstraintSeeds);
}

#[test]
fn a_substituted_observer_set_address_is_rejected() {
    let mut env = setup();
    let admin = env.admin.pubkey();
    let ix = env.ix_create_observer_set(admin, keypair().pubkey(), keys(3), 2);
    assert_fails_with_framework(
        env.as_admin(&[ix]),
        anchor_lang::error::ErrorCode::ConstraintSeeds,
    );
}

#[test]
fn only_the_admin_can_create_a_set() {
    let mut env = setup();
    let stranger = keypair();
    env.svm.airdrop(&stranger.pubkey(), 10_000_000_000).unwrap();
    let ix = env.ix_create_observer_set(stranger.pubkey(), observer_set_pda(1), keys(3), 2);
    assert_fails_with(
        env.send(&[ix], &[&stranger]),
        MandateError::UnauthorizedAdmin,
    );
    assert!(env.account_data(&observer_set_pda(1)).is_empty());
}

#[test]
fn the_admin_signature_is_required() {
    let mut env = setup();
    let admin = env.admin.pubkey();
    let mut ix = env.ix_create_observer_set(admin, observer_set_pda(1), keys(3), 2);
    ix.accounts[0].is_signer = false;
    assert_fails_with_framework(
        env.send(&[ix], &[]),
        anchor_lang::error::ErrorCode::AccountNotSigner,
    );
}

#[test]
fn bounds_and_thresholds_are_enforced() {
    // count 0
    let mut env = setup();
    assert_fails_with(
        create(&mut env, 1, vec![], 1),
        MandateError::InvalidObserverSet,
    );
    // count 6 exceeds MAX_OBSERVERS
    assert_fails_with(
        create(&mut env, 1, keys(6), 3),
        MandateError::InvalidObserverSet,
    );
    // threshold 0
    assert_fails_with(
        create(&mut env, 1, keys(3), 0),
        MandateError::InvalidObserverSet,
    );
    // threshold above count
    assert_fails_with(
        create(&mut env, 1, keys(3), 4),
        MandateError::InvalidObserverSet,
    );
    assert!(
        env.account_data(&observer_set_pda(1)).is_empty(),
        "nothing was created by the failures"
    );
    // the largest legal set
    create(&mut env, 1, keys(5), 5).unwrap();
    // and the smallest
    create(&mut env, 2, keys(1), 1).unwrap();
}

#[test]
fn observers_must_be_unique_nondefault_and_not_the_admin() {
    let mut env = setup();
    let dup = keypair().pubkey();
    assert_fails_with(
        create(&mut env, 1, vec![dup, keypair().pubkey(), dup], 2),
        MandateError::DuplicateObserver,
    );
    assert_fails_with(
        create(&mut env, 1, vec![Pubkey::default(), keypair().pubkey()], 1),
        MandateError::InvalidObserverSet,
    );
    let admin = env.admin.pubkey();
    assert_fails_with(
        create(&mut env, 1, vec![admin, keypair().pubkey()], 1),
        MandateError::InvalidObserverSet,
    );
    assert!(env.account_data(&observer_set_pda(1)).is_empty());
    let protocol: mandate::ProtocolConfig = env.load(&protocol_pda());
    assert_eq!(
        protocol.current_observer_set_version, 0,
        "a failed creation never advances the version"
    );
}

#[test]
fn creating_an_observer_set_is_allowed_while_new_risk_is_paused() {
    // Observer rotation is an incident-response tool: it affects future mandates only.
    let mut env = setup();
    let ix = env.ix_set_paused(env.admin.pubkey(), true);
    env.as_admin(&[ix]).unwrap();
    create(&mut env, 1, keys(3), 2).expect("allowed while paused");
}
