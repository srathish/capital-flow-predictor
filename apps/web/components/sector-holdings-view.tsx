"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { HoldingEntry, HoldingsSort } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PriceChart } from "@/components/price-chart";
import { RANGE_TO_DAYS, TimeRangeTabs, type TimeRange } from "@/components/ui/time-range-tabs";

type Column = {
  key: HoldingsSort;
  label: string;
  format: (v: number | null | undefined) => string;
  signed?: boolean;
  align?: "left" | "right";
};

const fmtPct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
// Weight comes from UW pre-multiplied by 100 (so 14.73 means 14.73%, not 1473%).
const fmtWeight = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v.toFixed(2)}%`;
const fmtRatio = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toFixed(2);
const fmtScore = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(3)}`;
const fmtUsdCompact = (v: number | null | undefined) => {
  if (v === null || v === undefined) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

const COLUMNS: Column[] = [
  { key: "ticker", label: "Ticker", format: (v) => String(v ?? "—"), align: "left" },
  { key: "weight", label: "Weight", format: fmtWeight, align: "right" },
  { key: "model_score", label: "Model", format: fmtScore, signed: true, align: "right" },
  { key: "return_1d", label: "1D", format: fmtPct, signed: true, align: "right" },
  { key: "return_5d", label: "5D", format: fmtPct, signed: true, align: "right" },
  { key: "return_20d", label: "20D", format: fmtPct, signed: true, align: "right" },
  { key: "return_60d", label: "60D", format: fmtPct, signed: true, align: "right" },
  { key: "pct_off_52w_high", label: "Off 52W H", format: fmtPct, signed: true, align: "right" },
  { key: "volume_z", label: "Vol vs 30D", format: fmtPct, signed: true, align: "right" },
  { key: "call_put_ratio", label: "Call/Put", format: fmtRatio, align: "right" },
  { key: "bullish_premium", label: "Bull $", format: fmtUsdCompact, align: "right" },
  { key: "bearish_premium", label: "Bear $", format: fmtUsdCompact, align: "right" },
  { key: "bullish_pct", label: "Bull %", format: fmtPct, align: "right" },
];

type Filter =
  | "all"
  | "bullish_model"
  | "bearish_model"
  | "bullish_flow"
  | "bearish_flow"
  | "above_5d"
  | "below_5d"
  | "weight_gt_1pct";

const FILTER_OPTIONS: { key: Filter; label: string; predicate: (h: HoldingEntry) => boolean }[] = [
  { key: "all", label: "All", predicate: () => true },
  { key: "bullish_model", label: "Model bullish", predicate: (h) => (h.model_score ?? 0) > 0 },
  { key: "bearish_model", label: "Model bearish", predicate: (h) => (h.model_score ?? 0) < 0 },
  {
    key: "bullish_flow",
    label: "Bullish flow",
    predicate: (h) =>
      h.bullish_premium !== null &&
      h.bearish_premium !== null &&
      h.bullish_premium > h.bearish_premium,
  },
  {
    key: "bearish_flow",
    label: "Bearish flow",
    predicate: (h) =>
      h.bullish_premium !== null &&
      h.bearish_premium !== null &&
      h.bearish_premium > h.bullish_premium,
  },
  { key: "above_5d", label: "Up 5D", predicate: (h) => (h.return_5d ?? 0) > 0 },
  { key: "below_5d", label: "Down 5D", predicate: (h) => (h.return_5d ?? 0) < 0 },
  { key: "weight_gt_1pct", label: "Weight ≥ 1%", predicate: (h) => (h.weight ?? 0) >= 1 },
];

export function SectorHoldingsView({ etf }: { etf: string }) {
  const upper = etf.toUpperCase();
  const [sort, setSort] = useState<HoldingsSort>("weight");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState<Filter>("all");
  const [chartRange, setChartRange] = useState<TimeRange>("3M");

  const { data, isLoading, error } = useQuery({
    queryKey: ["etf-holdings", upper, sort, direction],
    queryFn: () => api.etfHoldings(upper, sort, direction),
    retry: false,
  });

  const { data: chartData, isLoading: chartLoading } = useQuery({
    queryKey: ["etf-chart", upper, chartRange],
    queryFn: () => api.chartData(upper, RANGE_TO_DAYS[chartRange]),
    retry: false,
  });

  function toggleSort(key: HoldingsSort) {
    if (key === sort) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setDirection(key === "ticker" ? "asc" : "desc");
    }
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    const pred = FILTER_OPTIONS.find((f) => f.key === filter)?.predicate ?? (() => true);
    return data.holdings.filter(pred);
  }, [data, filter]);

  // Coverage stats — surface why a filter may return fewer rows than expected.
  const coverage = useMemo(() => {
    if (!data) return null;
    const total = data.holdings.length;
    const scored = data.holdings.filter((h) => h.model_score !== null).length;
    const withFlow = data.holdings.filter(
      (h) => h.bullish_premium !== null && h.bearish_premium !== null,
    ).length;
    return { total, scored, withFlow };
  }, [data]);

  const filterHint = useMemo(() => {
    if (!coverage) return null;
    if (filter === "bullish_model" || filter === "bearish_model") {
      if (coverage.scored === 0) {
        return `No holdings have a model score — the model ranks sector ETFs, not individual stocks.`;
      }
      if (coverage.scored < coverage.total) {
        return `${coverage.scored} of ${coverage.total} have a model score`;
      }
    }
    if (filter === "bullish_flow" || filter === "bearish_flow") {
      if (coverage.withFlow < coverage.total) {
        return `${coverage.withFlow} of ${coverage.total} have UW flow`;
      }
    }
    return null;
  }, [coverage, filter]);

  // Weight comes in as a percentage (14.73 = 14.73%). Contribution = (weight/100) * return.
  const movers = useMemo(() => {
    if (!data) return null;
    const make = (key: "return_1d" | "return_5d") => {
      const rows = data.holdings
        .map((h) => {
          const w = h.weight;
          const r = h[key];
          if (w === null || w === undefined || r === null || r === undefined) return null;
          return { h, contrib: (w / 100) * r, ret: r, weight: w };
        })
        .filter((x): x is { h: HoldingEntry; contrib: number; ret: number; weight: number } => x !== null);
      const sorted = [...rows].sort((a, b) => b.contrib - a.contrib);
      return {
        up: sorted.slice(0, 3),
        down: sorted.slice(-3).reverse(),
      };
    };
    return { d1: make("return_1d"), d5: make("return_5d") };
  }, [data]);

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (error || !data) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Holdings for <span className="font-mono">{upper}</span> aren&apos;t available right now.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{upper}</h1>
          <p className="text-sm text-muted-foreground">
            {data.n_holdings} holdings
            {data.last_updated && <> · refreshed {formatDate(data.last_updated)}</>}
          </p>
        </div>
        <Link
          href="/"
          className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          ← Sectors
        </Link>
      </div>

      {/* ETF price chart */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{upper} price</div>
              <div className="text-xs text-muted-foreground/80">Sector ETF — full constituent context below.</div>
            </div>
            <TimeRangeTabs value={chartRange} onChange={setChartRange} />
          </div>
          {chartLoading || !chartData ? (
            <Skeleton className="h-72 w-full" />
          ) : chartData.bars.length === 0 ? (
            <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
              No price history available for {upper}.
            </div>
          ) : (
            <PriceChart data={chartData} height={300} range={chartRange} onRangeChange={setChartRange} />
          )}
        </CardContent>
      </Card>

      {/* Aggregate / breadth strip */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-4 text-xs sm:grid-cols-5">
          <Stat label="Median 1D" value={fmtPct(data.median_return_1d)} signed value_signed={data.median_return_1d} />
          <Stat label="Median 5D" value={fmtPct(data.median_return_5d)} signed value_signed={data.median_return_5d} />
          <Stat label="Median 20D" value={fmtPct(data.median_return_20d)} signed value_signed={data.median_return_20d} />
          <Stat
            label="Breadth (5D > 0)"
            value={data.pct_above_5d_zero === null ? "—" : `${(data.pct_above_5d_zero * 100).toFixed(0)}%`}
          />
          <Stat
            label="Breadth (20D > 0)"
            value={data.pct_above_20d_zero === null ? "—" : `${(data.pct_above_20d_zero * 100).toFixed(0)}%`}
          />
        </CardContent>
      </Card>

      {/* Top contributors / detractors */}
      {movers && (
        <Card>
          <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
            <MoversBlock label="1D contribution" up={movers.d1.up} down={movers.d1.down} />
            <MoversBlock label="5D contribution" up={movers.d5.up} down={movers.d5.down} />
          </CardContent>
        </Card>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Filter:</span>
        {FILTER_OPTIONS.map((opt) => {
          const active = filter === opt.key;
          const isModelFilter = opt.key === "bullish_model" || opt.key === "bearish_model";
          const isFlowFilter = opt.key === "bullish_flow" || opt.key === "bearish_flow";
          const disabled =
            (isModelFilter && coverage !== null && coverage.scored === 0) ||
            (isFlowFilter && coverage !== null && coverage.withFlow === 0);
          const title = disabled
            ? isModelFilter
              ? "Model ranks sector ETFs, not individual stocks — no scores on holdings."
              : "No UW flow data for these holdings."
            : undefined;
          return (
            <button
              key={opt.key}
              type="button"
              disabled={disabled}
              title={title}
              onClick={() => !disabled && setFilter(opt.key)}
              className={cn(
                "rounded-full border px-2.5 py-1 transition-colors",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground",
                disabled && "cursor-not-allowed opacity-40 hover:text-muted-foreground"
              )}
            >
              {opt.label}
            </button>
          );
        })}
        <span className="ml-auto text-muted-foreground">
          showing {filtered.length} of {data.n_holdings}
        </span>
      </div>
      {filterHint && (
        <div className="-mt-1 text-[11px] text-muted-foreground">{filterHint}</div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  {COLUMNS.map((c) => {
                    const active = c.key === sort;
                    return (
                      <th
                        key={c.key}
                        onClick={() => toggleSort(c.key)}
                        className={cn(
                          "cursor-pointer select-none px-3 py-2",
                          c.align === "right" ? "text-right" : "text-left",
                          active ? "text-foreground" : "hover:text-foreground"
                        )}
                      >
                        {c.label}
                        {active && <span className="ml-1">{direction === "desc" ? "↓" : "↑"}</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map((h) => (
                  <tr key={h.ticker} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                    {COLUMNS.map((c) => {
                      const value = (h as unknown as Record<string, number | string | null>)[c.key];
                      const numericValue = typeof value === "number" ? value : null;
                      return (
                        <td
                          key={c.key}
                          className={cn(
                            "px-3 py-2",
                            c.align === "right" ? "text-right" : "text-left",
                            c.key === "ticker" ? "font-medium" : "num"
                          )}
                        >
                          {c.key === "ticker" ? (
                            <Link
                              href={`/agents/${encodeURIComponent(String(value))}`}
                              className="hover:text-primary"
                            >
                              {String(value)}
                              {h.short_name && (
                                <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                                  {h.short_name}
                                </span>
                              )}
                              {h.model_rank !== null && (
                                <span className="ml-2 rounded bg-muted px-1 text-[10px] font-normal text-muted-foreground">
                                  #{h.model_rank}
                                </span>
                              )}
                            </Link>
                          ) : (
                            <span
                              className={cn(
                                c.signed && numericValue !== null && numericValue > 0 && "text-signal-bullish",
                                c.signed && numericValue !== null && numericValue < 0 && "text-signal-bearish"
                              )}
                            >
                              {c.format(numericValue)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-xs text-muted-foreground">
                      No holdings match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type MoverRow = { h: HoldingEntry; contrib: number; ret: number; weight: number };

function MoversBlock({ label, up, down }: { label: string; up: MoverRow[]; down: MoverRow[] }) {
  return (
    <div>
      <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="grid grid-cols-2 gap-x-4">
        <MoverList rows={up} sign="up" />
        <MoverList rows={down} sign="down" />
      </div>
    </div>
  );
}

function MoverList({ rows, sign }: { rows: MoverRow[]; sign: "up" | "down" }) {
  if (rows.length === 0) {
    return <div className="text-xs text-muted-foreground">—</div>;
  }
  const headerCls = sign === "up" ? "text-signal-bullish" : "text-signal-bearish";
  return (
    <div className="space-y-1">
      <div className={cn("text-[10px] uppercase tracking-wide", headerCls)}>
        {sign === "up" ? "Top 3 ↑" : "Bottom 3 ↓"}
      </div>
      {rows.map((r) => {
        const contribBps = r.contrib * 10000; // basis points
        return (
          <Link
            key={r.h.ticker}
            href={`/agents/${encodeURIComponent(r.h.ticker)}`}
            className="flex items-baseline justify-between gap-2 text-xs hover:bg-muted/30"
          >
            <span className="font-medium">{r.h.ticker}</span>
            <span className="flex items-baseline gap-2 num">
              <span
                className={cn(
                  contribBps > 0 ? "text-signal-bullish" : contribBps < 0 ? "text-signal-bearish" : "",
                )}
              >
                {contribBps >= 0 ? "+" : ""}
                {contribBps.toFixed(1)} bp
              </span>
              <span className="text-[10px] text-muted-foreground">
                {r.weight.toFixed(1)}% × {(r.ret * 100).toFixed(2)}%
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  signed,
  value_signed,
}: {
  label: string;
  value: string;
  signed?: boolean;
  value_signed?: number | null;
}) {
  const cls =
    signed && value_signed !== undefined && value_signed !== null
      ? value_signed > 0
        ? "text-signal-bullish"
        : value_signed < 0
          ? "text-signal-bearish"
          : "text-foreground"
      : "text-foreground";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-sm font-semibold num", cls)}>{value}</div>
    </div>
  );
}
