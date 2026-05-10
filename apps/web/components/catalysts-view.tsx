"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const HOUR_OPTIONS = [
  { value: 6, label: "6h" },
  { value: 24, label: "24h" },
  { value: 48, label: "48h" },
  { value: 168, label: "7d" },
] as const;

const SCORE_OPTIONS = [
  { value: 0.05, label: "Show all" },
  { value: 0.15, label: "Score ≥ 0.15" },
  { value: 0.30, label: "Score ≥ 0.30 (high signal)" },
] as const;

function formatHoursAgo(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function CatalystsView() {
  const [hours, setHours] = useState<number>(48);
  const [minScore, setMinScore] = useState<number>(0.05);
  const [tickerFilter, setTickerFilter] = useState<string>("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["catalysts", hours, minScore, tickerFilter],
    queryFn: () =>
      api.redditCatalysts({
        hours,
        minScore,
        ticker: tickerFilter.trim().toUpperCase() || undefined,
        limit: 100,
      }),
    retry: false,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Catalysts</h1>
          <p className="text-sm text-muted-foreground">
            Reddit posts mentioning a known ticker AND a catalyst keyword
            (partnership, leak, FDA, acquisition, beat, guidance, insider, …).
            Designed to surface AAPL/INTC partnership-style chatter before official news.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Window:</span>
        {HOUR_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setHours(opt.value)}
            className={cn(
              "rounded-full px-3 py-1.5 font-semibold transition-colors",
              hours === opt.value
                ? "bg-primary text-white"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        ))}
        <span className="ml-4 text-muted-foreground">Filter:</span>
        {SCORE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setMinScore(opt.value)}
            className={cn(
              "rounded-full px-3 py-1.5 font-semibold transition-colors",
              Math.abs(minScore - opt.value) < 1e-9
                ? "bg-primary text-white"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        ))}
        <input
          value={tickerFilter}
          onChange={(e) => setTickerFilter(e.target.value)}
          placeholder="ticker (e.g. INTC)"
          className="ml-4 h-8 w-36 rounded-full border border-border bg-card px-3 text-xs outline-none focus:border-primary/60"
        />
      </div>

      {isLoading && <Skeleton className="h-96 w-full" />}
      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-signal-bearish">
            {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {data && data.posts.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No catalyst-flagged posts in this window. Run{" "}
            <code className="rounded bg-muted px-1">cfp-jobs reddit-catalysts</code>{" "}
            to refresh, or widen the window / lower the score filter.
          </CardContent>
        </Card>
      )}

      {data && data.posts.length > 0 && (
        <div className="space-y-2">
          {data.posts.map((p) => (
            <Card key={p.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <a
                    href={p.permalink ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="text-base font-semibold leading-snug hover:text-primary"
                  >
                    {p.title}
                  </a>
                  <span className="num text-xs text-muted-foreground">
                    score {p.catalyst_score.toFixed(2)} · {formatHoursAgo(p.hours_old)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded-full bg-muted px-2 py-0.5">r/{p.subreddit}</span>
                  {p.author && <span>u/{p.author}</span>}
                  {p.tickers.length > 0 && (
                    <span className="flex flex-wrap items-center gap-1">
                      {p.tickers.map((t) => (
                        <Link
                          key={t}
                          href={`/agents/${encodeURIComponent(t)}`}
                          className="rounded-full bg-primary/15 px-2 py-0.5 font-semibold text-primary hover:bg-primary/25"
                        >
                          ${t}
                        </Link>
                      ))}
                    </span>
                  )}
                  {p.keywords.length > 0 && (
                    <span className="flex flex-wrap items-center gap-1">
                      {p.keywords.slice(0, 4).map((k) => (
                        <span
                          key={k}
                          className="rounded-full bg-signal-bearish/15 px-2 py-0.5 font-semibold text-signal-bearish"
                        >
                          {k}
                        </span>
                      ))}
                      {p.keywords.length > 4 && (
                        <span className="text-muted-foreground">+{p.keywords.length - 4}</span>
                      )}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Posts persist for 7 days. Run <code className="rounded bg-muted px-1">cfp-jobs reddit-catalysts</code>{" "}
        every 15-30 min for live updates.
      </p>
    </div>
  );
}
