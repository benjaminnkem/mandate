import { Skeleton } from "./ui/skeleton.tsx";

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="text-muted-foreground">
      <span className="visually-hidden">{label}</span>
      <Skeleton aria-hidden="true" className="h-5 max-w-64" />
    </div>
  );
}
