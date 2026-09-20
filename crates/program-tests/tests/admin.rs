#![allow(clippy::result_large_err)]

mod common;

use anchor_lang::error::ErrorCode;
use anchor_lang::prelude::Pubkey;
use common::*;
use mandate::MandateError;
use solana_signer::Signer;

fn setup() -> Env {
    let mut env = Env::new();
    env.initialize_ok();
    env
}

fn protocol(env: &Env) -> mandate::ProtocolConfig {
    env.load(&protocol_pda())
}

#[test]
fn two_step_transfer_hands_over_the_admin_role() {
    let mut env = setup();
    let successor = keypair();
    let old_admin = env.admin.pubkey();

    let ix = env.ix_propose_admin(old_admin, successor.pubkey());
    let sent = env.as_admin(&[ix]).expect("propose");
    assert_eq!(
        protocol(&env).admin,
        old_admin,
        "nothing changes until the nominee accepts"
    );
    assert_eq!(protocol(&env).pending_admin, successor.pubkey());
    let proposed = events::<mandate::events::AdminTransferProposed>(&sent.logs);
    assert_eq!(
        (proposed[0].admin, proposed[0].pending_admin),
        (old_admin, successor.pubkey())
    );

    let ix = env.ix_accept_admin(successor.pubkey());
    let sent = env.send(&[ix], &[&successor]).expect("accept");
    let config = protocol(&env);
    assert_eq!(config.admin, successor.pubkey());
    assert!(!config.has_pending_admin(), "pending nomination is cleared");
    let accepted = events::<mandate::events::AdminTransferAccepted>(&sent.logs);
    assert_eq!(
        (accepted[0].previous_admin, accepted[0].new_admin),
        (old_admin, successor.pubkey())
    );

    // The old admin has lost every power; the new admin holds them.
    let ix = env.ix_set_paused(old_admin, true);
    assert_fails_with(env.as_admin(&[ix]), MandateError::UnauthorizedAdmin);
    let ix = env.ix_set_paused(successor.pubkey(), true);
    env.send(&[ix], &[&successor]).expect("new admin can pause");
    assert!(protocol(&env).paused_new_risk);
}

#[test]
fn a_nomination_alone_grants_nothing() {
    let mut env = setup();
    let nominee = keypair();
    let ix = env.ix_propose_admin(env.admin.pubkey(), nominee.pubkey());
    env.as_admin(&[ix]).unwrap();
    let ix = env.ix_set_paused(nominee.pubkey(), true);
    assert_fails_with(
        env.send(&[ix], &[&nominee]),
        MandateError::UnauthorizedAdmin,
    );
    assert!(!protocol(&env).paused_new_risk);
}

#[test]
fn only_the_admin_can_propose_or_cancel() {
    let mut env = setup();
    let stranger = keypair();
    let ix = env.ix_propose_admin(stranger.pubkey(), stranger.pubkey());
    assert_fails_with(
        env.send(&[ix], &[&stranger]),
        MandateError::UnauthorizedAdmin,
    );

    let ix = env.ix_propose_admin(env.admin.pubkey(), keypair().pubkey());
    env.as_admin(&[ix]).unwrap();
    let ix = env.ix_cancel_admin_transfer(stranger.pubkey());
    assert_fails_with(
        env.send(&[ix], &[&stranger]),
        MandateError::UnauthorizedAdmin,
    );
    assert!(
        protocol(&env).has_pending_admin(),
        "a stranger cannot cancel"
    );
}

#[test]
fn proposals_reject_the_default_key_and_the_current_admin() {
    let mut env = setup();
    let ix = env.ix_propose_admin(env.admin.pubkey(), Pubkey::default());
    assert_fails_with(env.as_admin(&[ix]), MandateError::InvalidAdmin);
    let ix = env.ix_propose_admin(env.admin.pubkey(), env.admin.pubkey());
    assert_fails_with(env.as_admin(&[ix]), MandateError::InvalidAdmin);
    assert!(!protocol(&env).has_pending_admin());
}

#[test]
fn only_the_nominee_can_accept() {
    let mut env = setup();
    let nominee = keypair();
    let stranger = keypair();
    let ix = env.ix_propose_admin(env.admin.pubkey(), nominee.pubkey());
    env.as_admin(&[ix]).unwrap();

    let ix = env.ix_accept_admin(stranger.pubkey());
    assert_fails_with(
        env.send(&[ix], &[&stranger]),
        MandateError::UnauthorizedPendingAdmin,
    );
    // even the current admin cannot accept on the nominee's behalf
    let ix = env.ix_accept_admin(env.admin.pubkey());
    assert_fails_with(env.as_admin(&[ix]), MandateError::UnauthorizedPendingAdmin);
    assert_eq!(protocol(&env).admin, env.admin.pubkey());
}

#[test]
fn the_nominee_must_actually_sign() {
    let mut env = setup();
    let nominee = keypair();
    let ix = env.ix_propose_admin(env.admin.pubkey(), nominee.pubkey());
    env.as_admin(&[ix]).unwrap();
    let mut ix = env.ix_accept_admin(nominee.pubkey());
    ix.accounts[1].is_signer = false;
    assert_fails_with_framework(env.send(&[ix], &[]), ErrorCode::AccountNotSigner);
}

#[test]
fn accepting_with_no_pending_transfer_fails() {
    let mut env = setup();
    // The default key cannot sign, so this is checked with any signer: there is nothing to accept.
    let anyone = keypair();
    let ix = env.ix_accept_admin(anyone.pubkey());
    assert_fails_with(env.send(&[ix], &[&anyone]), MandateError::NoPendingAdmin);
}

#[test]
fn a_nomination_can_be_cancelled_and_replaced() {
    let mut env = setup();
    let first = keypair();
    let second = keypair();
    let admin = env.admin.pubkey();

    let ix = env.ix_propose_admin(admin, first.pubkey());
    env.as_admin(&[ix]).unwrap();
    let ix = env.ix_cancel_admin_transfer(admin);
    let sent = env.as_admin(&[ix]).unwrap();
    assert!(!protocol(&env).has_pending_admin());
    let cancelled = events::<mandate::events::AdminTransferCancelled>(&sent.logs);
    assert_eq!(cancelled[0].cancelled_pending_admin, first.pubkey());

    // The cancelled nominee can no longer accept.
    let ix = env.ix_accept_admin(first.pubkey());
    assert_fails_with(env.send(&[ix], &[&first]), MandateError::NoPendingAdmin);

    // Proposing again replaces the previous nomination.
    let ix = env.ix_propose_admin(admin, first.pubkey());
    env.as_admin(&[ix]).unwrap();
    let ix = env.ix_propose_admin(admin, second.pubkey());
    env.as_admin(&[ix]).unwrap();
    let ix = env.ix_accept_admin(first.pubkey());
    assert_fails_with(
        env.send(&[ix], &[&first]),
        MandateError::UnauthorizedPendingAdmin,
    );
    let ix = env.ix_accept_admin(second.pubkey());
    env.send(&[ix], &[&second]).unwrap();
    assert_eq!(protocol(&env).admin, second.pubkey());
}

#[test]
fn cancelling_with_nothing_pending_fails() {
    let mut env = setup();
    let ix = env.ix_cancel_admin_transfer(env.admin.pubkey());
    assert_fails_with(env.as_admin(&[ix]), MandateError::NoPendingAdmin);
}

#[test]
fn a_transfer_cannot_be_accepted_twice() {
    let mut env = setup();
    let nominee = keypair();
    let ix = env.ix_propose_admin(env.admin.pubkey(), nominee.pubkey());
    env.as_admin(&[ix]).unwrap();
    let ix = env.ix_accept_admin(nominee.pubkey());
    env.send(&[ix], &[&nominee]).unwrap();
    let ix = env.ix_accept_admin(nominee.pubkey());
    assert_fails_with(env.send(&[ix], &[&nominee]), MandateError::NoPendingAdmin);
}

#[test]
fn the_admin_signature_is_required() {
    let mut env = setup();
    let mut ix = env.ix_set_paused(env.admin.pubkey(), true);
    ix.accounts[1].is_signer = false;
    assert_fails_with_framework(env.send(&[ix], &[]), ErrorCode::AccountNotSigner);
}

#[test]
fn a_substituted_protocol_account_is_rejected() {
    let mut env = setup();
    let mut ix = env.ix_set_paused(env.admin.pubkey(), true);
    ix.accounts[0].pubkey = env.pool; // not the protocol PDA
    let result = env.as_admin(&[ix]);
    assert!(result.is_err());
    assert!(!protocol(&env).paused_new_risk);
}

#[test]
fn pause_toggles_and_emits() {
    let mut env = setup();
    let admin = env.admin.pubkey();
    let ix = env.ix_set_paused(admin, true);
    let sent = env.as_admin(&[ix]).unwrap();
    assert!(protocol(&env).paused_new_risk);
    assert!(events::<mandate::events::NewRiskPauseChanged>(&sent.logs)[0].paused);
    let ix = env.ix_set_paused(admin, false);
    let sent = env.as_admin(&[ix]).unwrap();
    assert!(!protocol(&env).paused_new_risk);
    assert!(!events::<mandate::events::NewRiskPauseChanged>(&sent.logs)[0].paused);

    let stranger = keypair();
    let ix = env.ix_set_paused(stranger.pubkey(), true);
    assert_fails_with(
        env.send(&[ix], &[&stranger]),
        MandateError::UnauthorizedAdmin,
    );
}

#[test]
fn an_uninitialized_protocol_rejects_admin_calls() {
    let mut env = Env::new();
    let ix = env.ix_set_paused(env.admin.pubkey(), true);
    assert!(env.as_admin(&[ix]).is_err());
}
