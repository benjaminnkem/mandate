# ADR 0015: Epoch attestation and the leader/replay observer protocol (Prompt 8)

- Status: accepted
- Date: 2026-09-21

## Decisions

1. **`submit_attestation` records; it never pays.** An observer in the mandate's snapshotted `ObserverSet` signs one
   attestation per epoch. The program checks: the `observer_set` and `position_set` accounts are the ones stored on the
   mandate; the algorithm version equals the mandate's and is in the program allowlist; `observed_unix_ts` lies in
   `[epoch_start, epoch_end)` and not in the future; `now < recovery_deadline`; slot and both hashes are non-zero;
   spread is at most 20000 bps. The attestation is a PDA `[b"attestation", mandate, epoch_le, observer]` created with
   `init`, so a second submission by the same observer for the same epoch fails. Integer metrics and both hashes are
   stored; nothing accrues. It is not pause-gated (it records a measurement of a commitment already made).
2. **Mandates now carry `algorithm_version` and `unavailable_recovery_seconds`**, copied at creation, so later protocol
   changes cannot move a live mandate's rules.
3. **One process, one key.** The observer loads a single keypair, checks file mode 0600 and the expected public key,
   and never logs secret material. `pnpm observers:provision` creates three separate keys under the gitignored `.keys/`
   directory and refuses to overwrite or to write outside an ignored directory (`docs/runbooks/observer-keys.md`).
4. **Observers must agree bit for bit, so only one of them measures live.** Two live reads of a pool differ by slot.
   The leader for an epoch is the observer-set order rotated by `epoch % count`. Rank r acts at
   `epoch_end - lead + r * timeout` (defaults 60 s and 15 s; configuration is rejected unless
   `(count - 1) * timeout < lead`). The leader observes live, persists snapshot and record, then submits. A follower
   fetches the leader's evidence by evidence hash, verifies the snapshot hash, replays it offline, and signs only if the
   payload hash, evidence hash, metrics, slot and time reproduce exactly. A silent leader is replaced by the next rank
   after one timeout.
5. **Evidence hash = SHA-256 of `{payload_hash, snapshot_sha256}`**, identical for every observer of the same evidence.
   Transport metadata (which RPC, when fetched) is stored beside it and is not part of the hash. The payload embeds
   `algorithm_source_commit` and `lockfile_sha256`, so an observer built from different code cannot reproduce, and so
   will not sign, a peer's evidence.
6. **A follower also checks plausibility against live chain state** before signing: identical static pool fields,
   active-bin drift at most 50, spread drift at most 150 bps. Failing it refuses to sign and logs loudly.
7. **Idempotent and loud.** If the observer's own attestation already exists and matches, the job reports
   `already-attested`. If it exists and differs, the job throws `AttestationConflictError`. Evidence is persisted
   durably before the submission is sent.

## Trust limits (stated, not hidden)

- A forged snapshot that stays close to live chain state passes the plausibility gate. The real guarantee is the
  quorum of independently run observers; running all keys on one host or one RPC provider collapses it to one trust
  domain. Prompt 9 defines how quorum is evaluated.
- Only filesystem evidence storage is implemented. `EVIDENCE_STORAGE_MODE=s3` fails at startup rather than pretending.
- Observer tests run against an in-memory chain port over recorded real mainnet evidence. A Surfpool end-to-end run is
  scheduled for Prompt 13.
