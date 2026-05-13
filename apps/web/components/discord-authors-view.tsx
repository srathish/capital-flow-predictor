"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Leaderboard of Discord authors by parsed-play track record. Win rate is
// only displayed once an author has at least min_resolved plays whose expiry
// has passed; below that we show 'N plays · ?' so you can see who's active
// but not yet measurable.

export function DiscordAuthorsView() {
  const [lookback, setLookback] = useState(90);
  const [minResolved, setMinResolved] = useState(5);

  const { data, isLoading, error } = useQuery({
    queryKey: ["discord", "authors", lookback, minResolved],
    queryFn: () =>
      api.discordAuthors({ lookbackDays: lookback, minResolved }),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Author Trust
          </h1>
          <p className="text-sm text-muted-foreground">
            Win rate per Discord author across parsed plays. Higher rates =
            consistent callers. Empty bars = not enough resolved plays yet.
          </p>
        </div>
        <Link
          href="/discord"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          ← back to feed
        </Link>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">lookback</span>
          <select
            value={lookback}
            onChange={(e) => setLookback(Number(e.target.value))}
            className="h-8 rounded-md border border-border bg-card px-2 text-xs"
          >
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>6 months</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">min plays</span>
          <select
            value={minResolved}
            onChange={(e) => setMinResolved(Number(e.target.value))}
            className="h-8 rounded-md border border-border bg-card px-2 text-xs"
          >
            <option value={3}>3</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={25}>25</option>
          </select>
        </label>
      </div>

      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-signal-bearish">
            failed: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {isLoading && <Skeleton className="h-64 w-full" />}

      {!isLoading && (data?.authors.length ?? 0) === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No authors have parsed plays yet. The price worker fills these
            in over time — once a few alerts have expired, this table will
            populate.
          </CardContent>
        </Card>
      )}

      {!isLoading && (data?.authors.length ?? 0) > 0 && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-card/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Author</th>
                  <th className="px-4 py-2 text-right">Win rate</th>
                  <th className="px-4 py-2 text-right">W / L</th>
                  <th className="px-4 py-2 text-right">Resolved</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2 text-right">Avg spot move</th>
                </tr>
              </thead>
              <tbody>
                {data!.authors.map((a) => (
                  <tr
                    key={a.author_id}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-4 py-2 font-medium">{a.author_name}</td>
                    <td className="px-4 py-2 text-right">
                      {a.win_rate == null
                        ? "—"
                        : `${Math.round(a.win_rate * 100)}%`}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {a.wins} / {a.losses}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {a.resolved_plays}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {a.total_plays}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {a.avg_pnl_pct == null
                        ? "—"
                        : `${(a.avg_pnl_pct * 100).toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
