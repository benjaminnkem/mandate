//! A minimal, fail-closed reader for the Meteora DLMM `LbPair` account.
//!
//! Trust boundary (docs/adr/0011): Mandate does not parse Meteora state generally. It reads exactly
//! three fields (`token_x_mint`, `token_y_mint`, `bin_step`) from a fixed layout taken from the
//! official IDL (`@meteora-ag/dlmm` 1.9.14) and verified byte for byte against a real mainnet account
//! (see `tests/meteora.rs`). Any deviation in size or discriminator is rejected, never guessed at.
//! Whether a pool is *appropriate* (liquidity, lifecycle, token extensions) remains an off-chain
//! admin review recorded in `prestocks_metadata_hash`.
use crate::{MandateCoreError, Result};

/// `LbPair` account size including the 8-byte Anchor discriminator.
pub const LB_PAIR_LEN: usize = 904;
/// Anchor discriminator of `LbPair`.
pub const LB_PAIR_DISCRIMINATOR: [u8; 8] = [33, 11, 49, 98, 181, 101, 177, 13];
const BIN_STEP_OFFSET: usize = 80;
const TOKEN_X_MINT_OFFSET: usize = 88;
const TOKEN_Y_MINT_OFFSET: usize = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LbPairView {
    pub token_x_mint: [u8; 32],
    pub token_y_mint: [u8; 32],
    pub bin_step: u16,
}

fn read_key(data: &[u8], offset: usize) -> Result<[u8; 32]> {
    let end = offset
        .checked_add(32)
        .ok_or(MandateCoreError::InvalidMarket)?;
    data.get(offset..end)
        .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
        .ok_or(MandateCoreError::InvalidMarket)
}

/// Read the pool's mints and bin step. Rejects any account that is not exactly an `LbPair`.
pub fn read_lb_pair(data: &[u8]) -> Result<LbPairView> {
    if data.len() != LB_PAIR_LEN {
        return Err(MandateCoreError::InvalidMarket);
    }
    if data.get(..8) != Some(&LB_PAIR_DISCRIMINATOR[..]) {
        return Err(MandateCoreError::InvalidMarket);
    }
    let step_end = BIN_STEP_OFFSET
        .checked_add(2)
        .ok_or(MandateCoreError::InvalidMarket)?;
    let bin_step = data
        .get(BIN_STEP_OFFSET..step_end)
        .and_then(|bytes| <[u8; 2]>::try_from(bytes).ok())
        .map(u16::from_le_bytes)
        .ok_or(MandateCoreError::InvalidMarket)?;
    Ok(LbPairView {
        token_x_mint: read_key(data, TOKEN_X_MINT_OFFSET)?,
        token_y_mint: read_key(data, TOKEN_Y_MINT_OFFSET)?,
        bin_step,
    })
}

/// Confirm the pool trades exactly `base` against `quote` (in either order) and report whether the
/// base token is the pool's token X. Anything else is `InvalidMarket`.
pub fn bind_pool_mints(view: &LbPairView, base: &[u8; 32], quote: &[u8; 32]) -> Result<bool> {
    if base == quote {
        return Err(MandateCoreError::InvalidMarket);
    }
    if view.token_x_mint == *base && view.token_y_mint == *quote {
        Ok(true)
    } else if view.token_y_mint == *base && view.token_x_mint == *quote {
        Ok(false)
    } else {
        Err(MandateCoreError::InvalidMarket)
    }
}
