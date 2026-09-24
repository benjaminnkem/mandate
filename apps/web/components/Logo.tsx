/**
 * A small mark, not a wordmark: a sealed frame around three measured bars, echoing the epoch strip elsewhere
 * on the site (this is what gets measured, and paid, one bar at a time). Single color via `currentColor`, no
 * gradient, so it always matches the surrounding text and both themes.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <rect x="1.5" y="1.5" width="25" height="25" rx="7" stroke="currentColor" strokeWidth="1.6" />
      <rect x="8" y="14" width="3" height="7" rx="1" fill="currentColor" />
      <rect x="12.5" y="10" width="3" height="11" rx="1" fill="currentColor" />
      <rect x="17" y="6.5" width="3" height="14.5" rx="1" fill="currentColor" />
    </svg>
  );
}
