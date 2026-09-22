import type { Metadata } from "next";

export const metadata: Metadata = { title: "Methodology" };

export default function MethodologyPage() {
  return (
    <div className="stack" style={{ gap: "2rem", maxWidth: "70ch" }}>
      <div>
        <h1>Measurement methodology (algorithm version 1)</h1>
        <p className="lede">
          What every attestation actually measures, in reader-facing terms. The normative definition
          is `docs/TECHNICAL_SPEC.md` section 7 and `docs/methodology/measurement-v1.md`; the
          reference implementation is `packages/meteora/src/algorithm/`.
        </p>
      </div>

      <section>
        <h2>What is measured</h2>
        <p>
          Mandate measures execution quality on one exact, already-approved Meteora DLMM pool. It
          does not claim the pool&rsquo;s price is fair, correct, or safe to trade at.
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Definition</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Effective spread</th>
              <td>
                A round-trip probe: spend `Q0` USDC to buy `B0` base, then sell that exact `B0` back
                for `S0` USDC. Spread is `ceil(2·|Q0 − S0|·10000 / (Q0 + S0))` basis points. It
                includes the pool fee and any Token-2022 transfer fee on both legs, and it is not
                the same thing as a bid/ask spread on an order book.
              </td>
            </tr>
            <tr>
              <th scope="row">Pool buy / sell depth</th>
              <td>
                The largest USDC amount that can be fully spent (or, on the sell side, the largest
                base amount fully sold) while the average execution price stays within the
                mandate&rsquo;s depth band of the baseline price. This is aggregate pool depth —
                anyone could trade against it, not only the accepted provider.
              </td>
            </tr>
            <tr>
              <th scope="row">Provider contribution</th>
              <td>
                USDC and base (converted to a USDC-equivalent only for comparison) held specifically
                by the accepted provider&rsquo;s own registered positions, in the bins inside the
                same price band. This is reported separately from pool depth: a deep pool built
                entirely by other liquidity providers does not, by itself, satisfy the
                provider&rsquo;s own minimum contribution threshold.
              </td>
            </tr>
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: "0.9rem" }}>
          Every comparison against a threshold is exact integer cross-multiplication; the
          SDK&rsquo;s floating-point price-impact estimate is never used, and the search that finds
          each depth boundary is fixed by the algorithm version so two honest observers reach the
          identical integer.
        </p>
      </section>

      <section>
        <h2>Attribution: what counts as the provider&rsquo;s own liquidity</h2>
        <p>
          A registered position counts only if it is a real DLMM position of the selected pool whose
          on-chain owner is the accepted provider. Anything else — a missing account, a position on
          the wrong pool, one owned by someone else — contributes exactly zero, and the reason is
          recorded rather than silently dropped. An operator or fee-owner role never confers
          ownership. A position that exists but cannot be read is never treated as empty capital:
          the whole epoch becomes unobservable instead, since treating it as zero would be a guess
          the program is not allowed to make.
        </p>
      </section>

      <section>
        <h2>Determinism: how one observation becomes reproducible</h2>
        <ol className="stack" style={{ gap: "0.4rem" }}>
          <li>
            <strong>Atomic snapshot.</strong> Every account a measurement needs is fetched in one
            request, so everything comes from the same slot.
          </li>
          <li>
            <strong>Pure computation</strong> against that snapshot only, through the pinned
            official Meteora SDK.
          </li>
          <li>
            <strong>A pinned clock.</strong> The SDK&rsquo;s quoting reads the wall clock; every
            quote is run with the clock pinned to the snapshot&rsquo;s own on-chain time, so the
            same accounts always produce the same quote.
          </li>
          <li>
            <strong>Canonical evidence.</strong> The result is serialised as canonical JSON and
            hashed with SHA-256. The payload hash also binds the exact measurement code and
            dependency lock file used, so an observer running different code cannot reproduce, and
            therefore cannot honestly sign, another observer&rsquo;s evidence.
          </li>
        </ol>
        <p>
          Only one observer measures the pool live for a given epoch; the others replay that same
          recorded snapshot offline and sign only if their own independent computation reproduces
          the exact same payload hash, evidence hash, metrics, slot and time. See a mandate&rsquo;s
          evidence page for the parameters needed to redo this yourself.
        </p>
      </section>

      <section>
        <h2>What this does not measure</h2>
        <p>
          Fair value, whether a compliant pool is safe to trade, sustainability beyond the epochs
          actually measured, or anything about the token issuer. Compliance is a statement that
          specific integer thresholds were met at one observed snapshot — nothing more.
        </p>
      </section>

      <section>
        <h2>Token-2022 and PreStocks</h2>
        <p>
          PreStocks base mints are Token-2022 assets that can carry a transfer fee, a pause switch,
          a transfer hook, a scaled UI display multiplier, and a permanent delegate able to move or
          burn any holder&rsquo;s tokens — all controlled by one issuer key. Measurement records the
          fee schedule in force at the observed epoch, and refuses to measure — rather than record a
          false non-compliance — when the mint is paused or an active transfer hook is present.
        </p>
      </section>
    </div>
  );
}
