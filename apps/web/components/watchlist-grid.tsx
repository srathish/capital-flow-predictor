"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import type { WatchlistItem } from "@/lib/types";
import { formatDate, formatNum } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SignalBadge } from "@/components/ui/badge";

export function WatchlistGrid() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["watchlist"],
    queryFn: api.watchlist,
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-72" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          No watchlist available yet. Run <code className="rounded bg-muted px-1">make watchlist-build</code> on the backend, then refresh.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
        <p className="text-sm text-muted-foreground">
          Top constituents per top-ranked sector, with the Portfolio Manager's verdict.
          Last run {formatDate(data.run_ts)}.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {data.sectors.map((sec) => (
          <Card key={sec.sector} id={sec.sector}>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center justify-between">
                <span>{sec.sector}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {sec.items.length} candidate{sec.items.length === 1 ? "" : "s"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {sec.items.map((it) => (
                  <WatchlistRow key={it.ticker} it={it} />
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function WatchlistRow({ it }: { it: WatchlistItem }) {
  const summary =
    typeof it.rationale?.summary === "string" ? (it.rationale.summary as string) : null;

  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="num text-xs text-muted-foreground">#{it.rank}</span>
          <Link
            href={`/agents/${encodeURIComponent(it.ticker)}`}
            className="text-base font-semibold hover:underline"
          >
            {it.ticker}
          </Link>
          <SignalBadge signal={it.final_signal} />
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>conf <span className="num text-foreground">{formatNum(it.final_confidence)}</span></div>
          <div>weight <span className="num text-foreground">{formatNum(it.target_weight, 3)}</span></div>
        </div>
      </div>
      {summary && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-3">{summary}</p>
      )}
    </li>
  );
}
