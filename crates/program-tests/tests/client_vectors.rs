//! Generates (or verifies) the vectors that pin the TypeScript client to the Rust program:
//! PDA addresses, instruction data bytes and account metas for every instruction, built from fixed keys.
//!
//!   UPDATE_VECTORS=1 cargo test -p program-tests --test client_vectors   # rewrite the file
//!   cargo test -p program-tests --test client_vectors                    # verify it is current
//!
//! `@mandate/solana` reproduces every entry independently in its own tests.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use anchor_lang::prelude::Pubkey;
use anchor_lang::{InstructionData, ToAccountMetas};
use serde_json::{json, Value};

const VECTORS: &str = "../../packages/solana/vectors/client-vectors.json";

fn key(n: u8) -> Pubkey {
    Pubkey::new_from_array([n; 32])
}

fn metas(accounts: Vec<anchor_lang::prelude::AccountMeta>) -> Value {
    Value::Array(
        accounts
            .into_iter()
            .map(|a| json!({"pubkey": a.pubkey.to_string(), "isSigner": a.is_signer, "isWritable": a.is_writable}))
            .collect(),
    )
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn case(name: &str, accounts: Vec<anchor_lang::prelude::AccountMeta>, data: Vec<u8>) -> Value {
    json!({"instruction": name, "accounts": metas(accounts), "dataHex": hex(&data)})
}

fn build() -> Value {
    let program = mandate::ID;
    let (sponsor, admin, pool, mint, usdc) = (key(1), key(2), key(3), key(4), key(5));
    let protocol = Pubkey::find_program_address(&[mandate::PROTOCOL_SEED], &program).0;
    let observer_set = |v: u32| {
        Pubkey::find_program_address(&[mandate::OBSERVER_SET_SEED, &v.to_le_bytes()], &program).0
    };
    let market =
        |p: &Pubkey| Pubkey::find_program_address(&[mandate::MARKET_SEED, p.as_ref()], &program).0;
    let mandate_pda = |s: &Pubkey, id: u64| {
        Pubkey::find_program_address(
            &[mandate::MANDATE_SEED, s.as_ref(), &id.to_le_bytes()],
            &program,
        )
        .0
    };
    let vault =
        |m: &Pubkey| Pubkey::find_program_address(&[mandate::VAULT_SEED, m.as_ref()], &program).0;
    let system = key(0);
    let token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        .parse::<Pubkey>()
        .unwrap();
    let loader = "BPFLoaderUpgradeab1e11111111111111111111111"
        .parse::<Pubkey>()
        .unwrap();
    let program_data = Pubkey::find_program_address(&[program.as_ref()], &loader).0;

    let m1 = mandate_pda(&sponsor, 42);
    let args = mandate::CreateMandateArgs {
        mandate_id: 42,
        max_reward_raw: 1_000_000_000,
        bidding_ends_at: 1_789_925_436,
        start_at: 1_789_929_036,
        duration_seconds: 21_600,
        epoch_seconds: 300,
        max_effective_spread_bps: 400,
        depth_band_bps: 500,
        min_pool_buy_depth_quote_raw: 8_000_000_000,
        min_pool_sell_depth_quote_raw: 8_000_000_000,
        min_provider_quote_in_band_raw: 5_000_000_000,
        min_provider_base_quote_eq_in_band_raw: 5_000_000_000,
        probe_quote_raw: 10_000_000,
    };
    let init_args = mandate::InitializeProtocolArgs {
        admin,
        dlmm_program: key(9),
        min_budget_raw: 1_000,
        max_budget_raw: 1_000_000_000_000,
        min_epoch_seconds: 60,
        max_epoch_seconds: 3_600,
        max_duration_seconds: 2_592_000,
        max_epochs: 2_016,
        max_spread_bps: 1_000,
        max_depth_band_bps: 2_000,
        max_positions: 8,
        min_probe_quote_raw: 1_000_000,
        max_probe_quote_raw: 1_000_000_000,
        min_start_lead_seconds: 1_200,
        position_lock_buffer_seconds: 300,
        min_setup_window_seconds: 600,
        unavailable_recovery_seconds: 3_600,
    };

    let instructions = vec![
        case(
            "initialize_protocol",
            mandate::accounts::InitializeProtocol {
                payer: key(6),
                upgrade_authority: key(7),
                protocol,
                usdc_mint: usdc,
                usdc_token_program: token,
                program,
                program_data,
                system_program: system,
            }
            .to_account_metas(None),
            mandate::instruction::InitializeProtocol { args: init_args }.data(),
        ),
        case(
            "propose_admin",
            mandate::accounts::AdminOnly { protocol, admin }.to_account_metas(None),
            mandate::instruction::ProposeAdmin { new_admin: key(8) }.data(),
        ),
        case(
            "cancel_admin_transfer",
            mandate::accounts::AdminOnly { protocol, admin }.to_account_metas(None),
            mandate::instruction::CancelAdminTransfer {}.data(),
        ),
        case(
            "set_paused_new_risk",
            mandate::accounts::AdminOnly { protocol, admin }.to_account_metas(None),
            mandate::instruction::SetPausedNewRisk { paused: true }.data(),
        ),
        case(
            "accept_admin",
            mandate::accounts::AcceptAdmin {
                protocol,
                pending_admin: key(8),
            }
            .to_account_metas(None),
            mandate::instruction::AcceptAdmin {}.data(),
        ),
        case(
            "create_observer_set",
            mandate::accounts::CreateObserverSet {
                admin,
                protocol,
                observer_set: observer_set(1),
                system_program: system,
            }
            .to_account_metas(None),
            mandate::instruction::CreateObserverSet {
                observers: vec![key(10), key(11), key(12)],
                threshold: 2,
            }
            .data(),
        ),
        case(
            "upsert_market",
            mandate::accounts::UpsertMarket {
                admin,
                protocol,
                pool,
                base_mint: mint,
                quote_mint: usdc,
                market: market(&pool),
                system_program: system,
            }
            .to_account_metas(None),
            mandate::instruction::UpsertMarket {
                prestocks_metadata_hash: [7u8; 32],
            }
            .data(),
        ),
        case(
            "set_market_enabled",
            mandate::accounts::SetMarketEnabled {
                admin,
                protocol,
                market: market(&pool),
            }
            .to_account_metas(None),
            mandate::instruction::SetMarketEnabled { enabled: true }.data(),
        ),
        case(
            "create_mandate",
            mandate::accounts::CreateMandate {
                sponsor,
                protocol,
                market: market(&pool),
                observer_set: observer_set(1),
                usdc_mint: usdc,
                token_program: token,
                sponsor_usdc: key(13),
                mandate: m1,
                vault: vault(&m1),
                system_program: system,
            }
            .to_account_metas(None),
            mandate::instruction::CreateMandate { args }.data(),
        ),
        case(
            "cancel_unawarded_mandate",
            mandate::accounts::CancelUnawardedMandate {
                sponsor,
                protocol,
                mandate: m1,
                usdc_mint: usdc,
                token_program: token,
                vault: vault(&m1),
                sponsor_usdc: key(13),
            }
            .to_account_metas(None),
            mandate::instruction::CancelUnawardedMandate {}.data(),
        ),
    ];

    json!({
        "schema": "mandate-client-vectors",
        "note": "Generated by crates/program-tests/tests/client_vectors.rs. Do not edit by hand.",
        "programId": program.to_string(),
        "keys": {
            "sponsor": sponsor.to_string(), "admin": admin.to_string(), "pool": pool.to_string(),
            "baseMint": mint.to_string(), "usdcMint": usdc.to_string(),
        },
        "pdas": {
            "protocol": protocol.to_string(),
            "observerSetV1": observer_set(1).to_string(),
            "observerSetV2": observer_set(2).to_string(),
            "market": market(&pool).to_string(),
            "mandate42": m1.to_string(),
            "vault42": vault(&m1).to_string(),
            "programData": program_data.to_string(),
        },
        "instructions": instructions,
    })
}

#[test]
fn client_vectors_are_current() {
    let text = serde_json::to_string_pretty(&build()).unwrap() + "\n";
    if std::env::var("UPDATE_VECTORS").is_ok() {
        std::fs::write(VECTORS, &text).unwrap();
        return;
    }
    let on_disk =
        std::fs::read_to_string(VECTORS).expect("vectors missing: run with UPDATE_VECTORS=1");
    assert_eq!(
        on_disk, text,
        "client vectors are stale: run with UPDATE_VECTORS=1 and commit"
    );
}
