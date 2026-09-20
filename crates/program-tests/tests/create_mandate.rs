#![allow(clippy::result_large_err)]

mod common;

use anchor_lang::error::ErrorCode;
use anchor_lang::prelude::Pubkey;
use common::*;
use mandate::{MandateError, MandateStatus};
use solana_signer::Signer;

fn ready_with_sponsor(usdc_raw: u64) -> (Env, solana_keypair::Keypair, Pubkey) {
    let mut env = Env::ready();
    let (sponsor, account) = env.sponsor_with(usdc_raw);
    (env, sponsor, account)
}

fn nothing_created(env: &Env, sponsor: &Pubkey, id: u64) -> bool {
    let mandate_key = mandate_pda(sponsor, id);
    env.account_data(&mandate_key).is_empty()
        && env.account_data(&vault_pda(&mandate_key)).is_empty()
}

#[test]
fn escrows_exactly_the_maximum_reward_and_initializes_every_field() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    let args = env.valid_mandate_args(1);
    let sent = env
        .create_mandate(&sponsor, &usdc, args.clone())
        .expect("create");

    let mandate_key = mandate_pda(&sponsor.pubkey(), 1);
    let vault = vault_pda(&mandate_key);
    assert_eq!(
        env.token_amount(&usdc),
        4_000 * USDC,
        "sponsor paid exactly max_reward_raw"
    );
    assert_eq!(
        env.token_amount(&vault),
        1_000 * USDC,
        "the vault holds exactly the escrow"
    );

    let m: mandate::Mandate = env.load(&mandate_key);
    assert_eq!(m.version, mandate::MANDATE_VERSION);
    assert_eq!(
        m.bump,
        Pubkey::find_program_address(
            &[
                mandate::MANDATE_SEED,
                sponsor.pubkey().as_ref(),
                &1u64.to_le_bytes()
            ],
            &mandate::ID
        )
        .1
    );
    assert_eq!((m.sponsor, m.mandate_id), (sponsor.pubkey(), 1));
    assert_eq!(m.market_config, market_pda(&env.pool));
    assert_eq!(
        m.observer_set,
        observer_set_pda(1),
        "the current observer set version is snapshotted"
    );
    assert_eq!(m.vault, vault);
    assert_eq!(
        (m.created_at, m.bidding_ends_at, m.start_at),
        (NOW, NOW + 3_600, NOW + 7_200)
    );
    assert_eq!((m.epoch_seconds, m.total_epochs), (300, 72));
    assert_eq!(m.end_at, NOW + 7_200 + 6 * 3_600);
    assert_eq!(m.max_reward_raw, 1_000 * USDC);
    assert_eq!(
        (
            m.accepted_reward_raw,
            m.base_epoch_reward_raw,
            m.final_epoch_extra_raw
        ),
        (0, 0, 0)
    );
    assert_eq!(m.max_effective_spread_bps, args.max_effective_spread_bps);
    assert_eq!(m.depth_band_bps, args.depth_band_bps);
    assert_eq!(
        m.min_pool_buy_depth_quote_raw,
        args.min_pool_buy_depth_quote_raw
    );
    assert_eq!(
        m.min_pool_sell_depth_quote_raw,
        args.min_pool_sell_depth_quote_raw
    );
    assert_eq!(
        m.min_provider_quote_in_band_raw,
        args.min_provider_quote_in_band_raw
    );
    assert_eq!(
        m.min_provider_base_quote_eq_in_band_raw,
        args.min_provider_base_quote_eq_in_band_raw
    );
    assert_eq!(m.probe_quote_raw, args.probe_quote_raw);
    assert_eq!(
        (m.accepted_bid, m.provider, m.position_set),
        (Pubkey::default(), Pubkey::default(), Pubkey::default())
    );
    assert_eq!(
        (
            m.compliant_epochs,
            m.noncompliant_epochs,
            m.unavailable_epochs,
            m.finalized_epochs
        ),
        (0, 0, 0, 0)
    );
    assert_eq!(
        (
            m.earned_reward_raw,
            m.forfeited_reward_raw,
            m.claimed_reward_raw,
            m.sponsor_withdrawn_raw
        ),
        (0, 0, 0, 0)
    );
    assert_eq!(m.status, MandateStatus::Bidding);

    let events = events::<mandate::events::MandateCreated>(&sent.logs);
    assert_eq!(events.len(), 1);
    assert_eq!(
        (events[0].mandate, events[0].vault, events[0].max_reward_raw),
        (mandate_key, vault, 1_000 * USDC)
    );
    assert_eq!((events[0].total_epochs, events[0].end_at), (72, m.end_at));
}

#[test]
fn the_vault_can_only_be_moved_by_the_mandate_account() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
        .unwrap();
    let mandate_key = mandate_pda(&sponsor.pubkey(), 1);
    let raw = env.account_data(&vault_pda(&mandate_key));
    assert_eq!(
        &raw[0..32],
        env.usdc_mint.as_ref(),
        "vault mint is the protocol USDC"
    );
    assert_eq!(
        &raw[32..64],
        mandate_key.as_ref(),
        "the vault's token authority is the mandate PDA, nobody else"
    );
    assert_eq!(&raw[72..76], &[0, 0, 0, 0], "no delegate");
    assert_eq!(&raw[129..133], &[0, 0, 0, 0], "no close authority");
    assert_eq!(raw[108], 1, "initialised");
}

#[test]
fn a_sponsor_with_exactly_the_escrow_can_create_and_one_raw_unit_less_cannot() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(1_000 * USDC);
    env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
        .expect("exact balance succeeds");
    assert_eq!(env.token_amount(&usdc), 0);

    let (mut env, sponsor, usdc) = ready_with_sponsor(1_000 * USDC - 1);
    let result = env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1));
    assert!(result.is_err(), "one raw unit short must fail");
    assert!(
        nothing_created(&env, &sponsor.pubkey(), 1),
        "a failed escrow leaves no mandate and no vault behind"
    );
    assert_eq!(
        env.token_amount(&usdc),
        1_000 * USDC - 1,
        "and moves no funds"
    );
}

#[test]
fn insufficient_balance_creates_nothing() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(10 * USDC);
    let result = env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(7));
    assert!(result.is_err());
    assert!(nothing_created(&env, &sponsor.pubkey(), 7));
    assert_eq!(env.token_amount(&usdc), 10 * USDC);
}

#[test]
fn the_usdc_mint_and_token_program_are_not_client_choices() {
    // wrong mint account
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    let fake_mint = keypair().pubkey();
    let mut template = env.svm.get_account(&env.usdc_mint).unwrap();
    template.owner = pk(SPL_TOKEN);
    env.set_account(fake_mint, template);
    let mut ix = env.ix_create_mandate(&sponsor.pubkey(), &usdc, env.valid_mandate_args(1));
    ix.accounts[4].pubkey = fake_mint; // usdc_mint
    assert_fails_with(
        env.send(&[ix], &[&keypair_from(&sponsor)]),
        MandateError::InvalidUsdcAccount,
    );

    assert!(nothing_created(&env, &sponsor.pubkey(), 1));

    // wrong token program. Anchor runs `init` before evaluating later fields' constraints, so the
    // exact error may come from the token program rather than from our address check; what matters is
    // that the transaction fails atomically: nothing is created and no funds move.
    let mut ix = env.ix_create_mandate(&sponsor.pubkey(), &usdc, env.valid_mandate_args(1));
    ix.accounts[5].pubkey = pk(TOKEN_2022); // token_program
    assert!(env.send(&[ix], &[&keypair_from(&sponsor)]).is_err());
    assert!(nothing_created(&env, &sponsor.pubkey(), 1));
    assert_eq!(env.token_amount(&usdc), 5_000 * USDC);
}

fn keypair_from(kp: &solana_keypair::Keypair) -> solana_keypair::Keypair {
    solana_keypair::Keypair::new_from_array(*kp.secret_bytes())
}

#[test]
fn the_sponsor_usdc_account_must_be_the_sponsors_usdc() {
    let (mut env, sponsor, _usdc) = ready_with_sponsor(5_000 * USDC);

    // a token account of another mint
    let other_mint = keypair().pubkey();
    let mut template = env.svm.get_account(&env.usdc_mint).unwrap();
    template.owner = pk(SPL_TOKEN);
    env.set_account(other_mint, template);
    let wrong_mint_account =
        env.add_token_account_for_mint(&other_mint, &sponsor.pubkey(), 5_000 * USDC, SPL_TOKEN);
    let ix = env.ix_create_mandate(
        &sponsor.pubkey(),
        &wrong_mint_account,
        env.valid_mandate_args(1),
    );
    assert_fails_with_framework(
        env.send(&[ix], &[&keypair_from(&sponsor)]),
        ErrorCode::ConstraintTokenMint,
    );

    // someone else's USDC account (the sponsor is not its authority)
    let victim = keypair();
    let victims = env.add_token_account(&victim.pubkey(), 5_000 * USDC);
    let ix = env.ix_create_mandate(&sponsor.pubkey(), &victims, env.valid_mandate_args(1));
    assert_fails_with_framework(
        env.send(&[ix], &[&keypair_from(&sponsor)]),
        ErrorCode::ConstraintTokenOwner,
    );
    assert_eq!(
        env.token_amount(&victims),
        5_000 * USDC,
        "another wallet's funds are untouched"
    );

    // an account that is not a token account at all
    let ix = env.ix_create_mandate(
        &sponsor.pubkey(),
        &env.pool.clone(),
        env.valid_mandate_args(1),
    );
    assert!(env.send(&[ix], &[&keypair_from(&sponsor)]).is_err());
    assert!(nothing_created(&env, &sponsor.pubkey(), 1));
}

#[test]
fn the_sponsor_must_sign() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    let mut ix = env.ix_create_mandate(&sponsor.pubkey(), &usdc, env.valid_mandate_args(1));
    ix.accounts[0].is_signer = false;
    assert_fails_with_framework(env.send(&[ix], &[]), ErrorCode::AccountNotSigner);
}

#[test]
fn a_disabled_or_unknown_market_is_refused() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    let ix = env.ix_set_market_enabled(env.admin.pubkey(), market_pda(&env.pool), false);
    env.as_admin(&[ix]).unwrap();
    assert_fails_with(
        env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1)),
        MandateError::MarketDisabled,
    );

    // a market address that is not an approved market
    let mut ix = env.ix_create_mandate(&sponsor.pubkey(), &usdc, env.valid_mandate_args(1));
    ix.accounts[2].pubkey = keypair().pubkey();
    assert!(env.send(&[ix], &[&keypair_from(&sponsor)]).is_err());
    assert!(nothing_created(&env, &sponsor.pubkey(), 1));
}

#[test]
fn only_the_current_observer_set_can_be_snapshotted() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    // supply a version that does not exist
    let mut ix = env.ix_create_mandate(&sponsor.pubkey(), &usdc, env.valid_mandate_args(1));
    ix.accounts[3].pubkey = observer_set_pda(2);
    assert_fails_with_framework(
        env.send(&[ix], &[&keypair_from(&sponsor)]),
        ErrorCode::AccountNotInitialized,
    );

    // after a newer set becomes current, the old one no longer matches
    let admin = env.admin.pubkey();
    let ix = env.ix_create_observer_set(
        admin,
        observer_set_pda(2),
        vec![keypair().pubkey(), keypair().pubkey()],
        1,
    );
    env.as_admin(&[ix]).unwrap();
    let mut ix = env.ix_create_mandate(&sponsor.pubkey(), &usdc, env.valid_mandate_args(1));
    ix.accounts[3].pubkey = observer_set_pda(1);
    assert_fails_with_framework(
        env.send(&[ix], &[&keypair_from(&sponsor)]),
        ErrorCode::ConstraintSeeds,
    );
    env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
        .expect("the current set is accepted");
    let m: mandate::Mandate = env.load(&mandate_pda(&sponsor.pubkey(), 1));
    assert_eq!(
        m.observer_set,
        observer_set_pda(2),
        "later mandates bind the newer set"
    );
}

#[test]
fn a_protocol_without_an_observer_set_cannot_host_mandates() {
    let mut env = Env::new();
    env.initialize_ok();
    let admin = env.admin.pubkey();
    let ix = env.ix_upsert_market(
        admin,
        env.pool,
        env.base_mint,
        env.usdc_mint,
        market_pda(&env.pool),
        [7u8; 32],
    );
    env.as_admin(&[ix]).unwrap();
    let ix = env.ix_set_market_enabled(admin, market_pda(&env.pool), true);
    env.as_admin(&[ix]).unwrap();
    let (sponsor, usdc) = env.sponsor_with(5_000 * USDC);
    let ix = env.ix_create_mandate(&sponsor.pubkey(), &usdc, env.valid_mandate_args(1));
    assert!(env.send(&[ix], &[&keypair_from(&sponsor)]).is_err());
    assert!(nothing_created(&env, &sponsor.pubkey(), 1));
}

#[test]
fn every_timing_and_bounds_edge() {
    type Change = fn(&mut mandate::CreateMandateArgs);
    // (name, mutation, expected error). `None` means the edge is valid.
    let cases: Vec<(&str, Change, Option<MandateError>)> = vec![
        (
            "epoch 59s",
            |a| a.epoch_seconds = 59,
            Some(MandateError::InvalidEpochLength),
        ),
        (
            "epoch 60s",
            |a| {
                a.epoch_seconds = 60;
                a.duration_seconds = 3_600;
            },
            None,
        ),
        (
            "epoch 3600s",
            |a| {
                a.epoch_seconds = 3_600;
                a.duration_seconds = 7_200;
            },
            None,
        ),
        (
            "epoch 3601s",
            |a| a.epoch_seconds = 3_601,
            Some(MandateError::InvalidEpochLength),
        ),
        (
            "duration not a multiple",
            |a| a.duration_seconds += 1,
            Some(MandateError::InvalidEpochLength),
        ),
        (
            "duration zero",
            |a| a.duration_seconds = 0,
            Some(MandateError::InvalidTiming),
        ),
        (
            "duration negative",
            |a| a.duration_seconds = -300,
            Some(MandateError::InvalidTiming),
        ),
        (
            "duration over 30 days",
            |a| {
                a.epoch_seconds = 3_600;
                a.duration_seconds = 30 * 86_400 + 3_600;
            },
            Some(MandateError::InvalidTiming),
        ),
        (
            "2017 epochs",
            |a| {
                a.epoch_seconds = 60;
                a.duration_seconds = 2_017 * 60;
            },
            Some(MandateError::TooManyEpochs),
        ),
        (
            "2016 epochs",
            |a| {
                a.epoch_seconds = 60;
                a.duration_seconds = 2_016 * 60;
            },
            None,
        ),
        (
            "bidding closed now",
            |a| a.bidding_ends_at = NOW,
            Some(MandateError::InvalidTiming),
        ),
        (
            "bidding closes next second",
            |a| a.bidding_ends_at = NOW + 1,
            None,
        ),
        (
            "start one second too soon",
            |a| {
                a.start_at = NOW + 1_199;
                a.bidding_ends_at = NOW + 100;
            },
            Some(MandateError::InvalidTiming),
        ),
        (
            "start exactly at the lead",
            |a| {
                a.start_at = NOW + 1_200;
                a.bidding_ends_at = NOW + 100;
            },
            None,
        ),
        (
            "bidding ends at the lock",
            |a| a.bidding_ends_at = a.start_at - 900,
            Some(MandateError::InvalidTiming),
        ),
        (
            "bidding ends one second earlier",
            |a| a.bidding_ends_at = a.start_at - 901,
            None,
        ),
        (
            "bidding ends after start",
            |a| a.bidding_ends_at = a.start_at + 1,
            Some(MandateError::InvalidTiming),
        ),
        (
            "end time overflows i64",
            |a| {
                a.start_at = i64::MAX - 100;
                a.bidding_ends_at = NOW + 100;
                a.duration_seconds = 3_600;
                a.epoch_seconds = 300;
            },
            Some(MandateError::ArithmeticOverflow),
        ),
        (
            "budget one below minimum",
            |a| a.max_reward_raw = 999,
            Some(MandateError::InvalidBudget),
        ),
        ("budget at minimum", |a| a.max_reward_raw = 1_000, None),
        (
            "budget below the epoch count",
            |a| {
                a.epoch_seconds = 60;
                a.duration_seconds = 3_600;
                a.max_reward_raw = 60_000;
            },
            None,
        ),
        (
            "budget one above maximum",
            |a| a.max_reward_raw = 1_000_000_000_000 + 1,
            Some(MandateError::InvalidBudget),
        ),
        (
            "budget u64::MAX",
            |a| a.max_reward_raw = u64::MAX,
            Some(MandateError::InvalidBudget),
        ),
        (
            "spread zero",
            |a| a.max_effective_spread_bps = 0,
            Some(MandateError::InvalidThreshold),
        ),
        (
            "spread at protocol max",
            |a| a.max_effective_spread_bps = 1_000,
            None,
        ),
        (
            "spread above protocol max",
            |a| a.max_effective_spread_bps = 1_001,
            Some(MandateError::InvalidThreshold),
        ),
        (
            "band zero",
            |a| a.depth_band_bps = 0,
            Some(MandateError::InvalidThreshold),
        ),
        ("band at protocol max", |a| a.depth_band_bps = 2_000, None),
        (
            "band above protocol max",
            |a| a.depth_band_bps = 2_001,
            Some(MandateError::InvalidThreshold),
        ),
        (
            "zero buy depth",
            |a| a.min_pool_buy_depth_quote_raw = 0,
            Some(MandateError::InvalidThreshold),
        ),
        (
            "zero sell depth",
            |a| a.min_pool_sell_depth_quote_raw = 0,
            Some(MandateError::InvalidThreshold),
        ),
        (
            "zero provider quote",
            |a| a.min_provider_quote_in_band_raw = 0,
            Some(MandateError::InvalidThreshold),
        ),
        (
            "zero provider base",
            |a| a.min_provider_base_quote_eq_in_band_raw = 0,
            Some(MandateError::InvalidThreshold),
        ),
        (
            "probe one below minimum",
            |a| a.probe_quote_raw = 999_999,
            Some(MandateError::InvalidThreshold),
        ),
        ("probe at minimum", |a| a.probe_quote_raw = 1_000_000, None),
        (
            "probe at maximum",
            |a| a.probe_quote_raw = 1_000_000_000,
            None,
        ),
        (
            "probe one above maximum",
            |a| a.probe_quote_raw = 1_000_000_001,
            Some(MandateError::InvalidThreshold),
        ),
    ];
    for (name, change, expected) in cases {
        let mut env = Env::ready();
        let (sponsor, usdc) = env.sponsor_with(2_000_000_000_000);
        let mut args = env.valid_mandate_args(1);
        change(&mut args);
        let result = env.create_mandate(&sponsor, &usdc, args);
        match expected {
            None => assert!(result.is_ok(), "{name}: expected success, got {result:?}"),
            Some(error) => {
                assert!(
                    matches!(&result, Err(f) if custom_code(f) == Some(code(error))),
                    "{name}: expected {error:?}, got {:?}",
                    result.as_ref().err().map(|f| &f.err)
                );
                assert!(
                    nothing_created(&env, &sponsor.pubkey(), 1),
                    "{name}: a rejected mandate must leave nothing behind"
                );
                assert_eq!(
                    env.token_amount(&usdc),
                    2_000_000_000_000,
                    "{name}: a rejected mandate must move no funds"
                );
            }
        }
    }
}

#[test]
fn a_duplicate_mandate_id_cannot_be_reused() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
        .unwrap();
    let before = env.account_data(&mandate_pda(&sponsor.pubkey(), 1));
    let mut again = env.valid_mandate_args(1);
    again.max_reward_raw = 2_000 * USDC;
    assert!(env.create_mandate(&sponsor, &usdc, again).is_err());
    assert_eq!(
        env.account_data(&mandate_pda(&sponsor.pubkey(), 1)),
        before,
        "the first mandate is untouched"
    );
    assert_eq!(
        env.token_amount(&vault_pda(&mandate_pda(&sponsor.pubkey(), 1))),
        1_000 * USDC
    );
    assert_eq!(
        env.token_amount(&usdc),
        4_000 * USDC,
        "the failed duplicate moved nothing"
    );
}

#[test]
fn a_cancelled_mandates_id_stays_burned() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
        .unwrap();
    env.cancel_unawarded(&sponsor, &mandate_pda(&sponsor.pubkey(), 1), &usdc)
        .unwrap();
    assert!(
        env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
            .is_err(),
        "the mandate account still exists"
    );
}

#[test]
fn ids_are_scoped_to_the_sponsor_and_distinct_ids_coexist() {
    let mut env = Env::ready();
    let (alice, alice_usdc) = env.sponsor_with(5_000 * USDC);
    let (bob, bob_usdc) = env.sponsor_with(5_000 * USDC);
    env.create_mandate(&alice, &alice_usdc, env.valid_mandate_args(1))
        .unwrap();
    env.create_mandate(&alice, &alice_usdc, env.valid_mandate_args(2))
        .unwrap();
    env.create_mandate(&bob, &bob_usdc, env.valid_mandate_args(1))
        .expect("the same id under another sponsor is a different mandate");

    assert_ne!(
        mandate_pda(&alice.pubkey(), 1),
        mandate_pda(&bob.pubkey(), 1)
    );
    for (sponsor, id) in [(&alice, 1u64), (&alice, 2), (&bob, 1)] {
        assert_eq!(
            env.token_amount(&vault_pda(&mandate_pda(&sponsor.pubkey(), id))),
            1_000 * USDC
        );
    }
    assert_eq!(env.token_amount(&alice_usdc), 3_000 * USDC);
    assert_eq!(env.token_amount(&bob_usdc), 4_000 * USDC);
}

#[test]
fn a_mandate_address_not_derived_from_the_sponsor_and_id_is_rejected() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    let rogue = keypair().pubkey();
    let ix = env.ix_create_mandate_with(&sponsor.pubkey(), &usdc, env.valid_mandate_args(1), rogue);
    assert_fails_with_framework(
        env.send(&[ix], &[&keypair_from(&sponsor)]),
        ErrorCode::ConstraintSeeds,
    );
}

#[test]
fn pausing_blocks_creation() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    let ix = env.ix_set_paused(env.admin.pubkey(), true);
    env.as_admin(&[ix]).unwrap();
    assert_fails_with(
        env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1)),
        MandateError::ProtocolPaused,
    );
    assert!(nothing_created(&env, &sponsor.pubkey(), 1));
}

// ---- cancellation ----------------------------------------------------------------------------

#[test]
fn cancelling_returns_the_exact_escrow_and_closes_the_vault() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
        .unwrap();
    let mandate_key = mandate_pda(&sponsor.pubkey(), 1);
    let vault = vault_pda(&mandate_key);
    let sol_before = env.svm.get_balance(&sponsor.pubkey()).unwrap();

    let sent = env
        .cancel_unawarded(&sponsor, &mandate_key, &usdc)
        .expect("cancel");
    assert_eq!(
        env.token_amount(&usdc),
        5_000 * USDC,
        "every raw unit is back"
    );
    assert!(env.account_data(&vault).is_empty(), "the vault is closed");
    assert!(
        env.svm.get_balance(&sponsor.pubkey()).unwrap() > sol_before - 10_000,
        "the vault's rent returns to the sponsor"
    );
    let m: mandate::Mandate = env.load(&mandate_key);
    assert_eq!(m.status, MandateStatus::Cancelled);
    let events = events::<mandate::events::MandateCancelled>(&sent.logs);
    assert_eq!(
        (events[0].sponsor, events[0].refunded_raw),
        (sponsor.pubkey(), 1_000 * USDC)
    );
}

#[test]
fn only_the_sponsor_can_cancel() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
        .unwrap();
    let mandate_key = mandate_pda(&sponsor.pubkey(), 1);

    let (stranger, stranger_usdc) = env.sponsor_with(0);
    assert_fails_with(
        env.cancel_unawarded(&stranger, &mandate_key, &stranger_usdc),
        MandateError::UnauthorizedSponsor,
    );

    // The admin has no special power over a sponsor's escrow either.
    let admin = solana_keypair::Keypair::new_from_array(*env.admin.secret_bytes());
    let admin_usdc = env.add_token_account(&admin.pubkey(), 0);
    assert_fails_with(
        env.cancel_unawarded(&admin, &mandate_key, &admin_usdc),
        MandateError::UnauthorizedSponsor,
    );

    // A stranger cannot redirect the refund to themselves even by naming the sponsor as signer.
    let ix = env.ix_cancel_unawarded(&sponsor.pubkey(), &mandate_key, &stranger_usdc);
    assert!(
        env.send(&[ix], &[&keypair_from(&sponsor)]).is_err(),
        "refund destination must be the sponsor's own account"
    );

    assert_eq!(
        env.token_amount(&vault_pda(&mandate_key)),
        1_000 * USDC,
        "the escrow never moved"
    );
    assert_eq!(env.token_amount(&stranger_usdc), 0);
}

#[test]
fn the_sponsor_must_sign_to_cancel() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
        .unwrap();
    let mandate_key = mandate_pda(&sponsor.pubkey(), 1);
    let mut ix = env.ix_cancel_unawarded(&sponsor.pubkey(), &mandate_key, &usdc);
    ix.accounts[0].is_signer = false;
    assert_fails_with_framework(env.send(&[ix], &[]), ErrorCode::AccountNotSigner);
}

#[test]
fn a_substituted_vault_is_rejected() {
    let mut env = Env::ready();
    let (alice, alice_usdc) = env.sponsor_with(5_000 * USDC);
    let (bob, bob_usdc) = env.sponsor_with(5_000 * USDC);
    env.create_mandate(&alice, &alice_usdc, env.valid_mandate_args(1))
        .unwrap();
    env.create_mandate(&bob, &bob_usdc, env.valid_mandate_args(1))
        .unwrap();

    // Alice cancels her own mandate but names Bob's vault.
    let alice_mandate = mandate_pda(&alice.pubkey(), 1);
    let mut ix = env.ix_cancel_unawarded(&alice.pubkey(), &alice_mandate, &alice_usdc);
    ix.accounts[5].pubkey = vault_pda(&mandate_pda(&bob.pubkey(), 1)); // vault
    assert!(env.send(&[ix], &[&keypair_from(&alice)]).is_err());
    assert_eq!(
        env.token_amount(&vault_pda(&mandate_pda(&bob.pubkey(), 1))),
        1_000 * USDC
    );
}

#[test]
fn a_mandate_with_an_accepted_bid_or_past_bidding_cannot_be_cancelled() {
    // Later prompts create these states; here they are written directly so the guard is tested now.
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
        .unwrap();
    let mandate_key = mandate_pda(&sponsor.pubkey(), 1);

    env.update_account::<mandate::Mandate>(&mandate_key, |m| m.accepted_bid = keypair().pubkey());
    assert_fails_with(
        env.cancel_unawarded(&sponsor, &mandate_key, &usdc),
        MandateError::BidAlreadyAccepted,
    );

    env.update_account::<mandate::Mandate>(&mandate_key, |m| {
        m.accepted_bid = Pubkey::default();
        m.status = MandateStatus::Awarded;
    });
    assert_fails_with(
        env.cancel_unawarded(&sponsor, &mandate_key, &usdc),
        MandateError::MandateNotBidding,
    );
    assert_eq!(
        env.token_amount(&vault_pda(&mandate_key)),
        1_000 * USDC,
        "the escrow stays in the vault"
    );
}

#[test]
fn a_mandate_cannot_be_cancelled_twice() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
        .unwrap();
    let mandate_key = mandate_pda(&sponsor.pubkey(), 1);
    env.cancel_unawarded(&sponsor, &mandate_key, &usdc).unwrap();
    assert!(env.cancel_unawarded(&sponsor, &mandate_key, &usdc).is_err());
    assert_eq!(env.token_amount(&usdc), 5_000 * USDC, "no double refund");
}

#[test]
fn pause_and_a_disabled_market_never_trap_a_sponsors_escrow() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
        .unwrap();
    let mandate_key = mandate_pda(&sponsor.pubkey(), 1);

    let ix = env.ix_set_paused(env.admin.pubkey(), true);
    env.as_admin(&[ix]).unwrap();
    let ix = env.ix_set_market_enabled(env.admin.pubkey(), market_pda(&env.pool), false);
    env.as_admin(&[ix]).unwrap();

    env.cancel_unawarded(&sponsor, &mandate_key, &usdc)
        .expect("cancellation is allowed while paused and after the market is disabled");
    assert_eq!(env.token_amount(&usdc), 5_000 * USDC);
}

#[test]
fn a_refund_may_go_to_any_usdc_account_the_sponsor_owns() {
    let (mut env, sponsor, usdc) = ready_with_sponsor(5_000 * USDC);
    env.create_mandate(&sponsor, &usdc, env.valid_mandate_args(1))
        .unwrap();
    let second = env.add_token_account(&sponsor.pubkey(), 0);
    env.cancel_unawarded(&sponsor, &mandate_pda(&sponsor.pubkey(), 1), &second)
        .unwrap();
    assert_eq!(env.token_amount(&second), 1_000 * USDC);
    assert_eq!(env.token_amount(&usdc), 4_000 * USDC);
}

#[test]
fn conservation_across_many_mandates_and_cancellations() {
    let mut env = Env::ready();
    let (sponsor, usdc) = env.sponsor_with(10_000 * USDC);
    let mut escrowed = 0u64;
    for id in 1..=5u64 {
        let mut args = env.valid_mandate_args(id);
        args.max_reward_raw = id * 100 * USDC + id; // distinct, non-round amounts
        escrowed += args.max_reward_raw;
        env.create_mandate(&sponsor, &usdc, args).unwrap();
    }
    let vault_total: u64 = (1..=5u64)
        .map(|id| env.token_amount(&vault_pda(&mandate_pda(&sponsor.pubkey(), id))))
        .sum();
    assert_eq!(vault_total, escrowed);
    assert_eq!(
        env.token_amount(&usdc) + vault_total,
        10_000 * USDC,
        "sponsor balance plus escrow is conserved"
    );

    for id in [2u64, 4] {
        env.cancel_unawarded(&sponsor, &mandate_pda(&sponsor.pubkey(), id), &usdc)
            .unwrap();
    }
    let remaining: u64 = [1u64, 3, 5]
        .iter()
        .map(|id| env.token_amount(&vault_pda(&mandate_pda(&sponsor.pubkey(), *id))))
        .sum();
    assert_eq!(
        env.token_amount(&usdc) + remaining,
        10_000 * USDC,
        "still conserved after cancellations"
    );
}
