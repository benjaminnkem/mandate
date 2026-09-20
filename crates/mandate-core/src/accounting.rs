//! Exact reward accounting for one mandate, derived from a handful of counters and fixed invariants:
//!
//! ```text
//! earned + forfeited + unresolved == accepted
//! claimed <= earned <= accepted <= max
//! vault == max - claimed - sponsor_withdrawn
//! vault >= (earned - claimed) + unresolved
//! ```
use crate::math::{add_u64, sub_u64};
use crate::reward::epoch_reward;
use crate::{MandateCoreError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EpochOutcome {
    Compliant,
    NonCompliant,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccountingState {
    pub max_reward_raw: u64,
    pub accepted_reward_raw: u64,
    pub total_epochs: u32,
    pub finalized_epochs: u32,
    pub compliant_epochs: u32,
    pub noncompliant_epochs: u32,
    pub unavailable_epochs: u32,
    pub earned_reward_raw: u64,
    /// Sum of rewards of epochs finalized NonCompliant or Unavailable.
    pub forfeited_reward_raw: u64,
    pub claimed_reward_raw: u64,
    pub sponsor_withdrawn_raw: u64,
}

/// An amount to move, or everything currently available.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Amount {
    All,
    Exact(u64),
}

impl AccountingState {
    pub fn new(max_reward_raw: u64, accepted_reward_raw: u64, total_epochs: u32) -> Result<Self> {
        if total_epochs == 0 {
            return Err(MandateCoreError::InvalidEpochLength);
        }
        if accepted_reward_raw > max_reward_raw {
            return Err(MandateCoreError::InvalidBudget);
        }
        Ok(Self {
            max_reward_raw,
            accepted_reward_raw,
            total_epochs,
            finalized_epochs: 0,
            compliant_epochs: 0,
            noncompliant_epochs: 0,
            unavailable_epochs: 0,
            earned_reward_raw: 0,
            forfeited_reward_raw: 0,
            claimed_reward_raw: 0,
            sponsor_withdrawn_raw: 0,
        })
    }

    pub const fn all_epochs_resolved(&self) -> bool {
        self.finalized_epochs == self.total_epochs
    }

    /// Earned by the provider and not yet claimed.
    pub fn claimable_raw(&self) -> Result<u64> {
        sub_u64(self.earned_reward_raw, self.claimed_reward_raw)
    }

    /// Reward of epochs still undecided.
    pub fn unresolved_reward_raw(&self) -> Result<u64> {
        sub_u64(
            sub_u64(self.accepted_reward_raw, self.earned_reward_raw)?,
            self.forfeited_reward_raw,
        )
    }

    /// USDC still held by the reward vault.
    pub fn vault_balance_raw(&self) -> Result<u64> {
        sub_u64(
            sub_u64(self.max_reward_raw, self.claimed_reward_raw)?,
            self.sponsor_withdrawn_raw,
        )
    }

    /// Award surplus at any time, plus every forfeited reward once all epochs are resolved,
    /// less what was already withdrawn.
    pub fn sponsor_withdrawable_raw(&self) -> Result<u64> {
        let surplus = sub_u64(self.max_reward_raw, self.accepted_reward_raw)?;
        let forfeited = if self.all_epochs_resolved() {
            sub_u64(self.accepted_reward_raw, self.earned_reward_raw)?
        } else {
            0
        };
        sub_u64(add_u64(surplus, forfeited)?, self.sponsor_withdrawn_raw)
    }

    /// Record one epoch's final outcome. `already_finalized` comes from the caller (the program
    /// knows through the epoch's unique result account); counters cannot tell which epochs are done.
    pub fn finalize_epoch(
        &self,
        index: u32,
        outcome: EpochOutcome,
        already_finalized: bool,
    ) -> Result<Self> {
        if index >= self.total_epochs {
            return Err(MandateCoreError::EpochOutOfRange);
        }
        if already_finalized || self.finalized_epochs >= self.total_epochs {
            return Err(MandateCoreError::EpochAlreadyFinalized);
        }
        let reward = epoch_reward(self.accepted_reward_raw, self.total_epochs, index)?;
        let mut next = *self;
        next.finalized_epochs = bump(self.finalized_epochs)?;
        match outcome {
            EpochOutcome::Compliant => {
                next.compliant_epochs = bump(self.compliant_epochs)?;
                next.earned_reward_raw = add_u64(self.earned_reward_raw, reward)?;
            }
            EpochOutcome::NonCompliant => {
                next.noncompliant_epochs = bump(self.noncompliant_epochs)?;
                next.forfeited_reward_raw = add_u64(self.forfeited_reward_raw, reward)?;
            }
            EpochOutcome::Unavailable => {
                next.unavailable_epochs = bump(self.unavailable_epochs)?;
                next.forfeited_reward_raw = add_u64(self.forfeited_reward_raw, reward)?;
            }
        }
        Ok(next)
    }

    /// Provider claim. Returns the new state and the amount moved.
    pub fn claim(&self, amount: Amount) -> Result<(Self, u64)> {
        let available = self.claimable_raw()?;
        let amount_raw = match amount {
            Amount::All => available,
            Amount::Exact(value) => value,
        };
        if amount_raw == 0 || available == 0 {
            return Err(MandateCoreError::NothingToClaim);
        }
        if amount_raw > available {
            return Err(MandateCoreError::ClaimExceedsEarned);
        }
        let mut next = *self;
        next.claimed_reward_raw = add_u64(self.claimed_reward_raw, amount_raw)?;
        Ok((next, amount_raw))
    }

    /// Sponsor withdrawal of surplus and forfeited funds.
    pub fn sponsor_withdraw(&self, amount: Amount) -> Result<(Self, u64)> {
        let available = self.sponsor_withdrawable_raw()?;
        let amount_raw = match amount {
            Amount::All => available,
            Amount::Exact(value) => value,
        };
        if amount_raw == 0 || available == 0 {
            return Err(MandateCoreError::NothingToWithdraw);
        }
        if amount_raw > available {
            return Err(MandateCoreError::WithdrawExceedsAvailable);
        }
        let mut next = *self;
        next.sponsor_withdrawn_raw = add_u64(self.sponsor_withdrawn_raw, amount_raw)?;
        Ok((next, amount_raw))
    }

    /// Check every conservation invariant. Any failure is `InvariantViolation`.
    pub fn assert_invariants(&self) -> Result<()> {
        let bad = || MandateCoreError::InvariantViolation;
        let accounted =
            add_u64(self.earned_reward_raw, self.forfeited_reward_raw).map_err(|_| bad())?;
        if accounted > self.accepted_reward_raw
            || self.claimed_reward_raw > self.earned_reward_raw
            || self.accepted_reward_raw > self.max_reward_raw
        {
            return Err(bad());
        }
        let outflow =
            add_u64(self.claimed_reward_raw, self.sponsor_withdrawn_raw).map_err(|_| bad())?;
        if outflow > self.max_reward_raw {
            return Err(bad());
        }
        let releasable = Self {
            sponsor_withdrawn_raw: 0,
            ..*self
        }
        .sponsor_withdrawable_raw()
        .map_err(|_| bad())?;
        if self.sponsor_withdrawn_raw > releasable {
            return Err(bad());
        }
        let owed = add_u64(
            self.claimable_raw().map_err(|_| bad())?,
            self.unresolved_reward_raw().map_err(|_| bad())?,
        )
        .map_err(|_| bad())?;
        if self.vault_balance_raw().map_err(|_| bad())? < owed {
            return Err(bad());
        }
        let counted = self
            .compliant_epochs
            .checked_add(self.noncompliant_epochs)
            .and_then(|sum| sum.checked_add(self.unavailable_epochs))
            .ok_or_else(bad)?;
        if counted != self.finalized_epochs {
            return Err(bad());
        }
        Ok(())
    }
}

fn bump(counter: u32) -> Result<u32> {
    counter
        .checked_add(1)
        .ok_or(MandateCoreError::ArithmeticOverflow)
}
