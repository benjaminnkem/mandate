//! Epoch schedule and timing. Epoch `i` covers `[start + i*E, start + (i+1)*E)`: start inclusive,
//! end exclusive, so a timestamp on a boundary belongs to the later epoch.
use crate::math::narrow_i64;
use crate::{
    MandateCoreError, Result, MAX_DURATION_SECONDS, MAX_EPOCHS, MAX_EPOCH_SECONDS,
    MIN_EPOCH_SECONDS,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScheduleBounds {
    pub min_epoch_seconds: i64,
    pub max_epoch_seconds: i64,
    pub max_duration_seconds: i64,
    pub max_epochs: u32,
}

pub const DEFAULT_SCHEDULE_BOUNDS: ScheduleBounds = ScheduleBounds {
    min_epoch_seconds: MIN_EPOCH_SECONDS,
    max_epoch_seconds: MAX_EPOCH_SECONDS,
    max_duration_seconds: MAX_DURATION_SECONDS,
    max_epochs: MAX_EPOCHS,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Schedule {
    pub start_at: i64,
    pub epoch_seconds: i64,
    pub total_epochs: u32,
    pub end_at: i64,
}

/// Build the fixed schedule. Rule order is part of the contract (golden vectors assert which error wins).
pub fn build_schedule(
    start_at: i64,
    duration_seconds: i64,
    epoch_seconds: i64,
    bounds: &ScheduleBounds,
) -> Result<Schedule> {
    if epoch_seconds < bounds.min_epoch_seconds
        || epoch_seconds > bounds.max_epoch_seconds
        || epoch_seconds <= 0
    {
        return Err(MandateCoreError::InvalidEpochLength);
    }
    if duration_seconds <= 0 || duration_seconds > bounds.max_duration_seconds || start_at <= 0 {
        return Err(MandateCoreError::InvalidTiming);
    }
    let remainder = duration_seconds
        .checked_rem(epoch_seconds)
        .ok_or(MandateCoreError::InvalidEpochLength)?;
    if remainder != 0 {
        return Err(MandateCoreError::InvalidEpochLength);
    }
    let total = duration_seconds
        .checked_div(epoch_seconds)
        .ok_or(MandateCoreError::InvalidEpochLength)?;
    if total > i64::from(bounds.max_epochs) {
        return Err(MandateCoreError::TooManyEpochs);
    }
    let end_at = epoch_seconds
        .checked_mul(total)
        .and_then(|span| start_at.checked_add(span))
        .ok_or(MandateCoreError::ArithmeticOverflow)?;
    let total_epochs = u32::try_from(total).map_err(|_| MandateCoreError::TooManyEpochs)?;
    Ok(Schedule {
        start_at,
        epoch_seconds,
        total_epochs,
        end_at,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EpochPosition {
    NotStarted,
    Ended,
    Epoch(u32),
}

/// Which epoch a timestamp falls in.
pub fn epoch_position_at(
    start_at: i64,
    epoch_seconds: i64,
    total_epochs: u32,
    ts: i64,
) -> Result<EpochPosition> {
    let span = i128::from(epoch_seconds)
        .checked_mul(i128::from(total_epochs))
        .ok_or(MandateCoreError::ArithmeticOverflow)?;
    let end_at = i128::from(start_at)
        .checked_add(span)
        .ok_or(MandateCoreError::ArithmeticOverflow)?;
    if ts < start_at {
        return Ok(EpochPosition::NotStarted);
    }
    if i128::from(ts) >= end_at {
        return Ok(EpochPosition::Ended);
    }
    let elapsed = i128::from(ts)
        .checked_sub(i128::from(start_at))
        .ok_or(MandateCoreError::ArithmeticOverflow)?;
    let index = elapsed
        .checked_div(i128::from(epoch_seconds))
        .ok_or(MandateCoreError::InvalidEpochLength)?;
    let index = u32::try_from(index).map_err(|_| MandateCoreError::ArithmeticOverflow)?;
    Ok(EpochPosition::Epoch(index))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EpochBounds {
    pub epoch_start: i64,
    /// Exclusive end. An epoch can be finalized once the clock reaches this instant.
    pub epoch_end: i64,
    /// Earliest instant an unavailable finalization may run: epoch end plus the recovery window.
    pub recovery_deadline: i64,
}

pub fn epoch_bounds(
    start_at: i64,
    epoch_seconds: i64,
    total_epochs: u32,
    index: u32,
    unavailable_recovery_seconds: i64,
) -> Result<EpochBounds> {
    if index >= total_epochs {
        return Err(MandateCoreError::EpochOutOfRange);
    }
    let offset = i128::from(index)
        .checked_mul(i128::from(epoch_seconds))
        .ok_or(MandateCoreError::ArithmeticOverflow)?;
    let epoch_start = i128::from(start_at)
        .checked_add(offset)
        .ok_or(MandateCoreError::ArithmeticOverflow)?;
    let epoch_end = epoch_start
        .checked_add(i128::from(epoch_seconds))
        .ok_or(MandateCoreError::ArithmeticOverflow)?;
    let recovery_deadline = epoch_end
        .checked_add(i128::from(unavailable_recovery_seconds))
        .ok_or(MandateCoreError::ArithmeticOverflow)?;
    Ok(EpochBounds {
        epoch_start: narrow_i64(epoch_start)?,
        epoch_end: narrow_i64(epoch_end)?,
        recovery_deadline: narrow_i64(recovery_deadline)?,
    })
}
