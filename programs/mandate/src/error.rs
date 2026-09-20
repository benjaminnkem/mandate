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
            _ => Self::Unexpected,
        }
    }
}
