"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type { WhaleBet } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const REFETCH_MS = 30_000;

function money(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-signal-bullish";
  if (score >= 60) return "text-primary";
  if (score >= 40) return "text-amber-400";
  return "text-muted-foreground";
}

export function WhaleBetsPanel() {
  const [windowHours, setWindowHours] = useState<4 | 24>(4);
  const [direction, setDirection] = useState<"all" | "bull" | "bear">("all");

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ["whale-bets", windowHours, direction],
    queryFn: () =>
      api.whaleBets({
        windowHours,
        direction: direction === "all" ? undefined : direction,
        minScore: 40,
        limit: 24,
      }),
    refetchInterval: REFETCH_MS,
  });

  const bets = data?.bets ?? [];
  const tape = data?.market_tide ?? null;

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Whale bets</h2>
        <p className="text-xs text-muted-foreground">
          Tickers where someone is making a real bet — loud flow, opening, lifted,
          corroborated by insiders, dark pool, or Congress.
        </p>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {tape && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                tape === "bull"
                  ? "bg-signal-bullish/15 text-signal-bullish"
                  : "bg-signal-bearish/15 text-signal-bearish",
              )}
              title="Market-wide net-premium tape direction over the last 6h"
            >
              tide · {tape}
            </span>
          )}
          {isFetching && <span>refreshing…</span>}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="uppercase tracking-wide text-muted-foreground">window</span>
        {[4, 24].map((w) => (
          <button
            key={w}
            onClick={() => setWindowHours(w as 4 | 24)}
            className={cn(
              "rounded-full border border-border px-3 py-1",
              windowHours === w
                ? "bg-primary/15 text-primary"
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {w}h
          </button>
        ))}
        <span className="ml-3 uppercase tracking-wide text-muted-foreground">side</span>
        {(["all", "bull", "bear"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDirection(d)}
            className={cn(
              "rounded-full border border-border px-3 py-1 capitalize",
              direction === d
                ? d === "bull"
                  ? "bg-signal-bullish/15 text-signal-bullish"
                  : d === "bear"
                    ? "bg-signal-bearish/15 text-signal-bearish"
                    : "bg-primary/15 text-primary"
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {d}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-4 text-sm text-signal-bearish">
            Failed to load whale bets.
          </CardContent>
        </Card>
      ) : bets.length === 0 ? (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            No high-conviction bets in this window yet. The scorer runs every ~5min
            during RTH; try widening to 24h.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {bets.map((b) => (
            <WhaleCard key={`${b.ticker}-${b.window_hours}`} bet={b} />
          ))}
        </div>
      )}
    </section>
  );
}

function WhaleCard({ bet }: { bet: WhaleBet }) {
  const dom =
    bet.direction === "bull" ? bet.call_premium : bet.put_premium;
  const askShare =
    bet.ask_side_premium && dom && dom > 0 ? bet.ask_side_premium / dom : null;
  return (
    <Link
      href={`/agents/${encodeURIComponent(bet.ticker)}`}
      className="block rounded-2xl bg-card p-3 hover:bg-foreground/5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold tracking-tight">{bet.ticker}</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              bet.direction === "bull"
                ? "bg-signal-bullish/15 text-signal-bullish"
                : "bg-signal-bearish/15 text-signal-bearish",
            )}
          >
            {bet.direction}
          </span>
          {bet.against_tape && (
            <span
              className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-400"
              title="Bet runs opposite to the broad-tape direction — bolder"
            >
              vs tape
            </span>
          )}
        </div>
        <div className={cn("font-mono text-lg font-semibold", scoreColor(bet.score))}>
          {Math.round(bet.score)}
        </div>
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>
          calls <span className="font-mono text-foreground">{money(bet.call_premium)}</span>
        </span>
        <span>
          puts <span className="font-mono text-foreground">{money(bet.put_premium)}</span>
        </span>
        {askShare !== null && askShare > 0 && (
          <span>
            ask <span className="font-mono text-foreground">{Math.round(askShare * 100)}%</span>
          </span>
        )}
        {bet.iv_rank !== null && (
          <span>
            IV-rank{" "}
            <span className="font-mono text-foreground">
              {Math.round((bet.iv_rank ?? 0) * 100)}
            </span>
          </span>
        )}
      </div>

      {bet.reasons.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {bet.reasons.slice(0, 5).map((r, i) => (
            <li
              key={i}
              className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] text-foreground/80"
            >
              {r}
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}
