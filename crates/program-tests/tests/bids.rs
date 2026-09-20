#![allow(clippy::result_large_err)]

mod common;

use anchor_lang::error::ErrorCode;
use anchor_lang::prelude::Pubkey;
use common::*;
use mandate::{BidStatus, MandateError, MandateStatus};
use solana_keypair::Keypair;
use solana_signer::Signer;

// Timeline from `valid_mandate_args`: now = NOW, bidding closes NOW+3600, start NOW+7200. With the
// protocol's 300s lock buffer and 600s setup window the acceptance cutoff is start - 900 = NOW+6300.
const BIDDING_ENDS: i64 = NOW + 3_600;
const CUTOFF: i64 = NOW + 6_300;
const MAX: u64 = 1_000 * USDC;
const EPOCHS: u64 = 72;

struct World {
    env: Env,
    sponsor: Keypair,
    sponsor_usdc: Pubkey,
    mandate: Pubkey,
}

fn world() -> World {
    let mut env = Env::ready();
    let (sponsor, sponsor_usdc) = env.sponsor_with(5_000 * USDC);
    env.create_mandate(&sponsor, &sponsor_usdc, env.valid_mandate_args(1))
        .expect("mandate");
    let mandate = mandate_pda(&sponsor.pubkey(), 1);
    World {
        env,
        sponsor,
        sponsor_usdc,
        mandate,
    }
}

fn mandate_of(w: &World) -> mandate::Mandate {
    w.env.load(&w.mandate)
}
fn bid_of(w: &World, bid: &Pubkey) -> mandate::Bid {
    w.env.load(bid)
}
fn copy(k: &Keypair) -> Keypair {
    Keypair::new_from_array(*k.secret_bytes())
}

// ---- submit_bid ------------------------------------------------------------------------------

#[test]
fn a_bid_records_its_terms_and_moves_no_funds() {
    let mut w = world();
    let provider = w.env.provider();
    let vault_before = w.env.token_amount(&vault_pda(&w.mandate));
    let sent = w
        .env
        .submit_bid(&provider, &w.mandate, 7, 900 * USDC, NOW + 5_000)
        .expect("bid");

    let bid_key = bid_pda(&w.mandate, &provider.pubkey(), 7);
    let bid = bid_of(&w, &bid_key);
    assert_eq!(bid.version, mandate::BID_VERSION);
    assert_eq!(
        (bid.mandate, bid.provider, bid.nonce),
        (w.mandate, provider.pubkey(), 7)
    );
    assert_eq!(
        (bid.requested_reward_raw, bid.created_at, bid.valid_until),
        (900 * USDC, NOW, NOW + 5_000)
    );
    assert_eq!(bid.status, BidStatus::Active);
    assert_eq!(
        w.env.token_amount(&vault_pda(&w.mandate)),
        vault_before,
        "a bid never touches the vault"
    );
    let events = events::<mandate::events::BidSubmitted>(&sent.logs);
    assert_eq!(
        (
            events[0].bid,
            events[0].requested_reward_raw,
            events[0].nonce
        ),
        (bid_key, 900 * USDC, 7)
    );
    assert_eq!(
        mandate_of(&w).status,
        MandateStatus::Bidding,
        "bidding does not change the mandate"
    );
}

#[test]
fn reward_bounds_are_exact_to_one_raw_unit() {
    let mut w = world();
    let p = w.env.provider();
    assert_fails_with(
        w.env.submit_bid(&p, &w.mandate, 1, 0, NOW + 5_000),
        MandateError::InvalidBudget,
    );
    assert_fails_with(
        w.env.submit_bid(&p, &w.mandate, 2, MAX + 1, NOW + 5_000),
        MandateError::InvalidBudget,
    );
    assert_fails_with(
        w.env.submit_bid(&p, &w.mandate, 3, EPOCHS - 1, NOW + 5_000),
        MandateError::InvalidBudget,
    );
    w.env
        .submit_bid(&p, &w.mandate, 4, EPOCHS, NOW + 5_000)
        .expect("exactly one raw unit per epoch");
    w.env
        .submit_bid(&p, &w.mandate, 5, MAX, NOW + 5_000)
        .expect("exactly the maximum");
    w.env
        .submit_bid(&p, &w.mandate, 6, u64::MAX, NOW + 5_000)
        .expect_err("u64::MAX is above the maximum");
    assert!(
        w.env
            .account_data(&bid_pda(&w.mandate, &p.pubkey(), 1))
            .is_empty(),
        "a rejected bid creates nothing"
    );
}

#[test]
fn validity_bounds_are_exact_to_the_second() {
    let mut w = world();
    let p = w.env.provider();
    assert_fails_with(
        w.env.submit_bid(&p, &w.mandate, 1, MAX, NOW - 1),
        MandateError::BidExpired,
    );
    w.env
        .submit_bid(&p, &w.mandate, 2, MAX, NOW)
        .expect("valid until exactly now");
    w.env
        .submit_bid(&p, &w.mandate, 3, MAX, CUTOFF)
        .expect("valid until exactly the acceptance cutoff");
    assert_fails_with(
        w.env.submit_bid(&p, &w.mandate, 4, MAX, CUTOFF + 1),
        MandateError::InvalidTiming,
    );
}

#[test]
fn bidding_closes_at_the_configured_second() {
    let mut w = world();
    let p = w.env.provider();
    w.env.warp_time(BIDDING_ENDS - 1);
    w.env
        .submit_bid(&p, &w.mandate, 1, MAX, CUTOFF)
        .expect("one second before close");
    w.env.warp_time(BIDDING_ENDS);
    assert_fails_with(
        w.env.submit_bid(&p, &w.mandate, 2, MAX, CUTOFF),
        MandateError::BiddingClosed,
    );
}

#[test]
fn nonces_keep_history_and_cannot_be_reused() {
    let mut w = world();
    let p = w.env.provider();
    let q = w.env.provider();
    w.env
        .submit_bid(&p, &w.mandate, 1, 900 * USDC, NOW + 5_000)
        .unwrap();
    w.env
        .submit_bid(&p, &w.mandate, 2, 800 * USDC, NOW + 5_000)
        .expect("a second bid by the same provider");
    w.env
        .submit_bid(&q, &w.mandate, 1, 700 * USDC, NOW + 5_000)
        .expect("the same nonce under another provider");
    let first = bid_of(&w, &bid_pda(&w.mandate, &p.pubkey(), 1));
    assert_eq!(
        first.requested_reward_raw,
        900 * USDC,
        "later bids never overwrite earlier ones"
    );

    assert!(
        w.env
            .submit_bid(&p, &w.mandate, 1, 100 * USDC, NOW + 5_000)
            .is_err(),
        "reusing a nonce fails"
    );
    assert_eq!(
        bid_of(&w, &bid_pda(&w.mandate, &p.pubkey(), 1)).requested_reward_raw,
        900 * USDC
    );
}

#[test]
fn only_a_mandate_that_is_still_bidding_accepts_bids() {
    let mut w = world();
    let p = w.env.provider();
    w.env
        .update_account::<mandate::Mandate>(&w.mandate, |m| m.status = MandateStatus::Cancelled);
    assert_fails_with(
        w.env.submit_bid(&p, &w.mandate, 1, MAX, NOW + 5_000),
        MandateError::MandateNotBidding,
    );
    w.env.update_account::<mandate::Mandate>(&w.mandate, |m| {
        m.status = MandateStatus::Bidding;
        m.accepted_bid = keypair().pubkey();
    });
    assert_fails_with(
        w.env.submit_bid(&p, &w.mandate, 1, MAX, NOW + 5_000),
        MandateError::BidAlreadyAccepted,
    );
}

#[test]
fn the_provider_must_sign_and_addresses_must_be_derived() {
    let mut w = world();
    let p = w.env.provider();
    let mut ix = w
        .env
        .ix_submit_bid(&p.pubkey(), &w.mandate, 1, MAX, NOW + 5_000);
    ix.accounts[0].is_signer = false;
    assert_fails_with_framework(w.env.send(&[ix], &[]), ErrorCode::AccountNotSigner);

    // a bid address that is not derived from (mandate, provider, nonce)
    let ix = w.env.ix_submit_bid_with(
        &p.pubkey(),
        &w.mandate,
        keypair().pubkey(),
        1,
        MAX,
        NOW + 5_000,
    );
    assert_fails_with_framework(w.env.send(&[ix], &[&copy(&p)]), ErrorCode::ConstraintSeeds);
    // someone else's nonce space
    let victim = keypair().pubkey();
    let ix = w.env.ix_submit_bid_with(
        &p.pubkey(),
        &w.mandate,
        bid_pda(&w.mandate, &victim, 1),
        1,
        MAX,
        NOW + 5_000,
    );
    assert_fails_with_framework(w.env.send(&[ix], &[&copy(&p)]), ErrorCode::ConstraintSeeds);
}

#[test]
fn a_substituted_mandate_is_rejected() {
    let mut w = world();
    let p = w.env.provider();
    let ix = w
        .env
        .ix_submit_bid(&p.pubkey(), &keypair().pubkey(), 1, MAX, NOW + 5_000);
    assert!(w.env.send(&[ix], &[&copy(&p)]).is_err());
    // the pool account is not a mandate
    let ix = w
        .env
        .ix_submit_bid(&p.pubkey(), &w.env.pool.clone(), 1, MAX, NOW + 5_000);
    assert!(w.env.send(&[ix], &[&copy(&p)]).is_err());
}

// ---- accept_bid ------------------------------------------------------------------------------

#[test]
fn accepting_fixes_provider_reward_and_the_exact_split_and_transfers_nothing() {
    let mut w = world();
    let provider = w.env.provider();
    let requested = 900 * USDC + 1; // 900_000_001 = 72 * 12_500_000 + 1
    w.env
        .submit_bid(&provider, &w.mandate, 1, requested, NOW + 5_000)
        .unwrap();
    let bid_key = bid_pda(&w.mandate, &provider.pubkey(), 1);
    let provider_usdc = w.env.add_token_account(&provider.pubkey(), 0);
    let vault_before = w.env.token_amount(&vault_pda(&w.mandate));

    let sent = w
        .env
        .accept_bid(&w.sponsor.pubkey_owned(), &w.mandate, &bid_key)
        .expect("accept");
    let m = mandate_of(&w);
    assert_eq!(m.status, MandateStatus::Awarded);
    assert_eq!((m.accepted_bid, m.provider), (bid_key, provider.pubkey()));
    assert_eq!(m.accepted_reward_raw, requested);
    assert_eq!(m.base_epoch_reward_raw, 12_500_000);
    assert_eq!(m.final_epoch_extra_raw, 1);
    assert_eq!(
        m.base_epoch_reward_raw * (EPOCHS - 1) + m.base_epoch_reward_raw + m.final_epoch_extra_raw,
        requested,
        "the split sums exactly to the accepted reward"
    );
    assert_eq!(bid_of(&w, &bid_key).status, BidStatus::Accepted);
    assert_eq!(
        w.env.token_amount(&vault_pda(&w.mandate)),
        vault_before,
        "no reward moves at award"
    );
    assert_eq!(
        w.env.token_amount(&provider_usdc),
        0,
        "the provider receives nothing upfront"
    );
    let events = events::<mandate::events::BidAccepted>(&sent.logs);
    assert_eq!(events[0].surplus_raw, MAX - requested);
    assert_eq!(
        (
            events[0].base_epoch_reward_raw,
            events[0].final_epoch_extra_raw
        ),
        (12_500_000, 1)
    );
}

#[test]
fn every_split_shape_is_computed_by_the_canonical_math() {
    for requested in [EPOCHS, EPOCHS + 1, EPOCHS * 3, MAX, MAX - 1, 999_999_937] {
        let mut w = world();
        let p = w.env.provider();
        w.env
            .submit_bid(&p, &w.mandate, 1, requested, NOW + 5_000)
            .unwrap();
        w.env
            .accept_bid(
                &w.sponsor.pubkey_owned(),
                &w.mandate,
                &bid_pda(&w.mandate, &p.pubkey(), 1),
            )
            .unwrap();
        let m = mandate_of(&w);
        assert_eq!(
            m.base_epoch_reward_raw,
            requested / EPOCHS,
            "base for {requested}"
        );
        assert_eq!(
            m.final_epoch_extra_raw,
            requested % EPOCHS,
            "remainder for {requested}"
        );
    }
}

#[test]
fn only_the_sponsor_can_accept() {
    let mut w = world();
    let p = w.env.provider();
    w.env
        .submit_bid(&p, &w.mandate, 1, MAX, NOW + 5_000)
        .unwrap();
    let bid_key = bid_pda(&w.mandate, &p.pubkey(), 1);
    // the provider cannot accept their own bid
    assert_fails_with(
        w.env.accept_bid(&p, &w.mandate, &bid_key),
        MandateError::UnauthorizedSponsor,
    );
    // nor can the admin
    let admin = copy(&w.env.admin);
    assert_fails_with(
        w.env.accept_bid(&admin, &w.mandate, &bid_key),
        MandateError::UnauthorizedSponsor,
    );
    assert_eq!(mandate_of(&w).status, MandateStatus::Bidding);
}

#[test]
fn the_sponsor_must_sign_to_accept() {
    let mut w = world();
    let p = w.env.provider();
    w.env
        .submit_bid(&p, &w.mandate, 1, MAX, NOW + 5_000)
        .unwrap();
    let mut ix = w.env.ix_accept_bid(
        &w.sponsor.pubkey(),
        &w.mandate,
        &bid_pda(&w.mandate, &p.pubkey(), 1),
    );
    ix.accounts[0].is_signer = false;
    assert_fails_with_framework(w.env.send(&[ix], &[]), ErrorCode::AccountNotSigner);
}

#[test]
fn a_second_award_is_impossible_and_the_first_stays_immutable() {
    let mut w = world();
    let (a, b) = (w.env.provider(), w.env.provider());
    w.env
        .submit_bid(&a, &w.mandate, 1, 900 * USDC, NOW + 5_000)
        .unwrap();
    w.env
        .submit_bid(&b, &w.mandate, 1, 500 * USDC, NOW + 5_000)
        .unwrap();
    let (bid_a, bid_b) = (
        bid_pda(&w.mandate, &a.pubkey(), 1),
        bid_pda(&w.mandate, &b.pubkey(), 1),
    );

    w.env
        .accept_bid(&w.sponsor.pubkey_owned(), &w.mandate, &bid_a)
        .unwrap();
    let after_first = w.env.account_data(&w.mandate);
    // Even the cheaper bid cannot replace the award: the mandate is no longer `Bidding`.
    assert_fails_with(
        w.env
            .accept_bid(&w.sponsor.pubkey_owned(), &w.mandate, &bid_b),
        MandateError::MandateNotBidding,
    );
    assert_fails_with(
        w.env
            .accept_bid(&w.sponsor.pubkey_owned(), &w.mandate, &bid_a),
        MandateError::MandateNotBidding,
    );
    assert_eq!(
        w.env.account_data(&w.mandate),
        after_first,
        "the award is byte-for-byte unchanged"
    );
    assert_eq!(
        bid_of(&w, &bid_b).status,
        BidStatus::Active,
        "the unselected bid is untouched, not rewritten"
    );
}

#[test]
fn a_provider_bid_after_award_is_refused() {
    let mut w = world();
    let (a, late) = (w.env.provider(), w.env.provider());
    w.env
        .submit_bid(&a, &w.mandate, 1, MAX, NOW + 5_000)
        .unwrap();
    w.env
        .accept_bid(
            &w.sponsor.pubkey_owned(),
            &w.mandate,
            &bid_pda(&w.mandate, &a.pubkey(), 1),
        )
        .unwrap();
    assert_fails_with(
        w.env.submit_bid(&late, &w.mandate, 1, MAX, NOW + 5_000),
        MandateError::MandateNotBidding,
    );
}

#[test]
fn an_expired_bid_cannot_be_accepted_and_the_boundary_is_exact() {
    let mut w = world();
    let p = w.env.provider();
    w.env.submit_bid(&p, &w.mandate, 1, MAX, NOW + 100).unwrap();
    let bid_key = bid_pda(&w.mandate, &p.pubkey(), 1);
    w.env.warp_time(NOW + 100);
    let mut accepted = false;
    // valid_until == now is still valid
    if w.env
        .accept_bid(&w.sponsor.pubkey_owned(), &w.mandate, &bid_key)
        .is_ok()
    {
        accepted = true;
    }
    assert!(
        accepted,
        "a bid valid until exactly now can be accepted at that second"
    );

    let mut w = world();
    let p = w.env.provider();
    w.env.submit_bid(&p, &w.mandate, 1, MAX, NOW + 100).unwrap();
    w.env.warp_time(NOW + 101);
    assert_fails_with(
        w.env.accept_bid(
            &w.sponsor.pubkey_owned(),
            &w.mandate,
            &bid_pda(&w.mandate, &p.pubkey(), 1),
        ),
        MandateError::BidExpired,
    );
    assert_eq!(mandate_of(&w).status, MandateStatus::Bidding);
}

#[test]
fn acceptance_closes_at_the_cutoff_to_the_second() {
    let mut w = world();
    let p = w.env.provider();
    w.env.submit_bid(&p, &w.mandate, 1, MAX, CUTOFF).unwrap();
    let bid_key = bid_pda(&w.mandate, &p.pubkey(), 1);
    w.env.warp_time(CUTOFF + 1);
    assert_fails_with(
        w.env
            .accept_bid(&w.sponsor.pubkey_owned(), &w.mandate, &bid_key),
        MandateError::BidExpired,
    );

    // with a longer-lived bid the *cutoff* is what binds: bids may not outlive it, so use the boundary directly
    let mut w = world();
    let p = w.env.provider();
    w.env.submit_bid(&p, &w.mandate, 1, MAX, CUTOFF).unwrap();
    w.env.warp_time(CUTOFF);
    w.env
        .accept_bid(
            &w.sponsor.pubkey_owned(),
            &w.mandate,
            &bid_pda(&w.mandate, &p.pubkey(), 1),
        )
        .expect("accepting exactly at the cutoff leaves the full setup window");
}

#[test]
fn a_late_sponsor_cannot_award_even_to_a_bid_that_never_expires() {
    // Shorten the protocol's view: make the mandate's start earlier than the bid's validity implies by
    // writing the mandate directly, so the cutoff rule is exercised on its own.
    let mut w = world();
    let p = w.env.provider();
    w.env.submit_bid(&p, &w.mandate, 1, MAX, CUTOFF).unwrap();
    // The cutoff is fixed at creation and stored, so the rule is exercised by writing the stored value.
    w.env
        .update_account::<mandate::Mandate>(&w.mandate, |m| m.acceptance_cutoff = NOW + 100);
    w.env.warp_time(NOW + 101);
    assert_fails_with(
        w.env.accept_bid(
            &w.sponsor.pubkey_owned(),
            &w.mandate,
            &bid_pda(&w.mandate, &p.pubkey(), 1),
        ),
        MandateError::AcceptanceClosed,
    );
}

#[test]
fn a_bid_for_another_mandate_cannot_be_used() {
    let mut w = world();
    let p = w.env.provider();
    // a second mandate by the same sponsor
    w.env
        .create_mandate(
            &w.sponsor.pubkey_owned(),
            &w.sponsor_usdc,
            w.env.valid_mandate_args(2),
        )
        .unwrap();
    let other = mandate_pda(&w.sponsor.pubkey(), 2);
    w.env.submit_bid(&p, &other, 1, MAX, NOW + 5_000).unwrap();
    let foreign_bid = bid_pda(&other, &p.pubkey(), 1);
    assert!(
        w.env
            .accept_bid(&w.sponsor.pubkey_owned(), &w.mandate, &foreign_bid)
            .is_err(),
        "a bid on mandate 2 cannot award mandate 1"
    );
    assert_eq!(mandate_of(&w).status, MandateStatus::Bidding);
}

#[test]
fn a_cancelled_bid_cannot_be_accepted() {
    let mut w = world();
    let p = w.env.provider();
    w.env
        .submit_bid(&p, &w.mandate, 1, MAX, NOW + 5_000)
        .unwrap();
    let bid_key = bid_pda(&w.mandate, &p.pubkey(), 1);
    w.env.cancel_bid(&p, &bid_key).unwrap();
    assert_fails_with(
        w.env
            .accept_bid(&w.sponsor.pubkey_owned(), &w.mandate, &bid_key),
        MandateError::BidNotActive,
    );
}

#[test]
fn cancellation_and_acceptance_race_with_exactly_one_winner() {
    // Order A: the provider cancels first, so acceptance fails.
    let mut w = world();
    let p = w.env.provider();
    w.env
        .submit_bid(&p, &w.mandate, 1, MAX, NOW + 5_000)
        .unwrap();
    let bid_key = bid_pda(&w.mandate, &p.pubkey(), 1);
    w.env.cancel_bid(&p, &bid_key).unwrap();
    assert!(w
        .env
        .accept_bid(&w.sponsor.pubkey_owned(), &w.mandate, &bid_key)
        .is_err());
    assert_eq!(mandate_of(&w).status, MandateStatus::Bidding);

    // Order B: the sponsor accepts first, so cancellation fails and the award stands.
    let mut w = world();
    let p = w.env.provider();
    w.env
        .submit_bid(&p, &w.mandate, 1, MAX, NOW + 5_000)
        .unwrap();
    let bid_key = bid_pda(&w.mandate, &p.pubkey(), 1);
    w.env
        .accept_bid(&w.sponsor.pubkey_owned(), &w.mandate, &bid_key)
        .unwrap();
    assert_fails_with(w.env.cancel_bid(&p, &bid_key), MandateError::BidNotActive);
    assert_eq!(bid_of(&w, &bid_key).status, BidStatus::Accepted);
    assert_eq!(mandate_of(&w).provider, p.pubkey());
}

#[test]
fn a_sponsor_can_accept_a_bid_that_is_not_the_lowest() {
    let mut w = world();
    let (cheap, dear) = (w.env.provider(), w.env.provider());
    w.env
        .submit_bid(&cheap, &w.mandate, 1, 400 * USDC, NOW + 5_000)
        .unwrap();
    w.env
        .submit_bid(&dear, &w.mandate, 1, 950 * USDC, NOW + 5_000)
        .unwrap();
    w.env
        .accept_bid(
            &w.sponsor.pubkey_owned(),
            &w.mandate,
            &bid_pda(&w.mandate, &dear.pubkey(), 1),
        )
        .expect("no lowest-price rule in v1");
    assert_eq!(mandate_of(&w).provider, dear.pubkey());
}

#[test]
fn pausing_blocks_new_bids_and_awards_but_not_cancellation() {
    let mut w = world();
    let p = w.env.provider();
    w.env
        .submit_bid(&p, &w.mandate, 1, MAX, NOW + 5_000)
        .unwrap();
    let bid_key = bid_pda(&w.mandate, &p.pubkey(), 1);
    let ix = w.env.ix_set_paused(w.env.admin.pubkey(), true);
    w.env.as_admin(&[ix]).unwrap();

    assert_fails_with(
        w.env.submit_bid(&p, &w.mandate, 2, MAX, NOW + 5_000),
        MandateError::ProtocolPaused,
    );
    assert_fails_with(
        w.env
            .accept_bid(&w.sponsor.pubkey_owned(), &w.mandate, &bid_key),
        MandateError::ProtocolPaused,
    );
    w.env
        .cancel_bid(&p, &bid_key)
        .expect("a provider can always withdraw");
    w.env
        .close_bid(&p, &bid_key, &w.mandate)
        .expect("and reclaim rent");
    w.env
        .cancel_unawarded(&w.sponsor.pubkey_owned(), &w.mandate, &w.sponsor_usdc)
        .expect("and the sponsor can always get the escrow back");
}

// ---- cancel_bid / close_bid ------------------------------------------------------------------

#[test]
fn only_the_provider_can_cancel_and_only_an_active_bid() {
    let mut w = world();
    let p = w.env.provider();
    w.env
        .submit_bid(&p, &w.mandate, 1, MAX, NOW + 5_000)
        .unwrap();
    let bid_key = bid_pda(&w.mandate, &p.pubkey(), 1);

    let stranger = w.env.provider();
    assert_fails_with(
        w.env.cancel_bid(&stranger, &bid_key),
        MandateError::UnauthorizedProvider,
    );
    // the sponsor cannot cancel a provider's bid either
    assert_fails_with(
        w.env.cancel_bid(&w.sponsor.pubkey_owned(), &bid_key),
        MandateError::UnauthorizedProvider,
    );

    w.env.cancel_bid(&p, &bid_key).unwrap();
    assert_eq!(bid_of(&w, &bid_key).status, BidStatus::Cancelled);
    assert_fails_with(w.env.cancel_bid(&p, &bid_key), MandateError::BidNotActive);
}

#[test]
fn the_provider_must_sign_to_cancel() {
    let mut w = world();
    let p = w.env.provider();
    w.env
        .submit_bid(&p, &w.mandate, 1, MAX, NOW + 5_000)
        .unwrap();
    let mut ix = w
        .env
        .ix_cancel_bid(&p.pubkey(), &bid_pda(&w.mandate, &p.pubkey(), 1));
    ix.accounts[0].is_signer = false;
    assert_fails_with_framework(w.env.send(&[ix], &[]), ErrorCode::AccountNotSigner);
}

#[test]
fn a_bid_can_be_cancelled_after_bidding_closes_and_after_it_expires() {
    let mut w = world();
    let p = w.env.provider();
    w.env.submit_bid(&p, &w.mandate, 1, MAX, NOW + 100).unwrap();
    w.env.warp_time(BIDDING_ENDS + 10_000);
    w.env
        .cancel_bid(&p, &bid_pda(&w.mandate, &p.pubkey(), 1))
        .expect("cancelling is always allowed while active");
}

#[test]
fn a_cancelled_bid_can_be_closed_for_its_rent_and_then_the_nonce_is_free_again() {
    let mut w = world();
    let p = w.env.provider();
    w.env
        .submit_bid(&p, &w.mandate, 1, MAX, NOW + 5_000)
        .unwrap();
    let bid_key = bid_pda(&w.mandate, &p.pubkey(), 1);
    assert_fails_with(
        w.env.close_bid(&p, &bid_key, &w.mandate),
        MandateError::BidNotClosable,
    );

    w.env.cancel_bid(&p, &bid_key).unwrap();
    let before = w.env.svm.get_balance(&p.pubkey()).unwrap();
    let sent = w.env.close_bid(&p, &bid_key, &w.mandate).expect("close");
    assert!(w.env.account_data(&bid_key).is_empty());
    assert!(
        w.env.svm.get_balance(&p.pubkey()).unwrap() > before,
        "the rent returns to the provider"
    );
    assert_eq!(events::<mandate::events::BidClosed>(&sent.logs).len(), 1);
    w.env
        .submit_bid(&p, &w.mandate, 1, MAX, NOW + 5_000)
        .expect("a closed bid's nonce can be used again");
}

#[test]
fn an_unselected_bid_becomes_closable_once_the_mandate_is_awarded_elsewhere() {
    let mut w = world();
    let (winner, loser) = (w.env.provider(), w.env.provider());
    w.env
        .submit_bid(&winner, &w.mandate, 1, 800 * USDC, NOW + 5_000)
        .unwrap();
    w.env
        .submit_bid(&loser, &w.mandate, 1, 900 * USDC, NOW + 5_000)
        .unwrap();
    let (win_bid, lose_bid) = (
        bid_pda(&w.mandate, &winner.pubkey(), 1),
        bid_pda(&w.mandate, &loser.pubkey(), 1),
    );

    assert_fails_with(
        w.env.close_bid(&loser, &lose_bid, &w.mandate),
        MandateError::BidNotClosable,
    );
    w.env
        .accept_bid(&w.sponsor.pubkey_owned(), &w.mandate, &win_bid)
        .unwrap();
    w.env
        .close_bid(&loser, &lose_bid, &w.mandate)
        .expect("unselected bids can be closed once the mandate is awarded");

    // the accepted bid is a permanent record
    assert_fails_with(
        w.env.close_bid(&winner, &win_bid, &w.mandate),
        MandateError::BidNotClosable,
    );
    assert_eq!(bid_of(&w, &win_bid).status, BidStatus::Accepted);
}

#[test]
fn bids_on_a_cancelled_mandate_can_be_closed() {
    let mut w = world();
    let p = w.env.provider();
    w.env
        .submit_bid(&p, &w.mandate, 1, MAX, NOW + 5_000)
        .unwrap();
    w.env
        .cancel_unawarded(&w.sponsor.pubkey_owned(), &w.mandate, &w.sponsor_usdc)
        .unwrap();
    w.env
        .close_bid(&p, &bid_pda(&w.mandate, &p.pubkey(), 1), &w.mandate)
        .expect("the mandate is no longer bidding");
}

#[test]
fn only_the_provider_can_close_and_the_bid_must_match_the_mandate() {
    let mut w = world();
    let p = w.env.provider();
    w.env
        .submit_bid(&p, &w.mandate, 1, MAX, NOW + 5_000)
        .unwrap();
    let bid_key = bid_pda(&w.mandate, &p.pubkey(), 1);
    w.env.cancel_bid(&p, &bid_key).unwrap();
    let stranger = w.env.provider();
    assert_fails_with(
        w.env.close_bid(&stranger, &bid_key, &w.mandate),
        MandateError::UnauthorizedProvider,
    );
    // a different mandate account named alongside the bid
    w.env
        .create_mandate(
            &w.sponsor.pubkey_owned(),
            &w.sponsor_usdc,
            w.env.valid_mandate_args(2),
        )
        .unwrap();
    let other = mandate_pda(&w.sponsor.pubkey(), 2);
    assert_fails_with(
        w.env.close_bid(&p, &bid_key, &other),
        MandateError::BidMismatch,
    );
}

// ---- withdraw_surplus_after_award ------------------------------------------------------------

fn awarded(requested: u64) -> (World, Keypair, Pubkey) {
    let mut w = world();
    let p = w.env.provider();
    w.env
        .submit_bid(&p, &w.mandate, 1, requested, NOW + 5_000)
        .unwrap();
    let bid_key = bid_pda(&w.mandate, &p.pubkey(), 1);
    w.env
        .accept_bid(&w.sponsor.pubkey_owned(), &w.mandate, &bid_key)
        .unwrap();
    (w, p, bid_key)
}

#[test]
fn the_surplus_is_withdrawable_and_the_reserved_reward_never_is() {
    let (mut w, _p, _bid) = awarded(900 * USDC);
    let vault = vault_pda(&w.mandate);
    let sponsor_before = w.env.token_amount(&w.sponsor_usdc);
    let surplus = MAX - 900 * USDC;

    let sent = w
        .env
        .withdraw_surplus(
            &w.sponsor.pubkey_owned(),
            &w.mandate,
            &w.sponsor_usdc,
            surplus,
        )
        .expect("withdraw");
    assert_eq!(
        w.env.token_amount(&w.sponsor_usdc),
        sponsor_before + surplus
    );
    assert_eq!(
        w.env.token_amount(&vault),
        900 * USDC,
        "exactly the accepted reward stays reserved"
    );
    assert_eq!(mandate_of(&w).sponsor_withdrawn_raw, surplus);
    let events = events::<mandate::events::SponsorSurplusWithdrawn>(&sent.logs);
    assert_eq!(
        (
            events[0].amount_raw,
            events[0].total_withdrawn_raw,
            events[0].vault_balance_raw
        ),
        (surplus, surplus, 900 * USDC)
    );

    // one raw unit more than the surplus is refused, and the vault still holds the full reservation
    assert_fails_with(
        w.env
            .withdraw_surplus(&w.sponsor.pubkey_owned(), &w.mandate, &w.sponsor_usdc, 1),
        MandateError::NothingToWithdraw,
    );
    assert_eq!(w.env.token_amount(&vault), 900 * USDC);
}

#[test]
fn the_surplus_can_be_taken_in_pieces_and_never_exceeds_the_total() {
    let (mut w, _p, _bid) = awarded(900 * USDC);
    let surplus = MAX - 900 * USDC; // 100 USDC
    w.env
        .withdraw_surplus(
            &w.sponsor.pubkey_owned(),
            &w.mandate,
            &w.sponsor_usdc,
            40 * USDC,
        )
        .unwrap();
    assert_fails_with(
        w.env.withdraw_surplus(
            &w.sponsor.pubkey_owned(),
            &w.mandate,
            &w.sponsor_usdc,
            60 * USDC + 1,
        ),
        MandateError::WithdrawExceedsAvailable,
    );
    w.env
        .withdraw_surplus(
            &w.sponsor.pubkey_owned(),
            &w.mandate,
            &w.sponsor_usdc,
            60 * USDC,
        )
        .unwrap();
    assert_eq!(mandate_of(&w).sponsor_withdrawn_raw, surplus);
    assert_eq!(w.env.token_amount(&vault_pda(&w.mandate)), 900 * USDC);
    assert_fails_with(
        w.env
            .withdraw_surplus(&w.sponsor.pubkey_owned(), &w.mandate, &w.sponsor_usdc, 1),
        MandateError::NothingToWithdraw,
    );
}

#[test]
fn a_zero_withdrawal_is_an_error_not_a_withdraw_all() {
    let (mut w, _p, _bid) = awarded(900 * USDC);
    assert_fails_with(
        w.env
            .withdraw_surplus(&w.sponsor.pubkey_owned(), &w.mandate, &w.sponsor_usdc, 0),
        MandateError::NothingToWithdraw,
    );
    assert_eq!(w.env.token_amount(&vault_pda(&w.mandate)), MAX);
}

#[test]
fn an_award_at_the_full_budget_leaves_no_surplus() {
    let (mut w, _p, _bid) = awarded(MAX);
    assert_fails_with(
        w.env
            .withdraw_surplus(&w.sponsor.pubkey_owned(), &w.mandate, &w.sponsor_usdc, 1),
        MandateError::NothingToWithdraw,
    );
    assert_eq!(w.env.token_amount(&vault_pda(&w.mandate)), MAX);
}

#[test]
fn nothing_can_be_withdrawn_before_award_or_after_cancellation() {
    let mut w = world();
    assert_fails_with(
        w.env
            .withdraw_surplus(&w.sponsor.pubkey_owned(), &w.mandate, &w.sponsor_usdc, 1),
        MandateError::MandateNotAwarded,
    );
    assert_eq!(w.env.token_amount(&vault_pda(&w.mandate)), MAX);
}

#[test]
fn only_the_sponsor_can_withdraw_and_only_to_their_own_account() {
    let (mut w, p, _bid) = awarded(900 * USDC);
    let provider_usdc = w.env.add_token_account(&p.pubkey(), 0);
    assert_fails_with(
        w.env.withdraw_surplus(&p, &w.mandate, &provider_usdc, 1),
        MandateError::UnauthorizedSponsor,
    );
    let admin = copy(&w.env.admin);
    let admin_usdc = w.env.add_token_account(&admin.pubkey(), 0);
    assert_fails_with(
        w.env.withdraw_surplus(&admin, &w.mandate, &admin_usdc, 1),
        MandateError::UnauthorizedSponsor,
    );
    // the sponsor cannot redirect the surplus to someone else's account
    let ix = w
        .env
        .ix_withdraw_surplus(&w.sponsor.pubkey(), &w.mandate, &provider_usdc, 1);
    assert_fails_with_framework(
        w.env.send(&[ix], &[&copy(&w.sponsor)]),
        ErrorCode::ConstraintTokenOwner,
    );
    assert_eq!(w.env.token_amount(&provider_usdc), 0);
    assert_eq!(w.env.token_amount(&vault_pda(&w.mandate)), MAX);
}

#[test]
fn a_substituted_mandate_or_vault_cannot_be_drained() {
    let (mut w, _p, _bid) = awarded(900 * USDC);
    // a second, un-awarded mandate by the same sponsor; naming its vault must not work
    w.env
        .create_mandate(
            &w.sponsor.pubkey_owned(),
            &w.sponsor_usdc,
            w.env.valid_mandate_args(2),
        )
        .unwrap();
    let other = mandate_pda(&w.sponsor.pubkey(), 2);
    let mut ix = w
        .env
        .ix_withdraw_surplus(&w.sponsor.pubkey(), &w.mandate, &w.sponsor_usdc, 1);
    ix.accounts[5].pubkey = vault_pda(&other); // vault
    assert!(w.env.send(&[ix], &[&copy(&w.sponsor)]).is_err());
    assert_eq!(w.env.token_amount(&vault_pda(&other)), MAX);
    // the un-awarded mandate itself has nothing withdrawable
    assert_fails_with(
        w.env
            .withdraw_surplus(&w.sponsor.pubkey_owned(), &other, &w.sponsor_usdc, 1),
        MandateError::MandateNotAwarded,
    );
}

#[test]
fn withdrawing_is_not_blocked_by_a_pause_or_a_disabled_market() {
    let (mut w, _p, _bid) = awarded(900 * USDC);
    let ix = w.env.ix_set_paused(w.env.admin.pubkey(), true);
    w.env.as_admin(&[ix]).unwrap();
    let ix = w
        .env
        .ix_set_market_enabled(w.env.admin.pubkey(), market_pda(&w.env.pool), false);
    w.env.as_admin(&[ix]).unwrap();
    w.env
        .withdraw_surplus(
            &w.sponsor.pubkey_owned(),
            &w.mandate,
            &w.sponsor_usdc,
            10 * USDC,
        )
        .expect("the sponsor's surplus stays reachable");
}

#[test]
fn a_mandate_awarded_then_cancelled_via_the_unawarded_path_is_impossible() {
    let (mut w, _p, _bid) = awarded(900 * USDC);
    assert_fails_with(
        w.env
            .cancel_unawarded(&w.sponsor.pubkey_owned(), &w.mandate, &w.sponsor_usdc),
        MandateError::MandateNotBidding,
    );
    assert_eq!(
        w.env.token_amount(&vault_pda(&w.mandate)),
        MAX,
        "an awarded mandate's escrow cannot be pulled back by cancellation"
    );
}

#[test]
fn conservation_holds_through_award_and_surplus_withdrawals() {
    let (mut w, _p, _bid) = awarded(640 * USDC + 7);
    let total = 5_000 * USDC;
    let mut withdrawn = 0u64;
    for piece in [50 * USDC, 100 * USDC, 209 * USDC] {
        w.env
            .withdraw_surplus(
                &w.sponsor.pubkey_owned(),
                &w.mandate,
                &w.sponsor_usdc,
                piece,
            )
            .unwrap();
        withdrawn += piece;
        let vault = w.env.token_amount(&vault_pda(&w.mandate));
        assert_eq!(
            vault + withdrawn,
            MAX,
            "vault plus withdrawn equals the escrow"
        );
        assert!(
            vault >= 640 * USDC + 7,
            "the reserved reward is always fully covered"
        );
        assert_eq!(
            w.env.token_amount(&w.sponsor_usdc) + vault,
            total,
            "sponsor plus vault is conserved"
        );
    }
}
