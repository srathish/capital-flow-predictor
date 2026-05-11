"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";
import {
  ALL_CATEGORIES,
  CATALYST_CATEGORIES,
  classifyKeywords,
  type CatalystCategoryId,
} from "@/lib/catalyst-categories";
import type { CatalystPost, CategoryTrackRecord } from "@/lib/types";

const HOUR_OPTIONS = [
  { value: 6, label: "6h" },
  { value: 24, label: "24h" },
  { value: 48, label: "48h" },
  { value: 168, label: "7d" },
] as const;

const SCORE_OPTIONS = [
  { value: 0.05, label: "All" },
  { value: 0.15, label: "≥ 0.15" },
  { value: 0.3, label: "≥ 0.30" },
] as const;

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "score", label: "Top score" },
  { value: "cluster", label: "Most posts" },
  { value: "engagement", label: "Most upvoted" },
  { value: "movers", label: "Biggest mover" },
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]["value"];

const REFETCH_MS = 60_000;
const PINNED_KEY = "catalysts:pinned";
const MUTED_KEY = "catalysts:muted";

type EnrichedPost = CatalystPost & {
  primaryCategory: CatalystCategoryId;
  allCategories: CatalystCategoryId[];
};

type Cluster = {
  key: string;
  lead: EnrichedPost;
  count: number;
  members: EnrichedPost[];
};

function formatHoursAgo(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function formatCount(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

function formatPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(1)}%`;
}

function returnTone(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "text-muted-foreground";
  if (p > 0.5) return "text-signal-bullish";
  if (p < -0.5) return "text-signal-bearish";
  return "text-muted-foreground";
}

function scoreTooltip(p: CatalystPost): string {
  const b = p.score_breakdown;
  const trustStr = b.trust == null ? "—" : b.trust.toFixed(2);
  return [
    `Score ${p.catalyst_score.toFixed(2)} = base × recency × trust`,
    `Base ${b.base.toFixed(2)} (tickers ${b.n_tickers}, keywords ${b.n_keywords})`,
    `Recency ${b.recency.toFixed(2)} (decays 1.0 → 0.2 over 6h–48h)`,
    `Trust ${trustStr} (author posting history)`,
  ].join("\n");
}

function formatUpdatedAgo(ms: number | null): string {
  if (!ms) return "—";
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}

function useLocalSet(key: string): [Set<string>, (next: Set<string>) => void] {
  const [set, setSet] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setSet(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, [key]);
  const update = (next: Set<string>) => {
    setSet(new Set(next));
    try {
      localStorage.setItem(key, JSON.stringify(Array.from(next)));
    } catch {
      /* ignore */
    }
  };
  return [set, update];
}

function enrich(posts: CatalystPost[]): EnrichedPost[] {
  return posts.map((p) => {
    const c = classifyKeywords(p.keywords);
    return { ...p, primaryCategory: c.primary, allCategories: c.all };
  });
}

function clusterPosts(posts: EnrichedPost[]): Cluster[] {
  // Dedup near-duplicate posts: same lead ticker + same primary category +
  // same ~6h bucket. Keep the highest-score post as the cluster head and
  // attach the rest as members.
  const buckets = new Map<string, EnrichedPost[]>();
  for (const p of posts) {
    const ticker = p.tickers[0] ?? "_";
    const bucket = Math.floor(p.hours_old / 6);
    const key = `${ticker}|${p.primaryCategory}|${bucket}`;
    const arr = buckets.get(key) ?? [];
    arr.push(p);
    buckets.set(key, arr);
  }
  const clusters: Cluster[] = [];
  for (const [key, arr] of buckets) {
    arr.sort((a, b) => b.catalyst_score - a.catalyst_score);
    clusters.push({ key, lead: arr[0]!, count: arr.length, members: arr });
  }
  return clusters;
}

function buildHourlyHistogram(posts: EnrichedPost[], hoursWindow: number): number[] {
  const buckets = Math.max(8, Math.min(48, hoursWindow));
  const out = new Array<number>(buckets).fill(0);
  const stride = hoursWindow / buckets;
  for (const p of posts) {
    if (p.hours_old < 0 || p.hours_old > hoursWindow) continue;
    // Reverse so older is on the left, newest on the right.
    const idx = Math.min(buckets - 1, Math.floor((hoursWindow - p.hours_old) / stride));
    out[idx] = (out[idx] ?? 0) + 1;
  }
  return out;
}

type TickerAgg = {
  ticker: string;
  count: number;
  topCategory: CatalystCategoryId;
  newestHours: number;
  histogram: number[];
};

function aggregateByTicker(
  posts: EnrichedPost[],
  hoursWindow: number,
): TickerAgg[] {
  const byTicker = new Map<string, EnrichedPost[]>();
  for (const p of posts) {
    for (const t of p.tickers) {
      const arr = byTicker.get(t) ?? [];
      arr.push(p);
      byTicker.set(t, arr);
    }
  }
  const aggs: TickerAgg[] = [];
  for (const [ticker, arr] of byTicker) {
    const catCounts = new Map<CatalystCategoryId, number>();
    let newest = Infinity;
    for (const p of arr) {
      catCounts.set(p.primaryCategory, (catCounts.get(p.primaryCategory) ?? 0) + 1);
      if (p.hours_old < newest) newest = p.hours_old;
    }
    let topCategory: CatalystCategoryId = "other";
    let topN = -1;
    for (const [cat, n] of catCounts) {
      if (n > topN) {
        topN = n;
        topCategory = cat;
      }
    }
    aggs.push({
      ticker,
      count: arr.length,
      topCategory,
      newestHours: Number.isFinite(newest) ? newest : hoursWindow,
      histogram: buildHourlyHistogram(arr, hoursWindow),
    });
  }
  return aggs;
}

export function CatalystsView() {
  const [hours, setHours] = useState<number>(48);
  const [minScore, setMinScore] = useState<number>(0.05);
  const [tickerFilter, setTickerFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [activeCats, setActiveCats] = useState<Set<CatalystCategoryId>>(new Set());
  const [mutedSubs, setMutedSubs] = useState<Set<string>>(new Set());
  const [pinnedTickers, setPinnedTickers] = useLocalSet(PINNED_KEY);
  const [mutedTickers, setMutedTickers] = useLocalSet(MUTED_KEY);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["catalysts", hours, minScore, tickerFilter],
    queryFn: () =>
      api.redditCatalysts({
        hours,
        minScore,
        ticker: tickerFilter.trim().toUpperCase() || undefined,
        limit: 200,
      }),
    retry: false,
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
  });

  // 30-day backtest of the catalyst signal itself — does each category
  // actually predict moves? Refreshed every 10 minutes (slow-moving data).
  const { data: trackRecord } = useQuery({
    queryKey: ["catalyst-track-record", 30],
    queryFn: () => api.redditCatalystTrackRecord({ days: 30, minScore: 0.05 }),
    retry: false,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Tick state for "updated Xs ago" label.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const enriched = useMemo<EnrichedPost[]>(
    () => (data ? enrich(data.posts) : []),
    [data],
  );

  const subredditCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of enriched) m.set(p.subreddit, (m.get(p.subreddit) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [enriched]);

  const filtered = useMemo(() => {
    return enriched.filter((p) => {
      if (mutedSubs.has(p.subreddit)) return false;
      if (p.tickers.some((t) => mutedTickers.has(t))) return false;
      if (activeCats.size > 0) {
        const hit = p.allCategories.some((c) => activeCats.has(c));
        if (!hit) return false;
      }
      return true;
    });
  }, [enriched, mutedSubs, mutedTickers, activeCats]);

  const clusters = useMemo(() => {
    const cs = clusterPosts(filtered);
    cs.sort((a, b) => {
      if (sortBy === "score") return b.lead.catalyst_score - a.lead.catalyst_score;
      if (sortBy === "cluster") return b.count - a.count;
      if (sortBy === "engagement") {
        return (b.lead.upvotes ?? 0) - (a.lead.upvotes ?? 0);
      }
      if (sortBy === "movers") {
        const av = Math.abs(a.lead.return_since_post_pct ?? 0);
        const bv = Math.abs(b.lead.return_since_post_pct ?? 0);
        return bv - av;
      }
      return a.lead.hours_old - b.lead.hours_old;
    });
    return cs;
  }, [filtered, sortBy]);

  const tickerAggs = useMemo(() => {
    const aggs = aggregateByTicker(filtered, hours);
    aggs.sort((a, b) => {
      const aPin = pinnedTickers.has(a.ticker) ? 1 : 0;
      const bPin = pinnedTickers.has(b.ticker) ? 1 : 0;
      if (aPin !== bPin) return bPin - aPin;
      if (b.count !== a.count) return b.count - a.count;
      return a.newestHours - b.newestHours;
    });
    return aggs;
  }, [filtered, hours, pinnedTickers]);

  const toggleCat = (c: CatalystCategoryId) => {
    const next = new Set(activeCats);
    next.has(c) ? next.delete(c) : next.add(c);
    setActiveCats(next);
  };

  const toggleSub = (s: string) => {
    const next = new Set(mutedSubs);
    next.has(s) ? next.delete(s) : next.add(s);
    setMutedSubs(next);
  };

  const togglePin = (t: string) => {
    const next = new Set(pinnedTickers);
    next.has(t) ? next.delete(t) : next.add(t);
    setPinnedTickers(next);
  };

  const toggleMuteTicker = (t: string) => {
    const next = new Set(mutedTickers);
    next.has(t) ? next.delete(t) : next.add(t);
    setMutedTickers(next);
  };

  const toggleExpand = (k: string) => {
    const next = new Set(expanded);
    next.has(k) ? next.delete(k) : next.add(k);
    setExpanded(next);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Catalysts</h1>
          <p className="text-sm text-muted-foreground">
            Reddit posts where a known ticker co-occurs with a catalyst keyword.
            Built to surface partnership / FDA / earnings / leak chatter before
            it hits official news.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="num">
            Updated {formatUpdatedAgo(dataUpdatedAt || null)}
            {isFetching && <span className="ml-1 text-primary">·</span>}
          </span>
          <button
            onClick={() => refetch()}
            className="rounded-full border border-border px-3 py-1.5 font-semibold text-foreground hover:border-primary/60"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Window + score + ticker search */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Window</span>
        {HOUR_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setHours(opt.value)}
            className={cn(
              "rounded-full px-3 py-1.5 font-semibold transition-colors",
              hours === opt.value
                ? "bg-primary text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        ))}
        <span className="ml-3 text-muted-foreground">Score</span>
        {SCORE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setMinScore(opt.value)}
            title="Score combines keyword weight, ticker count, recency. Higher = stronger catalyst signal."
            className={cn(
              "rounded-full px-3 py-1.5 font-semibold transition-colors",
              Math.abs(minScore - opt.value) < 1e-9
                ? "bg-primary text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        ))}
        <input
          value={tickerFilter}
          onChange={(e) => setTickerFilter(e.target.value)}
          placeholder="Ticker (e.g. INTC)"
          className="ml-3 h-8 w-36 rounded-full border border-border bg-card px-3 text-xs outline-none focus:border-primary/60"
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground">Sort</span>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSortBy(opt.value)}
              className={cn(
                "rounded-full px-3 py-1.5 font-semibold transition-colors",
                sortBy === opt.value
                  ? "bg-primary text-white"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Type</span>
        {ALL_CATEGORIES.map((id) => {
          const cat = CATALYST_CATEGORIES[id];
          const active = activeCats.has(id);
          return (
            <button
              key={id}
              onClick={() => toggleCat(id)}
              title={cat.description}
              className={cn(
                "rounded-full px-2.5 py-1 font-semibold transition-colors",
                active
                  ? `${cat.swatch} ${cat.text} ring-1 ring-current`
                  : `${cat.swatch} ${cat.text} opacity-60 hover:opacity-100`,
              )}
            >
              {cat.label}
            </button>
          );
        })}
        {activeCats.size > 0 && (
          <button
            onClick={() => setActiveCats(new Set())}
            className="text-muted-foreground hover:text-foreground"
          >
            clear
          </button>
        )}
      </div>

      {/* States */}
      {isLoading && <Skeleton className="h-96 w-full" />}
      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-signal-bearish">
            {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {/* Heating-up strip */}
      {data && tickerAggs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Heating up
            </h2>
            <span className="text-[11px] text-muted-foreground">
              {tickerAggs.length} ticker{tickerAggs.length === 1 ? "" : "s"} ·
              {" "}
              {filtered.length} post{filtered.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {tickerAggs.slice(0, 24).map((agg) => {
              const cat = CATALYST_CATEGORIES[agg.topCategory];
              const pinned = pinnedTickers.has(agg.ticker);
              return (
                <div
                  key={agg.ticker}
                  className="group min-w-[160px] shrink-0 rounded-lg border border-border bg-card p-3 hover:border-primary/40"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <Link
                      href={`/agents/${encodeURIComponent(agg.ticker)}`}
                      className="font-mono text-sm font-semibold hover:text-primary"
                    >
                      ${agg.ticker}
                    </Link>
                    <button
                      onClick={() => togglePin(agg.ticker)}
                      title={pinned ? "Unpin" : "Pin to top"}
                      className={cn(
                        "text-xs",
                        pinned ? "text-primary" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {pinned ? "★" : "☆"}
                    </button>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                    <span className={cn("rounded px-1.5 py-0.5 font-semibold", cat.swatch, cat.text)}>
                      {cat.label}
                    </span>
                    <span className="num text-muted-foreground">
                      {agg.count} · {formatHoursAgo(agg.newestHours)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <Sparkline values={agg.histogram} width={140} height={24} />
                  </div>
                  <div className="mt-2 flex justify-between text-[10px]">
                    <button
                      onClick={() => setTickerFilter(agg.ticker)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      filter
                    </button>
                    <button
                      onClick={() => toggleMuteTicker(agg.ticker)}
                      className="text-muted-foreground hover:text-signal-bearish"
                    >
                      mute
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Track record (30d) — does the signal actually work? */}
      {trackRecord && trackRecord.n_total_with_return > 0 && (
        <TrackRecordPanel data={trackRecord} onCategoryClick={toggleCat} activeCats={activeCats} />
      )}

      {/* Subreddit chips (toggle to mute) */}
      {data && subredditCounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">Subreddits</span>
          {subredditCounts.map(([sub, n]) => {
            const muted = mutedSubs.has(sub);
            return (
              <button
                key={sub}
                onClick={() => toggleSub(sub)}
                title={muted ? "Click to include" : "Click to mute"}
                className={cn(
                  "rounded-full px-2 py-0.5 transition-colors",
                  muted
                    ? "bg-muted text-muted-foreground line-through opacity-60"
                    : "bg-muted text-foreground hover:bg-primary/15 hover:text-primary",
                )}
              >
                r/{sub}
                <span className="ml-1 text-muted-foreground">{n}</span>
              </button>
            );
          })}
          {mutedSubs.size > 0 && (
            <button
              onClick={() => setMutedSubs(new Set())}
              className="text-muted-foreground hover:text-foreground"
            >
              unmute all
            </button>
          )}
        </div>
      )}

      {/* Empty */}
      {data && clusters.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {data.posts.length === 0
              ? `No catalyst posts in the last ${formatHoursAgo(hours)}. Try widening the window or lowering the score threshold.`
              : "Filters hid every post. Clear the category, subreddit, or ticker filters above to see results."}
          </CardContent>
        </Card>
      )}

      {/* Posts list */}
      {clusters.length > 0 && (
        <div className="space-y-2">
          {clusters.map((c) => {
            const p = c.lead;
            const cat = CATALYST_CATEGORIES[p.primaryCategory];
            const isExpanded = expanded.has(c.key);
            return (
              <Card key={c.key} className={cn(c.count > 1 && "border-l-2 border-l-primary/40")}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <a
                      href={p.permalink ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="text-base font-semibold leading-snug hover:text-primary"
                    >
                      {p.title}
                    </a>
                    <span
                      className="num text-xs text-muted-foreground"
                      title={scoreTooltip(p)}
                    >
                      score {p.catalyst_score.toFixed(2)} · {formatHoursAgo(p.hours_old)}
                    </span>
                  </div>
                  {/* Engagement + price reaction row */}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                    {(p.upvotes != null || p.num_comments != null) && (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        {p.upvotes != null && (
                          <span className="num" title={`${p.upvotes} upvotes`}>
                            ▲ {formatCount(p.upvotes)}
                          </span>
                        )}
                        {p.num_comments != null && (
                          <span className="num" title={`${p.num_comments} comments`}>
                            💬 {formatCount(p.num_comments)}
                          </span>
                        )}
                      </span>
                    )}
                    {p.lead_ticker && (p.return_since_post_pct != null || p.return_next_day_pct != null) && (
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          ${p.lead_ticker}
                        </span>
                        {p.return_next_day_pct != null && (
                          <span
                            className={cn("num", returnTone(p.return_next_day_pct))}
                            title={`Next-trading-day close vs close on/before post (${p.price_at_post?.toFixed(2)} → ${p.price_next_day?.toFixed(2)})`}
                          >
                            +1d {formatPct(p.return_next_day_pct)}
                          </span>
                        )}
                        {p.return_since_post_pct != null && (
                          <span
                            className={cn("num", returnTone(p.return_since_post_pct))}
                            title={`Latest close vs close on/before post (${p.price_at_post?.toFixed(2)} → ${p.price_now?.toFixed(2)})`}
                          >
                            since {formatPct(p.return_since_post_pct)}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className={cn("rounded-full px-2 py-0.5 font-semibold", cat.swatch, cat.text)}>
                      {cat.label}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5">r/{p.subreddit}</span>
                    {p.author && <span className="hidden sm:inline">u/{p.author}</span>}
                    {p.tickers.length > 0 && (
                      <span className="flex flex-wrap items-center gap-1">
                        {p.tickers.map((t) => {
                          const pinned = pinnedTickers.has(t);
                          const muted = mutedTickers.has(t);
                          return (
                            <span key={t} className="inline-flex items-center gap-0.5">
                              <Link
                                href={`/agents/${encodeURIComponent(t)}`}
                                className={cn(
                                  "rounded-full bg-primary/15 px-2 py-0.5 font-semibold text-primary hover:bg-primary/25",
                                  muted && "opacity-50 line-through",
                                  pinned && "ring-1 ring-primary",
                                )}
                              >
                                ${t}
                              </Link>
                              <button
                                onClick={() => toggleMuteTicker(t)}
                                title={muted ? "Unmute ticker" : "Mute ticker"}
                                className="text-[10px] text-muted-foreground hover:text-signal-bearish"
                              >
                                {muted ? "+" : "×"}
                              </button>
                            </span>
                          );
                        })}
                      </span>
                    )}
                    {p.keywords.length > 0 && (
                      <span className="hidden flex-wrap items-center gap-1 sm:flex">
                        {p.keywords.slice(0, 3).map((k) => (
                          <span
                            key={k}
                            className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
                          >
                            {k}
                          </span>
                        ))}
                        {p.keywords.length > 3 && (
                          <span className="text-muted-foreground">+{p.keywords.length - 3}</span>
                        )}
                      </span>
                    )}
                    {c.count > 1 && (
                      <button
                        onClick={() => toggleExpand(c.key)}
                        className="ml-auto text-primary hover:underline"
                      >
                        {isExpanded
                          ? "hide"
                          : `+${c.count - 1} similar post${c.count - 1 === 1 ? "" : "s"}`}
                      </button>
                    )}
                  </div>
                  {isExpanded && c.count > 1 && (
                    <div className="mt-3 space-y-1 border-l border-border pl-3 text-[12px]">
                      {c.members.slice(1).map((m) => (
                        <a
                          key={m.id}
                          href={m.permalink ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-muted-foreground hover:text-foreground"
                        >
                          <span className="num mr-2 text-[10px]">
                            {m.catalyst_score.toFixed(2)}
                          </span>
                          {m.title}
                          <span className="ml-2 text-[10px]">
                            r/{m.subreddit} · {formatHoursAgo(m.hours_old)}
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Auto-refreshes every 60s. Score combines keyword weight, ticker count, and recency.
        Star a ticker to pin it, × to mute. Posts persist for 7 days.
      </p>
    </div>
  );
}

type TrackRecordPanelProps = {
  data: {
    window_days: number;
    n_total_posts: number;
    n_total_with_return: number;
    overall_hit_rate: number | null;
    overall_avg_return_next_day_pct: number | null;
    categories: CategoryTrackRecord[];
  };
  onCategoryClick: (c: CatalystCategoryId) => void;
  activeCats: Set<CatalystCategoryId>;
};

// Sample-size threshold below which we caution that the number is noisy.
// 20 is a soft floor — at n<20 a binomial hit rate has a 95% CI wider than
// ±22 percentage points, which isn't useful for ranking categories.
const TRACK_RECORD_MIN_N = 20;

function TrackRecordPanel({ data, onCategoryClick, activeCats }: TrackRecordPanelProps) {
  const rows = data.categories.filter((c) => c.n_with_return > 0);
  const overallHit = data.overall_hit_rate;
  const overallRet = data.overall_avg_return_next_day_pct;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Track record · {data.window_days}d
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {data.n_total_with_return}/{data.n_total_posts} posts with a next-day close ·
          {" "}
          overall hit {overallHit == null ? "—" : `${(overallHit * 100).toFixed(0)}%`} ·
          {" "}
          avg +1d{" "}
          <span className={cn("num", returnTone(overallRet ?? null))}>
            {formatPct(overallRet)}
          </span>
        </span>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-[12px]">
            <thead className="text-[10px] uppercase text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left font-semibold">Category</th>
                <th className="px-3 py-2 text-right font-semibold">n</th>
                <th className="px-3 py-2 text-right font-semibold" title="Fraction of posts whose lead ticker closed up the next trading day">
                  Hit rate
                </th>
                <th className="px-3 py-2 text-right font-semibold" title="Mean next-trading-day return of the lead ticker">
                  Avg +1d
                </th>
                <th className="px-3 py-2 text-right font-semibold" title="Median is more robust to outliers than the mean">
                  Median +1d
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const catId = (row.category as CatalystCategoryId) in CATALYST_CATEGORIES
                  ? (row.category as CatalystCategoryId)
                  : "other";
                const cat = CATALYST_CATEGORIES[catId];
                const active = activeCats.has(catId);
                const lowN = row.n_with_return < TRACK_RECORD_MIN_N;
                return (
                  <tr
                    key={row.category}
                    className={cn(
                      "border-b border-border/40 last:border-0 hover:bg-muted/30",
                      active && "bg-primary/5",
                    )}
                  >
                    <td className="px-3 py-2">
                      <button
                        onClick={() => onCategoryClick(catId)}
                        title={`Click to ${active ? "remove" : "apply"} ${cat.label} filter`}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold transition-opacity",
                          cat.swatch,
                          cat.text,
                          !active && "opacity-80 hover:opacity-100",
                          active && "ring-1 ring-current",
                        )}
                      >
                        {cat.label}
                      </button>
                    </td>
                    <td className={cn("num px-3 py-2 text-right", lowN && "text-muted-foreground")}
                        title={lowN ? `Only ${row.n_with_return} posts — too few to trust` : undefined}>
                      {row.n_with_return}
                      {lowN && <span className="ml-1 text-[10px]">·noisy</span>}
                    </td>
                    <td className="num px-3 py-2 text-right">
                      {row.hit_rate == null ? "—" : `${(row.hit_rate * 100).toFixed(0)}%`}
                    </td>
                    <td className={cn("num px-3 py-2 text-right", returnTone(row.avg_return_next_day_pct))}>
                      {formatPct(row.avg_return_next_day_pct)}
                    </td>
                    <td className={cn("num px-3 py-2 text-right", returnTone(row.median_return_next_day_pct))}>
                      {formatPct(row.median_return_next_day_pct)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p className="text-[10px] text-muted-foreground">
        Lead-ticker return from close-on-or-before post to next trading day close.
        Baseline is ~50% hit rate / ~0% avg — buckets above that have measurable edge.
        Rows with n &lt; {TRACK_RECORD_MIN_N} are too small to trust.
      </p>
    </div>
  );
}
