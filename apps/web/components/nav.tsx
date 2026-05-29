"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

const tabs = [
  { href: "/", label: "Sectors" },
  { href: "/macro", label: "Macro" },
  { href: "/confluence", label: "Confluence" },
  { href: "/reddit", label: "Reddit + Catalysts" },
  { href: "/flow", label: "Flow" },
  { href: "/smart-money", label: "Smart Money" },
  { href: "/explosive", label: "Hot Options" },
  { href: "/screener", label: "Stocks" },
  { href: "/scanner", label: "Setups" },
  { href: "/talon", label: "Talon" },
  { href: "/delphi", label: "Delphi" },
  { href: "/conviction", label: "Conviction" },
  { href: "/earnings", label: "Earnings" },
  { href: "/backtest", label: "Backtest Lab" },
  { href: "/discord", label: "Discord Alerts" },
  { href: "/gex", label: "Heatseeker" },
];

export function Nav() {
  const pathname = usePathname();
  const [ticker, setTicker] = React.useState("");

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Link href="/" className="shrink-0 font-semibold tracking-tight">
          Bellwether
        </Link>
        <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto text-sm scrollbar-thin">
          {tabs.map((t) => {
            const active = pathname === t.href || (t.href !== "/" && pathname.startsWith(t.href));
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1.5 transition-colors",
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
          className="ml-auto flex shrink-0 items-center gap-2"
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
