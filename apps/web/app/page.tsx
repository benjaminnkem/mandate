import { ButtonLink } from "../components/ButtonLink.tsx";
import { Card, CardContent } from "../components/ui/card.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";

export default function HomePage() {
  return (
    <div className="flex flex-col gap-12">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">
          Pay for measured market quality, not deposited TVL
        </h1>
        <p className="mt-3 max-w-[60ch] text-muted-foreground">
          Mandate lets a sponsor escrow USDC and contract one market maker against explicit,
          checkable liquidity requirements on one approved Meteora DLMM PreStocks/USDC pool. It pays
          only for the epochs the chain itself can confirm those requirements were met.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/markets">See approved markets</ButtonLink>
          <ButtonLink href="/mandates/new" variant="outline">
            Create a mandate
          </ButtonLink>
          <ButtonLink href="/methodology" variant="outline">
            Read the methodology
          </ButtonLink>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight">How a mandate pays</h2>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>
            A sponsor escrows the mandate&rsquo;s maximum USDC reward on chain and sets a schedule,
            a spread ceiling, minimum depth and a minimum provider contribution.
          </li>
          <li>
            Providers place open bids. The sponsor accepts one, which fixes the provider, the reward
            split and the schedule permanently.
          </li>
          <li>
            The provider registers the exact Meteora DLMM position accounts it will run against the
            pool.
          </li>
          <li>
            Every epoch, a threshold of independent observers measures the pool&rsquo;s real
            executable liquidity and, separately, the provider&rsquo;s own attributable contribution
            near the active price, then attests the exact integers on chain.
          </li>
          <li>
            The Anchor program, not any observer, recomputes compliance from those integers against
            the mandate&rsquo;s fixed thresholds and accrues that epoch&rsquo;s fixed reward only if
            every threshold is met.
          </li>
        </ol>
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight">Three outcomes, never a score</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Each epoch resolves to exactly one of three outcomes. There is no partial credit and no
          subjective judgment call: the program compares stored integer thresholds against attested
          integer metrics.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="flex flex-col gap-2">
              <StatusBadge status="Compliant" />
              <p className="text-sm text-muted-foreground">
                Every threshold was met. The provider earns that epoch&rsquo;s fixed share of the
                reward.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-2">
              <StatusBadge status="NonCompliant" />
              <p className="text-sm text-muted-foreground">
                The pool was measured, and at least one threshold was missed. That epoch&rsquo;s
                reward is forfeited back toward the sponsor, not paid.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-2">
              <StatusBadge status="Unavailable" />
              <p className="text-sm text-muted-foreground">
                No quorum of observers attested before the recovery deadline, so nothing was
                measured. This is never treated as a compliance failure, and the reward is likewise
                forfeited, not paid.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight">
          What Mandate measures, and what it does not
        </h2>
        <div className="mt-2 flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            Mandate measures{" "}
            <strong className="text-foreground">liquidity and execution quality</strong> on one
            specific, already-selected pool: how tight the two-sided spread is, how much can
            actually be bought or sold near the active price without excessive slippage, and how
            much of that depth the accepted provider&rsquo;s own registered positions contribute.
            There is no Pyth feed and no external fair-value input anywhere in settlement.
          </p>
          <p>
            <strong className="text-foreground">
              Mandate does not claim the pool&rsquo;s price is economically correct.
            </strong>{" "}
            A pool can be tight and deep while still trading far from any reasonable estimate of the
            underlying asset&rsquo;s value. Passing every Mandate threshold is a statement about
            tradability, not fair value, and it is not investment advice.
          </p>
          <p>
            Mandate also never takes custody of the provider&rsquo;s liquidity. Providers keep full
            control of their own Meteora positions and strategy; the program only reads public chain
            state, measures it, and pays the fixed reward the mandate already committed to.
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight">
          PreStocks tokens carry issuer risk beyond the pool itself
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The base asset in every market Mandate approves is a PreStocks token: a synthetic, wrapped
          representation of pre-IPO or private equity exposure, not a direct legal claim on the
          underlying shares. These are Token-2022 mints, and the ones reviewed so far grant their
          issuer extensions that an ordinary SPL token does not have, commonly a{" "}
          <strong className="text-foreground">permanent delegate</strong> able to move or burn any
          holder&rsquo;s tokens, a transfer fee taken on every transfer, and the ability to pause
          transfers outright. None of that is controlled or mitigated by Mandate: it is a property
          of the token itself, disclosed here so it is never assumed away. Mandate&rsquo;s own
          program moves only the USDC reward escrow; it never custodies or transfers PreStocks
          tokens, and approving a market is not an endorsement of the underlying instrument or its
          issuer.
        </p>
      </section>
    </div>
  );
}
