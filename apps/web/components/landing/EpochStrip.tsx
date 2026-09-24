"use client";

import { useLayoutEffect, useRef } from "react";

import { gsap, prefersReducedMotion } from "../../lib/gsap.ts";

type Outcome = "idle" | "compliant" | "noncompliant" | "unavailable";

const CYCLE: readonly Outcome[] = [
  "idle",
  "idle",
  "compliant",
  "compliant",
  "compliant",
  "noncompliant",
  "unavailable",
  "compliant",
];

const CELL_COUNT = 24;

/** Reads a CSS custom property's resolved color so GSAP tweens a real color, not an unresolved `var(...)`. */
function resolvedColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * A decorative, looping strip of epoch cells cycling through the product's own real outcomes (compliant,
 * non-compliant, unavailable). It illustrates the mechanic, not a real measurement, so it is aria-hidden; the
 * outcomes are stated as real text elsewhere on the page for anyone reading with a screen reader.
 */
export function EpochStrip() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cells = Array.from(container.children) as HTMLElement[];
    const colors: Record<Outcome, string> = {
      idle: resolvedColor("--muted"),
      compliant: resolvedColor("--ok"),
      noncompliant: resolvedColor("--destructive"),
      unavailable: resolvedColor("--warn"),
    };

    if (prefersReducedMotion()) {
      cells.forEach((cell, i) => {
        cell.style.backgroundColor = colors[CYCLE[i % CYCLE.length] ?? "idle"];
      });
      return;
    }

    const tl = gsap.timeline({ repeat: -1 });
    cells.forEach((cell, i) => {
      const offset = i * 0.1;
      CYCLE.forEach((outcome, step) => {
        const at = offset + step * 0.45;
        tl.set(cell, { backgroundColor: colors[outcome] }, at).fromTo(
          cell,
          { scaleY: 0.55 },
          { scaleY: 1, duration: 0.3, ease: "power2.out" },
          at,
        );
      });
    });

    return () => {
      tl.kill();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="flex h-16 w-full items-end gap-1 overflow-hidden rounded-md border bg-muted/30 p-2"
    >
      {Array.from({ length: CELL_COUNT }, (_, i) => (
        <span key={i} className="h-full flex-1 origin-bottom rounded-[2px] bg-muted" />
      ))}
    </div>
  );
}
