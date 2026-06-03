"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type {
  TalonV2CoiledSetup,
  TalonV2ScanProgress,
  TalonV2ScanResponse,
  TalonV2Setup,
  TalonV2ThemeSummary,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const PHASE_LABELS: Record<NonNullable<TalonV2ScanProgress["phase"]>, string> = {
  init: "Initializing",
  v1_scan: "Talon v1 flow scan",
  prewarm_gex: "Fetching GEX data",
  prewarm_dp: "Fetching dark pool data",
  metrics: "Computing flow metrics",
  coherence: "Computing theme coherence",
  prewarm_candles: "Fetching candles",
  chart_signals: "Chart signals",
  prewarm_earnings: "Fetching earnings",
  catalyst_signals: "Catalyst signals",
  prewarm_flow_alerts: "Fetching whale flow",
  whale_signals: "Whale concentration",
  prewarm_short: "Fetching short data",
  short_signals: "Short signals",
  prewarm_analyst: "Fetching analyst",
  analyst_signals: "Analyst signals",
  prewarm_insider: "Fetching insider",
  insider_signals: "Insider signals",
  pattern_signals: "Pattern detection",
  prewarm_fundamentals: "Fetching fundamentals",
  fundamentals_signals: "Fundamentals",
  done: "Done",
};

// Phases grouped by stage with approximate elapsed-seconds budgets (used for
// ETA estimation). Numbers calibrated from the first real scan (16m32s total
// for 504 tickers). Tweak from telemetry as we collect more runs.
const PHASE_ORDER: Array<{
  key: NonNullable<TalonV2ScanProgress["phase"]>;
  stage: "v1" | "v2";
  approxSec: number;
}> = [
  { key: "init", stage: "v1", approxSec: 1 },
  { key: "prewarm_gex", stage: "v1", approxSec: 220 },
  { key: "prewarm_dp", stage: "v1", approxSec: 200 },
  { key: "metrics", stage: "v1", approxSec: 30 },
  { key: "coherence", stage: "v1", approxSec: 30 },
  { key: "v1_scan", stage: "v1", approxSec: 0 },
  { key: "prewarm_candles", stage: "v2", approxSec: 140 },
  { key: "chart_signals", stage: "v2", approxSec: 10 },
  { key: "prewarm_earnings", stage: "v2", approxSec: 90 },
  { key: "catalyst_signals", stage: "v2", approxSec: 5 },
  { key: "prewarm_flow_alerts", stage: "v2", approxSec: 200 },
  { key: "whale_signals", stage: "v2", approxSec: 5 },
  { key: "prewarm_short", stage: "v2", approxSec: 80 },
  { key: "short_signals", stage: "v2", approxSec: 5 },
  { key: "prewarm_analyst", stage: "v2", approxSec: 80 },
  { key: "analyst_signals", stage: "v2", approxSec: 5 },
  { key: "prewarm_insider", stage: "v2", approxSec: 80 },
  { key: "insider_signals", stage: "v2", approxSec: 5 },
  { key: "pattern_signals", stage: "v2", approxSec: 15 },
  { key: "prewarm_fundamentals", stage: "v2", approxSec: 100 },
  { key: "fundamentals_signals", stage: "v2", approxSec: 5 },
  { key: "done", stage: "v2", approxSec: 1 },
];

function phaseIndex(phase: TalonV2ScanProgress["phase"]): number {
  if (!phase) return -1;
  return PHASE_ORDER.findIndex((p) => p.key === phase);
}

function totalRemainingSec(currentPhase: TalonV2ScanProgress["phase"], phaseFrac: number): number {
  const idx = phaseIndex(currentPhase);
  if (idx < 0) return 0;
  const current = PHASE_ORDER[idx];
  const currentRemaining = current.approxSec * (1 - phaseFrac);
  const futureRemaining = PHASE_ORDER.slice(idx + 1).reduce((a, p) => a + p.approxSec, 0);
  return Math.max(0, currentRemaining + futureRemaining);
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "";
  const diffMs = Date.now() - ts;
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${x >= 0 ? "+" : ""}${x.toFixed(digits)}%`;
}

function fmtRatio(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(digits);
}

function fmtMoney(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const abs = Math.abs(x);
  if (abs >= 1_000_000_000) return `$${(x / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(x / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(x / 1_000).toFixed(0)}K`;
  return `$${x.toFixed(0)}`;
}

function CoiledBadge({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return <span className="text-muted-foreground">—</span>;
  const pct = Math.round(score * 100);
  const cls =
    score >= 0.75 ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40" :
    score >= 0.65 ? "bg-amber-500/15 text-amber-300" :
    "bg-foreground/10 text-muted-foreground";
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[10px] font-medium tabular-nums", cls)}>
      {pct}
    </span>
  );
}

function StructureBadge({
  above20,
  above50,
  above200,
}: {
  above20: number | null | undefined;
  above50: number | null | undefined;
  above200: number | null | undefined;
}) {
  const dot = (v: number | null | undefined, label: string) => {
    if (v === null || v === undefined) {
      return <span key={label} className="text-[9px] text-muted-foreground">{label}?</span>;
    }
    return (
      <span
        key={label}
        className={cn(
          "text-[9px] font-medium tabular-nums",
          v ? "text-emerald-400" : "text-rose-400/80",
        )}
      >
        {label}{v ? "↑" : "↓"}
      </span>
    );
  };
  return (
    <div className="flex items-center gap-1.5">
      {dot(above20, "20d")}
      {dot(above50, "50d")}
      {dot(above200, "200d")}
    </div>
  );
}

function EarningsBadge({ risk, dte }: { risk?: string; dte?: number | null }) {
  if (!risk || risk === "unknown") return null;
  const cls =
    risk === "imminent" ? "bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/40" :
    risk === "near" ? "bg-amber-500/15 text-amber-300" :
    risk === "past" ? "bg-foreground/10 text-muted-foreground" :
    "bg-emerald-500/10 text-emerald-300";
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[10px] font-medium tabular-nums", cls)} title={`Next earnings: ${risk}`}>
      E{dte !== null && dte !== undefined ? (dte >= 0 ? `+${dte}` : `${dte}`) : ""}
    </span>
  );
}

function WhaleBadge({ score, prem }: { score?: number | null; prem?: number }) {
  if (!score || !prem) return null;
  if (score < 0.50) return null;
  const cls =
    score >= 0.75 ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40" :
    score >= 0.60 ? "bg-violet-500/10 text-violet-300/80" :
    "bg-foreground/10 text-muted-foreground";
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[10px] font-medium tabular-nums", cls)} title="Whale concentration">
      🐋 {fmtMoney(prem)}
    </span>
  );
}

function SqueezeBadge({ flag, siPct, dtc }: { flag?: boolean; siPct?: number | null; dtc?: number | null }) {
  if (!flag) return null;
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-orange-500/15 px-2 text-[10px] font-medium tabular-nums text-orange-300" title={`SI ${siPct?.toFixed(1)}% / DTC ${dtc?.toFixed(1)}`}>
      🔥 squeeze
    </span>
  );
}

function PatternBadge({ pattern, score }: { pattern?: string | null; score?: number | null }) {
  if (!pattern) return null;
  const label = pattern.replace(/_/g, " ");
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-sky-500/15 px-2 text-[10px] font-medium text-sky-300" title={`${label} · ${(score! * 100).toFixed(0)}`}>
      {label}
    </span>
  );
}

function InsiderBadge({ flag, value }: { flag?: boolean; value?: number }) {
  if (!flag) return null;
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-emerald-500/15 px-2 text-[10px] font-medium tabular-nums text-emerald-300" title="3+ insiders buying in 30d">
      👥 {fmtMoney(value)}
    </span>
  );
}

function AnalystBadge({ skew, ptVsSpot }: { skew?: string; ptVsSpot?: number | null }) {
  if (!skew || skew === "unknown") return null;
  const cls =
    skew === "bull" ? "bg-emerald-500/10 text-emerald-300" :
    skew === "bear" ? "bg-rose-500/10 text-rose-300" :
    "bg-foreground/10 text-muted-foreground";
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[10px] font-medium tabular-nums", cls)} title={`Analyst ${skew}`}>
      A {ptVsSpot !== null && ptVsSpot !== undefined ? fmtPct(ptVsSpot) : skew}
    </span>
  );
}

function FundBadge({ q }: { q?: string }) {
  if (!q || q === "unknown") return null;
  const cls =
    q === "high" ? "bg-emerald-500/15 text-emerald-300" :
    q === "low" ? "bg-rose-500/15 text-rose-300" :
    "bg-foreground/10 text-muted-foreground";
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[10px] font-medium uppercase tabular-nums", cls)} title="Fundamentals quality">
      F:{q}
    </span>
  );
}

function SetupBadges({ r }: { r: TalonV2Setup }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <CoiledBadge score={r.coiled_score} />
      <EarningsBadge risk={r.earnings_risk} dte={r.dte_to_earnings} />
      <WhaleBadge score={r.whale_score} prem={r.whale_total_prem_5d} />
      <PatternBadge pattern={r.pattern} score={r.pattern_score} />
      <SqueezeBadge flag={r.squeeze_flag} siPct={r.si_pct_float} dtc={r.days_to_cover} />
      <InsiderBadge flag={r.insider_cluster_flag} value={r.insider_recent_buys_total_value} />
      <AnalystBadge skew={r.analyst_skew} ptVsSpot={r.analyst_pt_vs_spot_pct} />
      <FundBadge q={r.fund_quality} />
    </div>
  );
}

type Tier = "coiled" | "whale" | "patterns" | "actionable" | "watchlist";

type CoiledSortKey =
  | "coiled_score"
  | "ticker"
  | "atr_ratio"
  | "vol_ratio"
  | "slope_4w_pct"
  | "grade"
  | "theme";

export function TalonV2View() {
  const qc = useQueryClient();
  const [tier, setTier] = useState<Tier>("coiled");
  const [coiledSort, setCoiledSort] = useState<{ k: CoiledSortKey; d: "asc" | "desc" }>({
    k: "coiled_score",
    d: "desc",
  });

  const { data, error, isLoading } = useQuery({
    queryKey: ["talon-v2-latest"],
    queryFn: () =>
      api.talonV2LatestScan().catch((e) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }),
    staleTime: 30_000,
  });

  const runScan = useMutation({
    mutationFn: () => api.talonV2RunScan(),
    onSuccess: (fresh) => qc.setQueryData(["talon-v2-latest"], fresh),
  });

  const { data: progress } = useQuery({
    queryKey: ["talon-v2-progress"],
    queryFn: () => api.talonV2ScanProgress(),
    refetchInterval: runScan.isPending ? 2000 : 30_000,
    refetchIntervalInBackground: false,
  });

  const isScanning = runScan.isPending || progress?.status === "running";
  const progressPct =
    progress && progress.phase_total > 0
      ? Math.round((progress.phase_progress / progress.phase_total) * 100)
      : 0;

  const scan = (data ?? null) as TalonV2ScanResponse | null;

  const coiledSetups = scan?.coiled_setups ?? [];
  const sortedCoiled = useMemo(() => {
    if (!coiledSetups.length) return [];
    const arr = [...coiledSetups];
    arr.sort((a, b) => {
      const va = (a as Record<string, unknown>)[coiledSort.k];
      const vb = (b as Record<string, unknown>)[coiledSort.k];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "string" && typeof vb === "string")
        return coiledSort.d === "desc" ? vb.localeCompare(va) : va.localeCompare(vb);
      return coiledSort.d === "desc"
        ? (vb as number) - (va as number)
        : (va as number) - (vb as number);
    });
    return arr;
  }, [coiledSetups, coiledSort]);

  const themesSummary = scan?.themes_summary ?? {};
  const coiledThemes = useMemo(() => {
    const entries = Object.entries(themesSummary) as [string, TalonV2ThemeSummary][];
    return entries
      .filter(([, s]) => s.coiled_basket || (s.n_coiled ?? 0) > 0)
      .sort((a, b) => (b[1].n_coiled || 0) - (a[1].n_coiled || 0));
  }, [themesSummary]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const tierRows: TalonV2Setup[] = (
    tier === "coiled" ? [] :
    tier === "whale" ? (scan?.whale_setups ?? []) :
    tier === "patterns" ? (scan?.pattern_setups ?? []) :
    tier === "actionable" ? (scan?.actionable ?? []) :
    (scan?.watchlist ?? [])
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Talon v2</h1>
            <span className="inline-flex h-5 items-center rounded-full bg-emerald-500/15 px-2 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/30">
              full signal stack
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            v1 flow + chart + earnings + whale + short + analyst + insider + patterns + fundamentals.
          </p>
          {scan && (
            <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
              Last scan {relativeTime(scan.v2_generated_at)} · {scan.universe_total} tickers ·{" "}
              {scan.coiled_count ?? 0} coiled · {scan.whale_count ?? 0} whale · {scan.pattern_count ?? 0} pattern ·{" "}
              {scan.actionable_count} actionable · {(scan.v2_elapsed_seconds ?? 0).toFixed(0)}s
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <button
            onClick={() => runScan.mutate()}
            disabled={isScanning}
            className="h-9 rounded-full border border-primary/40 bg-primary/10 px-4 text-sm text-primary hover:border-primary disabled:opacity-50 tabular-nums"
          >
            {isScanning ? "Scanning…" : "Run scan"}
          </button>
          {isScanning && progress && (
            <ScanProgressPanel progress={progress} progressPct={progressPct} />
          )}
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-rose-400">
            Failed to load Talon v2 scan: {String(error)}
          </CardContent>
        </Card>
      )}

      {!scan && !isLoading && !error && !isScanning && (
        <Card>
          <CardContent className="space-y-2 p-6 text-sm text-muted-foreground">
            <p className="text-foreground">No Talon v2 scan yet.</p>
            <p>
              Click <span className="text-foreground">Run scan</span> to kick the first one off
              (full Phase 1-3 signal stack, ~15-25 min).
            </p>
          </CardContent>
        </Card>
      )}

      {/* Stale-data banner: scan is running over an existing one */}
      {scan && isScanning && (
        <Card>
          <CardContent className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
            <span>
              <span className="text-foreground">New scan in progress.</span> Below is the previous
              scan ({relativeTime(scan.v2_generated_at)}); it'll be replaced when the new one finishes.
            </span>
          </CardContent>
        </Card>
      )}

      {/* Coiled themes summary */}
      {scan && coiledThemes.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Coiled themes
              </h2>
              <span className="text-[10px] text-muted-foreground">
                ≥3 members with coiled_score ≥ 0.65
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {coiledThemes.map(([name, s]) => (
                <div
                  key={name}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border p-3",
                    s.coiled_basket
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-border bg-card/50",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{name}</span>
                    <CoiledBadge score={s.mean_coiled_score} />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {s.n_coiled} of {s.n_members_with_data} coiled
                  </p>
                  {s.coiled_tickers.length > 0 && (
                    <p className="text-[11px] tabular-nums">
                      {s.coiled_tickers.slice(0, 8).join(" · ")}
                      {s.coiled_tickers.length > 8 ? ` +${s.coiled_tickers.length - 8}` : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tier switcher */}
      {scan && (
        <div className="flex flex-wrap items-center gap-1 rounded-full bg-foreground/[0.03] p-1 text-sm w-fit">
          <TierButton active={tier === "coiled"} onClick={() => setTier("coiled")}>
            Coiled ({scan.coiled_count ?? 0})
          </TierButton>
          <TierButton active={tier === "whale"} onClick={() => setTier("whale")}>
            Whale ({scan.whale_count ?? 0})
          </TierButton>
          <TierButton active={tier === "patterns"} onClick={() => setTier("patterns")}>
            Patterns ({scan.pattern_count ?? 0})
          </TierButton>
          <TierButton active={tier === "actionable"} onClick={() => setTier("actionable")}>
            Actionable ({scan.actionable_count})
          </TierButton>
          <TierButton active={tier === "watchlist"} onClick={() => setTier("watchlist")}>
            Watchlist ({scan.watchlist_count})
          </TierButton>
        </div>
      )}

      {/* Coiled table (uses different shape than the other tiers) */}
      {scan && tier === "coiled" && sortedCoiled.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr className="border-y border-border">
                    <SortableTh k="ticker" label="Ticker" sort={coiledSort} setSort={setCoiledSort} />
                    <SortableTh k="theme" label="Theme" sort={coiledSort} setSort={setCoiledSort} />
                    <SortableTh k="coiled_score" label="Coiled" sort={coiledSort} setSort={setCoiledSort} />
                    <SortableTh k="atr_ratio" label="ATR 5/20" sort={coiledSort} setSort={setCoiledSort} />
                    <SortableTh k="vol_ratio" label="Vol 5/20" sort={coiledSort} setSort={setCoiledSort} />
                    <SortableTh k="slope_4w_pct" label="4w slope" sort={coiledSort} setSort={setCoiledSort} />
                    <th className="px-3 py-2 text-left">Structure</th>
                    <SortableTh k="grade" label="v1 grade" sort={coiledSort} setSort={setCoiledSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedCoiled.map((r) => (
                    <CoiledRow key={r.ticker} r={r} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Whale / Patterns / Actionable / Watchlist — shared table shape */}
      {scan && tier !== "coiled" && tierRows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr className="border-y border-border">
                    <th className="px-3 py-2 text-left">Ticker</th>
                    <th className="px-3 py-2 text-left">Theme</th>
                    <th className="px-3 py-2 text-left">Grade</th>
                    <th className="px-3 py-2 text-left">Signals</th>
                    {tier === "whale" && (
                      <>
                        <th className="px-3 py-2 text-left">Top strike</th>
                        <th className="px-3 py-2 text-left">Concentration</th>
                      </>
                    )}
                    {tier === "patterns" && (
                      <th className="px-3 py-2 text-left">Pattern detail</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {tierRows.map((r) => (
                    <tr key={r.ticker} className="border-b border-border/60 hover:bg-foreground/[0.02]">
                      <td className="px-3 py-2 font-medium">{r.ticker}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.theme}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {r.grade?.toFixed(1) ?? "—"}
                        {r.ma_gate_adjust ? (
                          <span className={cn("ml-1 text-[9px]", r.ma_gate_adjust > 0 ? "text-emerald-400" : "text-rose-400")}>
                            ({r.ma_gate_adjust > 0 ? "+" : ""}{r.ma_gate_adjust})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <SetupBadges r={r} />
                      </td>
                      {tier === "whale" && (
                        <>
                          <td className="px-3 py-2 tabular-nums">
                            ${r.whale_top_strike}{r.whale_top_expiry ? ` ${r.whale_top_expiry}` : ""}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {fmtMoney(r.whale_top_strike_prem)} ({fmtPct((r.whale_concentration_pct ?? 0) * 100, 0)})
                          </td>
                        </>
                      )}
                      {tier === "patterns" && (
                        <td className="px-3 py-2 text-[10px] text-muted-foreground">
                          {r.pattern_detail ? JSON.stringify(r.pattern_detail).slice(0, 80) : "—"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Link to v1 */}
      {scan && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-xs text-muted-foreground">
              v2 phases: {scan.v2_phases_enabled?.join(" · ") ?? "—"}
              {scan.v2_phases_disabled?.length ? (
                <span className="ml-2 text-rose-400/80">
                  disabled: {scan.v2_phases_disabled.join(", ")}
                </span>
              ) : null}
            </div>
            <a href="/talon" className="text-xs text-primary hover:underline">
              View v1 setups →
            </a>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ScanProgressPanel — phase checklist + elapsed/ETA + recent tickers ribbon.
// The progress endpoint only tells us the current phase + ticker counter;
// everything else (which phases are done, elapsed seconds, ETA) is derived
// client-side from PHASE_ORDER.
function ScanProgressPanel({
  progress,
  progressPct,
}: {
  progress: TalonV2ScanProgress;
  progressPct: number;
}) {
  // Tick every second so elapsed + ETA update in real time
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedSec = progress.started_at
    ? Math.max(0, (Date.now() - new Date(progress.started_at).getTime()) / 1000)
    : 0;
  const phaseFrac =
    progress.phase_total > 0
      ? Math.min(1, progress.phase_progress / progress.phase_total)
      : 0;
  const etaSec = totalRemainingSec(progress.phase, phaseFrac);

  const currentIdx = phaseIndex(progress.phase);
  const v1Phases = PHASE_ORDER.filter((p) => p.stage === "v1");
  const v2Phases = PHASE_ORDER.filter((p) => p.stage === "v2");

  // Track the last N tickers we saw so the user sees a "live" ticker feed
  const [recentTickers, setRecentTickers] = useState<string[]>([]);
  useEffect(() => {
    if (progress.current_ticker) {
      setRecentTickers((cur) => {
        if (cur[0] === progress.current_ticker) return cur;
        return [progress.current_ticker!, ...cur].slice(0, 8);
      });
    }
  }, [progress.current_ticker]);

  return (
    <div className="w-[360px] space-y-2 rounded-lg border border-border bg-card/40 p-3">
      {/* Headline + ETA */}
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium">
          {progress.phase ? PHASE_LABELS[progress.phase] : "Initializing…"}
        </p>
        <p className="text-[10px] tabular-nums text-muted-foreground">
          {fmtDuration(elapsedSec)} / ~{fmtDuration(elapsedSec + etaSec)}
        </p>
      </div>

      {/* Per-phase progress bar */}
      <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <div
          className="h-full bg-primary transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <p className="text-[10px] tabular-nums text-muted-foreground">
        {progress.phase_progress}/{progress.phase_total}
        {progress.current_ticker ? ` · ${progress.current_ticker}` : ""}
      </p>

      {/* Phase checklist — stage by stage */}
      <div className="space-y-1.5 pt-1">
        <PhaseStage label="v1 — flow gates" phases={v1Phases} currentIdx={currentIdx} />
        <PhaseStage label="v2 — context + structure" phases={v2Phases} currentIdx={currentIdx} />
      </div>

      {/* Recent tickers ribbon */}
      {recentTickers.length > 0 && (
        <div className="pt-1">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
            Recent
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {recentTickers.map((t, i) => (
              <span
                key={`${t}-${i}`}
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                  i === 0
                    ? "bg-primary/15 text-primary"
                    : "bg-foreground/10 text-muted-foreground",
                )}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PhaseStage({
  label,
  phases,
  currentIdx,
}: {
  label: string;
  phases: Array<{ key: NonNullable<TalonV2ScanProgress["phase"]>; stage: "v1" | "v2"; approxSec: number }>;
  currentIdx: number;
}) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {phases.map((p) => {
          const idx = PHASE_ORDER.findIndex((x) => x.key === p.key);
          const status = idx < currentIdx ? "done" : idx === currentIdx ? "running" : "pending";
          return (
            <span
              key={p.key}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                status === "done"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : status === "running"
                  ? "bg-primary/15 text-primary animate-pulse"
                  : "bg-foreground/5 text-muted-foreground/60",
              )}
            >
              <span className="inline-block">
                {status === "done" ? "✓" : status === "running" ? "▶" : "○"}
              </span>
              {PHASE_LABELS[p.key].replace(/^(Talon |Fetching |Computing )/, "")}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function TierButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 transition-colors",
        active
          ? "bg-primary text-white shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function CoiledRow({ r }: { r: TalonV2CoiledSetup }) {
  return (
    <tr className="border-b border-border/60 hover:bg-foreground/[0.02]">
      <td className="px-3 py-2 font-medium">
        {r.ticker}
        {r.chart_only && <span className="ml-1 text-[9px] text-amber-400">chart-only</span>}
      </td>
      <td className="px-3 py-2 text-muted-foreground">{r.theme}</td>
      <td className="px-3 py-2"><CoiledBadge score={r.coiled_score} /></td>
      <td className="px-3 py-2 tabular-nums">{fmtRatio(r.atr_ratio)}</td>
      <td className="px-3 py-2 tabular-nums">{fmtRatio(r.vol_ratio)}</td>
      <td className="px-3 py-2 tabular-nums">{fmtPct(r.slope_4w_pct)}</td>
      <td className="px-3 py-2">
        <StructureBadge above20={r.above_20d} above50={r.above_50d} above200={r.above_200d} />
      </td>
      <td className="px-3 py-2 tabular-nums">
        {r.grade !== null && r.grade !== undefined ? r.grade.toFixed(1) : "—"}
      </td>
    </tr>
  );
}

function SortableTh({
  k,
  label,
  sort,
  setSort,
}: {
  k: CoiledSortKey;
  label: string;
  sort: { k: CoiledSortKey; d: "asc" | "desc" };
  setSort: (s: { k: CoiledSortKey; d: "asc" | "desc" }) => void;
}) {
  const active = sort.k === k;
  return (
    <th
      onClick={() => {
        if (active) setSort({ k, d: sort.d === "desc" ? "asc" : "desc" });
        else setSort({ k, d: "desc" });
      }}
      className={cn(
        "cursor-pointer select-none px-3 py-2 text-left hover:text-foreground",
        active && "text-foreground",
      )}
    >
      {label}
      {active && <span className="ml-1">{sort.d === "desc" ? "↓" : "↑"}</span>}
    </th>
  );
}
