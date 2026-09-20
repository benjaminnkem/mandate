use anchor_lang::prelude::*;

use crate::constants::MAX_POSITIONS;

/// The provider's registered Meteora position accounts for one mandate. PDA `[b"position_set", mandate]`.
///
/// Mutable only before the mandate's `position_lock_at`; after that instant it can never change, so a
/// provider cannot swap which positions count after seeing a measurement. The program checks only the
/// shape of the set (bounded, unique, non-default). It makes NO claim that a key is a real DLMM position
/// or that the provider owns it: observers verify that against Meteora state and record the result.
#[account]
#[derive(InitSpace)]
pub struct PositionSet {
    pub version: u8,
    pub bump: u8,
    pub mandate: Pubkey,
    pub provider: Pubkey,
    pub position_count: u8,
    /// Unused slots are `Pubkey::default()`.
    pub positions: [Pubkey; MAX_POSITIONS],
    /// The lock instant (the mandate's `position_lock_at`), recorded for readers.
    pub locked_at: i64,
}
