//! The binary per-epoch compliance predicate (docs/TECHNICAL_SPEC.md section 6.12). Integer
//! comparisons only; equality passes; every metric must pass.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EpochMetrics {
    pub effective_spread_bps: u32,
    pub pool_buy_depth_quote_raw: u64,
    pub pool_sell_depth_quote_raw: u64,
    pub provider_quote_in_band_raw: u64,
    pub provider_base_quote_eq_in_band_raw: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Thresholds {
    pub max_effective_spread_bps: u32,
    pub min_pool_buy_depth_quote_raw: u64,
    pub min_pool_sell_depth_quote_raw: u64,
    pub min_provider_quote_in_band_raw: u64,
    pub min_provider_base_quote_eq_in_band_raw: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComplianceFailure {
    SpreadTooWide,
    PoolBuyDepthTooLow,
    PoolSellDepthTooLow,
    ProviderQuoteInBandTooLow,
    ProviderBaseInBandTooLow,
}

impl ComplianceFailure {
    pub const ALL: [ComplianceFailure; 5] = [
        Self::SpreadTooWide,
        Self::PoolBuyDepthTooLow,
        Self::PoolSellDepthTooLow,
        Self::ProviderQuoteInBandTooLow,
        Self::ProviderBaseInBandTooLow,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SpreadTooWide => "SpreadTooWide",
            Self::PoolBuyDepthTooLow => "PoolBuyDepthTooLow",
            Self::PoolSellDepthTooLow => "PoolSellDepthTooLow",
            Self::ProviderQuoteInBandTooLow => "ProviderQuoteInBandTooLow",
            Self::ProviderBaseInBandTooLow => "ProviderBaseInBandTooLow",
        }
    }

    const fn bit(self) -> u8 {
        match self {
            Self::SpreadTooWide => 1,
            Self::PoolBuyDepthTooLow => 2,
            Self::PoolSellDepthTooLow => 4,
            Self::ProviderQuoteInBandTooLow => 8,
            Self::ProviderBaseInBandTooLow => 16,
        }
    }
}

/// Outcome of the predicate: the set of failed metrics (empty means compliant).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Compliance {
    failures: u8,
}

impl Compliance {
    pub const fn is_compliant(&self) -> bool {
        self.failures == 0
    }

    pub const fn contains(&self, failure: ComplianceFailure) -> bool {
        self.failures & failure.bit() != 0
    }
}

pub fn evaluate_compliance(metrics: &EpochMetrics, thresholds: &Thresholds) -> Compliance {
    let mut failures = 0u8;
    let mut record = |failed: bool, failure: ComplianceFailure| {
        if failed {
            failures |= failure.bit();
        }
    };
    record(
        metrics.effective_spread_bps > thresholds.max_effective_spread_bps,
        ComplianceFailure::SpreadTooWide,
    );
    record(
        metrics.pool_buy_depth_quote_raw < thresholds.min_pool_buy_depth_quote_raw,
        ComplianceFailure::PoolBuyDepthTooLow,
    );
    record(
        metrics.pool_sell_depth_quote_raw < thresholds.min_pool_sell_depth_quote_raw,
        ComplianceFailure::PoolSellDepthTooLow,
    );
    record(
        metrics.provider_quote_in_band_raw < thresholds.min_provider_quote_in_band_raw,
        ComplianceFailure::ProviderQuoteInBandTooLow,
    );
    record(
        metrics.provider_base_quote_eq_in_band_raw
            < thresholds.min_provider_base_quote_eq_in_band_raw,
        ComplianceFailure::ProviderBaseInBandTooLow,
    );
    Compliance { failures }
}
