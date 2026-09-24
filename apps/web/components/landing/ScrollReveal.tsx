"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

import { gsap, prefersReducedMotion } from "../../lib/gsap.ts";

/**
 * Lifts its children into place once, the first time the element enters the viewport. Motion only — never
 * opacity, and never `autoAlpha` (which also toggles `visibility`) — so nothing here ever fails a contrast
 * check or goes missing for a screen reader, a print view, or an automated scanner that never scrolls. A
 * no-op (children render at their final position immediately) when the visitor asked for reduced motion.
 */
export function ScrollReveal({
  children,
  className,
  delay = 0,
  y = 24,
  as: Tag = "div",
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly delay?: number;
  readonly y?: number;
  readonly as?: "div" | "li";
}) {
  const ref = useRef<HTMLDivElement | HTMLLIElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    // Plain `opacity`, never `autoAlpha`: autoAlpha also toggles `visibility`, which would make this content
    // (and anything inside it, like the "permanent delegate" disclosure) invisible to screen readers and to
    // anyone who has not scrolled there yet, not just visually faded. Motion only, never a real hide.
    const tween = gsap.fromTo(
      el,
      { y },
      {
        y: 0,
        duration: 0.7,
        delay,
        ease: "power2.out",
        scrollTrigger: { trigger: el, start: "top 85%", once: true },
      },
    );
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [delay, y]);

  return (
    <Tag ref={ref as never} className={className}>
      {children}
    </Tag>
  );
}
