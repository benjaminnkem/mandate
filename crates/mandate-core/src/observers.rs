//! Validation of an observer set (docs/TECHNICAL_SPEC.md section 5.3). Public keys are plain bytes
//! so this stays free of Solana types.
use crate::{MandateCoreError, Result, MAX_OBSERVERS};

const DEFAULT_KEY: [u8; 32] = [0u8; 32];

/// Rules: `1 <= count <= MAX_OBSERVERS`, `1 <= threshold <= count`, every key non-default and unique,
/// and no observer may be the protocol admin (key separation: an observer key is infrastructure,
/// never the admin identity).
pub fn validate_observer_set(
    observers: &[[u8; 32]],
    threshold: u8,
    admin: &[u8; 32],
) -> Result<()> {
    let count = observers.len();
    if count == 0 || count > MAX_OBSERVERS {
        return Err(MandateCoreError::InvalidObserverSet);
    }
    if threshold == 0 || usize::from(threshold) > count {
        return Err(MandateCoreError::InvalidObserverSet);
    }
    for (i, key) in observers.iter().enumerate() {
        if *key == DEFAULT_KEY || key == admin {
            return Err(MandateCoreError::InvalidObserverSet);
        }
        // Compare against every earlier key; the set is bounded by MAX_OBSERVERS.
        if observers.iter().take(i).any(|earlier| earlier == key) {
            return Err(MandateCoreError::DuplicateObserver);
        }
    }
    Ok(())
}
