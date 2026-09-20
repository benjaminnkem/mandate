#![allow(clippy::result_large_err)]

mod common;

use anchor_lang::error::ErrorCode;
use anchor_lang::prelude::Pubkey;
use common::*;
use mandate::MandateError;
use solana_signer::Signer;

const HASH: [u8; 32] = [7u8; 32];

fn setup() -> Env {
    let mut env = Env::new();
    env.initialize_ok();
    env
}

fn upsert(env: &mut Env, hash: [u8; 32]) -> Sent {
    let ix = env.ix_upsert_market(
        env.admin.pubkey(),
        env.pool,
        env.base_mint,
        env.usdc_mint,
        market_pda(&env.pool),
        hash,
    );
    env.as_admin(&[ix])
}

fn market(env: &Env) -> mandate::MarketConfig {
    env.load(&market_pda(&env.pool))
}

fn set_enabled(env: &mut Env, enabled: bool) -> Sent {
    let ix = env.ix_set_market_enabled(env.admin.pubkey(), market_pda(&env.pool), enabled);
    env.as_admin(&[ix])
}

fn pause(env: &mut Env, paused: bool) {
    let ix = env.ix_set_paused(env.admin.pubkey(), paused);
    env.as_admin(&[ix]).unwrap();
}

/// A token mint account at a fresh address.
fn new_mint(env: &mut Env, owner: &str, decimals: u8) -> Pubkey {
    let address = keypair().pubkey();
    let mut template = env.svm.get_account(&env.usdc_mint).unwrap();
    template.owner = pk(owner);
    template.data[44] = decimals;
    env.set_account(address, template);
    address
}

#[test]
fn approves_the_real_pool_binding_its_exact_mints() {
    let mut env = setup();
    let sent = upsert(&mut env, HASH).expect("upsert");
    let m = market(&env);

    assert_eq!(m.version, mandate::MARKET_VERSION);
    assert!(!m.enabled, "new markets start disabled");
    assert!(matches!(m.venue_type, mandate::VenueType::MeteoraDlmm));
    assert_eq!(m.pool, env.pool);
    assert_eq!(m.base_mint, env.base_mint);
    assert_eq!(
        m.base_token_program,
        pk(TOKEN_2022),
        "read from the base mint's owner"
    );
    assert_eq!(m.base_decimals, 9, "read from the base mint");
    assert_eq!(m.quote_mint, env.usdc_mint);
    assert_eq!(m.quote_token_program, pk(SPL_TOKEN));
    assert_eq!(m.quote_decimals, 6);
    assert!(
        m.base_is_x,
        "the real pool has the PreStocks token as token X"
    );
    assert_eq!(m.prestocks_metadata_hash, HASH);
    assert_eq!(m.reviewed_at, NOW);
    assert_eq!(
        m.bump,
        Pubkey::find_program_address(&[mandate::MARKET_SEED, env.pool.as_ref()], &mandate::ID).1
    );

    let emitted = events::<mandate::events::MarketConfigured>(&sent.logs);
    assert_eq!(emitted.len(), 1);
    assert!(emitted[0].created && !emitted[0].enabled && emitted[0].base_is_x);
    assert_eq!(emitted[0].pool, env.pool);
}

#[test]
fn reports_orientation_from_the_pool_when_the_base_token_is_y() {
    let mut env = setup();
    // The same real pool bytes with token X and token Y swapped.
    let mut data = pool_bytes();
    let (x, y) = (data[88..120].to_vec(), data[120..152].to_vec());
    data[88..120].copy_from_slice(&y);
    data[120..152].copy_from_slice(&x);
    let swapped = keypair().pubkey();
    env.set_account(
        swapped,
        solana_account::Account {
            lamports: 10_000_000,
            data,
            owner: env.dlmm_program,
            executable: false,
            rent_epoch: 0,
        },
    );
    let ix = env.ix_upsert_market(
        env.admin.pubkey(),
        swapped,
        env.base_mint,
        env.usdc_mint,
        market_pda(&swapped),
        HASH,
    );
    env.as_admin(&[ix]).unwrap();
    let m: mandate::MarketConfig = env.load(&market_pda(&swapped));
    assert!(!m.base_is_x);
}

#[test]
fn enabling_and_disabling_works_and_emits() {
    let mut env = setup();
    upsert(&mut env, HASH).unwrap();
    let sent = set_enabled(&mut env, true).unwrap();
    assert!(market(&env).enabled);
    let emitted = events::<mandate::events::MarketEnabledChanged>(&sent.logs);
    assert!(emitted[0].enabled);
    set_enabled(&mut env, false).unwrap();
    assert!(!market(&env).enabled);
}

#[test]
fn only_the_admin_can_manage_markets() {
    let mut env = setup();
    let stranger = keypair();
    env.svm.airdrop(&stranger.pubkey(), 10_000_000_000).unwrap();
    let ix = env.ix_upsert_market(
        stranger.pubkey(),
        env.pool,
        env.base_mint,
        env.usdc_mint,
        market_pda(&env.pool),
        HASH,
    );
    assert_fails_with(
        env.send(&[ix], &[&stranger]),
        MandateError::UnauthorizedAdmin,
    );
    assert!(env.account_data(&market_pda(&env.pool)).is_empty());

    upsert(&mut env, HASH).unwrap();
    let ix = env.ix_set_market_enabled(stranger.pubkey(), market_pda(&env.pool), true);
    assert_fails_with(
        env.send(&[ix], &[&stranger]),
        MandateError::UnauthorizedAdmin,
    );
    assert!(!market(&env).enabled);
}

#[test]
fn the_admin_signature_is_required() {
    let mut env = setup();
    let mut ix = env.ix_upsert_market(
        env.admin.pubkey(),
        env.pool,
        env.base_mint,
        env.usdc_mint,
        market_pda(&env.pool),
        HASH,
    );
    ix.accounts[0].is_signer = false;
    assert_fails_with_framework(env.send(&[ix], &[]), ErrorCode::AccountNotSigner);
}

#[test]
fn the_pool_must_belong_to_the_dlmm_program() {
    let mut env = setup();
    let mut pool = env.svm.get_account(&env.pool).unwrap();
    pool.owner = pk(SYSTEM_PROGRAM);
    env.set_account(env.pool, pool);
    assert_fails_with(upsert(&mut env, HASH), MandateError::InvalidMarket);
}

#[test]
fn the_pool_must_be_exactly_an_lbpair() {
    for mutate in [
        (|d: &mut Vec<u8>| {
            d.pop();
        }) as fn(&mut Vec<u8>),
        |d| d.push(0),
        |d| d[0] ^= 0xff,
        |d| d.clear(),
    ] {
        let mut env = setup();
        let mut pool = env.svm.get_account(&env.pool).unwrap();
        mutate(&mut pool.data);
        env.set_account(env.pool, pool);
        assert_fails_with(upsert(&mut env, HASH), MandateError::InvalidMarket);
    }
}

#[test]
fn the_base_mint_must_be_one_of_the_pools_mints() {
    let mut env = setup();
    let stranger_mint = new_mint(&mut env, TOKEN_2022, 9);
    let ix = env.ix_upsert_market(
        env.admin.pubkey(),
        env.pool,
        stranger_mint,
        env.usdc_mint,
        market_pda(&env.pool),
        HASH,
    );
    assert_fails_with(env.as_admin(&[ix]), MandateError::InvalidMarket);
    assert!(env.account_data(&market_pda(&env.pool)).is_empty());
}

#[test]
fn the_quote_mint_must_be_the_configured_usdc() {
    let mut env = setup();
    let fake_usdc = new_mint(&mut env, SPL_TOKEN, 6);
    let ix = env.ix_upsert_market(
        env.admin.pubkey(),
        env.pool,
        env.base_mint,
        fake_usdc,
        market_pda(&env.pool),
        HASH,
    );
    assert_fails_with(env.as_admin(&[ix]), MandateError::InvalidMarket);

    // and the base mint cannot double as the quote
    let ix = env.ix_upsert_market(
        env.admin.pubkey(),
        env.pool,
        env.base_mint,
        env.base_mint,
        market_pda(&env.pool),
        HASH,
    );
    assert_fails_with(env.as_admin(&[ix]), MandateError::InvalidMarket);
}

#[test]
fn a_market_address_not_derived_from_its_pool_is_rejected() {
    let mut env = setup();
    let ix = env.ix_upsert_market(
        env.admin.pubkey(),
        env.pool,
        env.base_mint,
        env.usdc_mint,
        keypair().pubkey(),
        HASH,
    );
    assert_fails_with_framework(env.as_admin(&[ix]), ErrorCode::ConstraintSeeds);
    // another pool's market address
    let other_pool = keypair().pubkey();
    let ix = env.ix_upsert_market(
        env.admin.pubkey(),
        env.pool,
        env.base_mint,
        env.usdc_mint,
        market_pda(&other_pool),
        HASH,
    );
    assert_fails_with_framework(env.as_admin(&[ix]), ErrorCode::ConstraintSeeds);
}

#[test]
fn refreshing_keeps_the_bindings_and_the_enabled_flag() {
    let mut env = setup();
    upsert(&mut env, HASH).unwrap();
    set_enabled(&mut env, true).unwrap();
    env.warp_time(NOW + 500);
    let sent = upsert(&mut env, [9u8; 32]).unwrap();
    let m = market(&env);
    assert_eq!(m.prestocks_metadata_hash, [9u8; 32]);
    assert_eq!(m.reviewed_at, NOW + 500);
    assert!(
        m.enabled,
        "a refresh never changes whether the market is enabled"
    );
    assert_eq!(
        (m.pool, m.base_mint, m.quote_mint),
        (env.pool, env.base_mint, env.usdc_mint)
    );
    assert!(!events::<mandate::events::MarketConfigured>(&sent.logs)[0].created);
}

#[test]
fn existing_bindings_are_immutable() {
    // If anything a binding depends on changes under an existing market, a refresh must refuse.
    let mut env = setup();
    upsert(&mut env, HASH).unwrap();
    let mut base = env.svm.get_account(&env.base_mint).unwrap();
    base.data[44] = 6; // decimals differ from what was approved
    env.set_account(env.base_mint, base);
    assert_fails_with(upsert(&mut env, [1u8; 32]), MandateError::InvalidMarket);
    assert_eq!(
        market(&env).prestocks_metadata_hash,
        HASH,
        "the refused refresh changed nothing"
    );

    let mut env = setup();
    upsert(&mut env, HASH).unwrap();
    let mut base = env.svm.get_account(&env.base_mint).unwrap();
    base.owner = pk(SPL_TOKEN); // different token program
    env.set_account(env.base_mint, base);
    assert_fails_with(upsert(&mut env, [1u8; 32]), MandateError::InvalidMarket);
}

#[test]
fn pausing_blocks_new_markets_and_enabling_but_never_disabling_or_refreshing() {
    let mut env = setup();
    pause(&mut env, true);
    assert_fails_with(upsert(&mut env, HASH), MandateError::ProtocolPaused);
    assert!(env.account_data(&market_pda(&env.pool)).is_empty());

    pause(&mut env, false);
    upsert(&mut env, HASH).unwrap();
    set_enabled(&mut env, true).unwrap();

    pause(&mut env, true);
    // Risk-reducing and informational actions keep working during a pause...
    upsert(&mut env, [5u8; 32]).expect("refresh is allowed while paused");
    set_enabled(&mut env, false).expect("disabling is always allowed");
    // ...but adding risk does not.
    assert_fails_with(set_enabled(&mut env, true), MandateError::ProtocolPaused);
    assert!(!market(&env).enabled);

    pause(&mut env, false);
    set_enabled(&mut env, true).expect("enabling works again once resumed");
}

#[test]
fn disabling_never_needs_the_pool_or_the_mints() {
    // Even if the pool account vanished, an admin can still switch a market off.
    let mut env = setup();
    upsert(&mut env, HASH).unwrap();
    set_enabled(&mut env, true).unwrap();
    let mut pool = env.svm.get_account(&env.pool).unwrap();
    pool.data.clear();
    env.set_account(env.pool, pool);
    set_enabled(&mut env, false).expect("disable does not touch the pool");
}

#[test]
fn a_market_that_was_never_approved_cannot_be_enabled() {
    let mut env = setup();
    let ix = env.ix_set_market_enabled(env.admin.pubkey(), market_pda(&env.pool), true);
    assert!(env.as_admin(&[ix]).is_err());
}
