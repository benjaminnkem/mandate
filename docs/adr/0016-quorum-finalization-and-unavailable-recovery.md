# ADR 0016: Quorum finalization, unavailable recovery and reward accrual (Prompt 9)

- Status: accepted
- Date: 2026-09-21

## Decisions

1. **`finalize_epoch` is permissionless and takes the attestations as remaining accounts** (at most
   `MAX_OBSERVERS`). The caller only pays rent for the `EpochResult`; it gains no authority over the verdict.
2. **Every supplied attestation is checked, not just counted.** It must deserialize as an `EpochAttestation` owned
   by this program, name this mandate and epoch, sit at its canonical PDA, belong to an observer in the mandate's
   bound `ObserverSet`, be the only one from that observer, carry the mandate's activated position set and its
   algorithm version, and agree bit for bit with the others on payload hash, evidence hash, slot, time and all five
   metrics. Anything else is rejected with a specific error. Nothing is averaged, and no observer verdict is read:
   compliance is recomputed from the mandate's stored thresholds and the attested integers (equality passes).
3. **The caller chooses which attestations to present, so one dishonest observer cannot block a quorum.** If two
   of three observers agree and the third submitted garbage, presenting only the agreeing two succeeds; presenting
   all three fails with `AttestationMismatch`. Fewer than `threshold` matching attestations is `QuorumNotReached`.
4. **An epoch can be finalized once, ever.** `EpochResult` is a PDA `[b"epoch_result", mandate, epoch_le]` created
   with `init`; a second finalization of any kind (quorum or unavailable) fails. Epochs may be finalized in any
   order, but only after they end (`now >= epoch_end`).
5. **Rewards accrue only through `mandate_core::accounting::finalize_epoch`.** A `Compliant` result earns that
   epoch's exact share; the final epoch takes the exact remainder, so the total earnable is the accepted reward to
   the unit. `NonCompliant` and `Unavailable` forfeit the share. Counters and the exact conservation invariants
   are asserted on every finalization, and no token moves at finalization.
6. **`finalize_unavailable_epoch` requires `now >= epoch_end + unavailable_recovery_seconds`**, both stored on the
   mandate at creation, so no admin, observer or later protocol change can move the deadline. The result is
   `Unavailable` with reward 0 and is never called `NonCompliant`: nothing was measured, so nothing is claimed about
   the provider's quality. Neither finalization instruction is pause-gated.
7. **When the last epoch resolves the mandate moves to `AwaitingFinalization`** (meaning: every epoch is resolved,
   only exit paths remain). `Closed` is reserved for the terminal state reached by `close_mandate` (ADR 0017).

## Known limits

- After the recovery deadline both `finalize_epoch` (if a quorum exists) and `finalize_unavailable_epoch` are valid,
  and whichever lands first wins. A hostile caller could front-run a late finalization with `Unavailable`. Attestations
  close at that same deadline, so the mitigation is operational: the scheduler must finalize as soon as a quorum
  exists, long before the deadline (the recovery window is at least the protocol minimum). This should be revisited
  before mainnet if the window is short.
- Finalization trusts the observers' attested integers to the extent of the quorum threshold (ADR 0015). The program
  cannot verify a measurement itself.
