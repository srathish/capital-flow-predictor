"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { baseUrl, authHeaders } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const REFETCH_MS = 60_000;

type ExplosiveSubScores = {
  flow_concentration: number;
  iv_term: number;
  squeeze: number;
  catalyst: number;
  cheap_optionality: number;
  gex_bonus: number;
  // Phase 2 confirmation signals
  iv_vs_rv?: number;
  skew_flip?: number;
  nope?: number;
  insider_buy?: number;
  volume_profile?: number;
};

type ExplosiveItem = {
  ticker: string;
  score: number;
  catalyst_type: string | null;
  catalyst_date: string | null;
  catalyst_label: string | null;
  days_to_catalyst: number | null;
  underlying_price: number | null;
  top_option_symbol: string | null;
  top_option_type: string | null;
  top_strike: number | null;
  top_expiry: string | null;
  top_last_price: number | null;
  top_volume: number | null;
  top_open_interest: number | null;
  top_premium: number | null;
  sub_scores: ExplosiveSubScores;
  signals: Record<string, string>;
};

type ExplosiveFeedResponse = {
  snapshot_ts: string | null;
  count: number;
  items: ExplosiveItem[];
};

type CatalystFilter = "all" | "earnings" | "fda" | "ipo";

const CATALYST_LABELS: Record<CatalystFilter, string> = {
  all: "All catalysts",
  earnings: "Earnings",
  fda: "FDA",
  ipo: "IPO",
};

async function fetchExplosive(filter: CatalystFilter, minScore: number): Promise<ExplosiveFeedResponse> {
  const sp = new URLSearchParams();
  sp.set("limit", "80");
  if (minScore > 0) sp.set("min_score", String(minScore));
  if (filter !== "all") sp.set("catalyst_type", filter);
  const res = await fetch(`${baseUrl()}/v1/explosive?${sp}`, {
    headers: { Accept: "application/json", ...authHeaders() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as ExplosiveFeedResponse;
}

function formatMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function formatPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v < 1) return `$${v.toFixed(2)}`;
  if (v < 100) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(0)}`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function catalystChipColor(type: string | null): string {
  if (type === "earnings") return "bg-primary/15 text-primary";
  if (type === "fda") return "bg-rose-500/15 text-rose-400";
  if (type === "ipo") return "bg-sky-500/15 text-sky-400";
  return "bg-muted text-muted-foreground";
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 55) return "text-amber-400";
  if (score >= 35) return "text-foreground";
  return "text-muted-foreground";
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(2, Math.min(100, score));
  const color =
    score >= 75 ? "bg-emerald-500" : score >= 55 ? "bg-amber-500" : score >= 35 ? "bg-foreground/60" : "bg-muted-foreground/40";
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function ExplosivePage() {
  const [filter, setFilter] = useState<CatalystFilter>("all");
  const [minScore, setMinScore] = useState(0);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["explosive", filter, minScore],
    queryFn: () => fetchExplosive(filter, minScore),
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Explosive Options</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Catalyst-aware unusual-options scanner. Surfaces names where flow concentration,
            IV term inversion, squeeze setup, and proximity to a catalyst all line up — the
            setup that <em>precedes</em> 1→100x option moves.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Snapshot: {data?.snapshot_ts ? `${formatRelative(data.snapshot_ts)} (${new Date(data.snapshot_ts).toLocaleString()})` : "—"} · {data?.count ?? 0} tickers
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-9 rounded-full border border-border bg-card px-4 text-sm hover:border-primary/60 disabled:opacity-50"
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(Object.keys(CATALYST_LABELS) as CatalystFilter[]).map((k) => {
          const active = filter === k;
          return (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={cn(
                "h-8 rounded-full px-3 text-xs transition-colors",
                active
                  ? "bg-primary/15 text-primary"
                  : "border border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              {CATALYST_LABELS[k]}
            </button>
          );
        })}
        <div className="ml-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span>min score</span>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="h-1.5 w-32"
          />
          <span className="w-8 text-foreground">{minScore}</span>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="p-6 text-sm text-rose-400">
            Failed to load: {(error as Error)?.message ?? "unknown"}
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && data && data.items.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No scored tickers yet. Run <code className="rounded bg-muted px-1.5 py-0.5">cfp-jobs explosive-ingest</code> then <code className="rounded bg-muted px-1.5 py-0.5">cfp-jobs explosive-score</code> to populate.
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && data && data.items.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Ticker</th>
                    <th className="px-3 py-2 text-left">Catalyst</th>
                    <th className="px-3 py-2 text-right">Score</th>
                    <th className="px-3 py-2 text-right">Stock</th>
                    <th className="px-3 py-2 text-left">Top OTM call</th>
                    <th className="px-3 py-2 text-right">Last</th>
                    <th className="px-3 py-2 text-right">Vol / OI</th>
                    <th className="px-3 py-2 text-left">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((it) => (
                    <tr key={it.ticker} className="border-t border-border/60 hover:bg-muted/30">
                      <td className="px-3 py-2 font-semibold">
                        <Link href={`/agents/${encodeURIComponent(it.ticker)}`} className="hover:text-primary">
                          {it.ticker}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {it.catalyst_label ? (
                          <div className="flex flex-col gap-0.5">
                            <span className={cn("inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs", catalystChipColor(it.catalyst_type))}>
                              {it.catalyst_label}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {it.days_to_catalyst !== null
                                ? it.days_to_catalyst === 0
                                  ? "today"
                                  : `in ${it.days_to_catalyst}d`
                                : "—"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className={cn("font-semibold tabular-nums", scoreColor(it.score))}>
                            {it.score.toFixed(0)}
                          </span>
                          <ScoreBar score={it.score} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatPrice(it.underlying_price)}</td>
                      <td className="px-3 py-2">
                        {it.top_strike != null && it.top_expiry ? (
                          <div className="flex flex-col">
                            <span className="font-mono text-xs">
                              ${it.top_strike.toFixed(it.top_strike < 10 ? 1 : 0)}C {it.top_expiry}
                            </span>
                            {it.top_option_symbol && (
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {it.top_option_symbol}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {it.top_last_price != null ? (
                          <span className={cn(it.top_last_price <= 0.75 && "font-semibold text-emerald-400")}>
                            {formatPrice(it.top_last_price)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        {it.top_volume != null ? it.top_volume.toLocaleString() : "—"}
                        {" / "}
                        {it.top_open_interest != null ? it.top_open_interest.toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        <div className="flex flex-col gap-0.5">
                          {Object.entries(it.signals).slice(0, 3).map(([k, v]) => (
                            <span key={k}>
                              <span className="text-foreground/70">{k.replace("_", " ")}:</span> {v}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
