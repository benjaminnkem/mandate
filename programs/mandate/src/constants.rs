use anchor_lang::prelude::*;

/// PDA seeds. Every account address in the protocol is derived from these; nothing is chosen by a caller.
#[constant]
pub const PROTOCOL_SEED: &[u8] = b"protocol";
#[constant]
pub const OBSERVER_SET_SEED: &[u8] = b"observer_set";
#[constant]
pub const MARKET_SEED: &[u8] = b"market";
#[constant]
pub const MANDATE_SEED: &[u8] = b"mandate";
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";
#[constant]
pub const BID_SEED: &[u8] = b"bid";
#[constant]
pub const POSITION_SET_SEED: &[u8] = b"position_set";
#[constant]
pub const ATTESTATION_SEED: &[u8] = b"attestation";

/// USDC has 6 decimals. The protocol refuses any other reward mint.
pub const USDC_DECIMALS: u8 = 6;

/// Account layout versions, so a future migration can recognise old accounts.
pub const PROTOCOL_VERSION: u8 = 1;
pub const OBSERVER_SET_VERSION: u8 = 1;
pub const MARKET_VERSION: u8 = 1;
pub const MANDATE_VERSION: u8 = 1;
pub const BID_VERSION: u8 = 1;
pub const POSITION_SET_VERSION: u8 = 1;
pub const ATTESTATION_VERSION: u8 = 1;

/// Measurement algorithm versions this build accepts attestations for (docs/methodology/measurement-v1.md).
/// A mandate binds `CURRENT_ALGORITHM_VERSION` at creation; supporting a new version is a deliberate program
/// upgrade that adds it here, never a runtime choice by an observer.
pub const SUPPORTED_ALGORITHM_VERSIONS: [u32; 1] = [1];
pub const CURRENT_ALGORITHM_VERSION: u32 = 1;

/// The largest possible effective spread: `ceil(2*|Q0-S0|*10000/(Q0+S0))` is at most 20_000 for positive probes.
pub const MAX_SPREAD_BPS_ATTESTABLE: u32 = 20_000;

/// Maximum observers, mirrored from `mandate_core` so account sizes are compile-time constants.
pub const MAX_OBSERVERS: usize = mandate_core::MAX_OBSERVERS;
/// Maximum registered positions, mirrored from `mandate_core` so account sizes are compile-time constants.
pub const MAX_POSITIONS: usize = mandate_core::MAX_POSITIONS;
