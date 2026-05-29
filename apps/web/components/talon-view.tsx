"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { TalonScanProgress, TalonScanResponse, TalonSetup } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const PHASE_LABELS: Record<NonNullable<TalonScanProgress["phase"]>, string> = {
  init: "Initializing",
  prewarm_gex: "Fetching GEX data",
  prewarm_dp: "Fetching dark pool data",
  metrics: "Computing per-ticker metrics",
  coherence: "Computing theme coherence",
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

type SortKey = "grade" | "ticker" | "delta_buildup_pct" | "vanna_ratio_5d_back" |
               "theme_coherence" | "call_dom_now" | "theme" | "dp_skew_pct" | "dp_share_pct";
type SortDir = "asc" | "desc";

const GRADE_BAND_STYLES = {
  high: "bg-signal-bullish/20 text-signal-bullish ring-1 ring-signal-bullish/40",
  mid: "bg-amber-500/15 text-amber-300",
  low: "bg-foreground/10 text-muted-foreground",
} as const;

const DIRECTION_STYLES = {
  bull: "bg-signal-bullish/15 text-signal-bullish",
  bear: "bg-signal-bearish/15 text-signal-bearish",
  neutral: "bg-foreground/10 text-muted-foreground",
} as const;

function gradeBand(g: number): keyof typeof GRADE_BAND_STYLES {
  if (g >= 70) return "high";
  if (g >= 55) return "mid";
  return "low";
}

function fmtPct(x: number | null, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${x >= 0 ? "+" : ""}${x.toFixed(digits)}%`;
}

function fmtRatio(x: number | null, digits = 2): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(digits);
}

function fmtPctValue(x: number | null, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${x.toFixed(digits)}%`;
}

function ScoreBar({ value }: { value: number }) {
  // value in [0, 100]
  const pct = Math.max(0, Math.min(100, value));
  const color =
    pct >= 70 ? "bg-signal-bullish" :
    pct >= 50 ? "bg-amber-500" :
    "bg-signal-bearish/70";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-foreground/10">
        <div className={cn("h-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-7 text-right text-[10px] tabular-nums text-muted-foreground">
        {pct.toFixed(0)}
      </span>
    </div>
  );
}

export function TalonView() {
  const qc = useQueryClient();

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ["talon-latest"],
    queryFn: () => api.talonLatestScan().catch((e) => {
      // 404 means "no scan yet" — surface as null instead of throwing.
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),
    staleTime: 30_000,
  });

  const runScan = useMutation({
    mutationFn: () => api.talonRunScan(),
    onSuccess: (fresh) => {
      qc.setQueryData(["talon-latest"], fresh);
    },
  });

  // Poll progress while a scan is running, OR every 30s as background heartbeat
  // (in case another tab/user kicked off a scan, this tab sees it).
  const { data: progress } = useQuery({
    queryKey: ["talon-progress"],
    queryFn: () => api.talonScanProgress(),
    refetchInterval: runScan.isPending ? 2000 : 30_000,
    refetchIntervalInBackground: false,
  });
  const isScanning = runScan.isPending || progress?.status === "running";
  const progressPct = progress && progress.phase_total > 0
    ? Math.round((progress.phase_progress / progress.phase_total) * 100)
    : 0;

  const [directionFilter, setDirectionFilter] = useState<"all" | "bull" | "bear">("all");
  const [bandFilter, setBandFilter] = useState<"all" | "actionable" | "watchlist">("all");
  const [themeFilter, setThemeFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("grade");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const rows = useMemo<TalonSetup[]>(() => {
    if (!data) return [];
    let combined: TalonSetup[];
    if (bandFilter === "actionable") combined = data.actionable;
    else if (bandFilter === "watchlist") combined = data.watchlist;
    else combined = [...data.actionable, ...data.watchlist];

    if (directionFilter !== "all") {
      combined = combined.filter((r) => r.direction === directionFilter);
    }
    if (themeFilter !== "all") {
      combined = combined.filter((r) => r.theme === themeFilter);
    }

    return [...combined].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const an = av === null || av === undefined ? Number.NEGATIVE_INFINITY : av;
      const bn = bv === null || bv === undefined ? Number.NEGATIVE_INFINITY : bv;
      if (typeof an === "string" && typeof bn === "string") {
        return sortDir === "desc" ? bn.localeCompare(an) : an.localeCompare(bn);
      }
      return sortDir === "desc" ? Number(bn) - Number(an) : Number(an) - Number(bn);
    });
  }, [data, bandFilter, directionFilter, themeFilter, sortKey, sortDir]);

  const themes = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const r of [...data.actionable, ...data.watchlist]) set.add(r.theme);
    return Array.from(set).sort();
  }, [data]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  const SortableHead = ({ k, children, align = "right" }: {
    k: SortKey; children: React.ReactNode; align?: "left" | "right";
  }) => (
    <th
      onClick={() => toggleSort(k)}
      className={cn(
        "cursor-pointer select-none whitespace-nowrap px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
      {sortKey === k && <span className="ml-1 text-[10px]">{sortDir === "desc" ? "▼" : "▲"}</span>}
    </th>
  );

  return (
    <div className="space-y-4">
      {/* ===== Header ===== */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-3">
                <h1 className="text-xl font-semibold tracking-tight">Talon</h1>
                <span className="text-xs text-muted-foreground">
                  Phase 3-validated flow gates · 504-ticker universe · live UW fetch
                </span>
              </div>
              {data ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Last scan{" "}
                  <span className="font-medium text-foreground">{data.scan_date}</span>
                  {" · "}
                  <span className="font-medium text-foreground">{data.with_gex_data}</span>/
                  {data.universe_total} tickers
                  {" · "}
                  <span className="font-medium text-signal-bullish">{data.actionable_count}</span> actionable
                  {" · "}
                  <span className="font-medium text-amber-300">{data.watchlist_count}</span> watchlist
                </p>
              ) : isLoading ? (
                <Skeleton className="mt-2 h-4 w-72" />
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  No scan in database yet — click <em>Run Scan</em>.
                </p>
              )}
              {data?.generated_at && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Generated{" "}
                  <span className="font-medium text-foreground">
                    {new Date(data.generated_at).toLocaleString()}
                  </span>
                  {" "}({relativeTime(data.generated_at)})
                  {data.elapsed_seconds != null && (
                    <> · ran in <span className="tabular-nums">{data.elapsed_seconds.toFixed(0)}s</span></>
                  )}
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={isScanning}
              onClick={() => runScan.mutate()}
              className={cn(
                "h-9 rounded-full px-4 text-sm font-semibold transition-colors",
                isScanning
                  ? "cursor-not-allowed bg-foreground/10 text-muted-foreground"
                  : "bg-primary text-white hover:bg-primary/90",
              )}
            >
              {isScanning ? "Scanning…" : "Run Scan"}
            </button>
          </div>

          {isScanning && progress && (
            <div className="space-y-1.5 rounded-md border border-border/50 bg-foreground/[0.02] p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">
                  {progress.phase ? PHASE_LABELS[progress.phase] : "Starting…"}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {progress.phase_total > 0
                    ? `${progress.phase_progress} / ${progress.phase_total}  (${progressPct}%)`
                    : "—"}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {progress.current_ticker && (
                <p className="text-[10px] text-muted-foreground">
                  Current: <span className="font-medium text-foreground">{progress.current_ticker}</span>
                </p>
              )}
              {progress.started_at && (
                <p className="text-[10px] text-muted-foreground">
                  Started {relativeTime(progress.started_at)} — scan typically takes 7–10 min
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-signal-bearish">
            {error instanceof ApiError
              ? `${error.status}: ${error.message}`
              : String(error)}
          </CardContent>
        </Card>
      )}

      {runScan.error && (
        <Card>
          <CardContent className="p-4 text-sm text-signal-bearish">
            Scan failed:{" "}
            {runScan.error instanceof ApiError
              ? `${runScan.error.status}: ${runScan.error.message}`
              : String(runScan.error)}
          </CardContent>
        </Card>
      )}

      {/* ===== Filters ===== */}
      {data && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <FilterGroup
              label="Band"
              value={bandFilter}
              onChange={(v) => setBandFilter(v as typeof bandFilter)}
              options={[
                { v: "all", label: `All (${data.actionable_count + data.watchlist_count})` },
                { v: "actionable", label: `Actionable (${data.actionable_count})` },
                { v: "watchlist", label: `Watchlist (${data.watchlist_count})` },
              ]}
            />
            <div className="h-5 w-px bg-border" />
            <FilterGroup
              label="Direction"
              value={directionFilter}
              onChange={(v) => setDirectionFilter(v as typeof directionFilter)}
              options={[
                { v: "all", label: "All" },
                { v: "bull", label: "Bull" },
                { v: "bear", label: "Bear" },
              ]}
            />
            <div className="h-5 w-px bg-border" />
            <label className="text-xs text-muted-foreground">Theme</label>
            <select
              value={themeFilter}
              onChange={(e) => setThemeFilter(e.target.value)}
              className="h-7 rounded-full border border-border bg-card px-2 text-xs outline-none focus:border-primary/60"
            >
              <option value="all">all</option>
              {themes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <span className="ml-auto text-xs text-muted-foreground">
              Showing {rows.length} setups
            </span>
          </CardContent>
        </Card>
      )}

      {/* ===== Results table ===== */}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {data ? "No setups match the current filters." : "No data yet."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr>
                  <SortableHead k="grade" align="left">Grade</SortableHead>
                  <SortableHead k="ticker" align="left">Ticker</SortableHead>
                  <th className="px-2 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Dir</th>
                  <SortableHead k="theme" align="left">Theme</SortableHead>
                  <SortableHead k="call_dom_now">Call Dom</SortableHead>
                  <SortableHead k="delta_buildup_pct">Δ Buildup</SortableHead>
                  <SortableHead k="vanna_ratio_5d_back">Vanna 5d</SortableHead>
                  <SortableHead k="theme_coherence">Theme Coh.</SortableHead>
                  <SortableHead k="dp_skew_pct">DP Skew</SortableHead>
                  <SortableHead k="dp_share_pct">DP %</SortableHead>
                  <th className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Gates (Δ · V · θ)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const band = gradeBand(r.grade);
                  return (
                    <tr key={r.ticker} className="border-b border-border/40 hover:bg-foreground/[0.03]">
                      <td className="px-2 py-2">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", GRADE_BAND_STYLES[band])}>
                          {r.grade.toFixed(1)}
                        </span>
                      </td>
                      <td className="px-2 py-2 font-medium">
                        <Link href={`/agents/${encodeURIComponent(r.ticker)}`} className="hover:text-primary">
                          {r.ticker}
                        </Link>
                      </td>
                      <td className="px-2 py-2">
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase", DIRECTION_STYLES[r.direction])}>
                          {r.direction}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">{r.theme}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtPctValue(r.call_dom_now)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtPct(r.delta_buildup_pct, 0)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtRatio(r.vanna_ratio_5d_back)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtRatio(r.theme_coherence)}</td>
                      <td className={cn(
                        "px-2 py-2 text-right tabular-nums",
                        r.dp_skew_pct === null ? "text-muted-foreground" :
                        r.dp_skew_pct > 0.1 ? "text-signal-bullish" :
                        r.dp_skew_pct < -0.1 ? "text-signal-bearish" :
                        "text-muted-foreground",
                      )}>
                        {r.dp_skew_pct === null ? "—" : `${r.dp_skew_pct >= 0 ? "+" : ""}${r.dp_skew_pct.toFixed(2)}%`}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-xs">
                        {fmtPctValue(r.dp_share_pct, 0)}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex justify-end gap-2">
                          <ScoreBar value={r.g_delta_score} />
                          <ScoreBar value={r.g_vanna_score} />
                          <ScoreBar value={r.g_theme_score} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* ===== Footer: notes + weights ===== */}
      {data && (
        <Card>
          <CardContent className="space-y-2 p-3 text-xs text-muted-foreground">
            <p>{data.notes}</p>
            <p>
              <strong className="text-foreground">Gate weights</strong>:{" "}
              {Object.entries(data.gate_weights_used)
                .map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`)
                .join(" · ")}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { v: T; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex gap-1">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={cn(
              "rounded-full px-2 py-0.5 text-xs transition-colors",
              value === o.v
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
