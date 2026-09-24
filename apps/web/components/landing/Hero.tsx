"use client";

import { useLayoutEffect, useRef } from "react";

import { EpochStrip } from "./EpochStrip.tsx";
import { ButtonLink } from "../ButtonLink.tsx";
import { gsap, prefersReducedMotion } from "../../lib/gsap.ts";

export function Hero() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) return;
    const targets = root.querySelectorAll("[data-reveal]");
    // Motion only, never opacity: a contrast/visibility check (an automated scan, a screen reader, a person
    // who loads the page and starts reading before the 0.6s tween settles) must never catch this content
    // mid-fade. Only position moves; text is at full, correct contrast from the very first paint.
    const tween = gsap.fromTo(
      targets,
      { y: 18 },
      { y: 0, duration: 0.6, stagger: 0.08, ease: "power2.out" },
    );
    return () => {
      tween.kill();
    };
  }, []);

  return (
    <div ref={rootRef} className="flex flex-col gap-6 py-6">
      <p
        data-reveal
        className="font-mono-data text-xs uppercase tracking-widest text-muted-foreground"
      >
        Meteora DLMM &middot; PreStocks / USDC
      </p>
      <h1 data-reveal className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
        Pay for market quality. Not deposited TVL.
      </h1>
      <p data-reveal className="max-w-lg text-muted-foreground">
        A sponsor escrows USDC against a measurable liquidity contract. Every epoch, the chain
        itself confirms compliance and pays automatically.
      </p>
      <div data-reveal className="flex flex-wrap gap-3">
        <ButtonLink href="/markets">See approved markets</ButtonLink>
        <ButtonLink href="/mandates/new" variant="outline">
          Create a mandate
        </ButtonLink>
      </div>
      <div data-reveal className="mt-2 max-w-lg">
        <EpochStrip />
        <p className="mt-2 text-xs text-muted-foreground">
          Every cell is one epoch&rsquo;s real outcome: compliant, non-compliant, or unavailable.
        </p>
      </div>
    </div>
  );
}
