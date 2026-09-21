# Observer keys and processes

Three observers, threshold 2 (ADR 0004). This runbook covers key handling only; the attestation protocol is ADR 0015.

## Rules

- **Three separate keypairs, three separate processes.** One process holds exactly one key (`OBSERVER_KEYPAIR_PATH`)
  and refuses to start unless it derives `OBSERVER_EXPECTED_PUBKEY`.
- **Never commit a key.** `.keys/` and `.env.observer*` are git-ignored. `pnpm observers:provision` refuses to write
  anywhere git would track, refuses to overwrite, writes mode `0600`, and prints public keys only. The observer refuses
  to start if its key file is readable by other users.
- **Never reuse another identity.** The program deploy key and the protocol admin key must not be observers, and the
  program rejects an observer set that contains the admin.
- **Observers hold no authority.** They can write attestations (facts) and nothing else; they cannot move funds.
  Fund each with a little SOL for attestation rent (about 0.0025 SOL per attestation) and fees.
- **Diversify in production.** At least two RPC providers and, ideally, separate operators. Two colluding observers can
  attest false metrics: the design makes disagreement visible, it does not make collusion impossible.

## Provision

```bash
pnpm observers:provision            # writes .keys/observer-1..3.json, prints public keys and env lines
```

Create the observer set from those three public keys (`create_observer_set`, threshold 2), then start one process per
key with its own environment file. All three must run the **same build**: the payload hash includes the source commit
and lockfile hash, so a different build refuses to sign a peer's evidence.

## Shared evidence

Followers replay the leader's snapshot, so all observers must read the same `EVIDENCE_STORAGE_PATH` (shared volume or a
synced directory). Evidence is immutable and content-addressed; a file that no longer hashes to its name is rejected.
S3-compatible storage is configured in the environment schema but **not implemented yet**; the observer fails at startup
if it is selected.

## Rotation and loss

A lost or compromised key means a new observer set version (immutable; affects only mandates created afterwards).
Existing mandates keep the set they bound (ADR 0004, EDGE_CASES section 6). Do not edit key files in place.
