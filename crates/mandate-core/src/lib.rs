//! Pure settlement logic for Mandate: reward split, epoch timing, compliance predicate.
//!
//! No Solana or Anchor dependency, so it can be tested exhaustively and its golden vectors
//! verified against `@mandate/domain`. Scaffold only; implemented in Prompt 2 of
//! docs/BUILD_PROMPTS.md.
#![forbid(unsafe_code)]
