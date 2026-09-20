use anchor_lang::prelude::*;

/// PDA seeds. Every account address in the protocol is derived from these; nothing is chosen by a caller.
#[constant]
pub const PROTOCOL_SEED: &[u8] = b"protocol";
#[constant]
pub const OBSERVER_SET_SEED: &[u8] = b"observer_set";
#[constant]
pub const MARKET_SEED: &[u8] = b"market";

/// USDC has 6 decimals. The protocol refuses any other reward mint.
pub const USDC_DECIMALS: u8 = 6;

/// Account layout versions, so a future migration can recognise old accounts.
pub const PROTOCOL_VERSION: u8 = 1;
pub const OBSERVER_SET_VERSION: u8 = 1;
pub const MARKET_VERSION: u8 = 1;

/// Maximum observers, mirrored from `mandate_core` so account sizes are compile-time constants.
pub const MAX_OBSERVERS: usize = mandate_core::MAX_OBSERVERS;
