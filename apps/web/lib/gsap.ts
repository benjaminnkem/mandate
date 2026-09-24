import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export { gsap, ScrollTrigger };

/** True once, at call time, if the visitor asked the OS for reduced motion. GSAP tweens are driven by JS, so
 * they do not automatically respect the CSS-only `prefers-reduced-motion` override in globals.css. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
