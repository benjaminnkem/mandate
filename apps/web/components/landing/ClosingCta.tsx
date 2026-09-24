import { ScrollReveal } from "./ScrollReveal.tsx";
import { ButtonLink } from "../ButtonLink.tsx";

export function ClosingCta() {
  return (
    <ScrollReveal as="div" className="border-t py-16">
      <div className="rounded-lg border bg-muted/30 px-6 py-10 text-center sm:px-12">
        <h2 className="font-heading text-2xl font-medium tracking-tight sm:text-3xl">
          Contract measurable liquidity today
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          One approved pool, one SLA, one provider held to it, epoch by epoch.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/markets">See approved markets</ButtonLink>
          <ButtonLink href="/mandates/new" variant="outline">
            Create a mandate
          </ButtonLink>
        </div>
      </div>
    </ScrollReveal>
  );
}
