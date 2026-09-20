//! Exact reward split. `base = floor(R / N)`, `extra = R mod N`; epochs `0..N-2` earn `base` and the
//! final epoch earns `base + extra`, so the maximum earnable equals the accepted reward exactly.
use crate::math::{add_u64, div_u64, rem_u64};
use crate::{MandateCoreError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RewardSplit {
    pub base: u64,
    pub extra: u64,
}

pub fn split_reward(accepted_reward_raw: u64, total_epochs: u32) -> Result<RewardSplit> {
    let n = u64::from(total_epochs);
    Ok(RewardSplit {
        base: div_u64(accepted_reward_raw, n)?,
        extra: rem_u64(accepted_reward_raw, n)?,
    })
}

/// Reward a compliant epoch earns.
pub fn epoch_reward(accepted_reward_raw: u64, total_epochs: u32, index: u32) -> Result<u64> {
    let split = split_reward(accepted_reward_raw, total_epochs)?;
    if index >= total_epochs {
        return Err(MandateCoreError::EpochOutOfRange);
    }
    // `index < total_epochs`, so `total_epochs >= 1` and this subtraction cannot underflow.
    let last = total_epochs
        .checked_sub(1)
        .ok_or(MandateCoreError::EpochOutOfRange)?;
    if index == last {
        add_u64(split.base, split.extra)
    } else {
        Ok(split.base)
    }
}
