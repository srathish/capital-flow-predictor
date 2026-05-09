"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AgentKind, AgentSignalEntry, AgentsForTickerResponse } from "@/lib/types";
import { formatDate, formatNum } from "@/lib/utils";
import { AgentCard } from "@/components/agent-card";
import { ChatPanel } from "@/components/chat-panel";
import { PriceChart } from "@/components/price-chart";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SignalBadge } from "@/components/ui/badge";

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

  const chart = useQuery({
    queryKey: ["chart-data", upper],
    queryFn: () => api.chartData(upper, 180),
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
  const expectedTotal = isLiveActive ? live.data?.expected_total ?? 21 : 21;
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{upper}</h1>
          <p className="text-sm text-muted-foreground">
            {data
              ? `${isLiveActive && !isComplete ? "Running" : "Last run"} ${formatDate(data.run_ts)} · ${completedCount}/${expectedTotal} signals`
              : isLoading
                ? "Loading…"
                : "No ensemble run yet."}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          {data && (
            <div className="flex items-center gap-2 text-sm">
              <SignalBadge signal="bullish" /> <span className="num">{counts.bullish}</span>
              <SignalBadge signal="neutral" /> <span className="num">{counts.neutral}</span>
              <SignalBadge signal="bearish" /> <span className="num">{counts.bearish}</span>
            </div>
          )}
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
              <PriceChart data={chart.data} height={360} />
            )}
            {pm && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Portfolio Manager — final
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
            )}

            <AgentSection
              title="Synthesis"
              description="Trader → Risk Manager → Portfolio Manager (final verdict)"
              agents={SYNTHESIS}
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

function PendingCard({ name, live }: { name: string; live: boolean }) {
  return (
    <div className="flex h-full min-h-[176px] flex-col rounded-lg border border-dashed bg-muted/20 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-muted-foreground">
          {PRETTY_NAMES[name] ?? name}
        </div>
        {live && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            thinking
          </span>
        )}
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-2 w-full animate-pulse rounded bg-muted" />
        <div className="h-2 w-4/5 animate-pulse rounded bg-muted" />
        <div className="h-2 w-3/5 animate-pulse rounded bg-muted" />
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
