#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use mandate_core::observers::validate_observer_set;
use mandate_core::protocol::{validate_protocol_params, ProtocolParams};
use mandate_core::MandateCoreError;

fn params() -> ProtocolParams {
    ProtocolParams {
        min_budget_raw: 1_000,
        max_budget_raw: 1_000_000_000_000,
        min_epoch_seconds: 60,
        max_epoch_seconds: 3_600,
        max_duration_seconds: 30 * 86_400,
        max_epochs: 2_016,
        max_spread_bps: 1_000,
        max_depth_band_bps: 2_000,
        max_positions: 8,
        min_probe_quote_raw: 1_000_000,
        max_probe_quote_raw: 1_000_000_000,
        min_start_lead_seconds: 1_200,
        position_lock_buffer_seconds: 300,
        min_setup_window_seconds: 600,
        unavailable_recovery_seconds: 3_600,
    }
}

fn invalid(mutate: impl FnOnce(&mut ProtocolParams)) -> bool {
    let mut p = params();
    mutate(&mut p);
    validate_protocol_params(&p) == Err(MandateCoreError::InvalidProtocolParams)
}

#[test]
fn baseline_params_are_valid() {
    assert_eq!(validate_protocol_params(&params()), Ok(()));
}

#[test]
fn every_bound_is_enforced() {
    assert!(invalid(|p| p.min_budget_raw = 0));
    assert!(invalid(|p| p.min_budget_raw = p.max_budget_raw + 1));
    assert!(invalid(|p| p.min_epoch_seconds = 0));
    assert!(invalid(|p| p.min_epoch_seconds = p.max_epoch_seconds + 1));
    assert!(invalid(|p| p.max_duration_seconds = 0));
    assert!(invalid(|p| p.max_duration_seconds = 30 * 86_400 + 1));
    assert!(invalid(|p| p.max_epochs = 0));
    assert!(invalid(|p| p.max_epochs = 2_017));
    assert!(invalid(|p| p.max_spread_bps = 0));
    assert!(invalid(|p| p.max_spread_bps = 10_001));
    assert!(invalid(|p| p.max_depth_band_bps = 0));
    assert!(invalid(|p| p.max_depth_band_bps = 10_000));
    assert!(invalid(|p| p.max_positions = 0));
    assert!(invalid(|p| p.max_positions = 9));
    assert!(invalid(|p| p.min_probe_quote_raw = 0));
    assert!(invalid(
        |p| p.min_probe_quote_raw = p.max_probe_quote_raw + 1
    ));
    assert!(invalid(|p| p.min_start_lead_seconds = -1));
    assert!(invalid(|p| p.position_lock_buffer_seconds = -1));
    assert!(invalid(|p| p.min_setup_window_seconds = -1));
    assert!(invalid(|p| p.unavailable_recovery_seconds = -1));
    assert!(invalid(|p| p.unavailable_recovery_seconds = 30 * 86_400 + 1));
}

#[test]
fn boundary_values_are_accepted() {
    let mut p = params();
    p.max_epochs = 2_016;
    p.max_positions = 8;
    p.max_depth_band_bps = 9_999;
    p.max_spread_bps = 10_000;
    p.max_duration_seconds = 30 * 86_400;
    p.unavailable_recovery_seconds = 30 * 86_400;
    p.min_epoch_seconds = p.max_epoch_seconds;
    assert_eq!(validate_protocol_params(&p), Ok(()));
}

#[test]
fn start_lead_must_leave_a_bidding_window() {
    // lead == lock buffer + setup window leaves zero time to bid: rejected; one second more is accepted.
    assert!(invalid(|p| p.min_start_lead_seconds = 900));
    let mut p = params();
    p.min_start_lead_seconds = 901;
    assert_eq!(validate_protocol_params(&p), Ok(()));
}

#[test]
fn overflowing_reserved_time_is_rejected_not_wrapped() {
    assert!(invalid(|p| {
        p.position_lock_buffer_seconds = i64::MAX;
        p.min_setup_window_seconds = i64::MAX;
    }));
}

fn key(n: u8) -> [u8; 32] {
    [n; 32]
}

#[test]
fn observer_set_accepts_valid_shapes() {
    let admin = key(200);
    assert_eq!(validate_observer_set(&[key(1)], 1, &admin), Ok(()));
    assert_eq!(
        validate_observer_set(&[key(1), key(2), key(3)], 2, &admin),
        Ok(())
    );
    assert_eq!(
        validate_observer_set(&[key(1), key(2), key(3), key(4), key(5)], 5, &admin),
        Ok(())
    );
}

#[test]
fn observer_set_bounds() {
    let admin = key(200);
    assert_eq!(
        validate_observer_set(&[], 1, &admin),
        Err(MandateCoreError::InvalidObserverSet)
    );
    let six = [key(1), key(2), key(3), key(4), key(5), key(6)];
    assert_eq!(
        validate_observer_set(&six, 3, &admin),
        Err(MandateCoreError::InvalidObserverSet)
    );
    assert_eq!(
        validate_observer_set(&[key(1), key(2)], 0, &admin),
        Err(MandateCoreError::InvalidObserverSet)
    );
    assert_eq!(
        validate_observer_set(&[key(1), key(2)], 3, &admin),
        Err(MandateCoreError::InvalidObserverSet)
    );
}

#[test]
fn observer_set_rejects_default_duplicate_and_admin_keys() {
    let admin = key(200);
    assert_eq!(
        validate_observer_set(&[[0u8; 32], key(2)], 1, &admin),
        Err(MandateCoreError::InvalidObserverSet)
    );
    assert_eq!(
        validate_observer_set(&[key(1), key(2), key(1)], 2, &admin),
        Err(MandateCoreError::DuplicateObserver)
    );
    assert_eq!(
        validate_observer_set(&[key(1), key(1)], 1, &admin),
        Err(MandateCoreError::DuplicateObserver)
    );
    assert_eq!(
        validate_observer_set(&[key(1), admin], 1, &admin),
        Err(MandateCoreError::InvalidObserverSet)
    );
}

use mandate_core::positions::validate_position_set;

#[test]
fn position_sets_are_bounded_nonempty_unique_and_nondefault() {
    let k = |n: u8| [n; 32];
    assert_eq!(validate_position_set(&[k(1)], 8), Ok(()));
    let eight: Vec<[u8; 32]> = (1..=8).map(k).collect();
    assert_eq!(validate_position_set(&eight, 8), Ok(()));
    let nine: Vec<[u8; 32]> = (1..=9).map(k).collect();
    assert_eq!(
        validate_position_set(&nine, 8),
        Err(MandateCoreError::InvalidPositionSet)
    );
    assert_eq!(
        validate_position_set(&[], 8),
        Err(MandateCoreError::InvalidPositionSet)
    );
    // a protocol that allows fewer than the hard cap
    assert_eq!(
        validate_position_set(&[k(1), k(2), k(3)], 2),
        Err(MandateCoreError::InvalidPositionSet)
    );
    assert_eq!(validate_position_set(&[k(1), k(2)], 2), Ok(()));
    // a protocol limit above the hard cap cannot lift it
    assert_eq!(
        validate_position_set(&nine, 200),
        Err(MandateCoreError::InvalidPositionSet)
    );
    assert_eq!(
        validate_position_set(&[[0u8; 32]], 8),
        Err(MandateCoreError::InvalidPositionSet)
    );
    assert_eq!(
        validate_position_set(&[k(1), k(2), k(1)], 8),
        Err(MandateCoreError::DuplicatePosition)
    );
    assert_eq!(
        validate_position_set(&[k(5), k(5)], 8),
        Err(MandateCoreError::DuplicatePosition)
    );
}
