#![allow(clippy::result_large_err)]

mod common;

use common::*;
use mandate::{MandateError, MandateStatus};
use mandate_core::accounting::{AccountingState, Amount, EpochOutcome};
use solana_keypair::Keypair;
use solana_signer::Signer;

const MAX: u64 = 1_000 * USDC;

fn vault(l: &Live) -> u64 {
    l.env.token_amount(&vault_pda(&l.mandate))
}

/// Three epochs, accepted 900 USDC (300 each): epoch 0 compliant, 1 non-compliant, 2 unavailable.
fn settled_mixed() -> Live {
    let mut l = Live::new();
    l.reshape(3, 900 * USDC);
    l.settle(0, Some(true));
    l.settle(1, Some(false));
    l.settle(2, None);
    l
}

#[test]
fn the_provider_claims_exactly_what_it_earned_and_no_more() {
    let mut l = Live::new();
    l.reshape(3, 900 * USDC);
    l.settle(0, Some(true));
    let dest = l.provider_usdc();
    assert_fails_with(
        l.claim(&dest, 300 * USDC + 1),
        MandateError::ClaimExceedsEarned,
    );
    assert_fails_with(l.claim(&dest, 0), MandateError::NothingToClaim);
    let sent = l.claim(&dest, 120 * USDC).expect("partial claim");
    assert_eq!(l.env.token_amount(&dest), 120 * USDC);
    assert_eq!(vault(&l), MAX - 120 * USDC);
    assert_eq!(l.mandate_state().claimed_reward_raw, 120 * USDC);
    let e = events::<mandate::events::ProviderRewardClaimed>(&sent.logs);
    assert_eq!(
        (e[0].amount_raw, e[0].total_claimed_raw),
        (120 * USDC, 120 * USDC)
    );
    // The rest, and then nothing more.
    l.claim(&dest, 180 * USDC).expect("rest");
    assert_fails_with(l.claim(&dest, 1), MandateError::NothingToClaim);
    assert_eq!(l.env.token_amount(&dest), 300 * USDC);
}

#[test]
fn nothing_is_claimable_before_an_epoch_is_finalized_compliant() {
    let mut l = Live::new();
    let dest = l.provider_usdc();
    assert_fails_with(l.claim(&dest, 1), MandateError::NothingToClaim);
    l.reshape(3, 900 * USDC);
    l.settle(0, Some(false));
    assert_fails_with(l.claim(&dest, 1), MandateError::NothingToClaim);
    assert_eq!(l.mandate_state().claimed_reward_raw, 0);
}

#[test]
fn only_the_accepted_provider_can_claim_and_only_to_its_own_account() {
    let mut l = Live::new();
    l.reshape(3, 900 * USDC);
    l.settle(0, Some(true));
    // The sponsor, an observer, the admin and a stranger all fail.
    let copies = [
        Keypair::new_from_array(*l.sponsor.secret_bytes()),
        Keypair::new_from_array(*l.observers[0].secret_bytes()),
        Keypair::new_from_array(*l.env.admin.secret_bytes()),
        keypair(),
    ];
    for who in &copies {
        // Each impostor claims into a USDC account it owns itself, so only the provider check can stop it.
        let own = l.env.add_token_account(&who.pubkey(), 0);
        let ix = l.ix_claim(&who.pubkey(), &own, 1);
        assert!(l.env.send(&[ix], &[who]).is_err());
        assert_eq!(l.env.token_amount(&own), 0);
    }
    // The provider cannot redirect the payout to somebody else's account.
    let someone_else = keypair().pubkey();
    let stolen = l.env.add_token_account(&someone_else, 0);
    assert!(l.claim(&stolen, 1).is_err());
    assert_eq!(l.env.token_amount(&stolen), 0);
    assert_eq!(l.mandate_state().claimed_reward_raw, 0);
}

#[test]
fn the_sponsor_can_never_take_earned_money_and_gets_the_rest_when_resolved() {
    let mut l = Live::new();
    l.reshape(3, 900 * USDC);
    let before = l.env.token_amount(&l.sponsor_usdc);
    // Award surplus only, while epochs are open.
    assert_fails_with(
        l.sponsor_withdraw(100 * USDC + 1),
        MandateError::WithdrawExceedsAvailable,
    );
    l.sponsor_withdraw(100 * USDC).expect("surplus");
    l.settle(0, Some(true));
    l.settle(1, Some(false));
    assert_fails_with(l.sponsor_withdraw(1), MandateError::NothingToWithdraw);
    l.settle(2, Some(true));
    // All resolved: forfeited epoch 1 (300) is now released; earned 600 is not.
    assert_fails_with(
        l.sponsor_withdraw(300 * USDC + 1),
        MandateError::WithdrawExceedsAvailable,
    );
    l.sponsor_withdraw(300 * USDC).expect("forfeited");
    assert_eq!(l.env.token_amount(&l.sponsor_usdc), before + 400 * USDC);
    assert_eq!(
        vault(&l),
        600 * USDC,
        "exactly the provider's earned reward remains"
    );
    let dest = l.provider_usdc();
    l.claim(&dest, 600 * USDC).expect("claim all");
    assert_eq!(vault(&l), 0);
}

#[test]
fn exits_survive_a_pause() {
    let mut l = settled_mixed();
    let admin = l.env.admin.pubkey();
    let ix = l.env.ix_set_paused(admin, true);
    l.env.as_admin(&[ix]).expect("pause");
    let dest = l.provider_usdc();
    l.claim(&dest, 300 * USDC).expect("claim while paused");
    l.sponsor_withdraw(600 * USDC + 100 * USDC)
        .expect("refund while paused");
    l.close().expect("close while paused");
}

#[test]
fn close_needs_full_resolution_and_an_empty_vault_and_keeps_the_records() {
    let mut l = Live::new();
    l.reshape(3, 900 * USDC);
    l.settle(0, Some(true));
    assert_fails_with(l.close(), MandateError::MandateNotClosable);
    l.settle(1, Some(true));
    l.settle(2, Some(true));
    assert_fails_with(l.close(), MandateError::MandateNotClosable); // funds remain
    let dest = l.provider_usdc();
    l.claim(&dest, 900 * USDC).expect("claim");
    assert_fails_with(l.close(), MandateError::MandateNotClosable); // sponsor surplus remains
    l.sponsor_withdraw(100 * USDC).expect("surplus");
    let sponsor_lamports = l.env.svm.get_balance(&l.sponsor.pubkey()).unwrap();
    let sent = l.close().expect("close");
    assert_eq!(l.mandate_state().status, MandateStatus::Closed);
    assert!(l
        .env
        .svm
        .get_account(&vault_pda(&l.mandate))
        .is_none_or(|a| a.lamports == 0));
    assert!(
        l.env.svm.get_balance(&l.sponsor.pubkey()).unwrap() > sponsor_lamports,
        "rent returns to the sponsor"
    );
    assert_eq!(
        l.result(2).reward_earned_raw,
        300 * USDC,
        "epoch records remain"
    );
    assert_eq!(
        events::<mandate::events::MandateClosed>(&sent.logs)[0].claimed_reward_raw,
        900 * USDC
    );
    // Nothing further can be done with a closed mandate.
    assert!(l.close().is_err());
    assert!(l.claim(&dest, 1).is_err());
}

#[test]
fn close_cannot_be_used_to_redirect_rent_or_swap_the_vault() {
    let mut l = settled_mixed();
    let dest = l.provider_usdc();
    l.claim(&dest, 300 * USDC).unwrap();
    l.sponsor_withdraw(700 * USDC).unwrap();
    let ix = l.ix_close(keypair().pubkey());
    assert_fails_with(l.env.send(&[ix], &[]), MandateError::UnauthorizedSponsor);
    l.close().expect("to the sponsor");
}

// ---- randomized state machine --------------------------------------------------------------

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*: deterministic, so any failure reproduces from its seed.
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
}

/// Random valid and invalid operations against a real vault, checked after every step against the pure
/// accounting model and the conservation invariants. Any divergence fails with the seed.
#[test]
fn randomized_sequences_conserve_every_unit() {
    for seed in 1..=12u64 {
        let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
        let mut l = Live::new();
        let epochs = 3 + rng.below(4) as u32; // 3..=6
        let accepted = 500 * USDC + rng.below(400 * USDC) + 1; // odd raw amounts exercise the remainder
        l.reshape(epochs, accepted);
        let dest = l.provider_usdc();
        let mut model = AccountingState::new(MAX, accepted, epochs).unwrap();
        let mut next_epoch = 0u32;
        let mut provider_received = 0u64;
        let mut sponsor_received = 0u64;
        let mut closed = false;

        for step in 0..40 {
            let ctx = format!("seed {seed} step {step}");
            match rng.below(4) {
                0 if next_epoch < epochs => {
                    let pick = rng.below(3);
                    let (outcome, arg) = match pick {
                        0 => (EpochOutcome::Compliant, Some(true)),
                        1 => (EpochOutcome::NonCompliant, Some(false)),
                        _ => (EpochOutcome::Unavailable, None),
                    };
                    l.settle(next_epoch, arg);
                    model = model.finalize_epoch(next_epoch, outcome, false).unwrap();
                    next_epoch += 1;
                }
                1 => {
                    let claimable = model.claimable_raw().unwrap();
                    let amount = rng.below(claimable + 3);
                    let result = l.claim(&dest, amount);
                    match model.claim(Amount::Exact(amount)) {
                        Ok((next, moved)) if amount != 0 => {
                            result.unwrap_or_else(|e| {
                                panic!("{ctx}: claim {amount} refused: {:?}", e.err)
                            });
                            model = next;
                            provider_received += moved;
                        }
                        _ => assert!(
                            result.is_err(),
                            "{ctx}: claim {amount} should fail (claimable {claimable})"
                        ),
                    }
                }
                2 => {
                    let available = model.sponsor_withdrawable_raw().unwrap();
                    let amount = rng.below(available + 3);
                    let result = l.sponsor_withdraw(amount);
                    match model.sponsor_withdraw(Amount::Exact(amount)) {
                        Ok((next, moved)) if amount != 0 => {
                            result.unwrap_or_else(|e| {
                                panic!("{ctx}: withdraw {amount} refused: {:?}", e.err)
                            });
                            model = next;
                            sponsor_received += moved;
                        }
                        _ => assert!(
                            result.is_err(),
                            "{ctx}: withdraw {amount} should fail (available {available})"
                        ),
                    }
                }
                _ => {
                    let closable =
                        model.all_epochs_resolved() && model.vault_balance_raw().unwrap() == 0;
                    let result = l.close();
                    assert_eq!(result.is_ok(), closable, "{ctx}: close");
                    if closable {
                        closed = true;
                        break;
                    }
                }
            }
            // The chain agrees with the model after every step, and the model's invariants hold.
            let m = l.mandate_state();
            assert_eq!(m.accounting(), model, "{ctx}: mandate counters");
            assert_eq!(
                vault(&l),
                model.vault_balance_raw().unwrap(),
                "{ctx}: vault"
            );
            model
                .assert_invariants()
                .unwrap_or_else(|e| panic!("{ctx}: invariant {e:?}"));
            assert!(
                vault(&l)
                    >= model.claimable_raw().unwrap() + model.unresolved_reward_raw().unwrap(),
                "{ctx}: vault covers every possible provider entitlement"
            );
            assert_eq!(
                provider_received + sponsor_received + vault(&l),
                MAX,
                "{ctx}: conservation"
            );
        }
        if closed {
            assert_eq!(
                provider_received + sponsor_received,
                MAX,
                "seed {seed}: closed with everything paid out"
            );
            assert_eq!(l.mandate_state().status, MandateStatus::Closed);
            continue;
        }
        // Drive to the end, drain, and close: every unit is accounted for.
        while next_epoch < epochs {
            l.settle(next_epoch, Some(rng.below(2) == 0));
            next_epoch += 1;
        }
        let m = l.mandate_state();
        let claim = m.earned_reward_raw - m.claimed_reward_raw;
        if claim > 0 {
            l.claim(&dest, claim).unwrap();
            provider_received += claim;
        }
        let now = l.mandate_state().accounting();
        let refund = now.sponsor_withdrawable_raw().unwrap();
        if refund > 0 {
            l.sponsor_withdraw(refund).unwrap();
            sponsor_received += refund;
        }
        assert_eq!(vault(&l), 0, "seed {seed}: fully drained before closing");
        if l.mandate_state().status != MandateStatus::Closed {
            l.close()
                .unwrap_or_else(|e| panic!("seed {seed}: final close: {:?}", e.err));
        }
        assert_eq!(
            provider_received + sponsor_received,
            MAX,
            "seed {seed}: every raw unit went to exactly one party"
        );
        assert_eq!(l.env.token_amount(&dest), provider_received);
        let m = l.mandate_state();
        assert_eq!(provider_received, m.claimed_reward_raw);
        assert_eq!(m.earned_reward_raw + m.forfeited_reward_raw, accepted);
    }
}
