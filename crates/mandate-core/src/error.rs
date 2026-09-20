/// Settlement error codes. Names match `DomainErrorCode` in `@mandate/domain` and
/// docs/TECHNICAL_SPEC.md section 20; golden vectors assert them by name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum MandateCoreError {
    ArithmeticOverflow,
    DivisionByZero,
    InvalidEpochLength,
    InvalidTiming,
    TooManyEpochs,
    InvalidBudget,
    InvalidThreshold,
    BidExpired,
    EpochOutOfRange,
    EpochAlreadyFinalized,
    NothingToClaim,
    ClaimExceedsEarned,
    NothingToWithdraw,
    WithdrawExceedsAvailable,
    InvariantViolation,
    InvalidProtocolParams,
    InvalidObserverSet,
    DuplicateObserver,
    InvalidMarket,
}

impl MandateCoreError {
    /// All variants, in declaration order.
    pub const ALL: [MandateCoreError; 19] = [
        Self::ArithmeticOverflow,
        Self::DivisionByZero,
        Self::InvalidEpochLength,
        Self::InvalidTiming,
        Self::TooManyEpochs,
        Self::InvalidBudget,
        Self::InvalidThreshold,
        Self::BidExpired,
        Self::EpochOutOfRange,
        Self::EpochAlreadyFinalized,
        Self::NothingToClaim,
        Self::ClaimExceedsEarned,
        Self::NothingToWithdraw,
        Self::WithdrawExceedsAvailable,
        Self::InvariantViolation,
        Self::InvalidProtocolParams,
        Self::InvalidObserverSet,
        Self::DuplicateObserver,
        Self::InvalidMarket,
    ];

    /// The stable code name shared with TypeScript and the golden vectors.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ArithmeticOverflow => "ArithmeticOverflow",
            Self::DivisionByZero => "DivisionByZero",
            Self::InvalidEpochLength => "InvalidEpochLength",
            Self::InvalidTiming => "InvalidTiming",
            Self::TooManyEpochs => "TooManyEpochs",
            Self::InvalidBudget => "InvalidBudget",
            Self::InvalidThreshold => "InvalidThreshold",
            Self::BidExpired => "BidExpired",
            Self::EpochOutOfRange => "EpochOutOfRange",
            Self::EpochAlreadyFinalized => "EpochAlreadyFinalized",
            Self::NothingToClaim => "NothingToClaim",
            Self::ClaimExceedsEarned => "ClaimExceedsEarned",
            Self::NothingToWithdraw => "NothingToWithdraw",
            Self::WithdrawExceedsAvailable => "WithdrawExceedsAvailable",
            Self::InvariantViolation => "InvariantViolation",
            Self::InvalidProtocolParams => "InvalidProtocolParams",
            Self::InvalidObserverSet => "InvalidObserverSet",
            Self::DuplicateObserver => "DuplicateObserver",
            Self::InvalidMarket => "InvalidMarket",
        }
    }
}

impl core::fmt::Display for MandateCoreError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl core::error::Error for MandateCoreError {}
