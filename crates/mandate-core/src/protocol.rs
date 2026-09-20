//! Validation of protocol-level parameters (docs/TECHNICAL_SPEC.md section 5.2 and ADR 0009).
//! Pure: these rules are enforced by `initialize_protocol` and unit-tested here.
use crate::{MandateCoreError, Result, MAX_DURATION_SECONDS, MAX_EPOCHS, MAX_POSITIONS};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtocolParams {
    pub min_budget_raw: u64,
    pub max_budget_raw: u64,
    pub min_epoch_seconds: i64,
    pub max_epoch_seconds: i64,
    pub max_duration_seconds: i64,
    pub max_epochs: u32,
    pub max_spread_bps: u32,
    pub max_depth_band_bps: u32,
    pub max_positions: u8,
    pub min_probe_quote_raw: u64,
    pub max_probe_quote_raw: u64,
    pub min_start_lead_seconds: i64,
    pub position_lock_buffer_seconds: i64,
    pub min_setup_window_seconds: i64,
    pub unavailable_recovery_seconds: i64,
}

/// Every bound is explicit and finite. Returns `InvalidProtocolParams` for the first violation.
pub fn validate_protocol_params(p: &ProtocolParams) -> Result<()> {
    let bad = MandateCoreError::InvalidProtocolParams;
    let ok = p.min_budget_raw >= 1
        && p.min_budget_raw <= p.max_budget_raw
        && p.min_epoch_seconds >= 1
        && p.min_epoch_seconds <= p.max_epoch_seconds
        && p.max_duration_seconds >= 1
        && p.max_duration_seconds <= MAX_DURATION_SECONDS
        && p.max_epochs >= 1
        && p.max_epochs <= MAX_EPOCHS
        && p.max_spread_bps >= 1
        && p.max_spread_bps <= 10_000
        && p.max_depth_band_bps >= 1
        && p.max_depth_band_bps <= 9_999
        && p.max_positions >= 1
        && usize::from(p.max_positions) <= MAX_POSITIONS
        && p.min_probe_quote_raw >= 1
        && p.min_probe_quote_raw <= p.max_probe_quote_raw
        && p.min_start_lead_seconds >= 0
        && p.position_lock_buffer_seconds >= 0
        && p.min_setup_window_seconds >= 0
        && p.unavailable_recovery_seconds >= 0
        && p.unavailable_recovery_seconds <= MAX_DURATION_SECONDS;
    if !ok {
        return Err(bad);
    }
    // A mandate needs a non-empty bidding window: the start lead must exceed the lock buffer plus
    // the provider's setup window, otherwise no valid creation timing exists.
    let reserved = p
        .position_lock_buffer_seconds
        .checked_add(p.min_setup_window_seconds)
        .ok_or(bad)?;
    if p.min_start_lead_seconds <= reserved {
        return Err(bad);
    }
    Ok(())
}
