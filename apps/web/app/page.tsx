import { AudienceSplit } from "../components/landing/AudienceSplit.tsx";
import { ClosingCta } from "../components/landing/ClosingCta.tsx";
import { Hero } from "../components/landing/Hero.tsx";
import { HowItWorks } from "../components/landing/HowItWorks.tsx";
import { MethodologyTeaser } from "../components/landing/MethodologyTeaser.tsx";
import { ScrollReveal } from "../components/landing/ScrollReveal.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { Card, CardContent } from "../components/ui/card.tsx";

export default function HomePage() {
  return (
    <div className="flex flex-col">
      <Hero />

      <HowItWorks />

      <div className="border-t py-14">
        <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Three outcomes, never a score
        </h2>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          No partial credit, no judgment call: the program compares stored integer thresholds
          against attested integer metrics.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <ScrollReveal>
            <Card className="h-full">
              <CardContent className="flex flex-col gap-2">
                <StatusBadge status="Compliant" />
                <p className="text-sm text-muted-foreground">
                  Every threshold met. The provider earns that epoch&rsquo;s fixed reward.
                </p>
              </CardContent>
            </Card>
          </ScrollReveal>
          <ScrollReveal delay={0.08}>
            <Card className="h-full">
              <CardContent className="flex flex-col gap-2">
                <StatusBadge status="NonCompliant" />
                <p className="text-sm text-muted-foreground">
                  A threshold was missed. That reward is forfeited back to the sponsor, not paid.
                </p>
              </CardContent>
            </Card>
          </ScrollReveal>
          <ScrollReveal delay={0.16}>
            <Card className="h-full">
              <CardContent className="flex flex-col gap-2">
                <StatusBadge status="Unavailable" />
                <p className="text-sm text-muted-foreground">
                  No quorum attested in time. Never counted as a compliance failure.
                </p>
              </CardContent>
            </Card>
          </ScrollReveal>
        </div>
      </div>

      <AudienceSplit />

      <ScrollReveal as="div" className="border-t py-14">
        <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Know the limits before you rely on this
        </h2>
        <div className="mt-6 grid gap-8 sm:grid-cols-2">
          <div>
            <h3 className="font-heading font-medium">What this proves</h3>
            <ul className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
              <li>Two-sided depth and spread, measured on chain, not self-reported.</li>
              <li>The provider&rsquo;s own attributable liquidity, separate from pool TVL.</li>
              <li>No Pyth feed, no external fair-value input, anywhere in settlement.</li>
            </ul>
          </div>
          <div>
            <h3 className="font-heading font-medium">What this doesn&rsquo;t</h3>
            <ul className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">
                  Mandate does not claim the pool&rsquo;s price is economically correct.
                </strong>{" "}
                Tight and deep can still mean far from fair value.
              </li>
              <li>
                PreStocks tokens are Token-2022 and can carry a{" "}
                <strong className="text-foreground">permanent delegate</strong>, a transfer fee, and
                an issuer pause switch. None of that is mitigated by Mandate.
              </li>
            </ul>
          </div>
        </div>
      </ScrollReveal>

      <MethodologyTeaser />

      <ClosingCta />
    </div>
  );
}
