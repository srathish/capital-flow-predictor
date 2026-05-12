"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type { ScreenSignal, StockScreenItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SIGNAL_OPTIONS: { value: ScreenSignal; label: string; tone: string }[] = [
  { value: "long", label: "Long", tone: "bg-signal-bullish/15 text-signal-bullish" },
  { value: "short", label: "Short", tone: "bg-signal-bearish/15 text-signal-bearish" },
  { value: "any", label: "Any", tone: "bg-primary/15 text-primary" },
];

const CONFIDENCE_FLOORS = [0.5, 0.6, 0.7];
const LOOKBACK_OPTIONS = [
  { value: 14, label: "2w" },
  { value: 30, label: "1m" },
  { value: 60, label: "2m" },
  { value: 90, label: "3m" },
];

const EARNINGS_EXCLUDE = [
  { value: 0, label: "include" },
  { value: 5, label: "exclude <5d" },
  { value: 10, label: "exclude <10d" },
];

const IV_RANK_FLOORS = [
  { value: 0, label: "off" },
  { value: 0.5, label: "≥50%" },
  { value: 0.7, label: "≥70%" },
  { value: 0.9, label: "≥90%" },
];

const SECTOR_OPTIONS = [
  { value: "", label: "all sectors" },
  { value: "XLK", label: "XLK · Tech" },
  { value: "XLF", label: "XLF · Financials" },
  { value: "XLE", label: "XLE · Energy" },
  { value: "XLV", label: "XLV · Health" },
  { value: "XLI", label: "XLI · Industrials" },
  { value: "XLY", label: "XLY · Discretionary" },
  { value: "XLP", label: "XLP · Staples" },
  { value: "XLU", label: "XLU · Utilities" },
  { value: "XLB", label: "XLB · Materials" },
  { value: "XLRE", label: "XLRE · Real Estate" },
  { value: "XLC", label: "XLC · Comm Services" },
  { value: "ARKK", label: "ARKK · Innovation" },
  { value: "SMH", label: "SMH · Semis" },
];

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function fmtPctSigned(v: number | null | undefined): string {
  if (v == null) return "—";
  const pct = v * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function fmtInt(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function signalColor(signal: string): string {
  if (signal === "long") return "text-signal-bullish";
  if (signal === "short") return "text-signal-bearish";
  return "text-muted-foreground";
}

export function ScreenerView() {
  const [signal, setSignal] = useState<ScreenSignal>("long");
  const [minConfidence, setMinConfidence] = useState(0.5);
  const [sector, setSector] = useState("");
  const [excludeEarnings, setExcludeEarnings] = useState(0);
  const [lookbackDays, setLookbackDays] = useState(30);
  const [minOi, setMinOi] = useState(0);
  const [minIvRank, setMinIvRank] = useState(0);

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: [
      "screener",
      signal,
      minConfidence,
      sector,
      excludeEarnings,
      lookbackDays,
      minOi,
      minIvRank,
    ],
    queryFn: () =>
      api.screenStocks({
        signal,
        minConfidence,
        sector: sector || undefined,
        minOi,
        minIvRank: minIvRank > 0 ? minIvRank : undefined,
        excludeEarningsWithinDays: excludeEarnings,
        lookbackDays,
        limit: 50,
      }),
    refetchInterval: 60_000,
  });

  const items = data?.items ?? [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Screener</h1>
        <p className="text-sm text-muted-foreground">
          Tickers the agent ensemble verdict ranks as options-trade candidates.
          Composite = PM confidence × IV-rank × √open-interest.
        </p>
        <div className="ml-auto text-xs text-muted-foreground">
          {data ? (
            <>
              {isFetching ? "refreshing… " : ""}
              {items.length} of {data.universe_size} candidates
            </>
          ) : (
            "—"
          )}
        </div>
      </header>

      {/* Filter row */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="uppercase tracking-wide text-muted-foreground">side</span>
        {SIGNAL_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => setSignal(o.value)}
            className={cn(
              "rounded-full border border-border px-3 py-1",
              signal === o.value
                ? o.tone
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}

        <span className="ml-3 uppercase tracking-wide text-muted-foreground">min conf</span>
        {CONFIDENCE_FLOORS.map((c) => (
          <button
            key={c}
            onClick={() => setMinConfidence(c)}
            className={cn(
              "rounded-full border border-border px-3 py-1",
              minConfidence === c
                ? "bg-primary/15 text-primary"
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {fmtPct(c)}
          </button>
        ))}

        <span className="ml-3 uppercase tracking-wide text-muted-foreground">lookback</span>
        {LOOKBACK_OPTIONS.map((l) => (
          <button
            key={l.value}
            onClick={() => setLookbackDays(l.value)}
            className={cn(
              "rounded-full border border-border px-3 py-1",
              lookbackDays === l.value
                ? "bg-primary/15 text-primary"
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {l.label}
          </button>
        ))}

        <span className="ml-3 uppercase tracking-wide text-muted-foreground">earnings</span>
        {EARNINGS_EXCLUDE.map((e) => (
          <button
            key={e.value}
            onClick={() => setExcludeEarnings(e.value)}
            className={cn(
              "rounded-full border border-border px-3 py-1",
              excludeEarnings === e.value
                ? "bg-primary/15 text-primary"
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {e.label}
          </button>
        ))}

        <span className="ml-3 uppercase tracking-wide text-muted-foreground">sector</span>
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="rounded-full border border-border bg-card px-3 py-1 text-xs"
        >
          {SECTOR_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <span className="ml-3 uppercase tracking-wide text-muted-foreground">min OI</span>
        <select
          value={minOi}
          onChange={(e) => setMinOi(Number(e.target.value))}
          className="rounded-full border border-border bg-card px-3 py-1 text-xs"
        >
          <option value={0}>off</option>
          <option value={1000}>1K</option>
          <option value={10000}>10K</option>
          <option value={100000}>100K</option>
        </select>

        <span className="ml-3 uppercase tracking-wide text-muted-foreground">min IV rank</span>
        {IV_RANK_FLOORS.map((f) => (
          <button
            key={f.value}
            onClick={() => setMinIvRank(f.value)}
            className={cn(
              "rounded-full border border-border px-3 py-1",
              minIvRank === f.value
                ? "bg-primary/15 text-primary"
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
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
            Screener failed. The universe table may be empty — kick off some agent
            runs first.
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No candidates pass these filters. Try lowering the confidence floor,
            widening the lookback, or relaxing the OI gate.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Ticker</th>
                  <th className="px-3 py-2">Sector</th>
                  <th className="px-3 py-2">Signal</th>
                  <th className="px-3 py-2 text-right">Conf</th>
                  <th className="px-3 py-2 text-right">IV rank</th>
                  <th className="px-3 py-2 text-right">OI</th>
                  <th className="px-3 py-2 text-right">Earnings in</th>
                  <th className="px-3 py-2 text-right">Score</th>
                  <th className="px-3 py-2">Thesis</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <ScreenerRow key={it.ticker} item={it} />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ScreenerRow({ item }: { item: StockScreenItem }) {
  return (
    <tr className="border-b last:border-0 hover:bg-foreground/5">
      <td className="px-3 py-2">
        <Link
          href={`/agents/${encodeURIComponent(item.ticker)}`}
          className="font-semibold text-foreground hover:text-primary"
        >
          {item.ticker}
        </Link>
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {item.sector ? (
          <Link href={`/sectors/${item.sector}`} className="hover:text-foreground">
            {item.sector}
          </Link>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            item.final_signal === "long"
              ? "bg-signal-bullish/15 text-signal-bullish"
              : item.final_signal === "short"
                ? "bg-signal-bearish/15 text-signal-bearish"
                : "bg-foreground/10 text-muted-foreground",
          )}
        >
          {item.final_signal}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {fmtPct(item.confidence)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {fmtPct(item.iv_rank)}
      </td>
      <td
        className={cn(
          "px-3 py-2 text-right font-mono text-xs",
          item.liquidity_ok ? "" : "text-muted-foreground",
        )}
        title={
          item.liquidity_ok
            ? undefined
            : "Open interest below the current min-OI gate — illiquid, fills may slip"
        }
      >
        <span className="inline-flex items-center justify-end gap-1">
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              item.liquidity_ok ? "bg-signal-bullish/60" : "bg-amber-500/60",
            )}
            aria-hidden
          />
          {fmtInt(item.open_interest)}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {item.days_to_earnings == null ? (
          "—"
        ) : (
          <span
            className={item.near_earnings ? "text-amber-400" : "text-muted-foreground"}
            title={
              item.expected_move_pct != null
                ? `Expected move ${fmtPctSigned(item.expected_move_pct)}`
                : undefined
            }
          >
            {item.days_to_earnings}d
          </span>
        )}
      </td>
      <td className={cn("px-3 py-2 text-right font-mono", signalColor(item.final_signal))}>
        {item.composite_score.toFixed(2)}
      </td>
      <td
        className="px-3 py-2 text-xs text-muted-foreground"
        title={item.rationale ?? undefined}
      >
        {item.rationale ? (
          <span className="line-clamp-1">{item.rationale}</span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}
