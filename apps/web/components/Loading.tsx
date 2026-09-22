export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" className="muted">
      <span className="visually-hidden">{label}</span>
      <span
        aria-hidden="true"
        className="skeleton"
        style={{ display: "block", height: "1.2em", maxWidth: "16rem" }}
      />
    </p>
  );
}
