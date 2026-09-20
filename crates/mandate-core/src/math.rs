//! Checked fixed-width integer helpers. Nothing wraps and nothing saturates silently.
use crate::{MandateCoreError, Result};

pub fn add_u64(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or(MandateCoreError::ArithmeticOverflow)
}

pub fn sub_u64(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or(MandateCoreError::ArithmeticOverflow)
}

pub fn mul_u64(a: u64, b: u64) -> Result<u64> {
    a.checked_mul(b).ok_or(MandateCoreError::ArithmeticOverflow)
}

pub fn div_u64(a: u64, b: u64) -> Result<u64> {
    a.checked_div(b).ok_or(MandateCoreError::DivisionByZero)
}

pub fn rem_u64(a: u64, b: u64) -> Result<u64> {
    a.checked_rem(b).ok_or(MandateCoreError::DivisionByZero)
}

/// `ceil(a / b)`.
pub fn ceil_div_u64(a: u64, b: u64) -> Result<u64> {
    let quotient = div_u64(a, b)?;
    if rem_u64(a, b)? == 0 {
        Ok(quotient)
    } else {
        // quotient < a / b + 1 <= u64::MAX + 1 only when b == 1, which has remainder 0, so this cannot overflow;
        // it is still checked.
        add_u64(quotient, 1)
    }
}

fn narrow_u64(value: u128) -> Result<u64> {
    u64::try_from(value).map_err(|_| MandateCoreError::ArithmeticOverflow)
}

/// `floor(a * b / c)` with a `u128` intermediate; the result must fit `u64`.
pub fn mul_div_floor_u64(a: u64, b: u64, c: u64) -> Result<u64> {
    let product = u128::from(a)
        .checked_mul(u128::from(b))
        .ok_or(MandateCoreError::ArithmeticOverflow)?;
    let quotient = product
        .checked_div(u128::from(c))
        .ok_or(MandateCoreError::DivisionByZero)?;
    narrow_u64(quotient)
}

/// `ceil(a * b / c)` with a `u128` intermediate; the result must fit `u64`.
pub fn mul_div_ceil_u64(a: u64, b: u64, c: u64) -> Result<u64> {
    let product = u128::from(a)
        .checked_mul(u128::from(b))
        .ok_or(MandateCoreError::ArithmeticOverflow)?;
    let divisor = u128::from(c);
    let quotient = product
        .checked_div(divisor)
        .ok_or(MandateCoreError::DivisionByZero)?;
    let remainder = product
        .checked_rem(divisor)
        .ok_or(MandateCoreError::DivisionByZero)?;
    let rounded = if remainder == 0 {
        quotient
    } else {
        quotient
            .checked_add(1)
            .ok_or(MandateCoreError::ArithmeticOverflow)?
    };
    narrow_u64(rounded)
}

/// Narrow an `i128` timestamp back to `i64`.
pub(crate) fn narrow_i64(value: i128) -> Result<i64> {
    i64::try_from(value).map_err(|_| MandateCoreError::ArithmeticOverflow)
}
