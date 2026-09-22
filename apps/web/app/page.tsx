import Link from "next/link";

import { StatusBadge } from "../components/StatusBadge.tsx";

export default function HomePage() {
  return (
    <div className="stack" style={{ gap: "2.5rem" }}>
      <section>
        <h1>Pay for measured market quality, not deposited TVL</h1>
        <p className="lede">
          Mandate lets a sponsor escrow USDC and contract one market maker against explicit,
          checkable liquidity requirements on one approved Meteora DLMM PreStocks/USDC pool — and
          pays only for the epochs the chain itself can confirm those requirements were met.
        </p>
        <div className="row" style={{ marginTop: "1.5rem" }}>
          <Link href="/markets" className="button primary">
            See approved markets
          </Link>
          <Link href="/mandates/new" className="button">
            Create a mandate
          </Link>
          <Link href="/methodology" className="button">
            Read the methodology
          </Link>
        </div>
      </section>

      <section>
        <h2>How a mandate pays</h2>
        <ol className="stack" style={{ gap: "0.5rem" }}>
          <li>
            A sponsor escrows the mandate&rsquo;s maximum USDC reward on chain and sets a schedule,
            a spread ceiling, minimum depth and a minimum provider contribution.
          </li>
          <li>
            Providers place open bids; the sponsor accepts one, which fixes the provider, the reward
            split and the schedule permanently.
          </li>
          <li>
            The provider registers the exact Meteora DLMM position accounts it will run against the
            pool.
          </li>
          <li>
            Every epoch, a threshold of independent observers measures the pool&rsquo;s real
            executable liquidity and, separately, the provider&rsquo;s own attributable contribution
            near the active price, and attests the exact integers on chain.
          </li>
          <li>
            The Anchor program — not any observer — recomputes compliance from those integers
            against the mandate&rsquo;s fixed thresholds and accrues that epoch&rsquo;s fixed reward
            only if every threshold is met.
          </li>
        </ol>
      </section>

      <section>
        <h2>Three outcomes, never a score</h2>
        <p>
          Each epoch resolves to exactly one of three outcomes. There is no partial credit and no
          subjective judgment call — the program compares stored integer thresholds against attested
          integer metrics.
        </p>
        <div className="grid">
          <div className="card">
            <StatusBadge status="Compliant" />
            <p className="muted" style={{ marginBottom: 0 }}>
              Every threshold was met. The provider earns that epoch&rsquo;s fixed share of the
              reward.
            </p>
          </div>
          <div className="card">
            <StatusBadge status="NonCompliant" />
            <p className="muted" style={{ marginBottom: 0 }}>
              The pool was measured, and at least one threshold was missed. That epoch&rsquo;s
              reward is forfeited back toward the sponsor, not paid.
            </p>
          </div>
          <div className="card">
            <StatusBadge status="Unavailable" />
            <p className="muted" style={{ marginBottom: 0 }}>
              No quorum of observers attested before the recovery deadline, so nothing was measured.
              This is never treated as a compliance failure — it makes no claim about quality either
              way — and the reward is likewise forfeited, not paid.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2>What Mandate measures — and what it does not</h2>
        <p>
          Mandate measures <strong>liquidity and execution quality</strong> on one specific,
          already-selected pool: how tight the two-sided spread is, how much can actually be bought
          or sold near the active price without excessive slippage, and how much of that depth the
          accepted provider&rsquo;s own registered positions contribute. There is no Pyth feed and
          no external fair-value input anywhere in settlement.
        </p>
        <p>
          <strong>Mandate does not claim the pool&rsquo;s price is economically correct.</strong> A
          pool can be tight and deep while still trading far from any reasonable estimate of the
          underlying asset&rsquo;s value. Passing every Mandate threshold is a statement about
          tradability, not about fair value, and it is not investment advice.
        </p>
        <p>
          Mandate also never takes custody of the provider&rsquo;s liquidity. Providers keep full
          control of their own Meteora positions and strategy; the program only reads public chain
          state, measures it, and pays the fixed reward the mandate already committed to.
        </p>
      </section>

      <section>
        <h2>PreStocks tokens carry issuer risk beyond the pool itself</h2>
        <p>
          The base asset in every market Mandate approves is a PreStocks token: a synthetic, wrapped
          representation of pre-IPO or private equity exposure, not a direct legal claim on the
          underlying shares. These are Token-2022 mints, and the ones reviewed so far grant their
          issuer extensions that an ordinary SPL token does not have — commonly a{" "}
          <strong>permanent delegate</strong> able to move or burn any holder&rsquo;s tokens, a
          transfer fee taken on every transfer, and the ability to pause transfers outright. None of
          that is controlled or mitigated by Mandate: it is a property of the token itself,
          disclosed here so it is never assumed away. Mandate&rsquo;s own program moves only the
          USDC reward escrow; it never custodies or transfers PreStocks tokens, and approving a
          market is not an endorsement of the underlying instrument or its issuer.
        </p>
      </section>
    </div>
  );
}
