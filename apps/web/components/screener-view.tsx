"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { sectorMetaFor } from "@/lib/sectors";
import type { ScreenSignal, StockScreenItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MyWatchlist,
  useAddToCustomWatchlist,
  useCustomWatchlist,
  useRemoveFromCustomWatchlist,
} from "@/components/my-watchlist";

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

type ViewMode = "flat" | "sector";

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
  const [finvizPreset, setFinvizPreset] = useState("");
  const [view, setView] = useState<ViewMode>("flat");
  const [showMyList, setShowMyList] = useState(false);

  const { data: presetsData } = useQuery({
    queryKey: ["finviz-presets"],
    queryFn: () => api.finvizPresets(),
    staleTime: 60 * 60 * 1000,
  });
  const presets = presetsData?.presets ?? [];

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
      finvizPreset,
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
        finvizPreset: finvizPreset || undefined,
      }),
    refetchInterval: 60_000,
  });

  const items = data?.items ?? [];

  const { data: customData } = useCustomWatchlist();
  const myListTickers = useMemo(
    () => new Set((customData?.entries ?? []).map((e) => e.ticker)),
    [customData],
  );
  const myListCount = myListTickers.size;

  const add = useAddToCustomWatchlist();
  const remove = useRemoveFromCustomWatchlist();
  const toggleMyList = (ticker: string) => {
    if (myListTickers.has(ticker)) remove.mutate({ ticker });
    else add.mutate({ ticker });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Screener</h1>
        <p className="text-sm text-muted-foreground">
          {finvizPreset
            ? "Finviz preset hits, with the agent ensemble's verdict overlaid where available."
            : "Tickers the agent ensemble verdict ranks as options-trade candidates."}{" "}
          Composite = PM confidence × IV-rank × √open-interest.
        </p>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {data ? (
            <span>
              {isFetching ? "refreshing… " : ""}
              {items.length} of {data.universe_size} candidates
            </span>
          ) : (
            <span>—</span>
          )}
          <button
            type="button"
            onClick={() => setShowMyList((v) => !v)}
            className={cn(
              "rounded-full border border-border px-3 py-1",
              showMyList
                ? "bg-primary/15 text-primary"
                : "bg-card hover:text-foreground",
            )}
            aria-pressed={showMyList}
          >
            ★ My list ({myListCount})
          </button>
        </div>
      </header>

      {/* Preset row — Finviz universe selector lives on its own line so the
          dropdown has room to breathe and the user understands it swaps the
          source of candidates entirely. */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="uppercase tracking-wide text-muted-foreground">universe</span>
        <button
          onClick={() => setFinvizPreset("")}
          className={cn(
            "rounded-full border border-border px-3 py-1",
            !finvizPreset
              ? "bg-primary/15 text-primary"
              : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          agent ensemble
        </button>
        <select
          value={finvizPreset}
          onChange={(e) => setFinvizPreset(e.target.value)}
          className="rounded-full border border-border bg-card px-3 py-1 text-xs"
        >
          <option value="">+ finviz preset…</option>
          {presets.map((p) => (
            <option key={p.key} value={p.key}>
              finviz · {p.label}
            </option>
          ))}
        </select>
        {finvizPreset ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-400">
            finviz universe — unrated rows allowed
          </span>
        ) : null}
      </div>

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

      {/* View toggle */}
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="uppercase tracking-wide text-muted-foreground">view</span>
        {(["flat", "sector"] as ViewMode[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cn(
              "rounded-full border border-border px-3 py-1",
              view === v
                ? "bg-primary/15 text-primary"
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {v === "flat" ? "Flat table" : "By sector"}
          </button>
        ))}
      </div>

      {/* Body: results + optional sidebar */}
      <div className={cn("flex gap-4", showMyList ? "" : "")}>
        <main className="min-w-0 flex-1">
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
          ) : view === "flat" ? (
            <FlatTable
              items={items}
              isStarred={(t) => myListTickers.has(t)}
              onToggleStar={toggleMyList}
            />
          ) : (
            <SectorGrid
              items={items}
              isStarred={(t) => myListTickers.has(t)}
              onToggleStar={toggleMyList}
            />
          )}
        </main>

        {showMyList && (
          <aside className="w-72 shrink-0 lg:block">
            <MyWatchlist />
          </aside>
        )}
      </div>
    </div>
  );
}

type RowActionProps = {
  isStarred: (t: string) => boolean;
  onToggleStar: (t: string) => void;
};

function StarButton({
  ticker,
  starred,
  onClick,
}: {
  ticker: string;
  starred: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={starred ? `Remove ${ticker} from My list` : `Add ${ticker} to My list`}
      aria-label={starred ? `Remove ${ticker}` : `Add ${ticker}`}
      className={cn(
        "rounded px-1.5 py-0.5 text-sm transition-colors",
        starred
          ? "text-amber-400 hover:text-amber-300"
          : "text-muted-foreground/40 hover:text-amber-400",
      )}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}

function FlatTable({
  items,
  isStarred,
  onToggleStar,
}: { items: StockScreenItem[] } & RowActionProps) {
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-8 px-2 py-2"></th>
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
              <ScreenerRow
                key={it.ticker}
                item={it}
                starred={isStarred(it.ticker)}
                onToggleStar={() => onToggleStar(it.ticker)}
              />
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function ScreenerRow({
  item,
  starred,
  onToggleStar,
}: {
  item: StockScreenItem;
  starred: boolean;
  onToggleStar: () => void;
}) {
  return (
    <tr className="border-b last:border-0 hover:bg-foreground/5">
      <td className="px-2 py-2">
        <StarButton ticker={item.ticker} starred={starred} onClick={onToggleStar} />
      </td>
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
        {item.has_agent_verdict ? (
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
        ) : (
          <span
            className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-400"
            title="Finviz hit; the agent ensemble hasn't analyzed this ticker yet. Click to run."
          >
            unrated
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {item.has_agent_verdict ? fmtPct(item.confidence) : "—"}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">{fmtPct(item.iv_rank)}</td>
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
        {item.rationale ? <span className="line-clamp-1">{item.rationale}</span> : "—"}
      </td>
    </tr>
  );
}

function SectorGrid({
  items,
  isStarred,
  onToggleStar,
}: { items: StockScreenItem[] } & RowActionProps) {
  // Group client-side by sector so the same filtered universe drives both views.
  const grouped = useMemo(() => {
    const m = new Map<string, StockScreenItem[]>();
    for (const it of items) {
      const key = it.sector ?? "—";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(it);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [items]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {grouped.map(([sec, rows]) => {
        const meta = sec === "—" ? { name: "Unclassified" } : sectorMetaFor(sec);
        return (
          <Card key={sec}>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center justify-between">
                {sec === "—" ? (
                  <span>{meta.name}</span>
                ) : (
                  <Link
                    href={`/sectors/${encodeURIComponent(sec)}`}
                    className="hover:underline"
                  >
                    {meta.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {sec}
                    </span>
                  </Link>
                )}
                <span className="text-xs font-normal text-muted-foreground">
                  {rows.length} candidate{rows.length === 1 ? "" : "s"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {rows.map((it) => (
                  <SectorRow
                    key={it.ticker}
                    item={it}
                    starred={isStarred(it.ticker)}
                    onToggleStar={() => onToggleStar(it.ticker)}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function SectorRow({
  item,
  starred,
  onToggleStar,
}: {
  item: StockScreenItem;
  starred: boolean;
  onToggleStar: () => void;
}) {
  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <StarButton ticker={item.ticker} starred={starred} onClick={onToggleStar} />
          <Link
            href={`/agents/${encodeURIComponent(item.ticker)}`}
            className="text-base font-semibold hover:underline"
          >
            {item.ticker}
          </Link>
          {item.has_agent_verdict ? (
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
          ) : (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-400">
              unrated
            </span>
          )}
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>
            conf{" "}
            <span className="font-mono text-foreground">
              {item.has_agent_verdict ? fmtPct(item.confidence) : "—"}
            </span>
          </div>
          <div>
            score{" "}
            <span className={cn("font-mono", signalColor(item.final_signal))}>
              {item.composite_score.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
      {item.rationale && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-3">
          {item.rationale}
        </p>
      )}
    </li>
  );
}
