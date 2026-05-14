"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type {
  FlowSuggestedPlay,
  StageConditions,
  StagePhase,
  StageRead,
  StageScanParams,
  StageSizingHint,
  StageTargets,
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
          {/* Prefix the score with the contributing side (HFS vs BCS) so the
              user knows which set of conditions the score refers to. */}
          <span className="mr-1 text-[10px] uppercase tracking-wide opacity-60">
            {item.phase === "BASE"
              ? "BCS"
              : item.phase === "HANDLE"
                ? "HFS"
                : item.bcs_score >= item.hfs_score
                  ? "BCS"
                  : "HFS"}
          </span>
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
  // Which side of the analyzer is "live" for this row. The score in the
  // table column comes from this side; the other side is shown dimmed so
  // it's clear which conditions the score refers to.
  const activeSide: "BCS" | "HFS" =
    item.phase === "BASE"
      ? "BCS"
      : item.phase === "HANDLE"
        ? "HFS"
        : item.bcs_score >= item.hfs_score
          ? "BCS"
          : "HFS";
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {item.read ? (
        <div className="md:col-span-2">
          <ReadCallout read={item.read} />
        </div>
      ) : null}
      {/* Flow confluence — only fetch when the scanner thinks a long-side
          trade is on the table (sizing_hint != skip). For DANGER/CAUTION
          rows we still show whether whales are loading calls anyway, as
          a "reversal in progress?" signal. */}
      <div className="md:col-span-2">
        <FlowConfluence item={item} />
      </div>
      <ConditionsBlock
        title={`BCS  ·  ${item.bcs_score}/5`}
        accent="text-signal-bullish"
        labels={BCS_LABELS}
        conditions={item.conditions}
        dimmed={activeSide !== "BCS"}
      />
      <ConditionsBlock
        title={`HFS  ·  ${item.hfs_score}/5`}
        accent="text-sky-400"
        labels={HFS_LABELS}
        conditions={item.conditions}
        dimmed={activeSide !== "HFS"}
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
      {item.targets ? (
        <div className="md:col-span-2">
          <TargetsTable item={item} targets={item.targets} />
        </div>
      ) : null}
    </div>
  );
}

function TargetsTable({
  item,
  targets,
}: {
  item: StageTickerResult;
  targets: StageTargets;
}) {
  const rows: { key: "t1" | "t2" | "t3"; label: string; window: string }[] = [
    { key: "t1", label: "T1", window: "2–3 weeks" },
    { key: "t2", label: "T2", window: "4–6 weeks" },
    { key: "t3", label: "T3", window: "8–12 weeks" },
  ];
  return (
    <div className="rounded-md border border-border/50 bg-card/40 p-3">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Targets + stop</span>
        <span className="font-mono text-foreground/80">
          ADR <span className="text-foreground">{targets.adr_pct.toFixed(1)}%</span>{" "}
          (~${targets.adr_dollars.toFixed(2)}/day)
          {targets.rr_to_t1 != null && (
            <>
              {" · "}R:R to T1{" "}
              <span className={targets.rr_to_t1 >= 2 ? "text-signal-bullish" : "text-amber-400"}>
                {targets.rr_to_t1.toFixed(2)}
              </span>
            </>
          )}
        </span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="py-1.5">Tier</th>
            <th className="py-1.5 text-right">Price</th>
            <th className="py-1.5 text-right">Gain</th>
            <th className="py-1.5 text-right">Time</th>
            <th className="py-1.5 text-right">Days est.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label, window }) => {
            const t = targets.targets[key];
            const daysExp = t.days.expected;
            const daysOpt = t.days.optimistic;
            const daysCon = t.days.conservative;
            const daysRange =
              daysOpt != null && daysCon != null ? `${daysOpt}–${daysCon}d` : "—";
            return (
              <tr key={key} className="border-b last:border-0">
                <td className="py-1.5 font-mono text-foreground/80">
                  {label}{" "}
                  <span className="text-[10px] text-muted-foreground">
                    ({t.adr_multiple.toFixed(0)}× ADR)
                  </span>
                </td>
                <td className="py-1.5 text-right font-mono text-foreground">
                  ${t.price.toFixed(2)}
                </td>
                <td className="py-1.5 text-right font-mono text-signal-bullish">
                  +{t.gain_pct.toFixed(1)}%
                </td>
                <td className="py-1.5 text-right text-muted-foreground">{window}</td>
                <td className="py-1.5 text-right font-mono text-muted-foreground">
                  <span className="text-foreground">~{daysExp ?? "—"}d</span>{" "}
                  <span className="text-[10px]">({daysRange})</span>
                </td>
              </tr>
            );
          })}
          {/* Stop row */}
          <tr className="border-b last:border-0 bg-signal-bearish/[0.04]">
            <td className="py-1.5 font-mono text-signal-bearish">STOP</td>
            <td className="py-1.5 text-right font-mono text-signal-bearish">
              ${targets.stop_price.toFixed(2)}
            </td>
            <td className="py-1.5 text-right font-mono text-signal-bearish">
              -{targets.stop_pct.toFixed(1)}%
            </td>
            <td
              colSpan={2}
              className="py-1.5 text-right text-[10px] text-muted-foreground"
            >
              {targets.stop_logic}
            </td>
          </tr>
          {/* Extension reference (textbook measured move) */}
          <tr>
            <td className="py-1.5 font-mono text-muted-foreground">EXT.</td>
            <td className="py-1.5 text-right font-mono text-muted-foreground">
              ${targets.extension_target.toFixed(2)}
            </td>
            <td className="py-1.5 text-right font-mono text-muted-foreground">
              +{targets.extension_gain_pct.toFixed(1)}%
            </td>
            <td
              colSpan={2}
              className="py-1.5 text-right text-[10px] text-muted-foreground"
            >
              textbook measured-move (full base depth, aspirational)
            </td>
          </tr>
        </tbody>
      </table>
      <div className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        T1/T2/T3 are ADR-based: 2× / 4× / 7× the 20-bar daily range above the
        trigger. Times assume ~0.20–0.30 ADR/day captured toward target. Stop
        defined by setup type (base support for BCS, swing low for HFS).
        Breakouts fail; treat as sizing input, not forecast. Anchored to{" "}
        {item.ticker} close ${item.close?.toFixed(2)} on {item.date}.
      </div>
    </div>
  );
}

function ConditionsBlock({
  title,
  accent,
  labels,
  conditions,
  dimmed = false,
}: {
  title: string;
  accent: string;
  labels: { key: keyof StageConditions; label: string }[];
  conditions: StageConditions;
  dimmed?: boolean;
}) {
  return (
    <div className={dimmed ? "opacity-50" : undefined}>
      <div className={cn("mb-1.5 text-[10px] font-semibold uppercase tracking-wide", accent)}>
        {title}
        {dimmed ? <span className="ml-1.5 text-muted-foreground/70">(not active)</span> : null}
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

const SIZING_STYLES: Record<StageSizingHint, { label: string; chip: string }> = {
  size_up: {
    label: "Size up · rare setup",
    chip: "bg-signal-bullish/20 text-signal-bullish",
  },
  standard: {
    label: "Standard sizing",
    chip: "bg-primary/15 text-primary",
  },
  small: { label: "Small / watch", chip: "bg-amber-500/15 text-amber-400" },
  skip: { label: "Skip from long side", chip: "bg-signal-bearish/15 text-signal-bearish" },
};

const RARITY_STYLES: Record<StageRead["rarity"], string> = {
  rare: "text-signal-bullish",
  uncommon: "text-primary",
  common: "text-muted-foreground",
  "n/a": "text-muted-foreground",
};

// ---------------------------------------------------------------------------
// Flow confluence — lazy-fetches /v1/flow/aggregate/{ticker}/suggest and shows
// the top 3 ranked option contracts plus a confluence verdict (do the scanner
// and the options-flow tape agree?). Only runs when a row is expanded.
// ---------------------------------------------------------------------------

type Confluence = "aligned" | "conflict" | "mixed" | "no_data";

const CONFLUENCE_STYLES: Record<Confluence, { label: string; chip: string }> = {
  aligned: {
    label: "✓ Flow confirms",
    chip: "bg-signal-bullish/20 text-signal-bullish",
  },
  conflict: {
    label: "⚠ Flow disagrees",
    chip: "bg-signal-bearish/20 text-signal-bearish",
  },
  mixed: { label: "~ Mixed flow", chip: "bg-amber-500/15 text-amber-400" },
  no_data: { label: "no flow data", chip: "bg-foreground/10 text-muted-foreground" },
};

const GATE_STYLES: Record<"proceed" | "wait" | "skip", string> = {
  proceed: "text-signal-bullish",
  wait: "text-amber-400",
  skip: "text-signal-bearish",
};

function FlowConfluence({ item }: { item: StageTickerResult }) {
  // What direction does the scanner imply? Long for BASE/HANDLE armed setups;
  // explicitly "short" for DANGER (avoid longs / consider short hedges); skip
  // otherwise. We never recommend shorts directly — the scanner is a long-
  // setup detector — but flow on a DANGER row that's loading calls is useful
  // ("reversal forming?").
  const setupDirection: "long" | "short" | "none" =
    item.phase === "BASE" || item.phase === "HANDLE"
      ? "long"
      : item.phase === "DANGER"
        ? "short"
        : "none";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["stage-flow-plays", item.ticker],
    queryFn: () => api.flowSuggestPlays(item.ticker, 3),
    staleTime: 2 * 60_000, // flow moves slowly within a couple minutes
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="rounded-md border border-border/50 bg-card/40 p-3">
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="rounded-md border border-border/50 bg-card/40 p-3 text-[11px] text-muted-foreground">
        Flow data unavailable for {item.ticker}. (No unusual-options coverage
        for this name, or the flow service errored.)
      </div>
    );
  }
  if (data.plays.length === 0) {
    return (
      <div className="rounded-md border border-border/50 bg-card/40 p-3 text-[11px] text-muted-foreground">
        No qualifying option plays found in the flow tape for {item.ticker}.
        Either the chain is illiquid or no recent unusual activity.
      </div>
    );
  }

  // Compute confluence. The flow side has its own "gate" (proceed/wait/skip)
  // plus a top-play option_type (call → bullish, put → bearish). Aligned means
  // the scanner's direction matches both the gate and the dominant option type.
  const topPlay = data.plays[0];
  const flowImpliedDir: "long" | "short" = topPlay.option_type === "call" ? "long" : "short";
  let confluence: Confluence;
  if (setupDirection === "none") {
    confluence = "no_data";
  } else if (data.gate === "skip") {
    confluence = "conflict";
  } else if (data.gate === "wait") {
    confluence = "mixed";
  } else if (setupDirection === flowImpliedDir) {
    confluence = "aligned";
  } else {
    confluence = "conflict";
  }

  const cs = CONFLUENCE_STYLES[confluence];

  return (
    <div className="rounded-md border border-border/50 bg-card/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide">
        <span className="text-muted-foreground">Flow tape</span>
        <span className={cn("rounded-full px-2 py-0.5 font-medium", cs.chip)}>
          {cs.label}
        </span>
        <span className="text-muted-foreground">
          · gate{" "}
          <span className={cn("font-semibold", GATE_STYLES[data.gate])}>
            {data.gate.toUpperCase()}
          </span>
        </span>
        <span className="ml-auto text-muted-foreground">
          {data.n_candidates_considered} candidates ·{" "}
          {data.spot != null ? `spot $${data.spot.toFixed(2)}` : "spot —"}
        </span>
      </div>

      {data.gate_reason && (
        <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
          {data.gate_reason}
        </p>
      )}

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="py-1.5">Contract</th>
            <th className="py-1.5">Exp</th>
            <th className="py-1.5 text-right">DTE</th>
            <th className="py-1.5 text-right">Conviction</th>
            <th className="py-1.5 text-right">Tgt mult</th>
            <th className="py-1.5">Why</th>
          </tr>
        </thead>
        <tbody>
          {data.plays.map((p) => (
            <FlowPlayRow key={`${p.strike}-${p.expiry}-${p.option_type}`} play={p} />
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        Suggested by the flow engine, ranked by conviction. Gate combines
        flow + ensemble agreement + regime. "Aligned" means the scanner's
        chart read and the option tape agree on direction — disagreement is
        worth pausing on, not necessarily fading.
      </p>
    </div>
  );
}

function FlowPlayRow({ play }: { play: FlowSuggestedPlay }) {
  const tone =
    play.option_type === "call" ? "text-signal-bullish" : "text-signal-bearish";
  const convictionTone =
    play.conviction === "high"
      ? "text-signal-bullish"
      : play.conviction === "medium"
        ? "text-amber-400"
        : "text-muted-foreground";
  return (
    <tr className="border-b last:border-0 align-top">
      <td className="py-1.5 font-mono">
        <span className={cn("font-semibold", tone)}>
          {play.strike.toFixed(play.strike < 10 ? 2 : 0)}
          {play.option_type === "call" ? "C" : "P"}
        </span>
        {play.ensemble_aligned && (
          <span
            className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-primary"
            title={`${play.ensemble_alignment_count}/${play.ensemble_total_voters} agents agree`}
          >
            agents
          </span>
        )}
      </td>
      <td className="py-1.5 text-muted-foreground">{play.expiry}</td>
      <td className="py-1.5 text-right font-mono text-muted-foreground">
        {play.days_to_expiry}d
      </td>
      <td className={cn("py-1.5 text-right font-mono", convictionTone)}>
        {play.conviction}
      </td>
      <td className="py-1.5 text-right font-mono text-foreground">
        {play.target_payout_multiple.toFixed(1)}×
      </td>
      <td className="py-1.5 text-[10px] text-muted-foreground">
        {play.why.length > 0 ? (
          <span className="line-clamp-2" title={play.why.join(" · ")}>
            {play.why[0]}
          </span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

function ReadCallout({ read }: { read: StageRead }) {
  const sizing = SIZING_STYLES[read.sizing_hint];
  return (
    <div className="rounded-md border border-border/50 bg-card/40 p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide">
        <span className="text-muted-foreground">Setup</span>
        <span className="font-semibold text-foreground">{read.setup_type}</span>
        <span className={cn("font-semibold", RARITY_STYLES[read.rarity])}>
          · {read.rarity}
        </span>
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide",
            sizing.chip,
          )}
        >
          {sizing.label}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-foreground/90">{read.read}</p>
    </div>
  );
}
