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

// ---- tokens, sponsors and mandates (Prompt 5) ------------------------------------------------

pub const USDC: u64 = 1_000_000; // one USDC in raw units

pub fn mandate_pda(sponsor: &Pubkey, id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[mandate::MANDATE_SEED, sponsor.as_ref(), &id.to_le_bytes()],
        &mandate::ID,
    )
    .0
}
pub fn vault_pda(mandate_key: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[mandate::VAULT_SEED, mandate_key.as_ref()], &mandate::ID).0
}

/// A raw SPL token account (165 bytes, initialised).
pub fn token_account(
    mint: &Pubkey,
    owner: &Pubkey,
    amount: u64,
    token_program: &str,
) -> solana_account::Account {
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(mint.as_ref());
    data[32..64].copy_from_slice(owner.as_ref());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1; // initialised
    solana_account::Account {
        lamports: 2_039_280,
        data,
        owner: pk(token_program),
        executable: false,
        rent_epoch: 0,
    }
}

impl Env {
    pub fn add_token_account(&mut self, owner: &Pubkey, amount: u64) -> Pubkey {
        self.add_token_account_for_mint(&self.usdc_mint.clone(), owner, amount, SPL_TOKEN)
    }

    pub fn add_token_account_for_mint(
        &mut self,
        mint: &Pubkey,
        owner: &Pubkey,
        amount: u64,
        program: &str,
    ) -> Pubkey {
        let address = keypair().pubkey();
        self.set_account(address, token_account(mint, owner, amount, program));
        address
    }

    pub fn token_amount(&self, address: &Pubkey) -> u64 {
        let data = self.account_data(address);
        u64::from_le_bytes(data[64..72].try_into().unwrap())
    }

    /// Rewrite an Anchor account in place (bypassing the program) to reach states later prompts create.
    pub fn update_account<T: anchor_lang::AccountSerialize + anchor_lang::AccountDeserialize>(
        &mut self,
        address: &Pubkey,
        change: impl FnOnce(&mut T),
    ) {
        let mut account = self.svm.get_account(address).unwrap();
        let mut value = T::try_deserialize(&mut account.data.as_slice()).unwrap();
        change(&mut value);
        let mut buffer = Vec::new();
        value.try_serialize(&mut buffer).unwrap();
        account.data[..buffer.len()].copy_from_slice(&buffer);
        self.set_account(*address, account);
    }

    /// Protocol initialised, observer set v1, and the real market approved and enabled.
    pub fn ready() -> Self {
        let mut env = Self::new();
        env.initialize_ok();
        let admin = env.admin.pubkey();
        let ix = env.ix_create_observer_set(
            admin,
            observer_set_pda(1),
            vec![keypair().pubkey(), keypair().pubkey(), keypair().pubkey()],
            2,
        );
        env.as_admin(&[ix]).expect("observer set");
        let ix = env.ix_upsert_market(
            admin,
            env.pool,
            env.base_mint,
            env.usdc_mint,
            market_pda(&env.pool),
            [7u8; 32],
        );
        env.as_admin(&[ix]).expect("market");
        let ix = env.ix_set_market_enabled(admin, market_pda(&env.pool), true);
        env.as_admin(&[ix]).expect("enable");
        env
    }

    /// A funded sponsor with a USDC account holding `usdc_raw`.
    pub fn sponsor_with(&mut self, usdc_raw: u64) -> (Keypair, Pubkey) {
        let sponsor = keypair();
        self.svm.airdrop(&sponsor.pubkey(), 10_000_000_000).unwrap();
        let account = self.add_token_account(&sponsor.pubkey(), usdc_raw);
        (sponsor, account)
    }

    pub fn valid_mandate_args(&self, id: u64) -> mandate::CreateMandateArgs {
        mandate::CreateMandateArgs {
            mandate_id: id,
            max_reward_raw: 1_000 * USDC,
            bidding_ends_at: NOW + 3_600,
            start_at: NOW + 7_200,
            duration_seconds: 6 * 3_600,
            epoch_seconds: 300,
            max_effective_spread_bps: 400,
            depth_band_bps: 500,
            min_pool_buy_depth_quote_raw: 8_000 * USDC,
            min_pool_sell_depth_quote_raw: 8_000 * USDC,
            min_provider_quote_in_band_raw: 5_000 * USDC,
            min_provider_base_quote_eq_in_band_raw: 5_000 * USDC,
            probe_quote_raw: 10 * USDC,
        }
    }

    pub fn ix_create_mandate(
        &self,
        sponsor: &Pubkey,
        sponsor_usdc: &Pubkey,
        args: mandate::CreateMandateArgs,
    ) -> Instruction {
        let mandate_key = mandate_pda(sponsor, args.mandate_id);
        self.ix_create_mandate_with(sponsor, sponsor_usdc, args, mandate_key)
    }

    pub fn ix_create_mandate_with(
        &self,
        sponsor: &Pubkey,
        sponsor_usdc: &Pubkey,
        args: mandate::CreateMandateArgs,
        mandate_key: Pubkey,
    ) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::CreateMandate {
                sponsor: *sponsor,
                protocol: protocol_pda(),
                market: market_pda(&self.pool),
                observer_set: observer_set_pda(
                    self.load::<mandate::ProtocolConfig>(&protocol_pda())
                        .current_observer_set_version,
                ),
                usdc_mint: self.usdc_mint,
                token_program: pk(SPL_TOKEN),
                sponsor_usdc: *sponsor_usdc,
                mandate: mandate_key,
                vault: vault_pda(&mandate_key),
                system_program: pk(SYSTEM_PROGRAM),
            }
            .to_account_metas(None),
            data: mandate::instruction::CreateMandate { args }.data(),
        }
    }

    pub fn ix_cancel_unawarded(
        &self,
        sponsor: &Pubkey,
        mandate_key: &Pubkey,
        sponsor_usdc: &Pubkey,
    ) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::CancelUnawardedMandate {
                sponsor: *sponsor,
                protocol: protocol_pda(),
                mandate: *mandate_key,
                usdc_mint: self.usdc_mint,
                token_program: pk(SPL_TOKEN),
                vault: vault_pda(mandate_key),
                sponsor_usdc: *sponsor_usdc,
            }
            .to_account_metas(None),
            data: mandate::instruction::CancelUnawardedMandate {}.data(),
        }
    }

    pub fn create_mandate(
        &mut self,
        sponsor: &Keypair,
        sponsor_usdc: &Pubkey,
        args: mandate::CreateMandateArgs,
    ) -> Sent {
        let ix = self.ix_create_mandate(&sponsor.pubkey(), sponsor_usdc, args);
        let signer = Keypair::new_from_array(*sponsor.secret_bytes());
        self.send(&[ix], &[&signer])
    }

    pub fn cancel_unawarded(
        &mut self,
        signer: &Keypair,
        mandate_key: &Pubkey,
        refund_to: &Pubkey,
    ) -> Sent {
        let ix = self.ix_cancel_unawarded(&signer.pubkey(), mandate_key, refund_to);
        let signer = Keypair::new_from_array(*signer.secret_bytes());
        self.send(&[ix], &[&signer])
    }
}

// ---- bids and award (Prompt 6) ---------------------------------------------------------------

pub fn bid_pda(mandate_key: &Pubkey, provider: &Pubkey, nonce: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[
            mandate::BID_SEED,
            mandate_key.as_ref(),
            provider.as_ref(),
            &nonce.to_le_bytes(),
        ],
        &mandate::ID,
    )
    .0
}

impl Env {
    pub fn provider(&mut self) -> Keypair {
        let provider = keypair();
        self.svm
            .airdrop(&provider.pubkey(), 10_000_000_000)
            .unwrap();
        provider
    }

    pub fn ix_submit_bid(
        &self,
        provider: &Pubkey,
        mandate_key: &Pubkey,
        nonce: u64,
        requested: u64,
        valid_until: i64,
    ) -> Instruction {
        self.ix_submit_bid_with(
            provider,
            mandate_key,
            bid_pda(mandate_key, provider, nonce),
            nonce,
            requested,
            valid_until,
        )
    }

    pub fn ix_submit_bid_with(
        &self,
        provider: &Pubkey,
        mandate_key: &Pubkey,
        bid: Pubkey,
        nonce: u64,
        requested: u64,
        valid_until: i64,
    ) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::SubmitBid {
                provider: *provider,
                protocol: protocol_pda(),
                mandate: *mandate_key,
                bid,
                system_program: pk(SYSTEM_PROGRAM),
            }
            .to_account_metas(None),
            data: mandate::instruction::SubmitBid {
                nonce,
                requested_reward_raw: requested,
                valid_until,
            }
            .data(),
        }
    }

    pub fn ix_cancel_bid(&self, provider: &Pubkey, bid: &Pubkey) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::CancelBid {
                provider: *provider,
                bid: *bid,
            }
            .to_account_metas(None),
            data: mandate::instruction::CancelBid {}.data(),
        }
    }

    pub fn ix_close_bid(
        &self,
        provider: &Pubkey,
        bid: &Pubkey,
        mandate_key: &Pubkey,
    ) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::CloseBid {
                provider: *provider,
                bid: *bid,
                mandate: *mandate_key,
            }
            .to_account_metas(None),
            data: mandate::instruction::CloseBid {}.data(),
        }
    }

    pub fn ix_accept_bid(
        &self,
        sponsor: &Pubkey,
        mandate_key: &Pubkey,
        bid: &Pubkey,
    ) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::AcceptBid {
                sponsor: *sponsor,
                protocol: protocol_pda(),
                mandate: *mandate_key,
                bid: *bid,
            }
            .to_account_metas(None),
            data: mandate::instruction::AcceptBid {}.data(),
        }
    }

    pub fn ix_withdraw_surplus(
        &self,
        sponsor: &Pubkey,
        mandate_key: &Pubkey,
        sponsor_usdc: &Pubkey,
        amount: u64,
    ) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::WithdrawSurplusAfterAward {
                sponsor: *sponsor,
                protocol: protocol_pda(),
                mandate: *mandate_key,
                usdc_mint: self.usdc_mint,
                token_program: pk(SPL_TOKEN),
                vault: vault_pda(mandate_key),
                sponsor_usdc: *sponsor_usdc,
            }
            .to_account_metas(None),
            data: mandate::instruction::WithdrawSurplusAfterAward { amount_raw: amount }.data(),
        }
    }

    fn signed(&mut self, ixs: &[Instruction], signer: &Keypair) -> Sent {
        let signer = Keypair::new_from_array(*signer.secret_bytes());
        self.send(ixs, &[&signer])
    }

    pub fn submit_bid(
        &mut self,
        provider: &Keypair,
        mandate_key: &Pubkey,
        nonce: u64,
        requested: u64,
        valid_until: i64,
    ) -> Sent {
        let ix = self.ix_submit_bid(
            &provider.pubkey(),
            mandate_key,
            nonce,
            requested,
            valid_until,
        );
        self.signed(&[ix], provider)
    }
    pub fn cancel_bid(&mut self, provider: &Keypair, bid: &Pubkey) -> Sent {
        let ix = self.ix_cancel_bid(&provider.pubkey(), bid);
        self.signed(&[ix], provider)
    }
    pub fn close_bid(&mut self, provider: &Keypair, bid: &Pubkey, mandate_key: &Pubkey) -> Sent {
        let ix = self.ix_close_bid(&provider.pubkey(), bid, mandate_key);
        self.signed(&[ix], provider)
    }
    pub fn accept_bid(&mut self, sponsor: &Keypair, mandate_key: &Pubkey, bid: &Pubkey) -> Sent {
        let ix = self.ix_accept_bid(&sponsor.pubkey(), mandate_key, bid);
        self.signed(&[ix], sponsor)
    }
    pub fn withdraw_surplus(
        &mut self,
        sponsor: &Keypair,
        mandate_key: &Pubkey,
        sponsor_usdc: &Pubkey,
        amount: u64,
    ) -> Sent {
        let ix = self.ix_withdraw_surplus(&sponsor.pubkey(), mandate_key, sponsor_usdc, amount);
        self.signed(&[ix], sponsor)
    }
}

/// Convenience: an owned copy of a keypair's public identity for passing where an owned key is needed.
pub trait SignerCopy {
    fn pubkey_owned(&self) -> solana_keypair::Keypair;
}
impl SignerCopy for solana_keypair::Keypair {
    fn pubkey_owned(&self) -> solana_keypair::Keypair {
        solana_keypair::Keypair::new_from_array(*self.secret_bytes())
    }
}

// ---- position sets, activation and refund (Prompt 7) -----------------------------------------

pub fn position_set_pda(mandate_key: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[mandate::POSITION_SET_SEED, mandate_key.as_ref()],
        &mandate::ID,
    )
    .0
}

impl Env {
    pub fn ix_register_positions(
        &self,
        provider: &Pubkey,
        mandate_key: &Pubkey,
        positions: Vec<Pubkey>,
    ) -> Instruction {
        self.ix_register_positions_with(
            provider,
            mandate_key,
            position_set_pda(mandate_key),
            positions,
        )
    }

    pub fn ix_register_positions_with(
        &self,
        provider: &Pubkey,
        mandate_key: &Pubkey,
        set: Pubkey,
        positions: Vec<Pubkey>,
    ) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::RegisterPositions {
                provider: *provider,
                protocol: protocol_pda(),
                mandate: *mandate_key,
                position_set: set,
                system_program: pk(SYSTEM_PROGRAM),
            }
            .to_account_metas(None),
            data: mandate::instruction::RegisterPositions { positions }.data(),
        }
    }

    pub fn ix_activate(&self, mandate_key: &Pubkey) -> Instruction {
        self.ix_activate_with(mandate_key, position_set_pda(mandate_key))
    }

    pub fn ix_activate_with(&self, mandate_key: &Pubkey, set: Pubkey) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::ActivateMandate {
                mandate: *mandate_key,
                position_set: set,
            }
            .to_account_metas(None),
            data: mandate::instruction::ActivateMandate {}.data(),
        }
    }

    pub fn ix_refund_unactivated(
        &self,
        sponsor: &Pubkey,
        mandate_key: &Pubkey,
        sponsor_usdc: &Pubkey,
    ) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::RefundUnactivatedMandate {
                sponsor: *sponsor,
                protocol: protocol_pda(),
                mandate: *mandate_key,
                position_set: position_set_pda(mandate_key),
                usdc_mint: self.usdc_mint,
                token_program: pk(SPL_TOKEN),
                vault: vault_pda(mandate_key),
                sponsor_usdc: *sponsor_usdc,
            }
            .to_account_metas(None),
            data: mandate::instruction::RefundUnactivatedMandate {}.data(),
        }
    }

    pub fn register_positions(
        &mut self,
        provider: &Keypair,
        mandate_key: &Pubkey,
        positions: Vec<Pubkey>,
    ) -> Sent {
        let ix = self.ix_register_positions(&provider.pubkey(), mandate_key, positions);
        let signer = Keypair::new_from_array(*provider.secret_bytes());
        self.send(&[ix], &[&signer])
    }

    /// Anyone can activate; the fee payer alone signs.
    pub fn activate(&mut self, mandate_key: &Pubkey) -> Sent {
        let ix = self.ix_activate(mandate_key);
        self.send(&[ix], &[])
    }

    pub fn refund_unactivated(
        &mut self,
        sponsor: &Keypair,
        mandate_key: &Pubkey,
        sponsor_usdc: &Pubkey,
    ) -> Sent {
        let ix = self.ix_refund_unactivated(&sponsor.pubkey(), mandate_key, sponsor_usdc);
        let signer = Keypair::new_from_array(*sponsor.secret_bytes());
        self.send(&[ix], &[&signer])
    }
}

// ---- observers and attestations (Prompt 8) ---------------------------------------------------

pub fn attestation_pda(mandate_key: &Pubkey, epoch: u32, observer: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            mandate::ATTESTATION_SEED,
            mandate_key.as_ref(),
            &epoch.to_le_bytes(),
            observer.as_ref(),
        ],
        &mandate::ID,
    )
    .0
}

pub const EPOCH_SECONDS: i64 = 300;
pub const START_AT: i64 = NOW + 7_200;
pub const RECOVERY: i64 = 3_600;

pub fn good_metrics() -> mandate::EpochMetrics {
    mandate::EpochMetrics {
        effective_spread_bps: 251,
        pool_buy_depth_quote_raw: 63_491_020_966,
        pool_sell_depth_quote_raw: 49_065_543_907,
        provider_quote_in_band_raw: 91_107_867,
        provider_base_quote_eq_in_band_raw: 81_314_309,
    }
}

pub fn args_for(epoch: u32, observed_unix_ts: i64) -> mandate::SubmitAttestationArgs {
    mandate::SubmitAttestationArgs {
        epoch_index: epoch,
        observed_slot: 448_786_149,
        observed_unix_ts,
        algorithm_version: 1,
        payload_hash: [0xAA; 32],
        evidence_hash: [0xBB; 32],
        metrics: good_metrics(),
    }
}

/// An `Active` mandate with a known 3-of-5... observer set: sponsor, provider, and three observer keys.
pub struct Live {
    pub env: Env,
    pub sponsor: Keypair,
    pub sponsor_usdc: Pubkey,
    pub provider: Keypair,
    pub observers: Vec<Keypair>,
    pub mandate: Pubkey,
    /// A second, independent mandate (own provider and position set), activated alongside the first.
    pub other_mandate: Pubkey,
}

impl Live {
    pub fn new() -> Self {
        let mut env = Env::new();
        env.initialize_ok();
        let admin = env.admin.pubkey();
        let observers: Vec<Keypair> = (0..3).map(|_| keypair()).collect();
        let ix = env.ix_create_observer_set(
            admin,
            observer_set_pda(1),
            observers.iter().map(|k| k.pubkey()).collect(),
            2,
        );
        env.as_admin(&[ix]).expect("observer set");
        for k in &observers {
            env.svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
        }
        let ix = env.ix_upsert_market(
            admin,
            env.pool,
            env.base_mint,
            env.usdc_mint,
            market_pda(&env.pool),
            [7u8; 32],
        );
        env.as_admin(&[ix]).expect("market");
        let ix = env.ix_set_market_enabled(admin, market_pda(&env.pool), true);
        env.as_admin(&[ix]).expect("enable");

        let (sponsor, sponsor_usdc) = env.sponsor_with(5_000 * USDC);
        env.create_mandate(&sponsor, &sponsor_usdc, env.valid_mandate_args(1))
            .expect("mandate");
        let mandate = mandate_pda(&sponsor.pubkey(), 1);
        let provider = env.provider();
        env.submit_bid(&provider, &mandate, 1, 900 * USDC, NOW + 5_000)
            .unwrap();
        env.accept_bid(
            &sponsor,
            &mandate,
            &bid_pda(&mandate, &provider.pubkey(), 1),
        )
        .unwrap();
        env.register_positions(
            &provider,
            &mandate,
            vec![keypair().pubkey(), keypair().pubkey()],
        )
        .unwrap();
        env.create_mandate(&sponsor, &sponsor_usdc, env.valid_mandate_args(2))
            .expect("second mandate");
        let other_mandate = mandate_pda(&sponsor.pubkey(), 2);
        let other_provider = env.provider();
        env.submit_bid(&other_provider, &other_mandate, 1, 800 * USDC, NOW + 5_000)
            .unwrap();
        env.accept_bid(
            &sponsor,
            &other_mandate,
            &bid_pda(&other_mandate, &other_provider.pubkey(), 1),
        )
        .unwrap();
        env.register_positions(&other_provider, &other_mandate, vec![keypair().pubkey()])
            .unwrap();

        env.warp_time(START_AT);
        env.activate(&mandate).expect("activate");
        env.activate(&other_mandate).expect("activate second");
        Self {
            env,
            sponsor,
            sponsor_usdc,
            provider,
            observers,
            mandate,
            other_mandate,
        }
    }

    pub fn ix_attest(
        &self,
        observer: &Pubkey,
        args: mandate::SubmitAttestationArgs,
    ) -> Instruction {
        let m: mandate::Mandate = self.env.load(&self.mandate);
        self.ix_attest_with(observer, args, m.observer_set, m.position_set, None)
    }

    pub fn ix_attest_with(
        &self,
        observer: &Pubkey,
        args: mandate::SubmitAttestationArgs,
        observer_set: Pubkey,
        position_set: Pubkey,
        attestation: Option<Pubkey>,
    ) -> Instruction {
        let attestation = attestation
            .unwrap_or_else(|| attestation_pda(&self.mandate, args.epoch_index, observer));
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::SubmitAttestation {
                observer: *observer,
                mandate: self.mandate,
                observer_set,
                position_set,
                attestation,
                system_program: pk(SYSTEM_PROGRAM),
            }
            .to_account_metas(None),
            data: mandate::instruction::SubmitAttestation { args }.data(),
        }
    }

    pub fn attest(&mut self, observer_index: usize, args: mandate::SubmitAttestationArgs) -> Sent {
        let signer = Keypair::new_from_array(*self.observers[observer_index].secret_bytes());
        let ix = self.ix_attest(&signer.pubkey(), args);
        self.env.send(&[ix], &[&signer])
    }

    pub fn attest_as(&mut self, signer: &Keypair, args: mandate::SubmitAttestationArgs) -> Sent {
        let signer = Keypair::new_from_array(*signer.secret_bytes());
        let ix = self.ix_attest(&signer.pubkey(), args);
        self.env.send(&[ix], &[&signer])
    }
}

// ---- epoch finalization (Prompt 9) -----------------------------------------------------------

pub fn epoch_result_pda(mandate_key: &Pubkey, epoch: u32) -> Pubkey {
    Pubkey::find_program_address(
        &[
            mandate::EPOCH_RESULT_SEED,
            mandate_key.as_ref(),
            &epoch.to_le_bytes(),
        ],
        &mandate::ID,
    )
    .0
}

impl Live {
    /// End of epoch `epoch` (exclusive) and its recovery deadline.
    pub fn epoch_end(epoch: u32) -> i64 {
        START_AT + EPOCH_SECONDS * i64::from(epoch + 1)
    }

    /// Have the observers at these indexes attest identical `args`, at a time inside the epoch.
    pub fn attest_many(&mut self, indexes: &[usize], args: &mandate::SubmitAttestationArgs) {
        self.env.warp_time(Self::epoch_end(args.epoch_index) - 1);
        for i in indexes {
            self.attest(*i, args.clone()).expect("attest");
        }
    }

    pub fn ix_finalize_with(
        &self,
        epoch: u32,
        observer_set: Pubkey,
        attestations: &[Pubkey],
    ) -> Instruction {
        let m: mandate::Mandate = self.env.load(&self.mandate);
        let mut accounts = mandate::accounts::FinalizeEpoch {
            payer: self.env.payer.pubkey(),
            mandate: self.mandate,
            observer_set,
            position_set: m.position_set,
            epoch_result: epoch_result_pda(&self.mandate, epoch),
            system_program: pk(SYSTEM_PROGRAM),
        }
        .to_account_metas(None);
        accounts.extend(
            attestations
                .iter()
                .map(|a| anchor_lang::prelude::AccountMeta::new_readonly(*a, false)),
        );
        Instruction {
            program_id: mandate::ID,
            accounts,
            data: mandate::instruction::FinalizeEpoch { epoch_index: epoch }.data(),
        }
    }

    pub fn finalize(&mut self, epoch: u32, attestations: &[Pubkey]) -> Sent {
        let m: mandate::Mandate = self.env.load(&self.mandate);
        let ix = self.ix_finalize_with(epoch, m.observer_set, attestations);
        self.env.send(&[ix], &[])
    }

    /// Finalize using the attestations of the observers at these indexes.
    pub fn finalize_with_observers(&mut self, epoch: u32, indexes: &[usize]) -> Sent {
        let list: Vec<Pubkey> = indexes
            .iter()
            .map(|i| attestation_pda(&self.mandate, epoch, &self.observers[*i].pubkey()))
            .collect();
        self.finalize(epoch, &list)
    }

    pub fn finalize_unavailable(&mut self, epoch: u32) -> Sent {
        let ix = Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::FinalizeUnavailableEpoch {
                payer: self.env.payer.pubkey(),
                mandate: self.mandate,
                epoch_result: epoch_result_pda(&self.mandate, epoch),
                system_program: pk(SYSTEM_PROGRAM),
            }
            .to_account_metas(None),
            data: mandate::instruction::FinalizeUnavailableEpoch { epoch_index: epoch }.data(),
        };
        self.env.send(&[ix], &[])
    }

    pub fn result(&self, epoch: u32) -> mandate::EpochResult {
        self.env.load(&epoch_result_pda(&self.mandate, epoch))
    }

    pub fn mandate_state(&self) -> mandate::Mandate {
        self.env.load(&self.mandate)
    }
}

// ---- exits: claims, sponsor refunds, closing (Prompt 10) -------------------------------------

impl Live {
    pub fn provider_usdc(&mut self) -> Pubkey {
        let owner = self.provider.pubkey();
        self.env.add_token_account(&owner, 0)
    }

    pub fn ix_claim(&self, provider: &Pubkey, provider_usdc: &Pubkey, amount: u64) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::ClaimProviderReward {
                provider: *provider,
                protocol: protocol_pda(),
                mandate: self.mandate,
                usdc_mint: self.env.usdc_mint,
                token_program: pk(SPL_TOKEN),
                vault: vault_pda(&self.mandate),
                provider_usdc: *provider_usdc,
            }
            .to_account_metas(None),
            data: mandate::instruction::ClaimProviderReward { amount_raw: amount }.data(),
        }
    }

    pub fn claim(&mut self, provider_usdc: &Pubkey, amount: u64) -> Sent {
        let signer = Keypair::new_from_array(*self.provider.secret_bytes());
        let ix = self.ix_claim(&signer.pubkey(), provider_usdc, amount);
        self.env.send(&[ix], &[&signer])
    }

    pub fn sponsor_withdraw(&mut self, amount: u64) -> Sent {
        let signer = Keypair::new_from_array(*self.sponsor.secret_bytes());
        let ix = self.env.ix_withdraw_surplus(
            &signer.pubkey(),
            &self.mandate,
            &self.sponsor_usdc,
            amount,
        );
        self.env.send(&[ix], &[&signer])
    }

    pub fn ix_close(&self, rent_receiver: Pubkey) -> Instruction {
        Instruction {
            program_id: mandate::ID,
            accounts: mandate::accounts::CloseMandate {
                caller: self.env.payer.pubkey(),
                protocol: protocol_pda(),
                mandate: self.mandate,
                usdc_mint: self.env.usdc_mint,
                token_program: pk(SPL_TOKEN),
                vault: vault_pda(&self.mandate),
                rent_receiver,
            }
            .to_account_metas(None),
            data: mandate::instruction::CloseMandate {}.data(),
        }
    }

    pub fn close(&mut self) -> Sent {
        let ix = self.ix_close(self.sponsor.pubkey());
        self.env.send(&[ix], &[])
    }

    /// Shrink the mandate to `epochs` epochs and set its accepted reward, so settlement scenarios stay small.
    pub fn reshape(&mut self, epochs: u32, accepted: u64) {
        let key = self.mandate;
        self.env.update_account::<mandate::Mandate>(&key, |m| {
            m.total_epochs = epochs;
            m.accepted_reward_raw = accepted;
        });
    }

    /// Finalize `epoch` as `Compliant`, `NonCompliant` (`Some(false)`) or `Unavailable` (`None`).
    pub fn settle(&mut self, epoch: u32, compliant: Option<bool>) {
        match compliant {
            None => {
                self.env.warp_time(Live::epoch_end(epoch) + RECOVERY);
                self.finalize_unavailable(epoch).expect("unavailable");
            }
            Some(ok) => {
                let mut m = mandate::EpochMetrics {
                    effective_spread_bps: 300,
                    pool_buy_depth_quote_raw: 9_000 * USDC,
                    pool_sell_depth_quote_raw: 9_000 * USDC,
                    provider_quote_in_band_raw: 6_000 * USDC,
                    provider_base_quote_eq_in_band_raw: 6_000 * USDC,
                };
                if !ok {
                    m.effective_spread_bps = 401;
                }
                let mut a = args_for(epoch, Live::epoch_end(epoch) - 5);
                a.metrics = m;
                self.attest_many(&[0, 1], &a);
                self.env.warp_time(Live::epoch_end(epoch));
                self.finalize_with_observers(epoch, &[0, 1])
                    .expect("finalize");
            }
        }
    }
}
