"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { api } from "@/lib/api";
import { sectorMetaFor } from "@/lib/sectors";
import type { WatchlistItem } from "@/lib/types";
import { formatDate, formatNum, formatPct } from "@/lib/utils";
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
          No tickers analyzed yet. Run the ensemble on a ticker from the top-nav search, then refresh.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
        <p className="text-sm text-muted-foreground">
          Every ticker the agent ensemble has recently analyzed, grouped by sector, with the Portfolio Manager's verdict.
          Last analysis {formatDate(data.run_ts)}.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {data.sectors.map((sec) => {
          const meta = sectorMetaFor(sec.sector);
          return (
            <Card key={sec.sector} id={sec.sector}>
              <CardHeader className="border-b">
                <CardTitle className="flex items-center justify-between">
                  <Link
                    href={`/sectors/${encodeURIComponent(sec.sector)}`}
                    className="hover:underline"
                  >
                    {meta.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {sec.sector}
                    </span>
                  </Link>
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
          );
        })}
      </div>
    </div>
  );
}

function WatchlistRow({ it }: { it: WatchlistItem }) {
  const summary =
    typeof it.rationale?.summary === "string" ? (it.rationale.summary as string) : null;
  const notesRaw = it.rationale?.reasoning_notes;
  const notes = Array.isArray(notesRaw)
    ? (notesRaw.filter((n) => typeof n === "string") as string[])
    : [];
  const [expanded, setExpanded] = React.useState(false);
  const canExpand = notes.length > 0;

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
          <div>PM conf <span className="num text-foreground">{formatNum(it.final_confidence)}</span></div>
          <div>alloc <span className="num text-foreground">{formatPct(it.target_weight, 1)}</span></div>
        </div>
      </div>
      {summary && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-3">{summary}</p>
      )}
      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-primary hover:underline"
        >
          {expanded ? "Hide reasoning" : `Show reasoning (${notes.length})`}
        </button>
      )}
      {expanded && notes.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
