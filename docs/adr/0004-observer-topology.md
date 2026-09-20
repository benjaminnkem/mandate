# ADR 0004: Observer topology

- Status: accepted for v1, with one point flagged for the product owner
- Date: 2026-09-20

## Decision

- Three observer identities, **2-of-3** threshold, `MAX_OBSERVERS = 5` (TECHNICAL_SPEC 5.1, 8.2).
- One shared code base and pinned algorithm; three processes with **distinct keypairs and distinct process identity** (`OBSERVER_INSTANCE_ID`). In production, at least two distinct RPC providers.
- Observers submit their own `submit_attestation` transaction, so identity is explicit onchain.
- `finalize_epoch` is permissionless; the scheduler only calls it.
- Observer keys never share a machine role with the deploy authority or protocol admin.
- **Trust statement (mandatory in UI/docs):** this is an auditable threshold attestation over public onchain state. It is not trustless.

## Flag for the product owner

Two colluding observers can attest false metrics and move money. For a hackathon MVP that is an accepted, disclosed limit; before real scale the observer set must be diversified across independent operators. This is already the position in AGENTS.md rule 5; recorded here so nobody drops it from the pitch.
