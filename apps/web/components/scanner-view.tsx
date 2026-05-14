"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type {
  StageConditions,
  StagePhase,
  StageScanParams,
  StageTickerResult,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// The scanner mirrors the TradingView indicator's dashboard. The 10 conditions
// are color-coded chips so a user with TV open can visually compare cell-for-
// cell. Phase colors match the indicator's background tint legend exactly:
//   GREEN  = BASE     BLUE   = HANDLE
//   ORANGE = CAUTION  RED    = DANGER     GRAY = NEUTRAL
const PHASE_STYLES: Record<StagePhase, { dot: string; chip: string; label: string }> = {
  BASE: {
    dot: "bg-signal-bullish",
    chip: "bg-signal-bullish/15 text-signal-bullish",
    label: "BASE",
  },
  HANDLE: {
    dot: "bg-sky-500",
    chip: "bg-sky-500/15 text-sky-400",
    label: "HANDLE",
  },
  NEUTRAL: {
    dot: "bg-muted-foreground",
    chip: "bg-foreground/10 text-muted-foreground",
    label: "NEUTRAL",
  },
  CAUTION: {
    dot: "bg-amber-500",
    chip: "bg-amber-500/15 text-amber-400",
    label: "CAUTION",
  },
  DANGER: {
    dot: "bg-signal-bearish",
    chip: "bg-signal-bearish/15 text-signal-bearish",
    label: "DANGER",
  },
};

const UNIVERSE_OPTIONS: { value: NonNullable<StageScanParams["universe"]>; label: string; desc: string }[] = [
  { value: "focus", label: "focus", desc: "miners + AI infra + quantum + semis + megacaps" },
  { value: "sp500", label: "S&P 500", desc: "~500 names, slower scan" },
  { value: "all", label: "all", desc: "focus ∪ S&P 500" },
];

// Display order = TV dashboard order. Keep these in lockstep with the indicator
// so the user can visually scan TV → web side-by-side.
const BCS_LABELS: { key: keyof StageConditions; label: string }[] = [
  { key: "stage2_trend", label: "Stage 2 Trend" },
  { key: "volume_dry_up", label: "Volume Dry-Up" },
  { key: "atr_contracted", label: "ATR Contracted" },
  { key: "ema_tight", label: "EMA Tight" },
  { key: "in_base_zone", label: "In Base Zone" },
];

const HFS_LABELS: { key: keyof StageConditions; label: string }[] = [
  { key: "uptrend_active", label: "Uptrend Active" },
  { key: "in_pullback_zone", label: "In Pullback" },
  { key: "holding_ema50", label: "Holding 50 EMA" },
  { key: "range_tight", label: "Range Tight" },
  { key: "vol_dry_in_handle", label: "Vol Dry (handle)" },
];

function fmtPctSigned(v: number | null | undefined): string {
  if (v == null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

export function ScannerView() {
  const [universe, setUniverse] = useState<NonNullable<StageScanParams["universe"]>>("focus");
  const [onlyArmed, setOnlyArmed] = useState(false);
  const [customTickers, setCustomTickers] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const params: StageScanParams = {
    universe: customTickers.trim() ? undefined : universe,
    tickers: customTickers.trim() || undefined,
    onlyArmed,
    limit: 200,
  };

  const { data, isLoading, isError, isFetching, error } = useQuery({
    queryKey: ["stage-scan", params.universe, params.tickers, params.onlyArmed],
    queryFn: () => api.stageScan(params),
    // S&P 500 scan is slow on first call (Yahoo fetch); subsequent calls are
    // cached server-side for an hour, so background refetch is cheap.
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

  const items = data?.items ?? [];
  const armedCount = items.filter((i) => i.active_ready).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Scanner</h1>
        <p className="text-sm text-muted-foreground">
          BCS + HFS detection — Python port of the TradingView{" "}
          <code className="text-xs">Stage Scanner</code> indicator. Phase, score, and
          trigger should match TV cell-for-cell. Disagreements are bugs.
        </p>
        <div className="ml-auto text-xs text-muted-foreground">
          {data ? (
            <>
              {isFetching ? "refreshing… " : ""}
              {armedCount} armed · {data.scanned} scanned
              {data.skipped > 0 ? ` · ${data.skipped} skipped` : ""}
            </>
          ) : (
            "—"
          )}
        </div>
      </header>

      {/* Filter row */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="uppercase tracking-wide text-muted-foreground">universe</span>
        {UNIVERSE_OPTIONS.map((u) => (
          <button
            key={u.value}
            onClick={() => {
              setUniverse(u.value);
              setCustomTickers("");
            }}
            disabled={!!customTickers.trim()}
            title={u.desc}
            className={cn(
              "rounded-full border border-border px-3 py-1 disabled:opacity-40",
              !customTickers.trim() && universe === u.value
                ? "bg-primary/15 text-primary"
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {u.label}
          </button>
        ))}

        <span className="ml-3 uppercase tracking-wide text-muted-foreground">custom</span>
        <input
          value={customTickers}
          onChange={(e) => setCustomTickers(e.target.value)}
          placeholder="IREN,CIFR,NBIS"
          className="h-7 w-48 rounded-full border border-border bg-card px-3 text-xs outline-none focus:border-primary/60"
        />

        <label className="ml-3 flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 hover:text-foreground">
          <input
            type="checkbox"
            checked={onlyArmed}
            onChange={(e) => setOnlyArmed(e.target.checked)}
            className="h-3 w-3 accent-primary"
          />
          <span className={onlyArmed ? "text-primary" : "text-muted-foreground"}>armed only</span>
        </label>
      </div>

      {/* Legend strip — tiny key so the colored chips are decodable without TV open */}
      <div className="mb-4 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
        {(Object.keys(PHASE_STYLES) as StagePhase[]).map((p) => (
          <span key={p} className="flex items-center gap-1.5">
            <span className={cn("inline-block h-2 w-2 rounded-full", PHASE_STYLES[p].dot)} />
            {PHASE_STYLES[p].label}
          </span>
        ))}
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-signal-bearish">
            Scan failed: {error instanceof Error ? error.message : "unknown error"}. The
            scanner depends on yfinance — if Yahoo is rate-limiting, try again in a
            minute.
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No tickers in this universe pass the current filter.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Ticker</th>
                  <th className="px-3 py-2">Phase</th>
                  <th className="px-3 py-2 text-right">Score</th>
                  <th className="px-3 py-2 text-right">Close</th>
                  <th className="px-3 py-2 text-right">Trigger</th>
                  <th className="px-3 py-2 text-right">Distance</th>
                  <th className="px-3 py-2">Today</th>
                  <th className="px-3 py-2 text-right text-[10px]">As of</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <ScannerRow
                    key={it.ticker}
                    item={it}
                    open={expanded === it.ticker}
                    onToggle={() =>
                      setExpanded((prev) => (prev === it.ticker ? null : it.ticker))
                    }
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

function ScannerRow({
  item,
  open,
  onToggle,
}: {
  item: StageTickerResult;
  open: boolean;
  onToggle: () => void;
}) {
  const ps = PHASE_STYLES[item.phase];
  const fired =
    item.fired_today.bcs_breakout
      ? { label: "BASE GO", chip: "bg-signal-bullish/20 text-signal-bullish" }
      : item.fired_today.hfs_breakout
        ? { label: "HANDLE GO", chip: "bg-sky-500/20 text-sky-400" }
        : item.fired_today.breakdown_warn
          ? { label: "WARN", chip: "bg-signal-bearish/20 text-signal-bearish" }
          : null;

  return (
    <>
      <tr
        className={cn(
          "cursor-pointer border-b last:border-0 hover:bg-foreground/5",
          item.active_ready && "bg-primary/5",
        )}
        onClick={onToggle}
      >
        <td className="px-3 py-2">
          <Link
            href={`/agents/${encodeURIComponent(item.ticker)}`}
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-foreground hover:text-primary"
          >
            {item.ticker}
          </Link>
        </td>
        <td className="px-3 py-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              ps.chip,
            )}
          >
            {ps.label}
          </span>
        </td>
        <td className={cn("px-3 py-2 text-right font-mono text-xs", item.active_ready ? "text-primary" : "text-muted-foreground")}>
          {item.active_score}/5
        </td>
        <td className="px-3 py-2 text-right font-mono text-xs">{fmtPrice(item.close)}</td>
        <td className="px-3 py-2 text-right font-mono text-xs">
          {fmtPrice(item.trigger_level)}
        </td>
        <td
          className={cn(
            "px-3 py-2 text-right font-mono text-xs",
            item.distance_pct != null && item.distance_pct < 0
              ? "text-signal-bullish"
              : "text-muted-foreground",
          )}
        >
          {fmtPctSigned(item.distance_pct)}
        </td>
        <td className="px-3 py-2">
          {fired ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                fired.chip,
              )}
            >
              {fired.label}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-right text-[10px] text-muted-foreground">
          {item.date ?? "—"}
        </td>
      </tr>
      {open ? (
        <tr className="border-b bg-foreground/[0.02]">
          <td colSpan={8} className="px-3 py-3">
            <ConditionsGrid item={item} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ConditionsGrid({ item }: { item: StageTickerResult }) {
  if (item.error) {
    return (
      <div className="text-xs text-signal-bearish">
        {item.ticker}: {item.error}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <ConditionsBlock
        title={`BCS  ·  ${item.bcs_score}/5`}
        accent="text-signal-bullish"
        labels={BCS_LABELS}
        conditions={item.conditions}
      />
      <ConditionsBlock
        title={`HFS  ·  ${item.hfs_score}/5`}
        accent="text-sky-400"
        labels={HFS_LABELS}
        conditions={item.conditions}
      />
      {(item.pullback_pct != null || item.pct_from_52w_high != null) && (
        <div className="text-[11px] text-muted-foreground">
          {item.pct_from_52w_high != null && (
            <div>
              off 52w high:{" "}
              <span className="font-mono text-foreground">
                {item.pct_from_52w_high.toFixed(1)}%
              </span>
            </div>
          )}
          {item.pullback_pct != null && (
            <div>
              pullback from 30-bar swing:{" "}
              <span className="font-mono text-foreground">
                {item.pullback_pct.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}
      {(item.danger.stage4 || item.danger.bear_stack) && (
        <div className="rounded-md bg-signal-bearish/10 px-3 py-2 text-[11px] text-signal-bearish">
          ⚠ {item.danger.stage4 ? "Stage 4 (below falling 200 EMA)" : "Bear stack (8 &lt; 21 &lt; 50 &lt; 200)"}
        </div>
      )}
    </div>
  );
}

function ConditionsBlock({
  title,
  accent,
  labels,
  conditions,
}: {
  title: string;
  accent: string;
  labels: { key: keyof StageConditions; label: string }[];
  conditions: StageConditions;
}) {
  return (
    <div>
      <div className={cn("mb-1.5 text-[10px] font-semibold uppercase tracking-wide", accent)}>
        {title}
      </div>
      <ul className="space-y-1 text-xs">
        {labels.map(({ key, label }) => {
          const pass = conditions[key];
          return (
            <li key={key} className="flex items-center justify-between">
              <span className="text-muted-foreground">{label}</span>
              <span
                className={cn(
                  "font-mono",
                  pass ? "text-signal-bullish" : "text-signal-bearish",
                )}
              >
                {pass ? "✓" : "✗"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
