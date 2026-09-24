"use client";

import { Lock, Radar, ScrollText, Users } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ComponentType } from "react";

import { ScrollReveal } from "./ScrollReveal.tsx";
import { ScrollTrigger, gsap, prefersReducedMotion } from "../../lib/gsap.ts";

interface Step {
  readonly icon: ComponentType<{ className?: string }>;
  readonly title: string;
  readonly body: string;
}

// Defined here, not passed in as a prop: a React component reference (the icon) cannot cross the
// server/client boundary as a plain prop from a Server Component, so this client component owns its own data.
const STEPS: readonly Step[] = [
  {
    icon: Lock,
    title: "Escrow",
    body: "Sponsor locks USDC on chain and sets the SLA: spread ceiling, minimum depth, minimum provider contribution.",
  },
  {
    icon: Users,
    title: "Bid",
    body: "Providers bid in the open. The sponsor accepts one bid, permanently fixing the provider and the reward split.",
  },
  {
    icon: ScrollText,
    title: "Register",
    body: "The accepted provider locks in the exact Meteora DLMM position accounts it will run against the pool.",
  },
  {
    icon: Radar,
    title: "Measure and pay",
    body: "Observers attest every epoch. The Anchor program recomputes compliance itself and pays only if every threshold holds.",
  },
];

/**
 * Below `md`, this renders as a plain static vertical list (no sticky panel, no scroll-linked state) — the
 * same layout every accessibility and mobile-viewport check already exercises, kept deliberately simple rather
 * than trying to make a two-column sticky interaction also work at phone width.
 */
export function HowItWorks() {
  const steps = STEPS;
  return (
    <div className="border-t py-14">
      <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
        How it works
      </h2>

      <div className="md:hidden">
        <ol className="relative mt-6 flex flex-col gap-8 border-l pl-6">
          {steps.map((step, i) => (
            <ScrollReveal as="li" key={step.title} delay={i * 0.05} className="relative">
              <span className="absolute -left-[calc(1.5rem+5px)] top-1 flex size-2.5 -translate-x-1/2 items-center justify-center rounded-full bg-primary" />
              <div className="flex items-start gap-3">
                <step.icon className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <h3 className="font-medium">{step.title}</h3>
                  <p className="mt-1 max-w-lg text-sm text-muted-foreground">{step.body}</p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </ol>
      </div>

      <div className="hidden md:block">
        <StickySteps steps={steps} />
      </div>
    </div>
  );
}

function StickySteps({ steps }: { steps: readonly Step[] }) {
  const [active, setActive] = useState(0);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(0);

  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    const triggers = stepRefs.current.map((el, i) =>
      el
        ? ScrollTrigger.create({
            trigger: el,
            start: "top 55%",
            end: "bottom 55%",
            onToggle: (self) => {
              if (self.isActive) setActive(i);
            },
          })
        : null,
    );
    return () => {
      triggers.forEach((t) => t?.kill());
    };
  }, [steps.length]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || prefersReducedMotion() || activeRef.current === active) {
      activeRef.current = active;
      return;
    }
    activeRef.current = active;
    gsap.fromTo(
      panel,
      { opacity: 0.3, y: 10 },
      { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" },
    );
  }, [active]);

  const step = steps[active];
  if (!step) return null;
  const Icon = step.icon;

  return (
    <div className="mt-6 grid grid-cols-[1fr_1.4fr] gap-12">
      <div className="sticky top-24 h-fit" aria-hidden="true">
        <div ref={panelRef} className="flex flex-col gap-3">
          <span className="font-mono-data text-xs text-muted-foreground">
            {String(active + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}
          </span>
          <Icon className="size-9 text-primary" />
          <h3 className="text-2xl font-heading font-medium tracking-tight">{step.title}</h3>
          <p className="max-w-xs text-sm text-muted-foreground">{step.body}</p>
        </div>
        <div className="mt-6 flex gap-1.5">
          {steps.map((s, i) => (
            <span
              key={s.title}
              className={`h-1 flex-1 rounded-full transition-colors ${i === active ? "bg-primary" : "bg-border"}`}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col">
        {steps.map((s, i) => (
          <div
            key={s.title}
            ref={(el) => {
              stepRefs.current[i] = el;
            }}
            className="flex min-h-[50vh] items-center border-t py-8 first:border-t-0"
          >
            <p className="text-lg text-muted-foreground">
              <span className="font-heading text-foreground">{s.title}.</span> {s.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
