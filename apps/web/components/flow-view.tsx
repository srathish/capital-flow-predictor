"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { FlowAnomalyKind, FlowCatalyst, FlowEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FlowMoversPanel } from "@/components/flow-movers-panel";
import { WhaleBetsPanel } from "@/components/whale-bets-panel";
import { TickerDossierSheet } from "@/components/ticker-dossier-sheet";

const REFETCH_MS = 30_000;
const CLUSTER_WINDOW_MS = 30 * 60 * 1000;

// Confluence is *cross-category* agreement, not just count of kinds.
// repeated_hits + oi_explosion on the same chain are the same phenomenon
// detected twice — not two independent signals. Real confluence means
// the size lens, the concentration lens, and the vol lens all agree.
type AnomalyCategory = "size" | "concentration" | "vol" | "daily" | "positioning";
const KIND_CATEGORY: Record<FlowAnomalyKind, AnomalyCategory> = {
  mega_sweep: "size",
  block_buy: "size",
  ask_aggression: "size",
  repeated_hits: "concentration",
  oi_explosion: "concentration",
  iv_expansion: "vol",
  daily_skew: "daily",
  // short_squeeze_setup is a structural fact about the float, independent of
  // flow lenses — bullish call sweep landing on a heavily-shorted name is a
  // qualitatively different signal from "the sweep was big."
  short_squeeze_setup: "positioning",
};

type ClusterItem = {
  type: "cluster";
  ticker: string;
  events: FlowEvent[];
  distinctKinds: number;
  distinctCategories: number;
  latestTs: string;
  totalPremium: number;
  sortScore: number;
};
type SingleItem = {
  type: "single";
  event: FlowEvent;
  sortScore: number;
};
type FeedItem = ClusterItem | SingleItem;

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
  short_squeeze_setup: {
    label: "Squeeze",
    blurb:
      "High short interest + bullish call sweep on the same name — heavily-shorted float meeting fresh upside flow.",
    cls: "bg-emerald-500/15 text-emerald-400",
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
  "short_squeeze_setup",
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

function CatalystBadge({ catalyst }: { catalyst: FlowCatalyst }) {
  const when =
    catalyst.days_until === 0
      ? "today"
      : catalyst.days_until === 1
        ? "tmrw"
        : `${catalyst.days_until}d`;
  const session = catalyst.session && catalyst.session !== "unknown" ? ` ${catalyst.session}` : "";
  const move =
    catalyst.expected_move_pct != null
      ? ` · ±${(catalyst.expected_move_pct * 100).toFixed(1)}%`
      : "";
  return (
    <span
      title={`Earnings ${catalyst.when}${session ? ` (${session.trim()})` : ""}${move ? ` · expected move${move.replace(" · ", " ")}` : ""}`}
      className="ml-1 inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide text-amber-400"
    >
      ER {when}
      {move}
    </span>
  );
}

export function FlowView() {
  const [lookback, setLookback] = useState<number>(24);
  const [minPremium, setMinPremium] = useState<number>(100_000);
  const [kind, setKind] = useState<FlowAnomalyKind | "all">("all");
  const [ticker, setTicker] = useState<string>("");
  const [dossierTicker, setDossierTicker] = useState<string | null>(null);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

  function openDossier(t: string) {
    const sym = t.trim().toUpperCase();
    if (sym) setDossierTicker(sym);
  }

  function toggleCluster(key: string) {
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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

  // Confluence ranking: tickers with ≥2 distinct anomaly kinds inside a
  // 30-minute window form a cluster card. Everything else stays as a
  // single-event row. Sort weight = confluence × 100 + recency × 10 +
  // premium_score × 5. Big single-ticket events (≥$10M / ≥$50M) get a
  // synthetic confluence bonus so a $20M lone sweep still rides high.
  const feedItems = useMemo<FeedItem[]>(() => {
    if (!data) return [];
    const asOfMs = new Date(data.as_of).getTime() || Date.now();
    const windowMs = Math.max(1, data.lookback_hours ?? 24) * 60 * 60 * 1000;

    const byTicker = new Map<string, FlowEvent[]>();
    for (const e of events) {
      const arr = byTicker.get(e.ticker) ?? [];
      arr.push(e);
      byTicker.set(e.ticker, arr);
    }

    const recencyScore = (ts: string) => {
      const age = asOfMs - new Date(ts).getTime();
      return Math.max(0, Math.min(1, 1 - age / windowMs));
    };
    const premiumScore = (p: number | null) => {
      if (!p || p <= 0) return 0;
      return Math.log10(Math.max(p / 100_000, 1));
    };
    const singleConfluence = (premium: number | null) => {
      const p = premium ?? 0;
      if (p >= 50_000_000) return 3;
      if (p >= 10_000_000) return 2;
      return 1;
    };

    const items: FeedItem[] = [];
    for (const [ticker, evs] of byTicker.entries()) {
      const sorted = [...evs].sort(
        (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
      );
      const latestTs = sorted[0].ts;
      const latestMs = new Date(latestTs).getTime();
      const inWindow = sorted.filter(
        (e) => latestMs - new Date(e.ts).getTime() <= CLUSTER_WINDOW_MS,
      );
      const older = sorted.filter(
        (e) => latestMs - new Date(e.ts).getTime() > CLUSTER_WINDOW_MS,
      );
      const distinctKinds = new Set(inWindow.map((e) => e.kind)).size;
      const distinctCategories = new Set(
        inWindow.map((e) => KIND_CATEGORY[e.kind]),
      ).size;

      // Cluster requires ≥2 *categories*, not just kinds. Sort weight uses
      // categories too so a same-category pair (repeated + vol/oi on one
      // chain) doesn't outrank a real cross-lens cluster.
      if (distinctCategories >= 2) {
        const totalPremium = inWindow.reduce((s, e) => s + (e.premium ?? 0), 0);
        const sortScore =
          distinctCategories * 100 +
          recencyScore(latestTs) * 10 +
          premiumScore(totalPremium) * 5;
        items.push({
          type: "cluster",
          ticker,
          events: inWindow,
          distinctKinds,
          distinctCategories,
          latestTs,
          totalPremium,
          sortScore,
        });
        for (const e of older) {
          const conf = singleConfluence(e.premium);
          items.push({
            type: "single",
            event: e,
            sortScore: conf * 100 + recencyScore(e.ts) * 10 + premiumScore(e.premium) * 5,
          });
        }
      } else {
        for (const e of sorted) {
          const conf = singleConfluence(e.premium);
          items.push({
            type: "single",
            event: e,
            sortScore: conf * 100 + recencyScore(e.ts) * 10 + premiumScore(e.premium) * 5,
          });
        }
      }
    }

    items.sort((a, b) => b.sortScore - a.sortScore);
    return items;
  }, [events, data]);

  const clusterCount = feedItems.filter((i) => i.type === "cluster").length;

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
        <FlowMoversPanel />
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
          onKeyDown={(e) => {
            if (e.key === "Enter") openDossier(ticker);
          }}
          placeholder="ticker — enter opens dossier"
          className="h-7 w-56 rounded-full border border-border bg-card px-3 text-xs outline-none focus:border-primary/60"
        />
        <button
          onClick={() => openDossier(ticker)}
          disabled={!ticker.trim()}
          className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          title="Open dossier slide-over for the ticker (Enter)"
        >
          dossier
        </button>

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
              <button
                key={t.ticker}
                type="button"
                onClick={() => openDossier(t.ticker)}
                className="group flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:border-primary/60"
              >
                <span className="font-semibold text-foreground">{t.ticker}</span>
                <span className="text-muted-foreground">
                  {formatMoney(t.premium)} · {t.count}
                </span>
              </button>
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
            {clusterCount > 0 && (
              <div className="border-b border-border/60 px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                {clusterCount} confluence {clusterCount === 1 ? "cluster" : "clusters"} ·
                ranked by signals × recency × size
              </div>
            )}
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
                {feedItems.map((item, idx) => {
                  if (item.type === "cluster") {
                    const key = `cluster-${item.ticker}-${item.latestTs}`;
                    // High-confluence (4+ categories) opens by default so the
                    // alpha moments never need a click; lower-confluence stays
                    // collapsed to keep the feed dense.
                    const autoOpen = item.distinctCategories >= 4;
                    const expanded = autoOpen || expandedClusters.has(key);
                    return (
                      <ClusterRow
                        key={key}
                        item={item}
                        expanded={expanded}
                        onToggle={() => toggleCluster(key)}
                        onTickerClick={openDossier}
                      />
                    );
                  }
                  return (
                    <FlowRow
                      key={`single-${item.event.ts}-${item.event.ticker}-${item.event.kind}-${idx}`}
                      event={item.event}
                      onTickerClick={openDossier}
                    />
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <TickerDossierSheet
        ticker={dossierTicker}
        open={dossierTicker !== null}
        onClose={() => setDossierTicker(null)}
      />
    </div>
  );
}

function FlowRow({
  event,
  onTickerClick,
}: {
  event: FlowEvent;
  onTickerClick: (ticker: string) => void;
}) {
  const meta = KIND_META[event.kind];
  return (
    <tr className="border-b last:border-0 hover:bg-foreground/5">
      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
        {formatRelative(event.ts)}
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={() => onTickerClick(event.ticker)}
          className="font-semibold text-foreground hover:text-primary"
        >
          {event.ticker}
        </button>
        {event.catalyst && <CatalystBadge catalyst={event.catalyst} />}
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

// Cluster row — 2+ distinct anomaly kinds on the same ticker within
// CLUSTER_WINDOW_MS. Renders as a single full-width tr (colSpan=6) with
// a header line and the contributing signals nested below. Visual weight
// scales with distinctKinds: 5+ glows, 3-4 highlights, 2 stays muted.
function ClusterRow({
  item,
  expanded,
  onToggle,
  onTickerClick,
}: {
  item: ClusterItem;
  expanded: boolean;
  onToggle: () => void;
  onTickerClick: (ticker: string) => void;
}) {
  const {
    ticker,
    events: clusterEvents,
    distinctKinds,
    distinctCategories,
    latestTs,
    totalPremium,
  } = item;
  const earliest = clusterEvents[clusterEvents.length - 1]?.ts ?? latestTs;
  const catalyst = clusterEvents.find((e) => e.catalyst)?.catalyst ?? null;
  const spanMs = new Date(latestTs).getTime() - new Date(earliest).getTime();
  const spanMin = Math.max(1, Math.round(spanMs / 60_000));

  // Visual weight keys off *categories* (independent lenses) not raw kinds.
  // 4 categories = all four lenses agreeing = the alpha moment.
  const tone =
    distinctCategories >= 4
      ? "border-l-4 border-l-amber-400/80 bg-amber-500/[0.06]"
      : distinctCategories >= 3
        ? "border-l-4 border-l-primary/70 bg-primary/[0.05]"
        : "border-l-4 border-l-foreground/30 bg-foreground/[0.02]";

  const flame = distinctCategories >= 4 ? "🔥 " : distinctCategories >= 3 ? "⚡ " : "";

  return (
    <tr className={cn("border-b last:border-0", tone)}>
      <td colSpan={6} className="px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onToggle}
              className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 text-left"
            >
              <span className="text-xs text-foreground/40">{expanded ? "▾" : "▸"}</span>
              <span
                role="link"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onTickerClick(ticker);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    onTickerClick(ticker);
                  }
                }}
                className="font-semibold text-foreground hover:text-primary"
              >
                {flame}
                {ticker}
              </span>
              {catalyst && <CatalystBadge catalyst={catalyst} />}
              <span className="text-xs text-muted-foreground">
                {distinctKinds} signals · {distinctCategories} lenses in {spanMin}m ·{" "}
                {formatMoney(totalPremium)} · latest {formatRelative(latestTs)}
              </span>
            </button>
            {expanded && (
              <ul className="mt-1 space-y-0.5 text-xs">
                {clusterEvents.slice(0, 5).map((e, i) => {
                  const meta = KIND_META[e.kind];
                  return (
                    <li
                      key={`${e.ts}-${e.kind}-${i}`}
                      className="flex flex-wrap items-baseline gap-x-2 text-muted-foreground"
                    >
                      <span className="text-foreground/40">└</span>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide",
                          meta.cls,
                        )}
                      >
                        {meta.label}
                      </span>
                      <span className={cn("flex-1", sideTone(e.option_type))}>{e.headline}</span>
                      <span className="font-mono text-[10px]">{formatMoney(e.premium)}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {formatRelative(e.ts)}
                      </span>
                    </li>
                  );
                })}
                {clusterEvents.length > 5 && (
                  <li className="text-[10px] text-muted-foreground">
                    + {clusterEvents.length - 5} more
                  </li>
                )}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => onTickerClick(ticker)}
            className="whitespace-nowrap rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground"
          >
            Dossier ▸
          </button>
        </div>
      </td>
    </tr>
  );
}
