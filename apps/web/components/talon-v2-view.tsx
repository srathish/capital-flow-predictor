"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
  prewarm_candles: "Fetching daily candles",
  chart_signals: "Computing ATR / vol / MA signals",
  done: "Done",
};

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
      const va = (a as any)[coiledSort.k];
      const vb = (b as any)[coiledSort.k];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "string") return coiledSort.d === "desc" ? vb.localeCompare(va) : va.localeCompare(vb);
      return coiledSort.d === "desc" ? vb - va : va - vb;
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

  return (
    <div className="space-y-4">
      {/* Header + run button */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Talon v2</h1>
            <span className="inline-flex h-5 items-center rounded-full bg-emerald-500/15 px-2 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/30">
              chart structure
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            v1 flow gates + ATR / volume contraction / MA position. Surfaces themes that are
            <span className="font-medium text-foreground"> basing, drying up volume, and ready to expand</span>.
          </p>
          {scan && (
            <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
              Last scan {relativeTime(scan.v2_generated_at)} · {scan.universe_total} tickers ·
              {" "}{scan.coiled_count} coiled · {scan.coiled_themes.length} coiled themes ·
              {" "}{(scan.v2_elapsed_seconds ?? 0).toFixed(0)}s elapsed
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
            <div className="w-[280px] space-y-0.5">
              <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="text-[10px] tabular-nums text-muted-foreground">
                {progress.phase ? PHASE_LABELS[progress.phase] : "…"} ·{" "}
                {progress.phase_progress}/{progress.phase_total}
                {progress.current_ticker ? ` · ${progress.current_ticker}` : ""}
              </p>
            </div>
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

      {!scan && !isLoading && !error && (
        <Card>
          <CardContent className="space-y-2 p-6 text-sm text-muted-foreground">
            <p className="text-foreground">No Talon v2 scan in the database yet.</p>
            <p>
              Click <span className="text-foreground">Run scan</span> to kick the first one off
              (takes ~10–15 min — runs v1's flow side plus the new candle prewarm).
            </p>
          </CardContent>
        </Card>
      )}

      {/* Coiled themes — the headline insight */}
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

      {/* Coiled setups table */}
      {scan && sortedCoiled.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-0">
            <div className="flex items-center justify-between px-4 pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Coiled setups ({sortedCoiled.length})
              </h2>
              <p className="text-[10px] text-muted-foreground">
                Pre-breakout candidates · sorted by coiled_score
              </p>
            </div>
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
                    <tr key={r.ticker} className="border-b border-border/60 hover:bg-foreground/[0.02]">
                      <td className="px-3 py-2 font-medium">
                        {r.ticker}
                        {r.chart_only && (
                          <span className="ml-1 text-[9px] text-amber-400">chart-only</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.theme}</td>
                      <td className="px-3 py-2"><CoiledBadge score={r.coiled_score} /></td>
                      <td className="px-3 py-2 tabular-nums">{fmtRatio(r.atr_ratio)}</td>
                      <td className="px-3 py-2 tabular-nums">{fmtRatio(r.vol_ratio)}</td>
                      <td className="px-3 py-2 tabular-nums">{fmtPct(r.slope_4w_pct)}</td>
                      <td className="px-3 py-2">
                        <StructureBadge
                          above20={r.above_20d}
                          above50={r.above_50d}
                          above200={r.above_200d}
                        />
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {r.grade !== null && r.grade !== undefined ? r.grade.toFixed(1) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* v1 actionable count — link to v1 page for the full setups table */}
      {scan && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm">
              <span className="font-medium">{scan.actionable_count}</span>{" "}
              <span className="text-muted-foreground">actionable +</span>{" "}
              <span className="font-medium">{scan.watchlist_count}</span>{" "}
              <span className="text-muted-foreground">watchlist (from v1 flow gates)</span>
            </div>
            <a
              href="/talon"
              className="text-xs text-primary hover:underline"
            >
              View v1 setups →
            </a>
          </CardContent>
        </Card>
      )}
    </div>
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

// (TalonV2Setup is imported for type-completeness; the v1 setups table lives at /talon.)
export type _UseTalonV2Setup = TalonV2Setup;
