//! Proves the LbPair reader against the REAL on-chain bytes of the OPENAI/USDC pool.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use mandate_core::meteora::{bind_pool_mints, read_lb_pair, LB_PAIR_DISCRIMINATOR, LB_PAIR_LEN};
use mandate_core::MandateCoreError;

const POOL_HEX: &str = include_str!("fixtures/lbpair-openai-usdc.hex");

fn hex(text: &str) -> Vec<u8> {
    let text = text.trim();
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}
fn key(text: &str) -> [u8; 32] {
    hex(text).try_into().unwrap()
}

// Public keys as bytes, from `PublicKey.toBytes()`.
const OPENAI: &str = "05daec0529e52bbf67f6ff1e146a9eb6ace7fc4ea31ca4bc9f15e10fe3719728";
const USDC: &str = "c6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61";

#[test]
fn reads_the_real_pool() {
    let data = hex(POOL_HEX);
    assert_eq!(data.len(), LB_PAIR_LEN);
    let view = read_lb_pair(&data).unwrap();
    assert_eq!(view.token_x_mint, key(OPENAI));
    assert_eq!(view.token_y_mint, key(USDC));
    assert_eq!(view.bin_step, 50);
}

#[test]
fn binds_the_exact_mints_and_reports_orientation() {
    let view = read_lb_pair(&hex(POOL_HEX)).unwrap();
    assert_eq!(bind_pool_mints(&view, &key(OPENAI), &key(USDC)), Ok(true)); // base is X
    assert_eq!(bind_pool_mints(&view, &key(USDC), &key(OPENAI)), Ok(false)); // base is Y
}

#[test]
fn rejects_the_wrong_mints() {
    let view = read_lb_pair(&hex(POOL_HEX)).unwrap();
    let other = [7u8; 32];
    assert_eq!(
        bind_pool_mints(&view, &other, &key(USDC)),
        Err(MandateCoreError::InvalidMarket)
    );
    assert_eq!(
        bind_pool_mints(&view, &key(OPENAI), &other),
        Err(MandateCoreError::InvalidMarket)
    );
    assert_eq!(
        bind_pool_mints(&view, &key(OPENAI), &key(OPENAI)),
        Err(MandateCoreError::InvalidMarket)
    );
}

#[test]
fn rejects_anything_that_is_not_exactly_an_lbpair() {
    let good = hex(POOL_HEX);
    assert_eq!(
        read_lb_pair(&good[..LB_PAIR_LEN - 1]),
        Err(MandateCoreError::InvalidMarket)
    );
    assert_eq!(read_lb_pair(&[]), Err(MandateCoreError::InvalidMarket));
    let mut longer = good.clone();
    longer.push(0);
    assert_eq!(read_lb_pair(&longer), Err(MandateCoreError::InvalidMarket));
    let mut wrong_disc = good.clone();
    wrong_disc[0] ^= 0xff;
    assert_eq!(
        read_lb_pair(&wrong_disc),
        Err(MandateCoreError::InvalidMarket)
    );
    assert_eq!(&good[..8], &LB_PAIR_DISCRIMINATOR);
}
