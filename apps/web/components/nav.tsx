"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

const tabs = [
  { href: "/", label: "Sectors" },
  { href: "/confluence", label: "Confluence" },
  { href: "/reddit", label: "Reddit + Catalysts" },
  { href: "/flow", label: "Flow" },
  { href: "/explosive", label: "Hot Options" },
  { href: "/screener", label: "Stocks" },
  { href: "/scanner", label: "Setups" },
  { href: "/delphi", label: "Delphi" },
  { href: "/discord", label: "Discord Alerts" },
  { href: "/gex", label: "Heatseeker" },
];

export function Nav() {
  const pathname = usePathname();
  const [ticker, setTicker] = React.useState("");

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link href="/" className="font-semibold tracking-tight">
          Bellwether
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {tabs.map((t) => {
            const active = pathname === t.href || (t.href !== "/" && pathname.startsWith(t.href));
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "rounded-full px-3 py-1.5 transition-colors",
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        <form
          className="ml-auto flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = ticker.trim().toUpperCase();
            if (t) window.location.href = `/agents/${encodeURIComponent(t)}`;
          }}
        >
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="ticker (e.g. NVDA)"
            className="h-9 w-44 rounded-full border border-border bg-card px-3 text-sm outline-none focus:border-primary/60"
          />
          <button
            type="submit"
            className="h-9 rounded-full bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90"
          >
            Open
          </button>
        </form>
        <ThemeToggle />
      </div>
    </header>
  );
}
