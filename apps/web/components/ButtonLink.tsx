import Link from "next/link";
import type { ComponentProps } from "react";

import { Button } from "./ui/button.tsx";

/** A `Button` that navigates via `next/link` instead of submitting. Base UI's Button defaults to expecting a
 * native `<button>` in `render`; a link needs `nativeButton={false}` or it warns on every render. */
export function ButtonLink({
  href,
  variant,
  size,
  className,
  children,
}: {
  readonly href: ComponentProps<typeof Link>["href"];
  readonly variant?: ComponentProps<typeof Button>["variant"];
  readonly size?: ComponentProps<typeof Button>["size"];
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      nativeButton={false}
      render={<Link href={href} />}
    >
      {children}
    </Button>
  );
}
