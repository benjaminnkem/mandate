use anchor_lang::prelude::*;

use crate::constants::MAX_OBSERVERS;

/// One immutable observer set version. PDA `[b"observer_set", version_le_bytes]`.
///
/// No instruction mutates an `ObserverSet` after creation: a change of observers is a *new* version,
/// and only mandates created afterwards snapshot it. Existing mandates keep the version they bound.
#[account]
#[derive(InitSpace)]
pub struct ObserverSet {
    pub version_tag: u8,
    pub bump: u8,
    pub version: u32,
    pub observer_count: u8,
    pub threshold: u8,
    /// Unused slots are `Pubkey::default()`.
    pub observers: [Pubkey; MAX_OBSERVERS],
    pub created_at: i64,
}
