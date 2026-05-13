"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { FlowAnomalyKind, FlowEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FlowAggregatePanel } from "@/components/flow-aggregate-panel";
import { WhaleBetsPanel } from "@/components/whale-bets-panel";

const REFETCH_MS = 30_000;

const LOOKBACK_OPTIONS = [
  { value: 4, label: "4h" },
  { value: 24, label: "24h" },
  { value: 72, label: "3d" },
  { value: 168, label: "7d" },
] as const;

const MIN_PREMIUM_OPTIONS = [
  { value: 100_000, label: "≥ $100K" },
  { value: 500_000, label: "≥ $500K" },
  { value: 1_000_000, label: "≥ $1M" },
  { value: 5_000_000, label: "≥ $5M" },
] as const;

type KindMeta = {
  label: string;
  blurb: string;
  cls: string;
};

// Order matters — used to render the filter row left-to-right.
const KIND_META: Record<FlowAnomalyKind | "all", KindMeta> = {
  all: {
    label: "All",
    blurb: "Every anomaly we picked up",
    cls: "bg-foreground/10 text-foreground",
  },
  mega_sweep: {
    label: "Mega sweep",
    blurb: "Large $ swept across multiple exchanges in one shot — urgency.",
    cls: "bg-signal-bullish/15 text-signal-bullish",
  },
  block_buy: {
    label: "Block",
    blurb: "Floor block, often LEAPs. Institutional positioning, not retail.",
    cls: "bg-primary/15 text-primary",
  },
  ask_aggression: {
    label: "Lifted",
    blurb: "≥85% of premium hit the ask — buyer paying up.",
    cls: "bg-signal-bullish/10 text-signal-bullish",
  },
  repeated_hits: {
    label: "Repeated",
    blurb: "Same chain hit over and over in the window — accumulation.",
    cls: "bg-amber-500/15 text-amber-400",
  },
  iv_expansion: {
    label: "IV jump",
    blurb: "Implied vol blew out during the alert — event being priced in.",
    cls: "bg-rose-500/15 text-rose-400",
  },
  oi_explosion: {
    label: "Vol/OI",
    blurb: "Volume dwarfs existing OI — brand-new positioning.",
    cls: "bg-sky-500/15 text-sky-400",
  },
  daily_skew: {
    label: "Daily skew",
    blurb: "Daily net call vs put premium is lopsided beyond 4×.",
    cls: "bg-purple-500/15 text-purple-400",
  },
};

const KIND_ORDER: (FlowAnomalyKind | "all")[] = [
  "all",
  "mega_sweep",
  "block_buy",
  "ask_aggression",
  "repeated_hits",
  "iv_expansion",
  "oi_explosion",
  "daily_skew",
];

function formatMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function formatRelative(iso: string): string {
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

function severityBar(severity: number): string {
  // Color floor for visibility even at low severity.
  const pct = Math.max(8, Math.round(severity * 100));
  return `${pct}%`;
}

function sideTone(side: string | null): string {
  if (side === "call") return "text-signal-bullish";
  if (side === "put") return "text-signal-bearish";
  return "text-muted-foreground";
}

export function FlowView() {
  const [lookback, setLookback] = useState<number>(24);
  const [minPremium, setMinPremium] = useState<number>(100_000);
  const [kind, setKind] = useState<FlowAnomalyKind | "all">("all");
  const [ticker, setTicker] = useState<string>("");

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["flow", lookback, minPremium, kind, ticker],
    queryFn: () =>
      api.flowUnusual({
        lookbackHours: lookback,
        minPremium,
        kind: kind === "all" ? undefined : kind,
        ticker: ticker.trim().toUpperCase() || undefined,
        limit: 200,
      }),
    refetchInterval: REFETCH_MS,
  });

  const events = data?.events ?? [];
  const counts = data?.count_by_kind ?? {};

  const topTickers = useMemo(() => {
    const byTicker: Record<string, { count: number; premium: number }> = {};
    for (const e of events) {
      const slot = (byTicker[e.ticker] ??= { count: 0, premium: 0 });
      slot.count += 1;
      slot.premium += e.premium ?? 0;
    }
    return Object.entries(byTicker)
      .map(([t, v]) => ({ ticker: t, ...v }))
      .sort((a, b) => b.premium - a.premium)
      .slice(0, 12);
  }, [events]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Flow</h1>
        <p className="text-sm text-muted-foreground">
          Unusual options activity our system flagged — big money, weird structure, or
          positioning that doesn't fit the noise.
        </p>
        <div className="ml-auto text-xs text-muted-foreground">
          {data ? (
            <>
              {isFetching ? "refreshing… " : ""}
              {events.length} events · as of {formatRelative(data.as_of)}
            </>
          ) : (
            "—"
          )}
        </div>
      </header>

      <WhaleBetsPanel />

      <div className="mb-4">
        <FlowAggregatePanel />
      </div>

      {/* Filter row 1: lookback + min premium + ticker filter */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <div className="flex items-center gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            window
          </span>
          {LOOKBACK_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setLookback(o.value)}
              className={cn(
                "rounded-full border border-border px-3 py-1 text-xs",
                lookback === o.value
                  ? "bg-primary/15 text-primary"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            size
          </span>
          {MIN_PREMIUM_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setMinPremium(o.value)}
              className={cn(
                "rounded-full border border-border px-3 py-1 text-xs",
                minPremium === o.value
                  ? "bg-primary/15 text-primary"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>

        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="filter ticker"
          className="h-7 w-32 rounded-full border border-border bg-card px-3 text-xs outline-none focus:border-primary/60"
        />

        <button
          onClick={() => refetch()}
          className="ml-auto rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          refresh
        </button>
      </div>

      {/* Filter row 2: anomaly kind chips */}
      <div className="mb-4 flex flex-wrap items-center gap-1">
        {KIND_ORDER.map((k) => {
          const meta = KIND_META[k];
          const active = kind === k;
          const count = k === "all" ? events.length : counts[k as FlowAnomalyKind] ?? 0;
          return (
            <button
              key={k}
              title={meta.blurb}
              onClick={() => setKind(active && k !== "all" ? "all" : k)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs",
                active ? meta.cls : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <span>{meta.label}</span>
              <span className="rounded-full bg-foreground/10 px-1.5 text-[10px] font-medium">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Top tickers strip */}
      {topTickers.length > 0 && (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              hot tickers
            </span>
            {topTickers.map((t) => (
              <Link
                key={t.ticker}
                href={`/agents/${encodeURIComponent(t.ticker)}`}
                className="group flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:border-primary/60"
              >
                <span className="font-semibold text-foreground">{t.ticker}</span>
                <span className="text-muted-foreground">
                  {formatMoney(t.premium)} · {t.count}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Events table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-signal-bearish">
            Failed to load flow events. The API may not have unusual-whales rows yet.
          </CardContent>
        </Card>
      ) : events.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No unusual flow in this window. Try widening the lookback or lowering the size
            filter.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Ticker</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Signal</th>
                  <th className="px-3 py-2 text-right">Premium</th>
                  <th className="px-3 py-2">Heat</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <FlowRow key={`${e.ts}-${e.ticker}-${e.kind}-${i}`} event={e} />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FlowRow({ event }: { event: FlowEvent }) {
  const meta = KIND_META[event.kind];
  return (
    <tr className="border-b last:border-0 hover:bg-foreground/5">
      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
        {formatRelative(event.ts)}
      </td>
      <td className="px-3 py-2">
        <Link
          href={`/agents/${encodeURIComponent(event.ticker)}`}
          className="font-semibold text-foreground hover:text-primary"
        >
          {event.ticker}
        </Link>
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            meta.cls,
          )}
          title={meta.blurb}
        >
          {meta.label}
        </span>
      </td>
      <td className="px-3 py-2 text-xs">
        <span className={sideTone(event.option_type)}>{event.headline}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">
        {formatMoney(event.premium)}
      </td>
      <td className="px-3 py-2">
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-foreground/10">
          <div
            className={cn(
              "h-full rounded-full",
              event.kind === "iv_expansion" || event.option_type === "put"
                ? "bg-signal-bearish"
                : "bg-signal-bullish",
            )}
            style={{ width: severityBar(event.severity) }}
          />
        </div>
      </td>
    </tr>
  );
}
