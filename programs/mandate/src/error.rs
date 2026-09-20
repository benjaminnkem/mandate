use anchor_lang::prelude::*;
use mandate_core::MandateCoreError;

/// Typed errors. Settlement failures are never collapsed into a generic argument error
/// (docs/TECHNICAL_SPEC.md section 20).
#[error_code]
pub enum MandateError {
    #[msg("New risk is paused")]
    ProtocolPaused,
    #[msg("Signer is not the protocol admin")]
    UnauthorizedAdmin,
    #[msg("Signer is not the program upgrade authority")]
    UnauthorizedInitializer,
    #[msg("Signer is not the pending admin")]
    UnauthorizedPendingAdmin,
    #[msg("There is no pending admin transfer")]
    NoPendingAdmin,
    #[msg("Invalid admin address")]
    InvalidAdmin,
    #[msg("USDC mint or token program is invalid")]
    InvalidUsdcAccount,
    #[msg("Protocol parameters are invalid")]
    InvalidProtocolParams,
    #[msg("Observer set is invalid")]
    InvalidObserverSet,
    #[msg("Observer set contains a duplicate observer")]
    DuplicateObserver,
    #[msg("Market is invalid")]
    InvalidMarket,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Market is disabled")]
    MarketDisabled,
    #[msg("Timing parameters are invalid")]
    InvalidTiming,
    #[msg("Epoch length is invalid")]
    InvalidEpochLength,
    #[msg("Too many epochs")]
    TooManyEpochs,
    #[msg("Budget is invalid")]
    InvalidBudget,
    #[msg("A threshold is invalid")]
    InvalidThreshold,
    #[msg("Signer is not the sponsor")]
    UnauthorizedSponsor,
    #[msg("Mandate is not accepting bids")]
    MandateNotBidding,
    #[msg("A bid has already been accepted")]
    BidAlreadyAccepted,
    #[msg("Reward vault does not hold the expected balance")]
    VaultMismatch,
    #[msg("Bidding has closed")]
    BiddingClosed,
    #[msg("The acceptance deadline has passed")]
    AcceptanceClosed,
    #[msg("Bid has expired")]
    BidExpired,
    #[msg("Bid is not active")]
    BidNotActive,
    #[msg("Bid cannot be closed yet")]
    BidNotClosable,
    #[msg("Bid does not belong to this mandate")]
    BidMismatch,
    #[msg("Signer is not the bid's provider")]
    UnauthorizedProvider,
    #[msg("Mandate has not been awarded")]
    MandateNotAwarded,
    #[msg("Nothing to withdraw")]
    NothingToWithdraw,
    #[msg("Withdrawal exceeds the amount available to the sponsor")]
    WithdrawExceedsAvailable,
    #[msg("Unexpected settlement error")]
    Unexpected,
}

impl From<MandateCoreError> for MandateError {
    fn from(error: MandateCoreError) -> Self {
        match error {
            MandateCoreError::InvalidProtocolParams => Self::InvalidProtocolParams,
            MandateCoreError::InvalidObserverSet => Self::InvalidObserverSet,
            MandateCoreError::DuplicateObserver => Self::DuplicateObserver,
            MandateCoreError::InvalidMarket => Self::InvalidMarket,
            MandateCoreError::ArithmeticOverflow => Self::ArithmeticOverflow,
            MandateCoreError::InvalidTiming => Self::InvalidTiming,
            MandateCoreError::InvalidEpochLength => Self::InvalidEpochLength,
            MandateCoreError::TooManyEpochs => Self::TooManyEpochs,
            MandateCoreError::InvalidBudget => Self::InvalidBudget,
            MandateCoreError::BidExpired => Self::BidExpired,
            MandateCoreError::NothingToWithdraw => Self::NothingToWithdraw,
            MandateCoreError::WithdrawExceedsAvailable => Self::WithdrawExceedsAvailable,
            MandateCoreError::InvalidThreshold => Self::InvalidThreshold,
            _ => Self::Unexpected,
        }
    }
}
