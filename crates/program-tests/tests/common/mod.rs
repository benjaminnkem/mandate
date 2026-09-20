//! Shared harness: a LiteSVM that executes the REAL compiled SBF binary as an upgradeable program.
#![allow(
    dead_code,
    clippy::result_large_err,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use anchor_lang::prelude::Pubkey;
use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_message::{Instruction, Message};
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::str::FromStr;

pub const SPL_TOKEN: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
pub const TOKEN_2022: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
pub const LOADER_UPGRADEABLE: &str = "BPFLoaderUpgradeab1e11111111111111111111111";
pub const SYSTEM_PROGRAM: &str = "11111111111111111111111111111111";

/// Real mainnet addresses. The pool account data is the real OPENAI/USDC `LbPair` bytes.
pub const DLMM_PROGRAM: &str = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
pub const POOL: &str = "4HTy7aTjPm5PTSEws2yWRDPX6gjWM6sC2dV5mv9u8JsH";
pub const OPENAI_MINT: &str = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
pub const USDC_MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const POOL_HEX: &str = include_str!("../../../mandate-core/tests/fixtures/lbpair-openai-usdc.hex");

pub fn pk(text: &str) -> Pubkey {
    Pubkey::from_str(text).unwrap()
}

pub fn pool_bytes() -> Vec<u8> {
    let text = POOL_HEX.trim();
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

pub const NOW: i64 = 1_789_921_836;

/// Error extraction. Anchor custom errors are `6000 + index`; framework errors are below 6000.
pub fn custom_code(failure: &FailedTransactionMetadata) -> Option<u32> {
    use solana_transaction_error::TransactionError;
    match &failure.err {
        TransactionError::InstructionError(
            _,
            solana_instruction_error::InstructionError::Custom(code),
        ) => Some(*code),
        _ => None,
    }
}

pub type Sent = Result<TransactionMetadata, FailedTransactionMetadata>;

pub struct Env {
    pub svm: LiteSVM,
    pub payer: Keypair,
    pub upgrade_authority: Keypair,
    pub admin: Keypair,
    pub usdc_mint: Pubkey,
    pub base_mint: Pubkey,
    pub pool: Pubkey,
    pub dlmm_program: Pubkey,
}

pub fn program_data_address() -> Pubkey {
    Pubkey::find_program_address(&[mandate::ID.as_ref()], &pk(LOADER_UPGRADEABLE)).0
}
pub fn protocol_pda() -> Pubkey {
    Pubkey::find_program_address(&[mandate::PROTOCOL_SEED], &mandate::ID).0
}
pub fn observer_set_pda(version: u32) -> Pubkey {
    Pubkey::find_program_address(
        &[mandate::OBSERVER_SET_SEED, &version.to_le_bytes()],
        &mandate::ID,
    )
    .0
}
pub fn market_pda(pool: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[mandate::MARKET_SEED, pool.as_ref()], &mandate::ID).0
}

fn mint_account(owner: &Pubkey, decimals: u8, freeze_authority: bool) -> solana_account::Account {
    let mut data = vec![0u8; 82];
    data[0..4].copy_from_slice(&1u32.to_le_bytes()); // mint authority: Some
    data[4..36].copy_from_slice(&[9u8; 32]);
    data[44] = decimals;
    data[45] = 1; // initialised
    if freeze_authority {
        data[46..50].copy_from_slice(&1u32.to_le_bytes());
        data[50..82].copy_from_slice(&[8u8; 32]);
    }
    solana_account::Account {
        lamports: 1_461_600,
        data,
        owner: *owner,
        executable: false,
        rent_epoch: 0,
    }
}

impl Env {
    /// A fresh chain with the compiled program deployed through the upgradeable loader, a real upgrade
    /// authority, a USDC mint, a Token-2022 base mint and the real OPENAI/USDC LbPair account.
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();
        svm.set_sysvar(&anchor_lang::prelude::Clock {
            slot: 1_000,
            epoch_start_timestamp: NOW,
            epoch: 1_038,
            leader_schedule_epoch: 1_038,
            unix_timestamp: NOW,
        });
        svm.add_program_from_file(mandate::ID, "../../target/deploy/mandate.so")
            .expect("compiled program not found: run `anchor build` first");

        let payer = Keypair::new();
        let upgrade_authority = Keypair::new();
        let admin = Keypair::new();
        for kp in [&payer, &upgrade_authority, &admin] {
            svm.airdrop(&kp.pubkey(), 100_000_000_000).unwrap();
        }

        // Give the program's ProgramData a real upgrade authority (litesvm deploys with none).
        let pd_address = program_data_address();
        let mut pd = svm.get_account(&pd_address).expect("programdata exists");
        // UpgradeableLoaderState::ProgramData { slot: u64, upgrade_authority_address: Option<Pubkey> }
        let authority = upgrade_authority.pubkey();
        pd.data[12] = 1; // Option tag = Some (u32 enum tag 3, u64 slot, then the option tag byte)
        pd.data[13..45].copy_from_slice(authority.as_ref());
        svm.set_account(pd_address, pd).unwrap();

        let usdc_mint = pk(USDC_MINT);
        let base_mint = pk(OPENAI_MINT);
        let pool = pk(POOL);
        let dlmm_program = pk(DLMM_PROGRAM);
        svm.set_account(usdc_mint, mint_account(&pk(SPL_TOKEN), 6, true))
            .unwrap();
        svm.set_account(base_mint, mint_account(&pk(TOKEN_2022), 9, true))
            .unwrap();
        svm.set_account(
            pool,
            solana_account::Account {
                lamports: 10_000_000,
                data: pool_bytes(),
                owner: dlmm_program,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

        Self {
            svm,
            payer,
            upgrade_authority,
            admin,
            usdc_mint,
            base_mint,
            pool,
            dlmm_program,
        }
    }

    pub fn set_account(&mut self, address: Pubkey, account: solana_account::Account) {
        self.svm.set_account(address, account).unwrap();
    }

    pub fn send(&mut self, ixs: &[Instruction], extra_signers: &[&Keypair]) -> Sent {
        self.svm.expire_blockhash();
        let mut signers: Vec<&Keypair> = vec![&self.payer];
        signers.extend_from_slice(extra_signers);
        let message = Message::new(ixs, Some(&self.payer.pubkey()));
        let tx = Transaction::new(&signers, message, self.svm.latest_blockhash());
        self.svm.send_transaction(tx)
    }

    pub fn account_data(&self, address: &Pubkey) -> Vec<u8> {
        self.svm
            .get_account(address)
            .map(|a| a.data)
            .unwrap_or_default()
    }

    pub fn load<T: anchor_lang::AccountDeserialize>(&self, address: &Pubkey) -> T {
        let data = self.account_data(address);
        T::try_deserialize(&mut data.as_slice()).unwrap()
    }

    pub fn warp_time(&mut self, unix_timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<anchor_lang::prelude::Clock>();
        clock.unix_timestamp = unix_timestamp;
        self.svm.set_sysvar(&clock);
    }

    // ---- instruction builders ----------------------------------------------------------------

    pub fn default_args(&self) -> mandate::InitializeProtocolArgs {
        mandate::InitializeProtocolArgs {
            admin: self.admin.pubkey(),
            dlmm_program: self.dlmm_program,
            min_budget_raw: 1_000,
            max_budget_raw: 1_000_000_000_000,
            min_epoch_seconds: 60,
            max_epoch_seconds: 3_600,
            max_duration_seconds: 30 * 86_400,
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
        }
    }

    pub fn ix_initialize(&self, args: mandate::InitializeProtocolArgs) -> Instruction {
        self.ix_initialize_with(
            args,
            self.upgrade_authority.pubkey(),
            program_data_address(),
            self.usdc_mint,
            pk(SPL_TOKEN),
            mandate::ID,
        )
    }

    pub fn ix_initialize_with(
        &self,
        args: mandate::InitializeProtocolArgs,
        upgrade_authority: Pubkey,
        program_data: Pubkey,
        usdc_mint: Pubkey,
        usdc_token_program: Pubkey,
        program: Pubkey,
    ) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::InitializeProtocol {
                payer: self.payer.pubkey(),
                upgrade_authority,
                protocol: protocol_pda(),
                usdc_mint,
                usdc_token_program,
                program,
                program_data,
                system_program: pk(SYSTEM_PROGRAM),
            }
            .to_account_metas(None),
            data: mandate::instruction::InitializeProtocol { args }.data(),
        }
    }

    pub fn initialize(&mut self) -> Sent {
        let ix = self.ix_initialize(self.default_args());
        let authority = Keypair::new_from_array(*self.upgrade_authority.secret_bytes());
        self.send(&[ix], &[&authority])
    }

    pub fn initialize_ok(&mut self) {
        self.initialize().expect("initialize_protocol succeeds");
    }

    fn admin_only(&self, admin: Pubkey) -> mandate::accounts::AdminOnly {
        mandate::accounts::AdminOnly {
            protocol: protocol_pda(),
            admin,
        }
    }

    pub fn ix_propose_admin(&self, signer: Pubkey, new_admin: Pubkey) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: self.admin_only(signer).to_account_metas(None),
            data: mandate::instruction::ProposeAdmin { new_admin }.data(),
        }
    }
    pub fn ix_cancel_admin_transfer(&self, signer: Pubkey) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: self.admin_only(signer).to_account_metas(None),
            data: mandate::instruction::CancelAdminTransfer {}.data(),
        }
    }
    pub fn ix_set_paused(&self, signer: Pubkey, paused: bool) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: self.admin_only(signer).to_account_metas(None),
            data: mandate::instruction::SetPausedNewRisk { paused }.data(),
        }
    }
    pub fn ix_accept_admin(&self, signer: Pubkey) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::AcceptAdmin {
                protocol: protocol_pda(),
                pending_admin: signer,
            }
            .to_account_metas(None),
            data: mandate::instruction::AcceptAdmin {}.data(),
        }
    }

    pub fn ix_create_observer_set(
        &self,
        signer: Pubkey,
        observer_set: Pubkey,
        observers: Vec<Pubkey>,
        threshold: u8,
    ) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::CreateObserverSet {
                admin: signer,
                protocol: protocol_pda(),
                observer_set,
                system_program: pk(SYSTEM_PROGRAM),
            }
            .to_account_metas(None),
            data: mandate::instruction::CreateObserverSet {
                observers,
                threshold,
            }
            .data(),
        }
    }

    pub fn ix_upsert_market(
        &self,
        signer: Pubkey,
        pool: Pubkey,
        base_mint: Pubkey,
        quote_mint: Pubkey,
        market: Pubkey,
        hash: [u8; 32],
    ) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::UpsertMarket {
                admin: signer,
                protocol: protocol_pda(),
                pool,
                base_mint,
                quote_mint,
                market,
                system_program: pk(SYSTEM_PROGRAM),
            }
            .to_account_metas(None),
            data: mandate::instruction::UpsertMarket {
                prestocks_metadata_hash: hash,
            }
            .data(),
        }
    }

    pub fn ix_set_market_enabled(
        &self,
        signer: Pubkey,
        market: Pubkey,
        enabled: bool,
    ) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::SetMarketEnabled {
                admin: signer,
                protocol: protocol_pda(),
                market,
            }
            .to_account_metas(None),
            data: mandate::instruction::SetMarketEnabled { enabled }.data(),
        }
    }

    /// Sign with the upgrade authority key.
    pub fn as_authority(&mut self, ixs: &[Instruction]) -> Sent {
        let authority = Keypair::new_from_array(*self.upgrade_authority.secret_bytes());
        self.send(ixs, &[&authority])
    }

    /// Sign with the admin key.
    pub fn as_admin(&mut self, ixs: &[Instruction]) -> Sent {
        let admin = Keypair::new_from_array(*self.admin.secret_bytes());
        self.send(ixs, &[&admin])
    }
}

pub fn keypair() -> Keypair {
    Keypair::new()
}

/// The Anchor custom error code for a program error variant.
pub fn code(error: mandate::MandateError) -> u32 {
    u32::from(error)
}

/// Assert a transaction failed with exactly this Anchor custom error.
pub fn assert_fails_with(result: Sent, error: mandate::MandateError) {
    match result {
        Ok(_) => panic!("expected failure {error:?}, but the transaction succeeded"),
        Err(failure) => assert_eq!(
            custom_code(&failure),
            Some(code(error)),
            "expected {error:?}; got {:?}\nlogs:\n{}",
            failure.err,
            failure.meta.logs.join("\n")
        ),
    }
}

/// Assert a transaction failed with a specific Anchor framework error (constraint, signer, ...).
pub fn assert_fails_with_framework(result: Sent, error: anchor_lang::error::ErrorCode) {
    match result {
        Ok(_) => panic!("expected framework failure {error:?}, but the transaction succeeded"),
        Err(failure) => assert_eq!(
            custom_code(&failure),
            Some(error as u32),
            "expected {error:?}; got {:?}\nlogs:\n{}",
            failure.err,
            failure.meta.logs.join("\n")
        ),
    }
}

/// Decode every event of type `T` emitted in a transaction's logs (`Program data: <base64>` lines).
pub fn events<T: anchor_lang::Event + anchor_lang::AnchorDeserialize>(logs: &[String]) -> Vec<T> {
    use base64::Engine;
    logs.iter()
        .filter_map(|line| line.strip_prefix("Program data: "))
        .filter_map(|b64| base64::engine::general_purpose::STANDARD.decode(b64).ok())
        .filter(|bytes| bytes.starts_with(T::DISCRIMINATOR))
        .map(|bytes| T::deserialize(&mut &bytes[T::DISCRIMINATOR.len()..]).unwrap())
        .collect()
}
