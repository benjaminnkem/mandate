//! Validation of mandate creation and bid parameters. Returns every distinct problem so callers can
//! explain all of them at once. The rules, their grouping and the resulting error names are the
//! contract shared with `@mandate/domain` and asserted by the golden vectors.
//!
//! All comparisons widen to `i128`, so no combination of inputs can overflow.
use crate::MandateCoreError;

/// The protocol limits validation consults.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtocolLimits {
    pub min_budget_raw: u64,
    pub max_budget_raw: u64,
    pub min_epoch_seconds: i64,
    pub max_epoch_seconds: i64,
    pub max_duration_seconds: i64,
    pub max_epochs: u32,
    pub max_spread_bps: u32,
    pub max_depth_band_bps: u32,
    pub min_probe_quote_raw: u64,
    pub max_probe_quote_raw: u64,
    pub min_start_lead_seconds: i64,
    pub position_lock_buffer_seconds: i64,
    pub min_setup_window_seconds: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CreateMandateParams {
    pub max_reward_raw: u64,
    pub bidding_ends_at: i64,
    pub start_at: i64,
    pub duration_seconds: i64,
    pub epoch_seconds: i64,
    pub max_effective_spread_bps: u32,
    pub depth_band_bps: u32,
    pub min_pool_buy_depth_quote_raw: u64,
    pub min_pool_sell_depth_quote_raw: u64,
    pub min_provider_quote_in_band_raw: u64,
    pub min_provider_base_quote_eq_in_band_raw: u64,
    pub probe_quote_raw: u64,
}

/// A set of distinct error codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ErrorSet(u32);

impl ErrorSet {
    pub fn insert(&mut self, error: MandateCoreError) {
        self.0 |= Self::bit(error);
    }

    pub const fn contains(&self, error: MandateCoreError) -> bool {
        self.0 & Self::bit(error) != 0
    }

    pub const fn is_empty(&self) -> bool {
        self.0 == 0
    }

    const fn bit(error: MandateCoreError) -> u32 {
        match 1u32.checked_shl(error as u32) {
            Some(bit) => bit,
            None => 0,
        }
    }

    /// The highest-priority error (declaration order), for callers that can return only one.
    pub fn first(&self) -> Option<MandateCoreError> {
        self.iter().next()
    }

    /// Members in declaration order.
    pub fn iter(&self) -> impl Iterator<Item = MandateCoreError> + '_ {
        MandateCoreError::ALL
            .into_iter()
            .filter(|error| self.contains(*error))
    }
}

/// Validate mandate creation parameters. Escrow must cover at least one raw unit per epoch.
pub fn validate_create_mandate(
    params: &CreateMandateParams,
    protocol: &ProtocolLimits,
    now: i64,
) -> ErrorSet {
    let mut errors = ErrorSet::default();
    let epoch = i128::from(params.epoch_seconds);
    let duration = i128::from(params.duration_seconds);
    let start = i128::from(params.start_at);

    let mut total_epochs: Option<i128> = None;
    if params.epoch_seconds < protocol.min_epoch_seconds
        || params.epoch_seconds > protocol.max_epoch_seconds
    {
        errors.insert(MandateCoreError::InvalidEpochLength);
    } else if params.duration_seconds <= 0
        || params.duration_seconds > protocol.max_duration_seconds
    {
        errors.insert(MandateCoreError::InvalidTiming);
    } else if let (Some(rem), Some(total)) =
        (duration.checked_rem(epoch), duration.checked_div(epoch))
    {
        if rem != 0 {
            errors.insert(MandateCoreError::InvalidEpochLength);
        } else {
            total_epochs = Some(total);
            if total > i128::from(protocol.max_epochs) {
                errors.insert(MandateCoreError::TooManyEpochs);
            }
        }
    } else {
        // Only reachable if protocol.min_epoch_seconds <= 0: a zero epoch is never valid.
        errors.insert(MandateCoreError::InvalidEpochLength);
    }

    let lock_at = start.saturating_sub(i128::from(protocol.position_lock_buffer_seconds));
    if params.bidding_ends_at <= now {
        errors.insert(MandateCoreError::InvalidTiming);
    }
    if start < i128::from(now).saturating_add(i128::from(protocol.min_start_lead_seconds)) {
        errors.insert(MandateCoreError::InvalidTiming);
    }
    if i128::from(params.bidding_ends_at)
        >= lock_at.saturating_sub(i128::from(protocol.min_setup_window_seconds))
    {
        errors.insert(MandateCoreError::InvalidTiming);
    }
    if let Some(total) = total_epochs {
        let end = epoch
            .checked_mul(total)
            .and_then(|span| start.checked_add(span));
        if start > 0
            && total <= i128::from(protocol.max_epochs)
            && end.is_none_or(|value| value > i128::from(i64::MAX))
        {
            errors.insert(MandateCoreError::ArithmeticOverflow);
        }
    }

    let budget = params.max_reward_raw;
    let below_epoch_count = total_epochs.is_some_and(|total| i128::from(budget) < total);
    if budget < protocol.min_budget_raw || budget > protocol.max_budget_raw || below_epoch_count {
        errors.insert(MandateCoreError::InvalidBudget);
    }

    if params.max_effective_spread_bps < 1
        || params.max_effective_spread_bps > protocol.max_spread_bps
        || params.depth_band_bps < 1
        || params.depth_band_bps > protocol.max_depth_band_bps
        || params.min_pool_buy_depth_quote_raw == 0
        || params.min_pool_sell_depth_quote_raw == 0
        || params.min_provider_quote_in_band_raw == 0
        || params.min_provider_base_quote_eq_in_band_raw == 0
        || params.probe_quote_raw < protocol.min_probe_quote_raw
        || params.probe_quote_raw > protocol.max_probe_quote_raw
    {
        errors.insert(MandateCoreError::InvalidThreshold);
    }
    errors
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BidParams {
    pub requested_reward_raw: u64,
    pub valid_until: i64,
    pub max_reward_raw: u64,
    pub now: i64,
    pub total_epochs: u32,
    /// Last instant a sponsor can still accept: the start of the provider's setup window.
    pub acceptance_cutoff: i64,
}

/// Validate a bid.
pub fn validate_bid(bid: &BidParams) -> ErrorSet {
    let mut errors = ErrorSet::default();
    if bid.requested_reward_raw == 0
        || bid.requested_reward_raw > bid.max_reward_raw
        || bid.requested_reward_raw < u64::from(bid.total_epochs)
    {
        errors.insert(MandateCoreError::InvalidBudget);
    }
    if bid.valid_until < bid.now {
        errors.insert(MandateCoreError::BidExpired);
    } else if bid.valid_until > bid.acceptance_cutoff {
        errors.insert(MandateCoreError::InvalidTiming);
    }
    errors
}
