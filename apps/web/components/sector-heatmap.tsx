"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import type { SectorEntry } from "@/lib/types";
import { cn, formatDate, formatNum } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function tileBg(rank: number | null, total: number): string {
  if (rank === null) return "bg-muted/40";
  // Greener at the top, redder at the bottom; mid sectors muted.
  const pos = (rank - 1) / Math.max(1, total - 1); // 0..1
  if (pos < 0.25) return "bg-signal-bullish/25 hover:bg-signal-bullish/40";
  if (pos < 0.5) return "bg-signal-bullish/10 hover:bg-signal-bullish/20";
  if (pos > 0.75) return "bg-signal-bearish/25 hover:bg-signal-bearish/40";
  if (pos > 0.5) return "bg-signal-bearish/10 hover:bg-signal-bearish/20";
  return "bg-muted hover:bg-muted/70";
}

export function SectorHeatmap() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["sectors", { horizon: 10 }],
    queryFn: () => api.sectors({ horizon: 10 }),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 18 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-signal-bearish/40">
        <CardContent className="p-4 text-sm text-muted-foreground">
          Failed to load sectors. Is the API up at{" "}
          <code className="rounded bg-muted px-1">{process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}</code>?
        </CardContent>
      </Card>
    );
  }

  const ranked = data.sectors
    .filter((s) => s.latest_rank !== null)
    .sort((a, b) => (a.latest_rank ?? 999) - (b.latest_rank ?? 999));
  const unranked = data.sectors.filter((s) => s.latest_rank === null);
  const total = ranked.length;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sector predictions</h1>
          <p className="text-sm text-muted-foreground">
            10-day relative-strength rankings from <code className="rounded bg-muted px-1">xgb_v1</code>.{" "}
            {data.run_ts && <>Last run {formatDate(data.run_ts)}.</>}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {ranked.map((s) => (
          <Tile key={s.symbol} s={s} totalRanked={total} />
        ))}
      </div>

      {unranked.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Holdings without ranking</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {unranked.map((s) => (
              <Tile key={s.symbol} s={s} totalRanked={total} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ s, totalRanked }: { s: SectorEntry; totalRanked: number }) {
  return (
    <Link href={`/sectors/${encodeURIComponent(s.symbol)}`} className="block group">
      <Card className={cn("transition-colors", tileBg(s.latest_rank, totalRanked))}>
        <CardHeader className="p-3">
          <div className="flex items-baseline justify-between">
            <CardTitle className="text-base">{s.symbol}</CardTitle>
            {s.latest_rank !== null && (
              <span className="num text-xs text-muted-foreground">#{s.latest_rank}</span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-0 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>score</span>
            <span className="num">{formatNum(s.latest_score, 4)}</span>
          </div>
          <div className="flex justify-between">
            <span>holdings</span>
            <span className="num">{s.n_constituents}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
