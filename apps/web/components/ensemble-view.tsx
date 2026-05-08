"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AgentKind, AgentSignalEntry } from "@/lib/types";
import { formatDate, formatNum } from "@/lib/utils";
import { AgentCard } from "@/components/agent-card";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SignalBadge } from "@/components/ui/badge";

const KIND_ORDER: { kind: AgentKind; label: string; description: string }[] = [
  {
    kind: "synthesis",
    label: "Synthesis",
    description: "Trader → Risk Manager → Portfolio Manager (final verdict)",
  },
  {
    kind: "persona",
    label: "Famous-investor personas",
    description: "13 LLM agents reasoning from distinct investing frameworks",
  },
  {
    kind: "analyst",
    label: "Quantitative analysts",
    description: "Deterministic rule-based signals (technicals, fundamentals, sentiment, news)",
  },
];

function summarize(signals: AgentSignalEntry[]) {
  const counts = { bullish: 0, bearish: 0, neutral: 0 };
  for (const s of signals) counts[s.signal]++;
  return counts;
}

export function EnsembleView({ ticker }: { ticker: string }) {
  const upper = ticker.toUpperCase();
  const { data, isLoading, error } = useQuery({
    queryKey: ["agents", upper],
    queryFn: () => api.agents(upper),
  });

  if (isLoading) return <EnsembleSkeleton />;

  if (error || !data) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          No agent ensemble run found for <span className="font-mono">{upper}</span>. Run{" "}
          <code className="rounded bg-muted px-1">make ensemble TICKER={upper}</code> on the backend, then refresh.
        </CardContent>
      </Card>
    );
  }

  const counts = summarize(data.signals);
  const grouped: Record<AgentKind, AgentSignalEntry[]> = {
    analyst: [],
    persona: [],
    synthesis: [],
    unknown: [],
  };
  for (const s of data.signals) grouped[s.kind].push(s);

  // Order synthesis nodes deterministically: trader, risk_manager, portfolio_manager
  grouped.synthesis.sort((a, b) => {
    const order = ["trader", "risk_manager", "portfolio_manager"];
    return order.indexOf(a.agent) - order.indexOf(b.agent);
  });

  // PM headline (if present)
  const pm = grouped.synthesis.find((s) => s.agent === "portfolio_manager");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{upper}</h1>
          <p className="text-sm text-muted-foreground">
            Last ensemble run {formatDate(data.run_ts)} · {data.signals.length} signals
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <SignalBadge signal="bullish" /> <span className="num">{counts.bullish}</span>
          <SignalBadge signal="neutral" /> <span className="num">{counts.neutral}</span>
          <SignalBadge signal="bearish" /> <span className="num">{counts.bearish}</span>
        </div>
      </div>

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

      {KIND_ORDER.map(({ kind, label, description }) => {
        const items = grouped[kind];
        if (!items || items.length === 0) return null;
        return (
          <section key={kind}>
            <header className="mb-3">
              <h2 className="text-lg font-semibold tracking-tight">{label}</h2>
              <p className="text-xs text-muted-foreground">{description}</p>
            </header>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((s) => (
                <AgentCard key={s.agent} s={s} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function EnsembleSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
    </div>
  );
}
