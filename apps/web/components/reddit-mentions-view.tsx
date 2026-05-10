"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type { RedditMentionsSort } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";

const SORT_OPTIONS: { value: RedditMentionsSort; label: string }[] = [
  { value: "mentions", label: "Most mentions" },
  { value: "spike", label: "Biggest spike" },
  { value: "rank_change", label: "Climbing fastest" },
];

export function RedditMentionsView() {
  const [sort, setSort] = useState<RedditMentionsSort>("mentions");
  const { data, isLoading, error } = useQuery({
    queryKey: ["reddit-mentions", sort],
    queryFn: () => api.redditMentions(sort, 60),
    retry: false,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Reddit chatter</h1>
          <p className="text-sm text-muted-foreground">
            Mention counts via Apewisdom across r/wallstreetbets, r/stocks, r/options, r/investing.
            {data?.snapshot_date && <> Snapshot {formatDate(data.snapshot_date)}.</>}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSort(opt.value)}
              className={cn(
                "rounded-full px-3 py-1.5 font-semibold transition-colors",
                sort === opt.value
                  ? "bg-primary text-white"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="rounded-full bg-signal-bearish/15 px-1.5 py-0.5 font-semibold text-signal-bearish">⚠ contrarian</span>
          <span className="opacity-70">3x+ spike, top 20 — likely late</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="rounded-full bg-primary/15 px-1.5 py-0.5 font-semibold text-primary">🔍 stealth</span>
          <span className="opacity-70">low chatter, off the radar</span>
        </span>
      </div>

      {isLoading && <Skeleton className="h-96 w-full" />}
      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-signal-bearish">
            {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {data && data.rows.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No Reddit data yet. Run <code className="rounded bg-muted px-1">cfp-jobs reddit</code> to snapshot today's Apewisdom rankings.
          </CardContent>
        </Card>
      )}

      {data && data.rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left">Ticker</th>
                    <th className="px-3 py-2 text-right">Mentions</th>
                    <th className="px-3 py-2 text-right">7d avg</th>
                    <th className="px-3 py-2 text-right">Spike</th>
                    <th className="px-3 py-2 text-right">Rank</th>
                    <th className="px-3 py-2 text-right">Δ rank 7d</th>
                    <th className="px-3 py-2 text-left">7d trend</th>
                    <th className="px-3 py-2 text-left">Per-subreddit</th>
                    <th className="px-3 py-2 text-left">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.ticker} className="border-b border-border/40 hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <Link
                          href={`/agents/${encodeURIComponent(r.ticker)}`}
                          className="font-semibold hover:text-primary"
                        >
                          {r.ticker}
                          {r.name && (
                            <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                              {r.name}
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="num px-3 py-2 text-right">{r.mentions_today}</td>
                      <td className="num px-3 py-2 text-right text-muted-foreground">
                        {r.mentions_7d_avg.toFixed(0)}
                      </td>
                      <td
                        className={cn(
                          "num px-3 py-2 text-right",
                          r.spike_ratio !== null && r.spike_ratio > 1.5 && "text-signal-bullish",
                          r.spike_ratio !== null && r.spike_ratio < 0.5 && "text-signal-bearish"
                        )}
                      >
                        {r.spike_ratio !== null ? `${r.spike_ratio.toFixed(1)}x` : "—"}
                      </td>
                      <td className="num px-3 py-2 text-right">
                        {r.rank_today !== null ? `#${r.rank_today}` : "—"}
                      </td>
                      <td
                        className={cn(
                          "num px-3 py-2 text-right",
                          r.rank_change_7d !== null && r.rank_change_7d < 0 && "text-signal-bullish",
                          r.rank_change_7d !== null && r.rank_change_7d > 0 && "text-signal-bearish"
                        )}
                      >
                        {r.rank_change_7d !== null
                          ? r.rank_change_7d > 0
                            ? `▼${r.rank_change_7d}`
                            : r.rank_change_7d < 0
                              ? `▲${Math.abs(r.rank_change_7d)}`
                              : "—"
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {r.sparkline_7d.length > 1 ? (
                          <Sparkline values={r.sparkline_7d} width={80} height={22} />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">need 2d</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-muted-foreground">
                        {r.by_subreddit.length === 0 ? (
                          "—"
                        ) : (
                          r.by_subreddit
                            .slice()
                            .sort((a, b) => b.mentions - a.mentions)
                            .map((s) => `${s.subreddit.replace("wallstreetbets", "WSB").replace("investing", "inv")}:${s.mentions}`)
                            .join(" · ")
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.is_contrarian_warning && (
                          <span className="rounded-full bg-signal-bearish/15 px-2 py-0.5 text-[10px] font-semibold text-signal-bearish">
                            ⚠ contrarian
                          </span>
                        )}
                        {r.is_stealth && (
                          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            🔍 stealth
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Click a ticker to run the agent ensemble on it. Asymmetry flags need 7+ days of snapshots
        to become reliable — early on, rely on raw mention counts.
      </p>
    </div>
  );
}
