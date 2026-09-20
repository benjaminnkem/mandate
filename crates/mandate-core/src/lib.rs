//! Pure settlement logic for Mandate: checked integer math, epoch timing, reward split,
//! the compliance predicate, exact reward accounting and creation/bid validation.
//!
//! No Solana or Anchor dependency, so it can be tested exhaustively and its behaviour is verified
//! against `@mandate/domain` through shared golden vectors produced by an independent Python
//! oracle (`packages/domain/vectors/generate_golden.py`).
//!
//! Every fallible operation returns [`MandateCoreError`]; nothing here panics or wraps.
#![forbid(unsafe_code)]

pub mod accounting;
pub mod compliance;
pub mod error;
pub mod math;
pub mod meteora;
pub mod observers;
pub mod positions;
pub mod protocol;
pub mod reward;
pub mod timing;
pub mod validation;

pub use error::MandateCoreError;

/// Result alias for every fallible operation in this crate.
pub type Result<T> = core::result::Result<T, MandateCoreError>;

/// Protocol constants (docs/TECHNICAL_SPEC.md section 5.1). Final values are per deployment.
pub const MAX_OBSERVERS: usize = 5;
pub const MAX_POSITIONS: usize = 8;
pub const MAX_EPOCHS: u32 = 2_016;
pub const MAX_DURATION_SECONDS: i64 = 30 * 24 * 60 * 60;
pub const MIN_EPOCH_SECONDS: i64 = 60;
pub const MAX_EPOCH_SECONDS: i64 = 60 * 60;
pub const BPS_DENOM: u64 = 10_000;
