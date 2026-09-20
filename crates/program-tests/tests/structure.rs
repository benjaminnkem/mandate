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

#[test]
fn no_instruction_can_move_funds() {
    // There are no reward vaults yet. When they exist this test must be extended, not deleted: no
    // instruction callable by the admin may take a token account or invoke the token program.
    let idl = idl();
    for instruction in idl["instructions"].as_array().unwrap() {
        let name = instruction["name"].as_str().unwrap();
        let accounts = account_names(instruction);
        for forbidden in [
            "vault",
            "token_account",
            "destination",
            "source",
            "recipient",
            "authority_token",
        ] {
            assert!(
                !accounts.iter().any(|a| a.contains(forbidden)),
                "{name} takes a fund-moving account named like `{forbidden}`: {accounts:?}"
            );
        }
        assert!(
            !name.contains("withdraw")
                && !name.contains("transfer_funds")
                && !name.contains("sweep")
                && !name.contains("seize"),
            "{name} looks like a fund-moving instruction"
        );
    }
}

#[test]
fn observer_sets_are_only_ever_written_by_their_creation_instruction() {
    let idl = idl();
    for instruction in idl["instructions"].as_array().unwrap() {
        let name = instruction["name"].as_str().unwrap();
        let takes_observer_set = account_names(instruction)
            .iter()
            .any(|a| a == "observer_set");
        assert_eq!(
            takes_observer_set,
            name == "create_observer_set",
            "{name} must not touch observer sets"
        );
    }
}

#[test]
fn every_admin_instruction_requires_a_signer() {
    let idl = idl();
    for instruction in idl["instructions"].as_array().unwrap() {
        let name = instruction["name"].as_str().unwrap();
        let signers = instruction["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|a| a["signer"].as_bool().unwrap_or(false))
            .count();
        assert!(signers >= 1, "{name} has no signer at all");
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
    let expected: BTreeSet<String> = ["ProtocolConfig", "ObserverSet", "MarketConfig"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    assert_eq!(accounts, expected);
}
