"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import type { AgentKind, AgentSignalEntry, AgentsForTickerResponse } from "@/lib/types";
import { formatDate, formatNum } from "@/lib/utils";
import { AgentCard } from "@/components/agent-card";
import { ChatPanel } from "@/components/chat-panel";
import { PriceChart } from "@/components/price-chart";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SignalBadge } from "@/components/ui/badge";
import { TrendPill } from "@/components/ui/trend-pill";
import { RANGE_TO_DAYS, type TimeRange } from "@/components/ui/time-range-tabs";

const ANALYSTS = ["technicals", "fundamentals", "sentiment", "news", "flow"] as const;
const PERSONAS = [
  "buffett",
  "burry",
  "druckenmiller",
  "taleb",
  "soros",
  "simons",
  "klarman",
  "greenblatt",
  "minervini",
  "cathie_wood",
  "damodaran",
  "lynch",
  "ackman",
] as const;
const RESEARCHERS = ["bull_researcher", "bear_researcher"] as const;
const SYNTHESIS = ["trader", "risk_manager", "portfolio_manager"] as const;

const PRETTY_NAMES: Record<string, string> = {
  technicals: "Technicals",
  fundamentals: "Fundamentals",
  sentiment: "Sentiment",
  news: "News",
  flow: "Options Flow",
  buffett: "Warren Buffett",
  burry: "Michael Burry",
  druckenmiller: "Stanley Druckenmiller",
  taleb: "Nassim Taleb",
  soros: "George Soros",
  simons: "Jim Simons (quant)",
  klarman: "Seth Klarman",
  greenblatt: "Joel Greenblatt",
  minervini: "Mark Minervini",
  cathie_wood: "Cathie Wood",
  damodaran: "Aswath Damodaran",
  lynch: "Peter Lynch",
  ackman: "Bill Ackman",
  bull_researcher: "Bull Researcher",
  bear_researcher: "Bear Researcher",
  trader: "Trader",
  risk_manager: "Risk Manager",
  portfolio_manager: "Portfolio Manager",
};

function summarize(signals: AgentSignalEntry[]) {
  const counts = { bullish: 0, bearish: 0, neutral: 0 };
  for (const s of signals) counts[s.signal]++;
  return counts;
}

export function EnsembleView({ ticker }: { ticker: string }) {
  const upper = ticker.toUpperCase();
  const [activeRunTs, setActiveRunTs] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // When activeRunTs is set, poll the per-run endpoint until is_complete.
  // Otherwise fetch the latest run.
  const latest = useQuery({
    queryKey: ["agents", upper],
    queryFn: () => api.agents(upper),
    enabled: activeRunTs === null,
    retry: false,
  });

  const [range, setRange] = useState<TimeRange>("6M");
  const chart = useQuery({
    queryKey: ["chart-data", upper, range],
    queryFn: () => api.chartData(upper, RANGE_TO_DAYS[range]),
    retry: false,
    staleTime: 60_000,
  });

  const live = useQuery({
    queryKey: ["agents-run", upper, activeRunTs],
    queryFn: () => api.getRunStatus(upper, activeRunTs!),
    enabled: activeRunTs !== null,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && d.is_complete ? false : 1500;
    },
    retry: false,
  });

  const runMutation = useMutation({
    mutationFn: () => api.runEnsemble(upper),
    onSuccess: (res) => {
      setActiveRunTs(res.run_ts);
      setRunError(null);
    },
    onError: (err: Error) => {
      setRunError(err.message);
    },
  });

  const isLiveActive = activeRunTs !== null;
  const data: AgentsForTickerResponse | null = useMemo(() => {
    if (isLiveActive && live.data) {
      return {
        ticker: live.data.ticker,
        run_ts: live.data.run_ts,
        signals: live.data.signals,
      };
    }
    return latest.data ?? null;
  }, [isLiveActive, live.data, latest.data]);

  const completedCount = isLiveActive ? live.data?.completed ?? 0 : data?.signals.length ?? 0;
  const expectedTotal = isLiveActive ? live.data?.expected_total ?? 25 : 25;
  const isComplete = isLiveActive ? live.data?.is_complete ?? false : true;

  const isLoading = isLiveActive ? live.isLoading : latest.isLoading;
  const hasError = isLiveActive ? live.isError : latest.isError;

  const signals = data?.signals ?? [];
  const byAgent = new Map(signals.map((s) => [s.agent, s]));
  const counts = summarize(signals);
  const pm = byAgent.get("portfolio_manager");

  const availablePersonas = useMemo(
    () => new Set(signals.filter((s) => PERSONAS.includes(s.agent as (typeof PERSONAS)[number])).map((s) => s.agent)),
    [signals]
  );

  // Robinhood-style price header: latest close + change vs prior bar.
  const lastBar = chart.data?.bars?.[chart.data.bars.length - 1];
  const prevBar = chart.data?.bars?.[chart.data.bars.length - 2];
  const lastClose = lastBar?.close ?? null;
  const prevClose = prevBar?.close ?? null;
  const dayChange = lastClose !== null && prevClose !== null && prevClose > 0
    ? lastClose - prevClose
    : null;
  const dayChangePct = lastClose !== null && prevClose !== null && prevClose > 0
    ? lastClose / prevClose - 1
    : null;

  return (
    <div className="space-y-6">
      {/* Robinhood-style header: huge ticker + price, ▲ change pill below, run controls right-aligned. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {upper}
          </div>
          <div className="flex items-baseline gap-3">
            <span className="num text-5xl font-bold tracking-tight">
              {lastClose !== null ? `$${lastClose.toFixed(2)}` : upper}
            </span>
            {(dayChange !== null || dayChangePct !== null) && (
              <TrendPill value={dayChange} pct={dayChangePct} size="md" />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {data
              ? `${isLiveActive && !isComplete ? "Running ensemble" : "Last ensemble run"} ${formatDate(data.run_ts)} · ${completedCount}/${expectedTotal} signals`
              : isLoading
                ? "Loading…"
                : "No ensemble run yet."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card p-1 text-xs font-semibold">
            <span className="rounded-full bg-primary px-3 py-1.5 text-white">
              Grid (v1)
            </span>
            <Link
              href={`/agents/${encodeURIComponent(upper)}/v2`}
              className="rounded-full px-3 py-1.5 text-muted-foreground hover:text-foreground"
            >
              Office (v2)
            </Link>
          </div>
          {data && (
            <div className="flex items-center gap-2 text-xs">
              <SignalBadge signal="bullish" /> <span className="num">{counts.bullish}</span>
              <SignalBadge signal="neutral" /> <span className="num">{counts.neutral}</span>
              <SignalBadge signal="bearish" /> <span className="num">{counts.bearish}</span>
            </div>
          )}
          <button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending || (isLiveActive && !isComplete)}
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {runMutation.isPending
              ? "Starting…"
              : isLiveActive && !isComplete
                ? `Running ${completedCount}/${expectedTotal}…`
                : "Run ensemble"}
          </button>
        </div>
      </div>

      {runError && (
        <Card className="border-signal-bearish/30 bg-signal-bearish/5">
          <CardContent className="p-3 text-sm text-signal-bearish">{runError}</CardContent>
        </Card>
      )}

      {!isLiveActive && hasError && !data && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            No ensemble run yet for <span className="font-mono">{upper}</span>. Click{" "}
            <span className="font-medium text-foreground">Run ensemble</span> to start one — takes ~30-40s.
          </CardContent>
        </Card>
      )}

      {isLoading && !data && <EnsembleSkeleton />}

      {data && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            {chart.data && chart.data.bars.length > 0 && (
              <PriceChart
                data={chart.data}
                height={360}
                range={range}
                onRangeChange={setRange}
              />
            )}
            {pm && (() => {
              // Drive the verdict card's color from the PM's signal so the
              // user can read the call at a glance: green frame = long,
              // red = short, grey = avoid/wait. The thicker border + matching
              // tinted background also make this card visually distinct from
              // the other agent cards below.
              const verdictTone =
                pm.signal === "bullish"
                  ? "border-signal-bullish/70 bg-signal-bullish/10 ring-1 ring-signal-bullish/40"
                  : pm.signal === "bearish"
                    ? "border-signal-bearish/70 bg-signal-bearish/10 ring-1 ring-signal-bearish/40"
                    : "border-signal-neutral/60 bg-signal-neutral/10 ring-1 ring-signal-neutral/30";
              const verdictLabel =
                pm.signal === "bullish"
                  ? "LONG"
                  : pm.signal === "bearish"
                    ? "SHORT"
                    : "NO TRADE";
              return (
                <Card className={`border-2 ${verdictTone}`}>
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Portfolio Manager — final · {verdictLabel}
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <SignalBadge signal={pm.signal} />
                        <span className="text-muted-foreground">
                          conf <span className="num text-foreground">{formatNum(pm.confidence)}</span>
                        </span>
                        {typeof (pm.payload as { target_weight?: unknown })?.target_weight === "number" && (
                          <span className="text-muted-foreground">
                            weight{" "}
                            <span className="num text-foreground">
                              {formatNum((pm.payload as { target_weight: number }).target_weight, 3)}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-sm leading-relaxed">{pm.rationale}</p>
                  </CardContent>
                </Card>
              );
            })()}

            <AgentSection
              title="Synthesis"
              description="Trader → Risk Manager → Portfolio Manager (final verdict)"
              agents={SYNTHESIS}
              byAgent={byAgent}
              live={isLiveActive && !isComplete}
            />
            <AgentSection
              title="Researchers (adversarial)"
              description="Each researcher takes an assigned side and builds the strongest case — the Trader then adjudicates between them"
              agents={RESEARCHERS}
              byAgent={byAgent}
              live={isLiveActive && !isComplete}
            />
            <AgentSection
              title="Famous-investor personas"
              description="13 LLM agents reasoning from distinct investing frameworks"
              agents={PERSONAS}
              byAgent={byAgent}
              live={isLiveActive && !isComplete}
            />
            <AgentSection
              title="Quantitative analysts"
              description="Deterministic rule-based signals (technicals, fundamentals, sentiment, news)"
              agents={ANALYSTS}
              byAgent={byAgent}
              live={isLiveActive && !isComplete}
            />
          </div>

          <div className="lg:sticky lg:top-4 lg:self-start">
            <ChatPanel
              ticker={upper}
              runTs={data.run_ts}
              availableAgents={availablePersonas}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AgentSection({
  title,
  description,
  agents,
  byAgent,
  live,
}: {
  title: string;
  description: string;
  agents: readonly string[];
  byAgent: Map<string, AgentSignalEntry>;
  live: boolean;
}) {
  return (
    <section>
      <header className="mb-3">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {agents.map((name) => {
          const s = byAgent.get(name);
          if (s) {
            return (
              <div key={name} className="animate-fade-in">
                <AgentCard s={s} />
              </div>
            );
          }
          return <PendingCard key={name} name={name} live={live} />;
        })}
      </div>
    </section>
  );
}

// Agent-specific "what would this persona be doing right now" phrases.
// These rotate while the agent is thinking so each card feels alive and
// hints at the agent's actual reasoning style. Fallback used for anyone
// not listed.
const PENDING_PHRASES: Record<string, string[]> = {
  trader:            ["Scanning the tape",        "Sizing the entry",       "Reading the order book", "Adjudicating bull vs bear"],
  risk_manager:      ["Stress-testing drawdowns", "Modeling tail scenarios", "Checking correlation",   "Setting position limits"],
  portfolio_manager: ["Weighing conviction",      "Synthesizing all views",  "Sizing the position",    "Calling the trade"],
  bull_researcher:   ["Building the long thesis", "Hunting for upside",      "Modeling growth",        "Stacking the bullish case"],
  bear_researcher:   ["Looking for cracks",       "Modeling the downside",   "Hunting for red flags",  "Stacking the bearish case"],
  buffett:           ["Calculating intrinsic value", "Checking moat strength", "Reading the 10-K",     "Measuring margin of safety"],
  burry:             ["Reading 10-K footnotes",   "Hunting for accounting tricks", "Modeling tail risk", "Counting shorts"],
  druckenmiller:     ["Watching central banks",   "Reading the macro tape",  "Sizing a top-down bet"],
  taleb:             ["Modeling fat tails",       "Pricing convexity",       "Stress-testing extremes"],
  soros:             ["Looking for reflexivity",  "Hunting for the inflection", "Reading market psychology"],
  simons:            ["Running the model",        "Crunching the factors",   "Backtesting signals"],
  klarman:           ["Measuring margin of safety", "Reading the balance sheet", "Hunting for mispricings"],
  greenblatt:        ["Ranking on ROIC",          "Sorting by earnings yield", "Running the Magic Formula"],
  minervini:         ["Checking the trend template", "Watching volume thrust", "Looking for VCP setups"],
  cathie_wood:       ["Modeling S-curves",        "Sizing disruption",       "Forecasting TAM"],
  damodaran:         ["Building the DCF",         "Stress-testing assumptions", "Computing cost of capital"],
  lynch:             ["Looking for ten-baggers",  "Walking the mall",        "Checking PEG"],
  ackman:            ["Building the activist case", "Stress-testing the franchise", "Pressuring management"],
  technicals:        ["Computing RSI / MACD",     "Reading the chart",       "Scanning support/resistance"],
  fundamentals:      ["Pulling the 10-Q",         "Modeling growth",         "Reading the footnotes"],
  sentiment:         ["Reading social posts",     "Measuring crowd mood",    "Counting bullish mentions"],
  news:              ["Scanning headlines",       "Reading press releases",  "Weighing the catalysts"],
  flow:              ["Watching options flow",    "Tracking dark pool prints", "Sizing unusual activity"],
};
const DEFAULT_PHRASES = ["Reading the data", "Building the thesis", "Weighing the evidence", "Drafting the call"];

const PENDING_EMOJI: Record<string, string> = {
  trader: "🧠", risk_manager: "🧯", portfolio_manager: "👔",
  bull_researcher: "🐂", bear_researcher: "🐻",
  buffett: "👴", burry: "🥸", druckenmiller: "🤵", taleb: "🧔", soros: "🧓",
  simons: "👨‍🔬", klarman: "👨‍💼", greenblatt: "🤓", minervini: "💪",
  cathie_wood: "👩‍💻", damodaran: "👨‍🏫", lynch: "🧑‍💼", ackman: "👨‍⚖️",
  technicals: "📈", fundamentals: "📊", sentiment: "💬", news: "📰", flow: "🌊",
};

function PendingCard({ name, live }: { name: string; live: boolean }) {
  const phrases = PENDING_PHRASES[name] ?? DEFAULT_PHRASES;
  const emoji = PENDING_EMOJI[name] ?? "🤔";
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  // Only spin the rotators while live — keep the card cheap when idle.
  useEffect(() => {
    if (!live) {
      startedAt.current = null;
      setElapsed(0);
      return;
    }
    startedAt.current = performance.now();
    const phraseId = window.setInterval(() => {
      setPhraseIdx((i) => (i + 1) % phrases.length);
    }, 2200);
    const tickId = window.setInterval(() => {
      if (startedAt.current !== null) {
        setElapsed(Math.floor((performance.now() - startedAt.current) / 1000));
      }
    }, 250);
    return () => {
      window.clearInterval(phraseId);
      window.clearInterval(tickId);
    };
  }, [live, phrases.length]);

  if (!live) {
    // Idle (between runs, or never run) — keep it quiet.
    return (
      <div className="flex h-full min-h-[176px] flex-col rounded-lg border border-dashed bg-muted/20 p-4">
        <div className="text-sm font-semibold text-muted-foreground">
          {PRETTY_NAMES[name] ?? name}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          No signal yet — run the ensemble to wake this agent up.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-[176px] flex-col overflow-hidden rounded-lg border border-dashed border-primary/30 bg-gradient-to-br from-primary/[0.06] via-card to-card p-4">
      {/* Subtle scanning shimmer to imply work in progress */}
      <div className="pointer-events-none absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-primary/[0.08] to-transparent" />
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg animate-bounce-slow" aria-hidden>
            {emoji}
          </span>
          <div className="text-sm font-semibold text-foreground">
            {PRETTY_NAMES[name] ?? name}
          </div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          thinking · {elapsed}s
        </span>
      </div>

      {/* Rotating status line — fades in/out as it cycles */}
      <div className="relative mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span key={phraseIdx} className="animate-fade-in italic">
          {phrases[phraseIdx]}
        </span>
        <span className="inline-flex">
          {[0, 1, 2].map((d) => (
            <span
              key={d}
              className="animate-pulse"
              style={{ animationDelay: `${d * 0.2}s` }}
            >
              .
            </span>
          ))}
        </span>
      </div>

      {/* Pretend "tokens streaming" lines — they cycle width to feel alive */}
      <div className="relative mt-auto space-y-2 pt-4">
        <div className="h-2 w-full animate-pulse rounded bg-muted" />
        <div
          className="h-2 animate-pulse rounded bg-muted"
          style={{ width: `${50 + ((phraseIdx * 17) % 40)}%` }}
        />
        <div
          className="h-2 animate-pulse rounded bg-muted"
          style={{ width: `${30 + ((phraseIdx * 23) % 50)}%` }}
        />
      </div>
    </div>
  );
}

function EnsembleSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
    </div>
  );
}
