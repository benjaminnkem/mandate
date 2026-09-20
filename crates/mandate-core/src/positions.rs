//! Validation of a provider's registered position set (docs/TECHNICAL_SPEC.md section 5.8).
//! The program checks only shape: bounded, non-default, unique keys. Whether each key is really a DLMM
//! position owned by the provider is measured by observers, never claimed by the program.
use crate::{MandateCoreError, Result, MAX_POSITIONS};

const DEFAULT_KEY: [u8; 32] = [0u8; 32];

/// `1 <= count <= min(max_positions, MAX_POSITIONS)`, no default key, no duplicate.
pub fn validate_position_set(positions: &[[u8; 32]], max_positions: u8) -> Result<()> {
    let count = positions.len();
    if count == 0 || count > usize::from(max_positions) || count > MAX_POSITIONS {
        return Err(MandateCoreError::InvalidPositionSet);
    }
    for (i, key) in positions.iter().enumerate() {
        if *key == DEFAULT_KEY {
            return Err(MandateCoreError::InvalidPositionSet);
        }
        if positions.iter().take(i).any(|earlier| earlier == key) {
            return Err(MandateCoreError::DuplicatePosition);
        }
    }
    Ok(())
}
