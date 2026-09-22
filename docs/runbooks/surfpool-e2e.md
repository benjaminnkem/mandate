# Surfpool mainnet-fork end-to-end rehearsal (Prompt 13)

## Network provenance

**Everything in this document ran on a Surfpool mainnet fork ("surfnet"), never on mainnet-beta.** Surfpool
1.6.0 forks real mainnet state on demand from an upstream datasource RPC (the free public
`https://api.mainnet-beta.solana.com` endpoint, unless overridden) into a fully local, fully controllable
validator. Every pubkey below that is *not* one of this rehearsal's own freshly generated test keys — the
approved PreStocks/USDC pool, both mints, the DLMM program, the Mandate program's on-chain state layout — is
real mainnet data, lazily fetched into the fork exactly as Surfpool does it. No pool state, balance, or
measurement result was ever hand-edited to manufacture a pass or a fail; every compliant/non-compliant outcome
below came from the program's own compliance evaluation against a real (if surgically perturbed) DLMM position.
Two narrow Surfpool cheat-code RPC methods were used, and only ever against this rehearsal's own test
wallets/PDAs — never the pool's reserves, the mint's supply, or measurement outputs. See "Cheats used" below.

Real mainnet anchors used throughout (from `docs/research/current-market.md`):

| Item | Address |
| --- | --- |
| Pool (Meteora DLMM, PreStocks OPENAI / USDC) | `4HTy7aTjPm5PTSEws2yWRDPX6gjWM6sC2dV5mv9u8JsH` |
| Base mint (PreStocks OPENAI, Token-2022, 9 decimals) | `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF` |
| Quote mint (USDC, classic SPL Token, 6 decimals) | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Meteora DLMM program | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` |
| Token-2022 program | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| Mandate program (this rehearsal's deploy) | `T2GzQeoAYprQyUorm7r6jaRvmoPhtXuZ6vJYYBS1pzc` |

## Toolchain

Surfpool 1.6.0, Solana CLI 4.2.2, Anchor 1.2.0, `@meteora-ag/dlmm` 1.9.14, Node >=24, pnpm 11.25.0 — the same
pins as `docs/adr/0002-runtime-and-tool-versions.md`. Postgres and Redis were the developer's own already-running
local services (Postgres.app, Homebrew redis), not started for this rehearsal.

## Starting the fork

```bash
surfpool start --network mainnet --no-deploy --no-tui --no-studio --airdrop-amount 10000000000000 --log-level debug \
  > .surfpool/e2e/surfpool.log 2>&1 &
```

`--ci` looked like the right flag for a non-interactive run but **silently disables all log output**, not just
the TUI; `--no-tui --no-studio` is what actually gives plain stdout logs. RPC: `http://127.0.0.1:8899`.

## Cheats used

Two Surfpool RPC extensions, both undocumented beyond their names in `surfpool start --help`'s `--snapshot`
mention, reverse-engineered here by probing:

- **`surfnet_setAccount(pubkeyB58, {lamports, data, owner, executable, rentEpoch})`** — sets arbitrary account
  state. `data` must be a **plain hex string** (a base64 string and a JSON byte array were both tried first and
  rejected with distinct errors before hex was confirmed by a round-trip read-back).
- **`surfnet_setTokenAccount(ownerB58, mintB58, {amount})`** — sets a token balance on a wallet's own ATA. **Bug
  found and worked around**: it always derives and writes the *classic SPL-Token-program* ATA for the given
  owner/mint, regardless of which program the mint is actually owned by. For our Token-2022 PreStocks mint this
  silently wrote a phantom, unrelated account (confirmed by reading both addresses back: the real Token-2022 ATA
  stayed at zero while a brand-new classic-program account appeared at the different, wrong address). Workaround
  in `scripts/src/surfpool-e2e.ts`'s `setTokenAccountAmount`: read the real ATA's existing bytes and patch only
  the amount field (offset 64, u64 LE — the same offset in both the classic and un-extended Token-2022 layouts)
  via `surfnet_setAccount`, preserving the mint/owner/delegate fields and any Token-2022 extension TLV data
  already appended past byte 165.
- **`surfnet_timeTravel`** — advances the fork's on-chain Clock sysvar. Real contract, found only by probing:
  a single-key params object, one of `absoluteEpoch` / `absoluteSlot` / `absoluteTimestamp` (not the
  `epochAdvance`/`timestampAdvance` shape one might guess from the name). It also has a **confirmed internal
  unit bug**: the first attempt with a target in seconds failed with
  `Cannot travel to past timestamp: target=1790096941, current=1790089062000` — the error message's own
  "current" value is 1000x the seconds value `getBlockTime` reports for the same instant, i.e. Surfpool compares
  the requested `absoluteTimestamp` (which it expects in seconds) against its internal clock in **milliseconds**.
  Passing the target multiplied by 1000 works.

Both cheats were used only on this rehearsal's own freshly generated wallets, PDAs, and (for `setAccount`) a
just-generated DLMM position keypair and the program's own deploy buffer — never on the pool's reserves, the
mint's supply, or any attested measurement.

## Program deployment

Deploying the 671 KB compiled program against the free public upstream RPC was the single hardest part of this
rehearsal. Two distinct, real problems were hit and worked around; neither is a fabrication for this exercise —
both are reproducible characteristics of forking against a free/shared RPC:

1. **Surfpool's own pre-transaction existence check hangs.** Before letting a transaction create *any* new
   account (a wallet, an ATA, a program/programData/buffer account), Surfpool tries to resolve that pubkey
   against the upstream datasource RPC first, apparently to avoid silently shadowing a real mainnet account.
   Against the free public endpoint this was observed to hang for ~30s and then fail with
   `Internal error: "Failed to fetch accounts from remote: error sending request for url
   (https://api.mainnet-beta.solana.com/)"` — even though a plain `curl` to the same endpoint, and a plain
   `solana transfer` to a brand-new pubkey, both succeeded instantly. This is why `scripts/src/surfpool-e2e.ts`
   calls `preEmpty(...)` (`surfnet_setAccount` with `lamports: 0`, confirmed afterward via
   `solana account <pubkey>` returning `AccountNotFound`, i.e. genuinely absent, not a stub) on every brand-new
   PDA/keypair immediately before the transaction that creates it, throughout this entire rehearsal. `lamports:
   1` is **not** sufficient — it leaves a real account behind that the loader/program later rejects as "already
   in use".
2. **`solana program deploy`'s chunked write-then-resign loop got stuck for 3+ hours**, repeatedly resending a
   stale blockhash (`SURFNETxSAFEHASHxxxxxxxxxxxxxxxxxxxxxxx1x99`) and failing "Blockhash not found" every time,
   never refreshing, while Surfpool's own `getLatestBlockhash` had already advanced. Killed
   (`pkill -9 -f "solana program deploy"`) and worked around by skipping the ~650-transaction chunked write phase
   entirely: the `BPFLoaderUpgradeable::Buffer` account (37-byte header — `u32` discriminant `1`, `Option` tag
   `1`, 32-byte authority pubkey — followed by the raw ELF bytes) was hand-constructed and written directly via
   `surfnet_setAccount` with the *real* compiled `.so` bytes, `owner: BPFLoaderUpgradeab1e11111111111111111111111`,
   and `lamports: 0` beforehand on the program/programData placeholders (see point 1) so only the small "finalize
   from a populated buffer" step remained.

Successful deploy, after these workarounds:

```
Program Id: T2GzQeoAYprQyUorm7r6jaRvmoPhtXuZ6vJYYBS1pzc
Signature: CYuVPNY54JLoNQGyUUph97mYQ9wHj8sMsKBZCqBavLxRkoM85tFEJqPXxjz7oJJwxVn83zd7f44e3FjLievdpxh
```

## Rehearsal driver

All administrative/lifecycle instructions with no dedicated CLI yet are driven by
[`scripts/src/surfpool-e2e.ts`](../../scripts/src/surfpool-e2e.ts):

```bash
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd scripts
SOLANA_RPC_HTTP_URL=http://127.0.0.1:8899 node src/surfpool-e2e.ts <command> [--flag value ...] [MANDATE_ID=<n> env]
```

Roles: `admin` (`~/.config/solana/id.json`, also the deploy/upgrade authority), `sponsor`, `provider-a`,
`provider-b` (`.keys/surfpool-e2e/*.json`), `observer-1/2/3` (`scripts/.keys/*.json`). All gitignored.

Setup (real, once): `airdrop-roles`, then `fund-wallets` (sponsor gets 10,000 USDC; provider-a gets 200 USDC +
1.0 PreStocks — real balances set on the providers' own real ATAs, never the pool's), `init-protocol`,
`create-observer-set` (3 observers, threshold 2), `approve-market` (the real pool above).

```
[init-protocol]        5Cj3MciL3m6kQc56N1XdQMVMyvtVXTAAcxdBMymd23K3zpk4CMg8RLErSqJ61ZwS3shHRPi6sDwvJhXQuEtVUcEQ
[create-observer-set]  5RFic8UMQQGBeyDPBH2KFyPGQwMcmhTAHYj3q3QzCKt8VUpPysMSY9WX2yKzHu6gHMRmuDdfKLXk3mMFraN6wCyo
[approve-market]       4xwvkB38JPHS9S6bop3nT9Rmxcoc2susoTpdScPvjzYtHdVmUtoxh4uGan63PnTeHPdwjcYpGGxAcKhWL8S2sNwY
```

### Timing: the on-chain clock, not wall clock

`activate_mandate` and `finalize_epoch` gate on the fork's **on-chain Clock sysvar**, which drifts from real
wall-clock time under Surfpool (slot production is not real-time, and `surfnet_timeTravel` jumps it directly).
`create-mandate` therefore anchors `biddingEndsAt`/`startAt` to `connection.getBlockTime(await
connection.getSlot())`, not `Date.now()` — an early version of this script used wall-clock and every timing
gate downstream broke. The observer CLI's own leader-rotation timing (`chain.nowUnix()`, in
`apps/observer/src/web3-chain.ts`) also reads the same on-chain clock, so it is internally consistent once the
mandate's own timestamps are.

## Mandate 1 — first attempt, and a real operator-error lesson

`96oWN1d9HSKFGKLUDejmtvMyNs4DuJ1aSoA4DzzJW18M` (sponsor `9efo8...`, 3 epochs × 300s):

```
[create-mandate]         3YfDc4388iZevVwtDDPiNxwK7yzvFJ3pfrB6dmrz4fHYtvndn9ZdzRJGWUmj8nhVERDEtm2swFTRP6PYYZTCse7x
[submit-bid provider-a]  5twyPhiNoAjSNF5KMMBYk3pmQp5T9XSNPDzbyDRWCA1N4QcBpzVmyZn8KUxfEJLi6djHRJE4ai6gp6pZ6Fw5abTp
[submit-bid provider-b]  47ipiEH9fTUq7JX7mT95Y6mgcwzYi1fS4XP6a1L47wYExqsQNSd9EssiA9prKcLAqZv6mjrMbwf85Vuf79zvfS8L
[accept-bid provider-a]  4WjWiQMqhAo1nrXyPj8jAHnLEXCd2rRRrVMvHV5BZh2mYr529GQtGANEgLtvAn2TCQRGeEKgyDFRHo7U1KnvmdPg
[activate]               5HL35Ey6BkNxVZZ2iJw7cVLHZaBbJL9gNySX6hE67jSYq9iy9nhQ4RjoPuRCpU7cWGTbTXb12GKWqFu5TNfj5qE
```

A **real** Meteora DLMM position was opened here using the raw `@meteora-ag/dlmm` SDK directly (`open-position`
command; `packages/meteora` is deliberately measurement-only per architecture, so this rehearsal plays the
provider with the vendor SDK exactly as a real market maker would):

```
[open-position]  37dB2HiB6CpAMuW9K9En5kxnd5n9MuHWUQHLkWpuVS9fqmeR9hhD8ifM3wSRM9ty6MWhCYnknHFT6WT7LoDHgx4C
position: CN7CL5G3UeKUnetPmtu2WPmHMBTuTnVvEfqMmtqep3YB
[register-positions]  5TbQV7nLdNMRcUB1vVSeZ2SwfGfbKrNp7PuRFtDrTkk1ijpe6T8CnuBGCcrfHpFTGKdv3gnE1fTaB9doxYWURHNo
```

**Epoch 0's window was missed**: the first `surfnet_timeTravel` jump aimed at the leader's 60-second observation
window overshot it (real wall-clock time elapsed running the diagnostic commands between the jump and the
observer CLI invocation ate the whole margin), so the observer's own live measurement landed just after the
epoch's end and it correctly refused to attest (`"live observation falls outside the epoch: not attesting"`).
This is genuine, honest evidence of how narrow a 60-second window is against real process-startup latency, and
is exactly why every mandate after this one used a much wider `OBSERVER_OBSERVE_LEAD_SECONDS=250` (see below).
Rather than fight the same mandate's exhausted epoch budget, mandate 1's epoch 0 was later finalized as
`Unavailable` (see "Failure injection" below) and the rehearsal continued on a fresh mandate.

## Mandate 2 — the full golden path

`H1YRRAHNCtvHs19CYRmNcv7ssJaQKHxCuqiqMufjE3it`, 6 epochs × 300s (widened from 3 so there was room for
compliant → perturbed/non-compliant → restored/compliant within one mandate's lifetime), timestamps anchored to
the fork's on-chain clock at creation.

```
[create-mandate]         318n29og6eg1DbVKMiNXoGAdNTRfCA1nKTV22wQWP4Q74yvsd5huMR96C9ZiLxZ64KGLh5RX5n9A2FiViyJ6WFr4
[submit-bid provider-a]  vG4d3ecrf1wfPWQEjdAhixxt9pm79CKXdGrdg5oi8B3LY1LvyStHNfeUb7xQcq8f6EDBD5axFSpB5QFfm814aoY
[submit-bid provider-b]  ZAjSuZQZTnUfFMzFUPtksqRc8bpH6YzmPDcN2cnRSXLZUq8WfXR72sfuWUNwR6T6UWfkDc6qAqCRfLPr1sLsB9G
[accept-bid provider-a]  2uPVAZeUtMxy5gv8Y6hURRh3kMjxxGdY4hTbyzQuaLY6K4oWM7fCHEFWd6Sg5SAWPmZGr7Ewh9u146b3XDpTznDG
[register-positions]     4fq1Q41LBjC7feVFKLjW7MjeHswVuinCXtCYRVpnXBNnh3JriEwAHZgPvVi5BbuGCmJvZR2XXjCZ6XZyL4M9KDQH
[activate]               52T2Wy5Nc46A4c4MjvJfrTiKCgYhYHDoZmZZMSjtvskqogGhd4C6pZaw1xp3TE9n75n8aeThhsH4qJYts9PgfVE9
```

Provider-a's real position `CN7CL5G3UeKUnetPmtu2WPmHMBTuTnVvEfqMmtqep3YB` (opened under mandate 1, unaffected by
which mandate references it) was registered again against this mandate.

### Real compliant measurement (epoch 2)

Three independent observer processes (`apps/observer/src/cli.ts attest`, one OS process per key, leader rotation
`epoch_index mod 3`) all measured the same real chain state and agreed bit for bit:

```
observer-3 (leader)    2Nqc2iRi6sWkDNab27NGEnpeWxsHrLA1M6F2r3r9Pj3GCJa1p1oHtUAGVK25YgYUJR9yb2b62q6du45HPUnbZhiU
observer-1 (follower)  4jWuGUYiDqZwJVvt6cTg6f9U8JThhRcrWLVrCx2YfjvZac8Etz3TPThxngdTJb5Qwno8GYzbXsDb7b4pu7UUyX9x
observer-2 (follower)  66q5RiHQqiLhLqCd2iB1B3tk2d4DvJowUqZzk1LxPe9E89B4yDs17Dh6a1HyFynNvTqwxX6M9oqSapAjoKxdhTuy
payloadHash: 6dab0298d0ad4ccadfc5a6ed7122909ad7a9637de146e110f092e9d4cd1fd1f3

[finalize-epoch 2]  2CXTYtjLnhn1nDm86E3YYtAx23DBefQdnZBu4k9TTqH5YuMnpVPLW2diDKM9AEVofqLDKozc3PYVtSU81kF28RE8
```

Result: `compliantEpochs: 1`, `earnedRewardRaw: 141666666` (141.67 USDC, one epoch's share of the accepted
850 USDC reward).

### Real perturbation → natural non-compliance (epoch 4)

99% of the position's real liquidity was removed with the vendor SDK's `removeLiquidity`:

```
[remove-liquidity provider-a, bps=9900]  36RPPiCjrxV9f1MVeWyXmDVFPKpLCbdivZzR8aiyUgQnqMheR96wev6NLegktFwH4QfU6LJzX7sgAMsAkK8mcGZT
```

Three observers again measured the now-thin real position and agreed:

```
observer-1 (leader)    54KHNrSsnh1wwEZzpyqtbrXdL1iwtDSoH6YVTg5KiaX7NAeHoU5kmUDwjDiEZzowCYWJSkMW5PKg7WwQoPsSHMQu
observer-2 (follower)  wWdLUVg5tNT6VziXHDNME4yWXRxh4xpKy1SYcq4fLqwzWxYNyHqqkQxoLpGDNXVy9iBsG9Esgba6BeoUL51sfvd
observer-3 (follower)  62TPxNohLbv6YiUiaKSoSWWTCozVRdEJmEoW9PabWemP3ymNCM6stZUN31P9JsLxfb9ScbZgLb6dh7ucrSZYUKCV
payloadHash: 84689048be70e7862ecdd65e381c20564bbfa36966ab6cfc70c0bc22d7755df8

[finalize-epoch 4]  55tEn65jYUtGnrrtkrMKydXkPMPhmSNH82e3F5coM1Ljc2tTqnwwd96osHWzCm7knoZHYLKtyijx9vuHHZv7xAaj
```

Result: `noncompliantEpochs: 1`, `earnedRewardRaw` unchanged at 141666666 — the program itself, recomputing
compliance from the attested integers against the mandate's stored thresholds, rejected the epoch. No result was
edited by hand.

### Real restoration → compliance again (epoch 5)

```
[add-liquidity provider-a]  4NLz1DePkmPWY8UsB2fAcjMcbxVTQt1ohRJu5LQsBQMfQCYCzTtmh3MKBN6875Ypub8PgpoagjAMA6BACbJbWQsq

observer-3 (leader)    4LF9TzrRTvhM37mhUzHja3NFbUEQm7PPZxVYaYnPs2czQx92dqqvNGfMACpmPCYCPy1MnrFWoZxQwhdGB9VhsP1U
observer-1 (follower)  3qD2PsaDP18NYm97Cdq5chnGUDGCi2SdFqeuKrMQhYdc9CAwLVkVRrYqJqRPVBDcfkuDCT4xjhsZEcGLeKLdZp6j
observer-2 (follower)  4XqapppAR4jQk7Gw7pCuDRGyZ85j2RH3Xo8LfvnBTkT22yEf3hH5Nw8spB57JcccJCRU42QJqm5NRV7nZMGujv2j
payloadHash: dd2c527f2458b51ce0d6dddd445112b9df2d8452920ae64b17c964936544118c

[finalize-epoch 5]  22ZZrSK2U51JmsjsQvH21hixVVZzjeYu5UEh9WMQTZZmu1wAw7ngE8aZmwh5DYEDyM5KGcvEusfMAkncaqDd2Hdy
```

Result: `compliantEpochs: 2, noncompliantEpochs: 1, earnedRewardRaw: 283333336`.

Epochs 0, 1 and 3 were never inside a reachable observation window during this run (each was overtaken by a
`time-travel` jump aimed at a later epoch's window; see "Observed limitations") and were finalized `Unavailable`
instead, honestly, rather than fabricated:

```
[finalize-unavailable 0]  8Hf6j9PD3kesdJwNusrraVd9deUPKeTydQKsA7A7v61qw2EVptdWSa1GivVLCsGDbEiL8gvBrhNQWrAoBu62ovJ
[finalize-unavailable 1]  3JmRJatcJqHZU6WJQWjF4UeQkbTWcrzBPnQR4gCV64b6iBcyd7p3A4WvY8Y46Hu1pWVx9LhRhHyyZZFnZ61QN85q
[finalize-unavailable 3]  4PjS1rA7RwtbJp9VdKwDc5ap6fhJvLDrFH9bGGSaCnRwa2YmEiwKq5DySAUBkBSYHu6DuweCGT9UCJyVBKQ4NkRy
```

Final tally, all 6 epochs finalized: `compliantEpochs: 2, noncompliantEpochs: 1, unavailableEpochs: 3,
earnedRewardRaw: 283333336, forfeitedRewardRaw: 566666664` (sums exactly to the accepted 850,000,000).

### Claim, refund, reconciliation

```
[claim provider-a, 283333336]   32kosQ3fhXiZdSEVDDV6VJzTKPrLjWgDFKP2uvVvDL9Ehfa2hgbFkg5JSF3iy61HMbzDthcr1BTtURFJ7WPNZmeb
[withdraw sponsor, 616666664]   2HSsJ4uhSE1SznHmZapdkaHJsbPkgCUBSgXeerNtqJVLv32HxRwsLv1gPr5xkjE4s6sY11DtRSbEr7Nys2jx6QY7
```

(616,666,664 = 50,000,000 surplus above the accepted bid + 566,666,664 forfeited from the non-compliant/
unavailable epochs.)

```bash
SOLANA_RPC_HTTP_URL=http://127.0.0.1:8899 pnpm reconcile:mandate H1YRRAHNCtvHs19CYRmNcv7ssJaQKHxCuqiqMufjE3it
```

```
mandate H1YRRAHNCtvHs19CYRmNcv7ssJaQKHxCuqiqMufjE3it (AwaitingFinalization) on 127.0.0.1:8899
  deposited            900000000
  earned / forfeited   283333336 / 566666664   (unresolved 0)
  claimed / claimable  283333336 / 0
  sponsor withdrawn    616666664   (withdrawable 0)
  vault expected/actual 0 / 0
  remaining obligations 0
OK: books reconcile
```

## Mandate 3 — real observer-disagreement failure injection

`JzWYvNjVsXBHb7EUBFamy2J2SueNfnp13CfXgj45AnK`, same real position, one epoch used.

```
[create-mandate]  33JGzUgjaUV5UNjV5BXoCQkkzJoW329PCoyGcoNHsCEEzYe17ySoVqH68qYcxoAqjjC5VvCF57JQvBBt5MAFLu6Q
[submit-bid]      gNGFaoy2XHBpXekh1NnmaRV1NDAdtNbdj5KZ58myZZ4vTtzyqCh4NJTfmK8RcJDqrZoqZhmF7TeAunJxsUA9LMa
[accept-bid]      3qC7AuwkDex3HuvfsnW8nqRtFBNRngxWDextAPoFVRMddAv42x6dANR7V1Yn4N8h4F6Ay2wABVt5rXG4iS8e1GC6
[register-pos.]   ssFRds1gAcXabVDpDHpjibNizYZkwQbt4zc7pvyBfuz34g4gUM3yuiZAs9NH9w92Pd31B5v82ZwFBCLkfbZrrAt
[activate]        3Yg69YCEunMH8G2BouUVUDBQ7EUV1CLkn8rQAZQUxuffmM8HKpQfJWMfpZNSv5L5Q55vgmYUrcbsg9u24PJjKYRt
```

Two observers measured honestly and agreed (`payloadHash 80caf5794712c7aad36797dd8bf36fe46dd6979d7aec2d4c9034
8853c02626cf`):

```
observer-1 (leader)    3rynXr5mGyeg7uWYSf5hLzHaEBfCvrRCSDpur9Z46DTdDu85ZRt1vWdqejQfLWymk3iC4dABt4mV3merwPXFK9m1
observer-2 (follower)  3UKNdFgu22H7RYkmDdtKWXvpFfrUoKj8ZtyWcAm9re7feAQ939PQmCLX52ZFkGPdzsoBxuuAxC45uYwQ8gUkk5qG
```

A third, deliberately dishonest attestation was injected from observer-3 (`submit-bad-attestation`: copies a real
attestation's `observedSlot`/`observedUnixTs`/`algorithmVersion` so it passes every legitimate binding check, but
corrupts the payload/evidence hashes and the spread metric — simulating a buggy or malicious observer):

```
[submit-bad-attestation observer-3]  4sPmCC2i8EqJWpiEv7xFNFzvBa6LgDtqQKNQ8uuDNW4812sazjMv5vsJWa39tyXhTm2L365o7tiugvaSAtQkZ4N
```

Finalizing with **all three** attestations present was rejected on-chain, live, by `finalize_epoch`'s own
bit-for-bit agreement check:

```
AnchorError thrown in programs/mandate/src/instructions/finalize_epoch.rs:186.
Error Code: AttestationMismatch. Error Number: 6056.
Error Message: Attestations disagree; nothing is averaged.
```

Finalizing again with only the two agreeing observers (`--observers observer-1,observer-2`) succeeded:

```
[finalize-epoch 0]  2WSyXbu5EK8cCZmFm1HcsQTejyNxmcLB68JFcVLVhk7EBqj6fuGwuCeURoLYaYsdxrkXgTKDSdbJPqCmgWSRMVKC
```

This is the program's actual, documented design (`finalize_epoch.rs`'s own comment): "the caller chooses which
attestations to present, so one dishonest observer cannot block a quorum of honest ones." Disagreement is never
averaged or silently resolved; it is rejected until the caller presents an agreeing subset that meets the
observer set's threshold (2 of 3 here).

## Read plane: indexer, DB rebuild, RPC outage, scheduler

A local `mandate` Postgres database and `mandate` role were created and migrated once
(`DATABASE_URL=postgresql://mandate:mandate@127.0.0.1:5432/mandate pnpm db:migrate` → `applied: 0001_read_model`),
against the developer's own already-running Postgres.app and Homebrew Redis (neither was started for this
rehearsal).

**Indexer, live**: started against the fork, correctly reconstructed all three mandates' state from real chain
data (`upserted: 32` rows from `42` events on first sync; `vault reconciliation checked: 3, failing: []`).

**Indexer restart (crash recovery)**: the running indexer was `kill -9`'d. While it was down, a real chain
transaction was submitted (`finalize-unavailable` on mandate 1's epoch 0). The indexer was restarted; it read its
durable `chain_cursor` row and resumed from `last_slot`, then synced `upserted: 33, events: 1` — exactly the one
transaction that happened while it was down, no duplication and no loss (`epoch_results` row count for that
mandate was exactly 1, not 2, confirmed by direct SQL).

**Destructive DB rebuild**: `DATABASE_URL=... pnpm indexer:rebuild` was run against the live fork. The read model
it reconstructed matched the pre-rebuild state exactly — `mandates`/`epoch_results` rows, `earned_raw`/
`claimed_raw` amounts, and `chain_cursor` all identical — confirming the README's claim that "PostgreSQL is a
read model that must be rebuildable from chain and evidence alone."

**RPC outage**: the indexer was pointed at an intentionally unreachable RPC (`http://127.0.0.1:19999`) for ten
seconds. It logged `"sync failed; will retry"` (with the real `ECONNREFUSED` cause) on every attempt, kept
running without crashing, and produced no bad writes. Pointed back at the real fork RPC, it resumed cleanly at
the next real slot.

**Scheduler / queue retry — a genuine, reproducible limitation, not worked around**: the scheduler was started
with a relayer keypair (`SCHEDULER_RELAYER_KEYPAIR_PATH`) so it could actually execute `finalize` jobs, and
logged `"finalization enabled"` correctly. Across repeated ticks it planned **zero** jobs for any of this
rehearsal's three mandates. Root cause, confirmed by reading `apps/scheduler/src/main.ts`: `planJobs` computes
"is anything due" from `new Date()` — real wall-clock time — while every mandate's own epoch windows in this
rehearsal were only reachable by advancing the fork's on-chain Clock sysvar via `surfnet_timeTravel`, which runs
far ahead of real wall-clock by the time a mandate's epochs are exercised in one working session. From the
scheduler's (correctly, for production) wall-clock-anchored point of view, every epoch in this rehearsal was
still hours in the future. This is a structural, honest consequence of combining time-travel with a wall-clock
scheduler, not a bug to paper over: a full live run without any time-travel (i.e. one that simply waits out real
epoch boundaries) would exercise the scheduler and its job-retry path exactly as designed. The retry/lease
mechanics themselves (attempts, backoff, dead-lettering) are exercised directly, without this timing conflict, by
`packages/db/test/queue.test.ts`.

## Observed limitations (summary)

1. Surfpool's pre-transaction existence check against a free public upstream RPC hangs (~30s) and fails for
   certain new-account shapes; worked around by pre-registering the account as "known locally, absent"
   (`surfnet_setAccount`, `lamports: 0`) immediately before the transaction that creates it.
2. `solana program deploy`'s chunked write-then-resign loop can get stuck indefinitely resending a stale
   blockhash; worked around by hand-populating the deploy buffer directly and skipping the chunked phase.
3. `surfnet_setTokenAccount` always targets the classic-SPL-Token-program ATA for a given owner/mint, silently
   missing Token-2022 accounts; worked around by patching the real account's bytes directly via
   `surfnet_setAccount`.
4. `surfnet_timeTravel`'s real parameter shape and its seconds-vs-milliseconds unit inconsistency are
   undocumented; both were reverse-engineered from error messages.
5. The fork's on-chain clock and real wall-clock diverge once `surfnet_timeTravel` is used, which is exactly why
   `create-mandate` anchors its timestamps to the fork's own clock rather than `Date.now()`, and why the
   scheduler's wall-clock-based job planner never considered any of this rehearsal's mandates due (see above).
6. A too-narrow leader observation window (60s) combined with real observer-CLI process-startup latency
   (SDK/RPC connection setup) caused three epochs across two mandates to be missed and finalized `Unavailable`
   instead of measured — genuine operator-timing error, not a product defect, and the reason later runs used
   `OBSERVER_OBSERVE_LEAD_SECONDS=250`.

None of these were worked around by editing a measurement result, a compliance verdict, or reward accounting;
every number in every mandate above (`compliantEpochs`, `earnedRewardRaw`, `forfeitedRewardRaw`, the
reconciliation report) was produced by the real, compiled Anchor program evaluating real, on-chain attested
metrics.
