#![allow(clippy::result_large_err)]

mod common;

use anchor_lang::error::ErrorCode;
use common::*;
use mandate::MandateError;
use solana_signer::Signer;

#[test]
fn initializes_with_every_field_set() {
    let mut env = Env::new();
    let sent = env.initialize().expect("initialize");
    let config: mandate::ProtocolConfig = env.load(&protocol_pda());
    let args = env.default_args();

    assert_eq!(config.version, mandate::PROTOCOL_VERSION);
    assert_eq!(
        config.bump,
        anchor_lang::prelude::Pubkey::find_program_address(&[mandate::PROTOCOL_SEED], &mandate::ID)
            .1
    );
    assert_eq!(config.admin, env.admin.pubkey());
    assert!(!config.has_pending_admin());
    assert_eq!(config.usdc_mint, env.usdc_mint);
    assert_eq!(config.usdc_token_program, pk(SPL_TOKEN));
    assert_eq!(config.dlmm_program, env.dlmm_program);
    assert!(!config.paused_new_risk);
    assert_eq!(config.min_budget_raw, args.min_budget_raw);
    assert_eq!(config.max_budget_raw, args.max_budget_raw);
    assert_eq!(config.min_epoch_seconds, args.min_epoch_seconds);
    assert_eq!(config.max_epoch_seconds, args.max_epoch_seconds);
    assert_eq!(config.max_duration_seconds, args.max_duration_seconds);
    assert_eq!(config.max_epochs, args.max_epochs);
    assert_eq!(config.max_spread_bps, args.max_spread_bps);
    assert_eq!(config.max_depth_band_bps, args.max_depth_band_bps);
    assert_eq!(config.max_positions, args.max_positions);
    assert_eq!(config.min_probe_quote_raw, args.min_probe_quote_raw);
    assert_eq!(config.max_probe_quote_raw, args.max_probe_quote_raw);
    assert_eq!(config.min_start_lead_seconds, args.min_start_lead_seconds);
    assert_eq!(
        config.position_lock_buffer_seconds,
        args.position_lock_buffer_seconds
    );
    assert_eq!(
        config.min_setup_window_seconds,
        args.min_setup_window_seconds
    );
    assert_eq!(
        config.unavailable_recovery_seconds,
        args.unavailable_recovery_seconds
    );
    assert_eq!(config.current_observer_set_version, 0);

    let emitted = events::<mandate::events::ProtocolInitialized>(&sent.logs);
    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0].admin, env.admin.pubkey());
    assert_eq!(emitted[0].usdc_mint, env.usdc_mint);
}

#[test]
fn only_the_program_upgrade_authority_can_initialize() {
    let mut env = Env::new();
    let impostor = keypair();
    let mut ix = env.ix_initialize(env.default_args());
    ix.accounts[1].pubkey = impostor.pubkey(); // upgrade_authority
    assert_fails_with(
        env.send(&[ix], &[&impostor]),
        MandateError::UnauthorizedInitializer,
    );
    assert!(
        env.account_data(&protocol_pda()).is_empty(),
        "nothing was created"
    );
}

#[test]
fn nobody_can_initialize_an_immutable_program() {
    let mut env = Env::new();
    let address = program_data_address();
    let mut pd = env.svm.get_account(&address).unwrap();
    pd.data[12] = 0; // Option::None: the program can no longer be upgraded
    env.set_account(address, pd);
    assert_fails_with(env.initialize(), MandateError::UnauthorizedInitializer);
}

#[test]
fn a_substituted_program_data_account_is_rejected() {
    let mut env = Env::new();
    // The real authority signs, but the ProgramData account is replaced by an account it controls.
    let ix = env.ix_initialize_with(
        env.default_args(),
        env.upgrade_authority.pubkey(),
        env.pool,
        env.usdc_mint,
        pk(SPL_TOKEN),
        mandate::ID,
    );
    let result = env.as_authority(&[ix]);
    assert!(
        result.is_err(),
        "a foreign account must not stand in for ProgramData"
    );
    assert!(env.account_data(&protocol_pda()).is_empty());
}

#[test]
fn a_substituted_program_account_is_rejected() {
    let mut env = Env::new();
    let ix = env.ix_initialize_with(
        env.default_args(),
        env.upgrade_authority.pubkey(),
        program_data_address(),
        env.usdc_mint,
        pk(SPL_TOKEN),
        pk(SYSTEM_PROGRAM),
    );
    assert_fails_with_framework(env.as_authority(&[ix]), ErrorCode::InvalidProgramId);
}

#[test]
fn the_upgrade_authority_must_actually_sign() {
    let mut env = Env::new();
    let mut ix = env.ix_initialize(env.default_args());
    ix.accounts[1].is_signer = false;
    assert_fails_with_framework(env.send(&[ix], &[]), ErrorCode::AccountNotSigner);
}

#[test]
fn cannot_be_initialized_twice() {
    let mut env = Env::new();
    env.initialize_ok();
    let mut second = env.default_args();
    second.admin = keypair().pubkey();
    let ix = env.ix_initialize(second);
    assert!(env.as_authority(&[ix]).is_err());
    let config: mandate::ProtocolConfig = env.load(&protocol_pda());
    assert_eq!(
        config.admin,
        env.admin.pubkey(),
        "the first configuration is untouched"
    );
}

#[test]
fn the_reward_mint_must_be_classic_usdc_with_six_decimals() {
    // wrong decimals
    let mut env = Env::new();
    let mut bad = env.svm.get_account(&env.usdc_mint).unwrap();
    bad.data[44] = 9;
    env.set_account(env.usdc_mint, bad);
    assert_fails_with(env.initialize(), MandateError::InvalidUsdcAccount);

    // Token-2022 named as the token program
    let mut env = Env::new();
    let ix = env.ix_initialize_with(
        env.default_args(),
        env.upgrade_authority.pubkey(),
        program_data_address(),
        env.usdc_mint,
        pk(TOKEN_2022),
        mandate::ID,
    );
    assert_fails_with(env.as_authority(&[ix]), MandateError::InvalidUsdcAccount);

    // a mint owned by Token-2022 (even with the right token program named alongside it)
    let mut env = Env::new();
    let mut t22 = env.svm.get_account(&env.usdc_mint).unwrap();
    t22.owner = pk(TOKEN_2022);
    env.set_account(env.usdc_mint, t22);
    let ix = env.ix_initialize_with(
        env.default_args(),
        env.upgrade_authority.pubkey(),
        program_data_address(),
        env.usdc_mint,
        pk(SPL_TOKEN),
        mandate::ID,
    );
    assert!(env.as_authority(&[ix]).is_err());

    // an account that is not a mint at all
    let mut env = Env::new();
    let ix = env.ix_initialize_with(
        env.default_args(),
        env.upgrade_authority.pubkey(),
        program_data_address(),
        env.pool,
        pk(SPL_TOKEN),
        mandate::ID,
    );
    assert!(env.as_authority(&[ix]).is_err());
}

#[test]
fn parameters_are_bounded() {
    type Mutate = fn(&mut mandate::InitializeProtocolArgs);
    let cases: Vec<(&str, Mutate)> = vec![
        ("zero min budget", |a| a.min_budget_raw = 0),
        ("min budget above max", |a| {
            a.min_budget_raw = a.max_budget_raw + 1
        }),
        ("zero min epoch", |a| a.min_epoch_seconds = 0),
        ("min epoch above max", |a| {
            a.min_epoch_seconds = a.max_epoch_seconds + 1
        }),
        ("zero duration", |a| a.max_duration_seconds = 0),
        ("duration beyond 30 days", |a| {
            a.max_duration_seconds = 30 * 86_400 + 1
        }),
        ("zero epochs", |a| a.max_epochs = 0),
        ("epochs above hard cap", |a| a.max_epochs = 2_017),
        ("zero spread cap", |a| a.max_spread_bps = 0),
        ("spread above 100%", |a| a.max_spread_bps = 10_001),
        ("zero band cap", |a| a.max_depth_band_bps = 0),
        ("band at 100%", |a| a.max_depth_band_bps = 10_000),
        ("zero positions", |a| a.max_positions = 0),
        ("too many positions", |a| a.max_positions = 9),
        ("zero probe", |a| a.min_probe_quote_raw = 0),
        ("probe range inverted", |a| {
            a.min_probe_quote_raw = a.max_probe_quote_raw + 1
        }),
        ("negative lead", |a| a.min_start_lead_seconds = -1),
        ("negative lock buffer", |a| {
            a.position_lock_buffer_seconds = -1
        }),
        ("negative setup window", |a| a.min_setup_window_seconds = -1),
        ("negative recovery", |a| a.unavailable_recovery_seconds = -1),
        ("no bidding window", |a| a.min_start_lead_seconds = 900),
        ("overflowing reserved time", |a| {
            a.position_lock_buffer_seconds = i64::MAX;
            a.min_setup_window_seconds = i64::MAX;
        }),
    ];
    for (name, mutate) in cases {
        let mut env = Env::new();
        let mut args = env.default_args();
        mutate(&mut args);
        let ix = env.ix_initialize(args);
        let result = env.as_authority(&[ix]);
        assert!(
            matches!(&result, Err(f) if custom_code(f) == Some(code(MandateError::InvalidProtocolParams))),
            "{name}: expected InvalidProtocolParams, got {result:?}"
        );
    }
}

#[test]
fn admin_and_dlmm_program_must_be_set() {
    let mut env = Env::new();
    let mut args = env.default_args();
    args.admin = anchor_lang::prelude::Pubkey::default();
    let ix = env.ix_initialize(args);
    assert_fails_with(env.as_authority(&[ix]), MandateError::InvalidAdmin);

    let mut env = Env::new();
    let mut args = env.default_args();
    args.dlmm_program = anchor_lang::prelude::Pubkey::default();
    let ix = env.ix_initialize(args);
    assert_fails_with(env.as_authority(&[ix]), MandateError::InvalidProtocolParams);
}

#[test]
fn the_admin_may_differ_from_the_upgrade_authority() {
    // Key separation: the deploy key initialises, a different key administers.
    let mut env = Env::new();
    env.initialize_ok();
    let config: mandate::ProtocolConfig = env.load(&protocol_pda());
    assert_ne!(config.admin, env.upgrade_authority.pubkey());
}
