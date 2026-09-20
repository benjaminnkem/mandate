//! Verifies `mandate-core` against the shared golden vectors produced by the independent Python
//! oracle (`packages/domain/vectors/generate_golden.py`). The TypeScript package checks the same file.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use mandate_core::accounting::{AccountingState, Amount, EpochOutcome};
use mandate_core::compliance::{evaluate_compliance, ComplianceFailure, EpochMetrics, Thresholds};
use mandate_core::math::{
    add_u64, ceil_div_u64, div_u64, mul_div_ceil_u64, mul_div_floor_u64, mul_u64, sub_u64,
};
use mandate_core::reward::{epoch_reward, split_reward};
use mandate_core::timing::{
    acceptance_cutoff, build_schedule, epoch_bounds, epoch_position_at, EpochPosition,
    DEFAULT_SCHEDULE_BOUNDS,
};
use mandate_core::validation::{
    validate_bid, validate_create_mandate, BidParams, CreateMandateParams, ErrorSet, ProtocolLimits,
};
use mandate_core::{MandateCoreError, Result};
use serde_json::Value;
use std::collections::HashSet;

const VECTORS: &str = include_str!("../../../packages/domain/vectors/golden.json");

fn vectors() -> Value {
    serde_json::from_str(VECTORS).expect("golden.json parses")
}

fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key]
        .as_str()
        .unwrap_or_else(|| panic!("missing string {key} in {v}"))
}
fn u64_of(v: &Value, key: &str) -> u64 {
    text(v, key)
        .parse()
        .unwrap_or_else(|_| panic!("bad u64 {key} in {v}"))
}
fn i64_of(v: &Value, key: &str) -> i64 {
    text(v, key)
        .parse()
        .unwrap_or_else(|_| panic!("bad i64 {key} in {v}"))
}
fn u32_of(v: &Value, key: &str) -> u32 {
    u32::try_from(
        v[key]
            .as_u64()
            .unwrap_or_else(|| panic!("missing u32 {key} in {v}")),
    )
    .unwrap()
}

/// Compare a `Result<u64>` with a vector `expect` of the form `{"ok": "123"}` or `{"err": "Name"}`.
fn assert_u64_expect(result: Result<u64>, expect: &Value, context: &str) {
    match (result, expect.get("ok"), expect.get("err")) {
        (Ok(value), Some(ok), None) => {
            assert_eq!(value.to_string(), ok.as_str().unwrap(), "{context}");
        }
        (Err(error), None, Some(err)) => {
            assert_eq!(error.as_str(), err.as_str().unwrap(), "{context}");
        }
        (got, ..) => panic!("{context}: got {got:?}, expected {expect}"),
    }
}

#[test]
fn checked_math_matches_oracle() {
    for case in vectors()["checked_math"].as_array().unwrap() {
        let a = u64_of(case, "a");
        let b = u64_of(case, "b");
        let op = text(case, "op");
        let result = match op {
            "add" => add_u64(a, b),
            "sub" => sub_u64(a, b),
            "mul" => mul_u64(a, b),
            "div" => div_u64(a, b),
            "ceil_div" => ceil_div_u64(a, b),
            "mul_div_floor" => mul_div_floor_u64(a, b, u64_of(case, "c")),
            "mul_div_ceil" => mul_div_ceil_u64(a, b, u64_of(case, "c")),
            other => panic!("unknown op {other}"),
        };
        assert_u64_expect(result, &case["expect"], &case.to_string());
    }
}

#[test]
fn reward_split_matches_oracle() {
    for case in vectors()["reward_split"].as_array().unwrap() {
        let reward = u64_of(case, "reward");
        let epochs = u32_of(case, "epochs");
        if let Some(expect) = case.get("expect") {
            assert_eq!(
                split_reward(reward, epochs).unwrap_err().as_str(),
                expect["err"].as_str().unwrap()
            );
            continue;
        }
        let split = split_reward(reward, epochs).unwrap();
        assert_eq!(split.base.to_string(), text(case, "base"));
        assert_eq!(split.extra.to_string(), text(case, "extra"));
        if let Some(all) = case["all_epoch_rewards"].as_array() {
            let mut sum: u128 = 0;
            for (i, expected) in all.iter().enumerate() {
                let got = epoch_reward(reward, epochs, u32::try_from(i).unwrap()).unwrap();
                assert_eq!(got.to_string(), expected.as_str().unwrap());
                sum += u128::from(got);
            }
            assert_eq!(sum, u128::from(reward), "conservation for {case}");
        }
        for sampled in case["sampled"].as_array().unwrap() {
            let index = u32_of(sampled, "index");
            assert_u64_expect(
                epoch_reward(reward, epochs, index),
                &sampled["expect"],
                &sampled.to_string(),
            );
        }
    }
}

#[test]
fn schedule_matches_oracle() {
    for case in vectors()["schedule"].as_array().unwrap() {
        let result = build_schedule(
            i64_of(case, "start_at"),
            i64_of(case, "duration_seconds"),
            i64_of(case, "epoch_seconds"),
            &DEFAULT_SCHEDULE_BOUNDS,
        );
        let expect = &case["expect"];
        match (result, expect.get("ok"), expect.get("err")) {
            (Ok(schedule), Some(ok), None) => {
                assert_eq!(
                    u64::from(schedule.total_epochs),
                    ok["total_epochs"].as_u64().unwrap(),
                    "{case}"
                );
                assert_eq!(
                    schedule.end_at.to_string(),
                    ok["end_at"].as_str().unwrap(),
                    "{case}"
                );
            }
            (Err(error), None, Some(err)) => {
                assert_eq!(error.as_str(), err.as_str().unwrap(), "{case}")
            }
            (got, ..) => panic!("{case}: got {got:?}"),
        }
    }
}

#[test]
fn epoch_position_and_bounds_match_oracle() {
    let all = vectors();
    for case in all["timing"]["positions"].as_array().unwrap() {
        let position = epoch_position_at(
            i64_of(case, "start_at"),
            i64_of(case, "epoch_seconds"),
            u32_of(case, "total_epochs"),
            i64_of(case, "ts"),
        )
        .unwrap();
        let expect = &case["expect"];
        match expect["kind"].as_str().unwrap() {
            "NotStarted" => assert_eq!(position, EpochPosition::NotStarted, "{case}"),
            "Ended" => assert_eq!(position, EpochPosition::Ended, "{case}"),
            "Epoch" => assert_eq!(
                position,
                EpochPosition::Epoch(u32::try_from(expect["index"].as_u64().unwrap()).unwrap()),
                "{case}"
            ),
            other => panic!("unknown kind {other}"),
        }
    }
    for case in all["timing"]["bounds"].as_array().unwrap() {
        let result = epoch_bounds(
            i64_of(case, "start_at"),
            i64_of(case, "epoch_seconds"),
            u32_of(case, "total_epochs"),
            u32_of(case, "index"),
            i64_of(case, "recovery_seconds"),
        );
        let expect = &case["expect"];
        match (result, expect.get("ok"), expect.get("err")) {
            (Ok(b), Some(ok), None) => {
                assert_eq!(
                    b.epoch_start.to_string(),
                    ok["epoch_start"].as_str().unwrap(),
                    "{case}"
                );
                assert_eq!(
                    b.epoch_end.to_string(),
                    ok["epoch_end"].as_str().unwrap(),
                    "{case}"
                );
                assert_eq!(
                    b.recovery_deadline.to_string(),
                    ok["recovery_deadline"].as_str().unwrap(),
                    "{case}"
                );
            }
            (Err(error), None, Some(err)) => {
                assert_eq!(error.as_str(), err.as_str().unwrap(), "{case}")
            }
            (got, ..) => panic!("{case}: got {got:?}"),
        }
    }
}

#[test]
fn acceptance_cutoff_matches_oracle() {
    for case in vectors()["acceptance_cutoff"].as_array().unwrap() {
        let result = acceptance_cutoff(
            i64_of(case, "start_at"),
            i64_of(case, "position_lock_buffer_seconds"),
            i64_of(case, "min_setup_window_seconds"),
        );
        let expect = &case["expect"];
        match (result, expect.get("ok"), expect.get("err")) {
            (Ok(value), Some(ok), None) => {
                assert_eq!(value.to_string(), ok.as_str().unwrap(), "{case}")
            }
            (Err(error), None, Some(err)) => {
                assert_eq!(error.as_str(), err.as_str().unwrap(), "{case}")
            }
            (got, ..) => panic!("{case}: got {got:?}"),
        }
    }
}

#[test]
fn compliance_matches_oracle() {
    for case in vectors()["compliance"].as_array().unwrap() {
        let t = &case["thresholds"];
        let m = &case["metrics"];
        let result = evaluate_compliance(
            &EpochMetrics {
                effective_spread_bps: u32_of(m, "effective_spread_bps"),
                pool_buy_depth_quote_raw: u64_of(m, "pool_buy_depth_quote_raw"),
                pool_sell_depth_quote_raw: u64_of(m, "pool_sell_depth_quote_raw"),
                provider_quote_in_band_raw: u64_of(m, "provider_quote_in_band_raw"),
                provider_base_quote_eq_in_band_raw: u64_of(m, "provider_base_quote_eq_in_band_raw"),
            },
            &Thresholds {
                max_effective_spread_bps: u32_of(t, "max_effective_spread_bps"),
                min_pool_buy_depth_quote_raw: u64_of(t, "min_pool_buy_depth_quote_raw"),
                min_pool_sell_depth_quote_raw: u64_of(t, "min_pool_sell_depth_quote_raw"),
                min_provider_quote_in_band_raw: u64_of(t, "min_provider_quote_in_band_raw"),
                min_provider_base_quote_eq_in_band_raw: u64_of(
                    t,
                    "min_provider_base_quote_eq_in_band_raw",
                ),
            },
        );
        let expect = &case["expect"];
        assert_eq!(
            result.is_compliant(),
            expect["compliant"].as_bool().unwrap(),
            "{case}"
        );
        let got: Vec<&str> = ComplianceFailure::ALL
            .into_iter()
            .filter(|failure| result.contains(*failure))
            .map(ComplianceFailure::as_str)
            .collect();
        let want: Vec<&str> = expect["failures"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(got, want, "{case}");
    }
}

fn snapshot_matches(state: &AccountingState, after: &Value, context: &str) {
    let expect_u64 =
        |key: &str, got: u64| assert_eq!(got.to_string(), text(after, key), "{key} {context}");
    let expect_u32 = |key: &str, got: u32| {
        assert_eq!(
            u64::from(got),
            after[key].as_u64().unwrap(),
            "{key} {context}"
        )
    };
    expect_u32("finalized_epochs", state.finalized_epochs);
    expect_u32("compliant_epochs", state.compliant_epochs);
    expect_u32("noncompliant_epochs", state.noncompliant_epochs);
    expect_u32("unavailable_epochs", state.unavailable_epochs);
    expect_u64("earned_reward_raw", state.earned_reward_raw);
    expect_u64("forfeited_reward_raw", state.forfeited_reward_raw);
    expect_u64("claimed_reward_raw", state.claimed_reward_raw);
    expect_u64("sponsor_withdrawn_raw", state.sponsor_withdrawn_raw);
    expect_u64("claimable_raw", state.claimable_raw().unwrap());
    expect_u64("unresolved_raw", state.unresolved_reward_raw().unwrap());
    expect_u64(
        "sponsor_withdrawable_raw",
        state.sponsor_withdrawable_raw().unwrap(),
    );
    expect_u64("vault_balance_raw", state.vault_balance_raw().unwrap());
    assert_eq!(
        state.all_epochs_resolved(),
        after["all_epochs_resolved"].as_bool().unwrap(),
        "{context}"
    );
}

#[test]
fn accounting_scenarios_match_oracle() {
    for scenario in vectors()["accounting"].as_array().unwrap() {
        let name = text(scenario, "name");
        let mut state = AccountingState::new(
            u64_of(scenario, "max_reward_raw"),
            u64_of(scenario, "accepted_reward_raw"),
            u32_of(scenario, "total_epochs"),
        )
        .unwrap();
        let mut finalized: HashSet<u32> = HashSet::new();
        for step in scenario["steps"].as_array().unwrap() {
            let amount = || match step["amount"].as_str() {
                Some("all") => Amount::All,
                Some(value) => Amount::Exact(value.parse().unwrap()),
                None => panic!("missing amount"),
            };
            let result: Result<AccountingState> = match text(step, "op") {
                "finalize" => {
                    let index = u32_of(step, "index");
                    let outcome = match text(step, "outcome") {
                        "Compliant" => EpochOutcome::Compliant,
                        "NonCompliant" => EpochOutcome::NonCompliant,
                        _ => EpochOutcome::Unavailable,
                    };
                    let next = state.finalize_epoch(index, outcome, finalized.contains(&index));
                    if next.is_ok() {
                        finalized.insert(index);
                    }
                    next
                }
                "claim" => state.claim(amount()).map(|(next, _)| next),
                "withdraw" => state.sponsor_withdraw(amount()).map(|(next, _)| next),
                other => panic!("unknown op {other}"),
            };
            let context = format!("{name}: {step}");
            let expect = &step["expect"];
            match (result, expect.get("ok"), expect.get("err")) {
                (Ok(next), Some(_), None) => state = next,
                (Err(error), None, Some(err)) => {
                    assert_eq!(error.as_str(), err.as_str().unwrap(), "{context}")
                }
                (got, ..) => panic!("{context}: got {got:?}"),
            }
            snapshot_matches(&state, &step["after"], &context);
            state
                .assert_invariants()
                .unwrap_or_else(|e| panic!("{context}: invariant {e}"));
        }
    }
}

fn limits(p: &Value) -> ProtocolLimits {
    ProtocolLimits {
        min_budget_raw: u64_of(p, "min_budget_raw"),
        max_budget_raw: u64_of(p, "max_budget_raw"),
        min_epoch_seconds: i64_of(p, "min_epoch_seconds"),
        max_epoch_seconds: i64_of(p, "max_epoch_seconds"),
        max_duration_seconds: i64_of(p, "max_duration_seconds"),
        max_epochs: u32_of(p, "max_epochs"),
        max_spread_bps: u32_of(p, "max_spread_bps"),
        max_depth_band_bps: u32_of(p, "max_depth_band_bps"),
        min_probe_quote_raw: u64_of(p, "min_probe_quote_raw"),
        max_probe_quote_raw: u64_of(p, "max_probe_quote_raw"),
        min_start_lead_seconds: i64_of(p, "min_start_lead_seconds"),
        position_lock_buffer_seconds: i64_of(p, "position_lock_buffer_seconds"),
        min_setup_window_seconds: i64_of(p, "min_setup_window_seconds"),
    }
}

fn sorted_names(set: &ErrorSet) -> Vec<&'static str> {
    let mut names: Vec<&'static str> = set.iter().map(MandateCoreError::as_str).collect();
    names.sort_unstable();
    names
}

#[test]
fn validation_matches_oracle() {
    let all = vectors();
    let validation = &all["validation"];
    let protocol = limits(&validation["protocol"]);
    for case in validation["create_mandate"].as_array().unwrap() {
        let p = &case["params"];
        let params = CreateMandateParams {
            max_reward_raw: u64_of(p, "max_reward_raw"),
            bidding_ends_at: i64_of(p, "bidding_ends_at"),
            start_at: i64_of(p, "start_at"),
            duration_seconds: i64_of(p, "duration_seconds"),
            epoch_seconds: i64_of(p, "epoch_seconds"),
            max_effective_spread_bps: u32_of(p, "max_effective_spread_bps"),
            depth_band_bps: u32_of(p, "depth_band_bps"),
            min_pool_buy_depth_quote_raw: u64_of(p, "min_pool_buy_depth_quote_raw"),
            min_pool_sell_depth_quote_raw: u64_of(p, "min_pool_sell_depth_quote_raw"),
            min_provider_quote_in_band_raw: u64_of(p, "min_provider_quote_in_band_raw"),
            min_provider_base_quote_eq_in_band_raw: u64_of(
                p,
                "min_provider_base_quote_eq_in_band_raw",
            ),
            probe_quote_raw: u64_of(p, "probe_quote_raw"),
        };
        let got = sorted_names(&validate_create_mandate(
            &params,
            &protocol,
            i64_of(case, "now"),
        ));
        let want: Vec<&str> = case["expect"]["errors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(got, want, "create: {}", text(case, "name"));
    }
    for case in validation["bid"].as_array().unwrap() {
        let got = sorted_names(&validate_bid(&BidParams {
            requested_reward_raw: u64_of(case, "requested_reward_raw"),
            valid_until: i64_of(case, "valid_until"),
            max_reward_raw: u64_of(case, "max_reward_raw"),
            now: i64_of(case, "now"),
            total_epochs: u32_of(case, "total_epochs"),
            acceptance_cutoff: i64_of(case, "acceptance_cutoff"),
        }));
        let want: Vec<&str> = case["expect"]["errors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(got, want, "bid: {}", text(case, "name"));
    }
}
