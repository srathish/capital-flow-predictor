"use client";

// Confluence — cross-tab signal aggregator.
//
// One ticker per row. Sources currently considered:
//   explosive · delphi · whale · reddit_mentions · reddit_catalysts · flow
//
// Reads /v1/confluence/active. On first mount, the page fetches with
// seed=true so the API pre-warms the cache over its seed universe
// (top explosive + delphi + whale tickers). Subsequent polls every 60s use
// the plain cache read — no extra DB cost.
//
// New tickers (in the latest poll but not the previous one) get a brief
// flash highlight so the user can spot what just emerged without a toast.

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { ConfluenceRow, ConfluenceSourceName } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SOURCE_LABELS: Record<ConfluenceSourceName, string> = {
  explosive: "Explosive",
  delphi: "Delphi",
  whale: "Whale",
  reddit_mentions: "Reddit",
  reddit_catalysts: "Catalysts",
  flow: "Flow",
};

const SOURCE_CHIP: Record<ConfluenceSourceName, string> = {
  explosive: "bg-amber-500/15 text-amber-400",
  delphi: "bg-sky-500/15 text-sky-400",
  whale: "bg-purple-500/15 text-purple-400",
  reddit_mentions: "bg-orange-500/15 text-orange-400",
  reddit_catalysts: "bg-pink-500/15 text-pink-400",
  flow: "bg-signal-bullish/15 text-signal-bullish",
};

function intensityClass(n: number): string {
  if (n >= 4) return "bg-signal-bearish/25 text-signal-bearish ring-1 ring-signal-bearish/40";
  if (n === 3) return "bg-amber-500/20 text-amber-400";
  if (n === 2) return "bg-sky-500/15 text-sky-300";
  return "bg-foreground/10 text-muted-foreground";
}

export function ConfluenceView() {
  const [minSources, setMinSources] = useState<number>(2);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Two queries: a one-shot seeded fetch on mount (kicks the API into computing
  // confluence for the seed universe), and a polling fetch every 60s that just
  // reads the cache.
  const seedQuery = useQuery({
    queryKey: ["confluence", "seed", minSources],
    queryFn: () => api.confluenceActive({ minSources, limit: 100, seed: true }),
    staleTime: Infinity, // only run once per session per minSources
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const pollQuery = useQuery({
    queryKey: ["confluence", "active", minSources],
    queryFn: () => api.confluenceActive({ minSources, limit: 100 }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    enabled: seedQuery.isSuccess,
    retry: 1,
  });

  const data = pollQuery.data ?? seedQuery.data;
  const isLoading = seedQuery.isLoading;
  const isError = seedQuery.isError || pollQuery.isError;
  const isFetching = seedQuery.isFetching || pollQuery.isFetching;

  // Track previously-seen tickers so we can flash new entries.
  const prevTickers = useRef<Set<string>>(new Set());
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!data) return;
    const currentTickers = new Set(data.rows.map((r) => r.ticker));
    const newly: string[] = [];
    for (const t of currentTickers) {
      if (!prevTickers.current.has(t)) newly.push(t);
    }
    if (newly.length > 0) {
      setFlashing(new Set(newly));
      const tm = setTimeout(() => setFlashing(new Set()), 3_000);
      prevTickers.current = currentTickers;
      return () => clearTimeout(tm);
    }
    prevTickers.current = currentTickers;
  }, [data]);

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Confluence</h1>
          <p className="text-sm text-muted-foreground">
            Tickers firing on multiple scanners at once — Explosive, Delphi, Whale, Reddit,
            Catalysts, Flow.
          </p>
          <div className="ml-auto text-xs text-muted-foreground">
            {data ? (
              <>
                {isFetching ? "refreshing… " : ""}
                {rows.length} active · {new Date(data.generated_at).toLocaleTimeString()}
              </>
            ) : (
              "—"
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="uppercase tracking-wide text-muted-foreground">min sources</span>
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            onClick={() => setMinSources(n)}
            className={cn(
              "rounded-full border border-border px-3 py-1",
              minSources === n
                ? "bg-primary/15 text-primary"
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            ≥{n}
          </button>
        ))}
        <button
          onClick={() => {
            pollQuery.refetch();
            seedQuery.refetch();
          }}
          className="ml-auto rounded-full border border-border bg-card px-3 py-1 text-muted-foreground hover:text-foreground"
        >
          {isFetching ? "refreshing…" : "refresh"}
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-signal-bearish">
            Couldn&apos;t load confluence data. Make sure the API + migration 0038 are live.
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No tickers firing on {minSources}+ sources right now. Try lowering the
            threshold, or wait — sources refresh on their own crons (Explosive every 15 min,
            Whale every 12 min, Delphi every 15 min during RTH).
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Ticker</th>
                  <th className="px-3 py-2">Sources</th>
                  <th className="px-3 py-2">Active on</th>
                  <th className="px-3 py-2 text-right">Max score</th>
                  <th className="px-3 py-2 text-right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ConfluenceRowView
                    key={row.ticker}
                    row={row}
                    open={expanded === row.ticker}
                    onToggle={() =>
                      setExpanded((prev) => (prev === row.ticker ? null : row.ticker))
                    }
                    flash={flashing.has(row.ticker)}
                  />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ConfluenceRowView({
  row,
  open,
  onToggle,
  flash,
}: {
  row: ConfluenceRow;
  open: boolean;
  onToggle: () => void;
  flash: boolean;
}) {
  return (
    <>
      <tr
        className={cn(
          "cursor-pointer border-b last:border-0 hover:bg-foreground/5 transition-colors duration-1000",
          flash && "bg-primary/15",
        )}
        onClick={onToggle}
      >
        <td className="px-3 py-2">
          <Link
            href={`/agents/${encodeURIComponent(row.ticker)}`}
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-foreground hover:text-primary"
          >
            {row.ticker}
          </Link>
        </td>
        <td className="px-3 py-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              intensityClass(row.n_sources),
            )}
          >
            {row.n_sources} active
          </span>
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {row.sources.map((s) => (
              <span
                key={s.name}
                title={s.detail}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                  SOURCE_CHIP[s.name],
                )}
              >
                {SOURCE_LABELS[s.name]}
              </span>
            ))}
          </div>
        </td>
        <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
          {row.max_source_score != null ? row.max_source_score.toFixed(0) : "—"}
        </td>
        <td className="px-3 py-2 text-right text-[10px] text-muted-foreground">
          {new Date(row.computed_at).toLocaleTimeString()}
        </td>
      </tr>
      {open ? (
        <tr className="border-b bg-foreground/[0.02]">
          <td colSpan={5} className="px-3 py-3">
            <SourceDetails row={row} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function SourceDetails({ row }: { row: ConfluenceRow }) {
  return (
    <div className="space-y-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Source breakdown
      </div>
      <ul className="space-y-1.5 text-xs">
        {row.sources.map((s) => (
          <li key={s.name} className="flex items-baseline gap-3">
            <span
              className={cn(
                "min-w-[100px] rounded-full px-2 py-0.5 text-center text-[10px] font-medium uppercase tracking-wide",
                SOURCE_CHIP[s.name],
              )}
            >
              {SOURCE_LABELS[s.name]}
            </span>
            <span className="text-foreground">{s.detail}</span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 pt-2 text-[11px]">
        <Link
          href={`/agents/${encodeURIComponent(row.ticker)}`}
          className="rounded-full bg-primary/15 px-3 py-1 text-primary hover:bg-primary/25"
        >
          Open ensemble →
        </Link>
        <Link
          href={`/explosive/${encodeURIComponent(row.ticker)}`}
          className="rounded-full bg-foreground/10 px-3 py-1 text-muted-foreground hover:text-foreground"
        >
          Explosive detail
        </Link>
      </div>
    </div>
  );
}
