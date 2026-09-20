#![allow(clippy::result_large_err)]

mod common;

use anchor_lang::error::ErrorCode;
use anchor_lang::prelude::Pubkey;
use common::*;
use mandate::{MandateError, MandateStatus};
use solana_keypair::Keypair;
use solana_signer::Signer;

// Timeline from `valid_mandate_args`: now = NOW, start NOW+7200. With a 300s lock buffer the position
// set locks at NOW+6900, so registration is allowed while now < NOW+6900.
const LOCK_AT: i64 = NOW + 6_900;
const START: i64 = NOW + 7_200;
const MAX: u64 = 1_000 * USDC;

struct World {
    env: Env,
    sponsor: Keypair,
    sponsor_usdc: Pubkey,
    provider: Keypair,
    mandate: Pubkey,
}

/// A mandate awarded to `provider`, positions not yet registered.
fn awarded() -> World {
    let mut env = Env::ready();
    let (sponsor, sponsor_usdc) = env.sponsor_with(5_000 * USDC);
    env.create_mandate(&sponsor, &sponsor_usdc, env.valid_mandate_args(1))
        .unwrap();
    let mandate = mandate_pda(&sponsor.pubkey(), 1);
    let provider = env.provider();
    env.submit_bid(&provider, &mandate, 1, 900 * USDC, NOW + 5_000)
        .unwrap();
    env.accept_bid(
        &sponsor,
        &mandate,
        &bid_pda(&mandate, &provider.pubkey(), 1),
    )
    .unwrap();
    World {
        env,
        sponsor,
        sponsor_usdc,
        provider,
        mandate,
    }
}

fn keys(n: usize) -> Vec<Pubkey> {
    (0..n).map(|_| keypair().pubkey()).collect()
}
fn set_of(w: &World) -> mandate::PositionSet {
    w.env.load(&position_set_pda(&w.mandate))
}
fn mandate_of(w: &World) -> mandate::Mandate {
    w.env.load(&w.mandate)
}
fn copy(k: &Keypair) -> Keypair {
    Keypair::new_from_array(*k.secret_bytes())
}

// ---- the stored deadlines --------------------------------------------------------------------

#[test]
fn deadlines_are_fixed_at_creation() {
    let w = awarded();
    let m = mandate_of(&w);
    assert_eq!(
        m.acceptance_cutoff,
        NOW + 6_300,
        "start - lock buffer - setup window"
    );
    assert_eq!(m.position_lock_at, LOCK_AT, "start - lock buffer");
}

// ---- register_positions ----------------------------------------------------------------------

#[test]
fn registering_stores_the_exact_set_in_order() {
    let mut w = awarded();
    let positions = keys(3);
    let sent = w
        .env
        .register_positions(&w.provider, &w.mandate, positions.clone())
        .expect("register");
    let set = set_of(&w);
    assert_eq!(set.version, mandate::POSITION_SET_VERSION);
    assert_eq!(
        (set.mandate, set.provider, set.position_count, set.locked_at),
        (w.mandate, w.provider.pubkey(), 3, LOCK_AT)
    );
    assert_eq!(
        &set.positions[..3],
        positions.as_slice(),
        "registration order is preserved"
    );
    assert_eq!(
        &set.positions[3..],
        &[Pubkey::default(); 5],
        "unused slots are the default key"
    );
    let events = events::<mandate::events::PositionSetRegistered>(&sent.logs);
    assert_eq!(
        (events[0].positions.clone(), events[0].replaced),
        (positions, false)
    );
    assert_eq!(
        mandate_of(&w).position_set,
        Pubkey::default(),
        "registering does not activate anything"
    );
    assert_eq!(mandate_of(&w).status, MandateStatus::Awarded);
}

#[test]
fn a_set_can_be_replaced_until_the_lock_and_replacement_is_total() {
    let mut w = awarded();
    w.env
        .register_positions(&w.provider, &w.mandate, keys(5))
        .unwrap();
    let replacement = keys(2);
    let sent = w
        .env
        .register_positions(&w.provider, &w.mandate, replacement.clone())
        .expect("replace");
    let set = set_of(&w);
    assert_eq!(set.position_count, 2);
    assert_eq!(&set.positions[..2], replacement.as_slice());
    assert_eq!(
        &set.positions[2..],
        &[Pubkey::default(); 6],
        "no stale keys survive a replacement"
    );
    assert!(events::<mandate::events::PositionSetRegistered>(&sent.logs)[0].replaced);
    assert_eq!(set.locked_at, LOCK_AT);
}

#[test]
fn the_set_is_bounded_unique_and_non_default() {
    let mut w = awarded();
    assert_fails_with(
        w.env.register_positions(&w.provider, &w.mandate, vec![]),
        MandateError::InvalidPositionSet,
    );
    assert_fails_with(
        w.env.register_positions(&w.provider, &w.mandate, keys(9)),
        MandateError::InvalidPositionSet,
    );
    w.env
        .register_positions(&w.provider, &w.mandate, keys(8))
        .expect("the hard cap is 8");
    let dup = keypair().pubkey();
    assert_fails_with(
        w.env
            .register_positions(&w.provider, &w.mandate, vec![dup, keypair().pubkey(), dup]),
        MandateError::DuplicatePosition,
    );
    assert_fails_with(
        w.env.register_positions(
            &w.provider,
            &w.mandate,
            vec![Pubkey::default(), keypair().pubkey()],
        ),
        MandateError::InvalidPositionSet,
    );
    assert_eq!(
        set_of(&w).position_count,
        8,
        "failed attempts leave the last valid set untouched"
    );
}

#[test]
fn a_protocol_limit_below_the_hard_cap_is_enforced() {
    let mut w = awarded();
    w.env
        .update_account::<mandate::ProtocolConfig>(&protocol_pda(), |p| p.max_positions = 2);
    assert_fails_with(
        w.env.register_positions(&w.provider, &w.mandate, keys(3)),
        MandateError::InvalidPositionSet,
    );
    w.env
        .register_positions(&w.provider, &w.mandate, keys(2))
        .expect("within the protocol limit");
}

#[test]
fn only_the_accepted_provider_can_register() {
    let mut w = awarded();
    let stranger = w.env.provider();
    assert_fails_with(
        w.env.register_positions(&stranger, &w.mandate, keys(1)),
        MandateError::UnauthorizedProvider,
    );
    assert_fails_with(
        w.env
            .register_positions(&copy(&w.sponsor), &w.mandate, keys(1)),
        MandateError::UnauthorizedProvider,
    );
    assert_fails_with(
        w.env
            .register_positions(&copy(&w.env.admin), &w.mandate, keys(1)),
        MandateError::UnauthorizedProvider,
    );
    assert!(w.env.account_data(&position_set_pda(&w.mandate)).is_empty());

    // a provider whose bid was not the one accepted has no rights either
    let loser = w.env.provider();
    w.env.update_account::<mandate::Mandate>(&w.mandate, |_| {});
    assert_fails_with(
        w.env.register_positions(&loser, &w.mandate, keys(1)),
        MandateError::UnauthorizedProvider,
    );
}

#[test]
fn the_provider_must_sign() {
    let mut w = awarded();
    let mut ix = w
        .env
        .ix_register_positions(&w.provider.pubkey(), &w.mandate, keys(1));
    ix.accounts[0].is_signer = false;
    assert_fails_with_framework(w.env.send(&[ix], &[]), ErrorCode::AccountNotSigner);
}

#[test]
fn the_mandate_must_be_awarded() {
    // still bidding: nobody is the provider yet
    let mut env = Env::ready();
    let (sponsor, usdc) = env.sponsor_with(5_000 * USDC);
    env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
        .unwrap();
    let mandate = mandate_pda(&sponsor.pubkey(), 1);
    let someone = env.provider();
    assert_fails_with(
        env.register_positions(&someone, &mandate, keys(1)),
        MandateError::MandateNotAwarded,
    );

    // already active: the set is frozen
    let mut w = awarded();
    w.env
        .register_positions(&w.provider, &w.mandate, keys(1))
        .unwrap();
    w.env.warp_time(START);
    w.env.activate(&w.mandate).unwrap();
    assert_fails_with(
        w.env.register_positions(&w.provider, &w.mandate, keys(2)),
        MandateError::MandateNotAwarded,
    );
}

#[test]
fn the_lock_is_exact_to_the_second() {
    let mut w = awarded();
    w.env.warp_time(LOCK_AT - 1);
    w.env
        .register_positions(&w.provider, &w.mandate, keys(1))
        .expect("one second before the lock");
    w.env.warp_time(LOCK_AT);
    assert_fails_with(
        w.env.register_positions(&w.provider, &w.mandate, keys(2)),
        MandateError::PositionSetLocked,
    );
    w.env.warp_time(START + 10_000);
    assert_fails_with(
        w.env.register_positions(&w.provider, &w.mandate, keys(2)),
        MandateError::PositionSetLocked,
    );
    assert_eq!(
        set_of(&w).position_count,
        1,
        "the set that existed at the lock is final"
    );
}

#[test]
fn nothing_can_be_registered_for_the_first_time_after_the_lock() {
    let mut w = awarded();
    w.env.warp_time(LOCK_AT);
    assert_fails_with(
        w.env.register_positions(&w.provider, &w.mandate, keys(1)),
        MandateError::PositionSetLocked,
    );
    assert!(w.env.account_data(&position_set_pda(&w.mandate)).is_empty());
}

#[test]
fn addresses_must_be_derived_from_the_mandate() {
    let mut w = awarded();
    let ix = w.env.ix_register_positions_with(
        &w.provider.pubkey(),
        &w.mandate,
        keypair().pubkey(),
        keys(1),
    );
    assert_fails_with_framework(
        w.env.send(&[ix], &[&copy(&w.provider)]),
        ErrorCode::ConstraintSeeds,
    );
    // another mandate's set address
    let other_set = position_set_pda(&keypair().pubkey());
    let ix = w
        .env
        .ix_register_positions_with(&w.provider.pubkey(), &w.mandate, other_set, keys(1));
    assert_fails_with_framework(
        w.env.send(&[ix], &[&copy(&w.provider)]),
        ErrorCode::ConstraintSeeds,
    );
}

#[test]
fn registration_never_moves_funds() {
    let mut w = awarded();
    let vault = vault_pda(&w.mandate);
    let before = w.env.token_amount(&vault);
    w.env
        .register_positions(&w.provider, &w.mandate, keys(4))
        .unwrap();
    assert_eq!(w.env.token_amount(&vault), before);
}

#[test]
fn pausing_does_not_block_registration() {
    // The award already committed the provider; setting up must remain possible during a pause.
    let mut w = awarded();
    let ix = w.env.ix_set_paused(w.env.admin.pubkey(), true);
    w.env.as_admin(&[ix]).unwrap();
    w.env
        .register_positions(&w.provider, &w.mandate, keys(1))
        .expect("registration finishes an existing commitment");
}

// ---- activate_mandate ------------------------------------------------------------------------

#[test]
fn activation_needs_the_start_time_and_positions_and_is_permissionless() {
    let mut w = awarded();
    w.env
        .register_positions(&w.provider, &w.mandate, keys(2))
        .unwrap();

    w.env.warp_time(START - 1);
    assert_fails_with(w.env.activate(&w.mandate), MandateError::MandateNotStarted);
    w.env.warp_time(START);
    let vault_before = w.env.token_amount(&vault_pda(&w.mandate));
    // the fee payer alone signs: neither sponsor nor provider is involved
    let sent = w.env.activate(&w.mandate).expect("activate");

    let m = mandate_of(&w);
    assert_eq!(m.status, MandateStatus::Active);
    assert_eq!(m.position_set, position_set_pda(&w.mandate));
    assert_eq!(
        w.env.token_amount(&vault_pda(&w.mandate)),
        vault_before,
        "activation moves no funds"
    );
    let events = events::<mandate::events::MandateActivated>(&sent.logs);
    assert_eq!(
        (
            events[0].start_at,
            events[0].activated_at,
            events[0].provider
        ),
        (START, START, w.provider.pubkey())
    );
}

#[test]
fn activation_can_happen_late_and_does_not_need_the_sponsor_or_provider() {
    let mut w = awarded();
    w.env
        .register_positions(&w.provider, &w.mandate, keys(1))
        .unwrap();
    w.env.warp_time(START + 86_400);
    w.env
        .activate(&w.mandate)
        .expect("a bystander can always start a ready mandate");
    assert_eq!(mandate_of(&w).status, MandateStatus::Active);
}

#[test]
fn a_mandate_without_positions_cannot_activate() {
    let mut w = awarded();
    w.env.warp_time(START);
    let result = w.env.activate(&w.mandate);
    assert_fails_with_framework(result, ErrorCode::AccountNotInitialized);
    assert_eq!(mandate_of(&w).status, MandateStatus::Awarded);
}

#[test]
fn another_mandates_position_set_cannot_be_substituted() {
    let mut w = awarded();
    // a second, separately awarded mandate whose provider did register
    w.env
        .create_mandate(
            &copy(&w.sponsor),
            &w.sponsor_usdc,
            w.env.valid_mandate_args(2),
        )
        .unwrap();
    let other = mandate_pda(&w.sponsor.pubkey(), 2);
    let other_provider = w.env.provider();
    w.env
        .submit_bid(&other_provider, &other, 1, 800 * USDC, NOW + 5_000)
        .unwrap();
    w.env
        .accept_bid(
            &copy(&w.sponsor),
            &other,
            &bid_pda(&other, &other_provider.pubkey(), 1),
        )
        .unwrap();
    w.env
        .register_positions(&other_provider, &other, keys(2))
        .unwrap();

    w.env.warp_time(START);
    let ix = w.env.ix_activate_with(&w.mandate, position_set_pda(&other));
    assert_fails_with_framework(w.env.send(&[ix], &[]), ErrorCode::ConstraintSeeds);
    assert_eq!(mandate_of(&w).status, MandateStatus::Awarded);
}

#[test]
fn only_an_awarded_mandate_can_activate_and_only_once() {
    let mut w = awarded();
    w.env
        .register_positions(&w.provider, &w.mandate, keys(1))
        .unwrap();
    w.env.warp_time(START);
    w.env.activate(&w.mandate).unwrap();
    let after = w.env.account_data(&w.mandate);
    assert_fails_with(w.env.activate(&w.mandate), MandateError::MandateNotAwarded);
    assert_eq!(
        w.env.account_data(&w.mandate),
        after,
        "a second activation changes nothing"
    );

    // a mandate still bidding cannot be activated
    let mut env = Env::ready();
    let (sponsor, usdc) = env.sponsor_with(5_000 * USDC);
    env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
        .unwrap();
    env.warp_time(START);
    let bidding = mandate_pda(&sponsor.pubkey(), 1);
    assert!(
        env.activate(&bidding).is_err(),
        "a mandate that was never awarded cannot start"
    );
    let unchanged: mandate::Mandate = env.load(&bidding);
    assert_eq!(unchanged.status, MandateStatus::Bidding);
}

#[test]
fn a_pause_does_not_block_activation() {
    let mut w = awarded();
    w.env
        .register_positions(&w.provider, &w.mandate, keys(1))
        .unwrap();
    let ix = w.env.ix_set_paused(w.env.admin.pubkey(), true);
    w.env.as_admin(&[ix]).unwrap();
    w.env.warp_time(START);
    w.env
        .activate(&w.mandate)
        .expect("activation finishes a commitment already made");
}

#[test]
fn after_activation_the_awarded_terms_and_set_are_immutable() {
    let mut w = awarded();
    let positions = keys(3);
    w.env
        .register_positions(&w.provider, &w.mandate, positions.clone())
        .unwrap();
    w.env.warp_time(START);
    w.env.activate(&w.mandate).unwrap();
    assert_eq!(&set_of(&w).positions[..3], positions.as_slice());
    assert_fails_with(
        w.env.register_positions(&w.provider, &w.mandate, keys(1)),
        MandateError::MandateNotAwarded,
    );
    assert_eq!(
        &set_of(&w).positions[..3],
        positions.as_slice(),
        "the registered set never changes once the mandate is live"
    );
}

// ---- refund_unactivated_mandate --------------------------------------------------------------

#[test]
fn a_provider_who_never_registers_leaves_the_sponsor_a_way_out() {
    let mut w = awarded();
    let vault = vault_pda(&w.mandate);
    let sponsor_before = w.env.token_amount(&w.sponsor_usdc);
    w.env.warp_time(LOCK_AT);
    let sent = w
        .env
        .refund_unactivated(&w.sponsor, &w.mandate, &w.sponsor_usdc)
        .expect("refund");

    assert_eq!(
        w.env.token_amount(&w.sponsor_usdc),
        sponsor_before + MAX,
        "the whole escrow returns, including the reserved part"
    );
    assert!(w.env.account_data(&vault).is_empty(), "the vault is closed");
    let m = mandate_of(&w);
    assert_eq!(m.status, MandateStatus::Cancelled);
    assert_eq!(
        m.sponsor_withdrawn_raw, m.max_reward_raw,
        "everything the sponsor put in has come back"
    );
    assert_eq!(m.claimed_reward_raw, 0, "the provider earned nothing");
    let events = events::<mandate::events::UnactivatedMandateRefunded>(&sent.logs);
    assert_eq!(events[0].refunded_raw, MAX);
}

#[test]
fn the_refund_accounts_for_surplus_already_withdrawn() {
    let mut w = awarded();
    w.env
        .withdraw_surplus(&copy(&w.sponsor), &w.mandate, &w.sponsor_usdc, 100 * USDC)
        .unwrap();
    w.env.warp_time(LOCK_AT);
    w.env
        .refund_unactivated(&w.sponsor, &w.mandate, &w.sponsor_usdc)
        .unwrap();
    assert_eq!(
        w.env.token_amount(&w.sponsor_usdc),
        5_000 * USDC,
        "sponsor is made exactly whole: nothing lost, nothing gained"
    );
    assert_eq!(mandate_of(&w).sponsor_withdrawn_raw, MAX);
}

#[test]
fn the_refund_is_impossible_while_the_provider_can_still_register() {
    let mut w = awarded();
    w.env.warp_time(LOCK_AT - 1);
    assert_fails_with(
        w.env
            .refund_unactivated(&w.sponsor, &w.mandate, &w.sponsor_usdc),
        MandateError::PositionWindowOpen,
    );
    assert_eq!(w.env.token_amount(&vault_pda(&w.mandate)), MAX);
}

#[test]
fn the_refund_is_impossible_once_any_positions_are_registered() {
    let mut w = awarded();
    w.env
        .register_positions(&w.provider, &w.mandate, keys(1))
        .unwrap();
    w.env.warp_time(LOCK_AT);
    assert_fails_with(
        w.env
            .refund_unactivated(&w.sponsor, &w.mandate, &w.sponsor_usdc),
        MandateError::PositionSetExists,
    );
    assert_eq!(
        w.env.token_amount(&vault_pda(&w.mandate)),
        MAX,
        "a provider who registered is not abandoned by the sponsor"
    );
    // and the mandate can still start
    w.env.warp_time(START);
    w.env.activate(&w.mandate).expect("activate");
}

#[test]
fn only_the_sponsor_can_refund() {
    let mut w = awarded();
    w.env.warp_time(LOCK_AT);
    let provider_usdc = w.env.add_token_account(&w.provider.pubkey(), 0);
    assert_fails_with(
        w.env
            .refund_unactivated(&w.provider, &w.mandate, &provider_usdc),
        MandateError::UnauthorizedSponsor,
    );
    let admin = copy(&w.env.admin);
    let admin_usdc = w.env.add_token_account(&admin.pubkey(), 0);
    assert_fails_with(
        w.env.refund_unactivated(&admin, &w.mandate, &admin_usdc),
        MandateError::UnauthorizedSponsor,
    );
    // and only to the sponsor's own account
    let ix = w
        .env
        .ix_refund_unactivated(&w.sponsor.pubkey(), &w.mandate, &provider_usdc);
    assert_fails_with_framework(
        w.env.send(&[ix], &[&copy(&w.sponsor)]),
        ErrorCode::ConstraintTokenOwner,
    );
    assert_eq!(w.env.token_amount(&vault_pda(&w.mandate)), MAX);
}

#[test]
fn the_sponsor_must_sign_the_refund() {
    let mut w = awarded();
    w.env.warp_time(LOCK_AT);
    let mut ix = w
        .env
        .ix_refund_unactivated(&w.sponsor.pubkey(), &w.mandate, &w.sponsor_usdc);
    ix.accounts[0].is_signer = false;
    assert_fails_with_framework(w.env.send(&[ix], &[]), ErrorCode::AccountNotSigner);
}

#[test]
fn the_refund_applies_only_to_awarded_mandates_and_only_once() {
    let mut w = awarded();
    w.env.warp_time(LOCK_AT);
    w.env
        .refund_unactivated(&w.sponsor, &w.mandate, &w.sponsor_usdc)
        .unwrap();
    assert!(
        w.env
            .refund_unactivated(&w.sponsor, &w.mandate, &w.sponsor_usdc)
            .is_err(),
        "no double refund"
    );
    assert_eq!(w.env.token_amount(&w.sponsor_usdc), 5_000 * USDC);

    // an unawarded mandate uses cancel_unawarded_mandate instead
    let mut env = Env::ready();
    let (sponsor, usdc) = env.sponsor_with(5_000 * USDC);
    env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
        .unwrap();
    let bidding = mandate_pda(&sponsor.pubkey(), 1);
    env.warp_time(LOCK_AT);
    assert_fails_with(
        env.refund_unactivated(&sponsor, &bidding, &usdc),
        MandateError::MandateNotAwarded,
    );

    // an active mandate can never be refunded this way
    let mut w = awarded();
    w.env
        .register_positions(&w.provider, &w.mandate, keys(1))
        .unwrap();
    w.env.warp_time(START);
    w.env.activate(&w.mandate).unwrap();
    assert_fails_with(
        w.env
            .refund_unactivated(&w.sponsor, &w.mandate, &w.sponsor_usdc),
        MandateError::MandateNotAwarded,
    );
}

#[test]
fn a_pause_never_traps_the_refund() {
    let mut w = awarded();
    let ix = w.env.ix_set_paused(w.env.admin.pubkey(), true);
    w.env.as_admin(&[ix]).unwrap();
    w.env.warp_time(LOCK_AT);
    w.env
        .refund_unactivated(&w.sponsor, &w.mandate, &w.sponsor_usdc)
        .expect("refunds are never gated on the pause flag");
}

#[test]
fn a_refunded_mandate_releases_its_bids() {
    let mut w = awarded();
    w.env.warp_time(LOCK_AT);
    w.env
        .refund_unactivated(&w.sponsor, &w.mandate, &w.sponsor_usdc)
        .unwrap();
    // the accepted bid stays a record; a losing bid on another mandate is unaffected. The mandate is void:
    assert_fails_with(
        w.env.register_positions(&w.provider, &w.mandate, keys(1)),
        MandateError::MandateNotAwarded,
    );
    w.env.warp_time(START);
    assert!(
        w.env.activate(&w.mandate).is_err(),
        "a voided mandate can never start"
    );
    assert_eq!(mandate_of(&w).status, MandateStatus::Cancelled);
}
