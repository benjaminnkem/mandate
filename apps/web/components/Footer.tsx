import Link from "next/link";

import { Logo } from "./Logo.tsx";
import { env } from "../lib/env.ts";

const COLUMNS: readonly { title: string; links: readonly { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/markets", label: "Approved markets" },
      { href: "/mandates", label: "Explore mandates" },
      { href: "/mandates/new", label: "Create a mandate" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/methodology", label: "Methodology" },
      { href: "/provider", label: "Provider workspace" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:grid-cols-[1.3fr_1fr_1fr]">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-1.5 font-heading text-sm font-medium">
            <Logo className="size-5 text-primary" />
            Mandate
          </span>
          <p className="max-w-56 text-sm text-muted-foreground">
            Pay for measured market quality, not deposited TVL.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title} className="flex flex-col gap-2">
            <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {col.title}
            </h2>
            <ul className="flex flex-col gap-1.5">
              {col.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm hover:text-primary hover:underline">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap justify-between gap-3 px-4 py-4 text-xs text-muted-foreground">
          <span>
            It is not investment advice and does not price fair value. Approving a market is not an
            endorsement of the underlying instrument.
          </span>
          <span className="font-mono-data whitespace-nowrap">
            {env.cluster}. Program {env.programId.slice(0, 6)}...{env.programId.slice(-6)}
          </span>
        </div>
      </div>
    </footer>
  );
}
