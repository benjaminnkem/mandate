//! Structural invariants read from the generated IDL, so a future change that widens the program's
//! authority fails a test instead of slipping through review.
use std::collections::BTreeSet;

fn idl() -> serde_json::Value {
    let text = std::fs::read_to_string("../../target/idl/mandate.json")
        .expect("IDL not found: run `anchor build` first");
    serde_json::from_str(&text).unwrap()
}

fn instruction_names(idl: &serde_json::Value) -> BTreeSet<String> {
    idl["instructions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["name"].as_str().unwrap().to_string())
        .collect()
}

fn account_names(instruction: &serde_json::Value) -> Vec<String> {
    instruction["accounts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["name"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn the_instruction_set_is_exactly_the_reviewed_one() {
    let expected: BTreeSet<String> = [
        "initialize_protocol",
        "propose_admin",
        "accept_admin",
        "cancel_admin_transfer",
        "set_paused_new_risk",
        "create_observer_set",
        "upsert_market",
        "set_market_enabled",
        "create_mandate",
        "cancel_unawarded_mandate",
        "submit_bid",
        "cancel_bid",
        "close_bid",
        "accept_bid",
        "withdraw_surplus_after_award",
        "register_positions",
        "activate_mandate",
        "refund_unactivated_mandate",
        "submit_attestation",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    assert_eq!(
        instruction_names(&idl()),
        expected,
        "adding an instruction requires a deliberate review"
    );
}

/// Instructions allowed to touch token accounts, each callable only by the sponsor. Extend this list
/// deliberately (and review it) whenever a new fund-moving instruction is added.
const FUND_MOVING: [&str; 4] = [
    "create_mandate",
    "cancel_unawarded_mandate",
    "withdraw_surplus_after_award",
    "refund_unactivated_mandate",
];

#[test]
fn only_reviewed_instructions_touch_tokens_and_none_takes_an_admin() {
    let idl = idl();
    for instruction in idl["instructions"].as_array().unwrap() {
        let name = instruction["name"].as_str().unwrap();
        let accounts = account_names(instruction);
        let touches_tokens = accounts
            .iter()
            .any(|a| a.contains("vault") || a.contains("usdc") || a.contains("token_program"));
        // initialize_protocol only *reads* the mint and names its program; it takes no token account.
        let takes_token_account = accounts
            .iter()
            .any(|a| a.contains("vault") || a.ends_with("_usdc"));
        if takes_token_account {
            assert!(
                FUND_MOVING.contains(&name),
                "{name} takes a token account but is not on the reviewed fund-moving list"
            );
            assert!(
                !accounts
                    .iter()
                    .any(|a| a == "admin" || a == "pending_admin" || a == "upgrade_authority"),
                "{name} moves funds but also takes an admin-like account: {accounts:?}"
            );
            assert!(
                accounts.iter().any(|a| a == "sponsor"),
                "{name} must be signed by the sponsor"
            );
        }
        let _ = touches_tokens;
        assert!(
            FUND_MOVING.contains(&name)
                || !(name.contains("withdraw") || name.contains("sweep") || name.contains("seize")),
            "{name} looks like an unreviewed fund-moving instruction"
        );
    }
}

#[test]
fn observer_sets_are_only_ever_written_by_their_creation_instruction() {
    // Other instructions may READ a set (create_mandate snapshots it) but only creation may write one.
    let idl = idl();
    for instruction in idl["instructions"].as_array().unwrap() {
        let name = instruction["name"].as_str().unwrap();
        let writes = instruction["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["name"] == "observer_set" && a["writable"].as_bool().unwrap_or(false));
        assert_eq!(
            writes,
            name == "create_observer_set",
            "{name} must not write observer sets"
        );
    }
}

/// Instructions deliberately callable by anyone: they need no signer beyond the transaction fee payer.
/// Each must be harmless to run at the wrong moment, move no funds, and be safe if a hostile party calls it.
const PERMISSIONLESS: [&str; 1] = ["activate_mandate"];

#[test]
fn every_instruction_requires_a_signer_unless_reviewed_as_permissionless() {
    let idl = idl();
    for instruction in idl["instructions"].as_array().unwrap() {
        let name = instruction["name"].as_str().unwrap();
        let signers = instruction["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|a| a["signer"].as_bool().unwrap_or(false))
            .count();
        if PERMISSIONLESS.contains(&name) {
            assert_eq!(
                signers, 0,
                "{name} is reviewed as permissionless and must not require a signer account"
            );
            let accounts = account_names(instruction);
            assert!(
                !accounts
                    .iter()
                    .any(|a| a.contains("vault") || a.contains("usdc") || a.contains("token")),
                "{name} is permissionless and so must not touch funds: {accounts:?}"
            );
        } else {
            assert!(
                signers >= 1,
                "{name} has no signer and is not on the reviewed permissionless list"
            );
        }
    }
}

#[test]
fn account_types_are_the_reviewed_ones() {
    let idl = idl();
    let accounts: BTreeSet<String> = idl["accounts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["name"].as_str().unwrap().to_string())
        .collect();
    let expected: BTreeSet<String> = [
        "ProtocolConfig",
        "ObserverSet",
        "MarketConfig",
        "Mandate",
        "Bid",
        "PositionSet",
        "EpochAttestation",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    assert_eq!(accounts, expected);
}

#[test]
fn the_typescript_clients_idl_copy_is_current() {
    let built = std::fs::read_to_string("../../target/idl/mandate.json").expect("IDL not built");
    let copy = std::fs::read_to_string("../../packages/solana/idl/mandate.json")
        .expect("client IDL missing: run `pnpm idl:sync`");
    let normalise = |text: &str| serde_json::from_str::<serde_json::Value>(text).unwrap();
    assert_eq!(
        normalise(&built),
        normalise(&copy),
        "packages/solana/idl/mandate.json is stale: run `pnpm idl:sync`"
    );
}
