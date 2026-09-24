import { Landmark, TrendingUp } from "lucide-react";

import { ScrollReveal } from "./ScrollReveal.tsx";
import { ButtonLink } from "../ButtonLink.tsx";
import { Card, CardContent } from "../ui/card.tsx";

export function AudienceSplit() {
  return (
    <div className="border-t py-14">
      <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
        Built for both sides of the contract
      </h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <ScrollReveal>
          <Card className="h-full">
            <CardContent className="flex h-full flex-col gap-3">
              <Landmark className="size-7 text-primary" />
              <h3 className="font-heading text-lg font-medium">For sponsors</h3>
              <p className="flex-1 text-sm text-muted-foreground">
                Contract measurable liquidity instead of trusting a promise. Set the SLA once and
                pay only for the epochs the chain itself confirms.
              </p>
              <ButtonLink href="/mandates/new" variant="outline" className="self-start">
                Create a mandate
              </ButtonLink>
            </CardContent>
          </Card>
        </ScrollReveal>
        <ScrollReveal delay={0.08}>
          <Card className="h-full">
            <CardContent className="flex h-full flex-col gap-3">
              <TrendingUp className="size-7 text-primary" />
              <h3 className="font-heading text-lg font-medium">For providers</h3>
              <p className="flex-1 text-sm text-muted-foreground">
                Bid your own terms on an open mandate. Get paid automatically, epoch by epoch, for
                the depth and spread you actually deliver.
              </p>
              <ButtonLink href="/provider" variant="outline" className="self-start">
                Open provider workspace
              </ButtonLink>
            </CardContent>
          </Card>
        </ScrollReveal>
      </div>
    </div>
  );
}
