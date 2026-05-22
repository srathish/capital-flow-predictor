"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { baseUrl, authHeaders } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TickerDossierSheet } from "@/components/ticker-dossier-sheet";

// /explosive is the "Board" surface — daily-ish scored shortlist of
// catalyst-aware setups, organized as thesis cards (not a table).
// Each card stands alone as a "would I trade this?" decision: catalyst
// countdown, score + sub-score sparkbar, Phase-2 confirmation chips,
// suggested trade structure, and a Dossier slide-over for verify-and-back.

const REFETCH_MS = 60_000;

type ExplosiveSubScores = {
  flow_concentration: number;
  iv_term: number;
  squeeze: number;
  catalyst: number;
  cheap_optionality: number;
  gex_bonus: number;
  // Phase 2 confirmation signals (0 = absent, > 0 = confirming)
  iv_vs_rv?: number;
  skew_flip?: number;
  nope?: number;
  insider_buy?: number;
  volume_profile?: number;
};

type FunnelStages = {
  stage1_passed: boolean;
  stage2_passed: boolean;
  stage3_passed: boolean;
  stage4_passed: boolean;
  stage5_passed: boolean;
  stages_passed: number;
  reasons: Record<string, string>;
};

type ExplosiveItem = {
  ticker: string;
  score: number;
  catalyst_type: string | null;
  catalyst_date: string | null;
  catalyst_label: string | null;
  days_to_catalyst: number | null;
  underlying_price: number | null;
  top_option_symbol: string | null;
  top_option_type: string | null;
  top_strike: number | null;
  top_expiry: string | null;
  top_last_price: number | null;
  top_volume: number | null;
  top_open_interest: number | null;
  top_premium: number | null;
  sub_scores: ExplosiveSubScores;
  stages?: FunnelStages;
  signals: Record<string, string>;
};

const STAGE_LABELS: { key: keyof FunnelStages; label: string }[] = [
  { key: "stage1_passed", label: "screener" },
  { key: "stage2_passed", label: "flow" },
  { key: "stage3_passed", label: "positioning" },
  { key: "stage4_passed", label: "catalyst" },
  { key: "stage5_passed", label: "squeeze" },
];

function FunnelStageRow({ stages }: { stages: FunnelStages | undefined }) {
  if (!stages) return null;
  const n = stages.stages_passed ?? 0;
  const flame = n >= 5 ? "🔥 " : n >= 4 ? "⚡ " : "";
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
      {STAGE_LABELS.map(({ key, label }) => {
        const ok = Boolean(stages[key]);
        const reasonKey = label;
        const why = stages.reasons?.[reasonKey];
        return (
          <span
            key={key}
            title={why ?? (ok ? "passed" : "did not pass")}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
              ok ? "bg-emerald-500/15 text-emerald-300" : "bg-muted/60 text-muted-foreground",
            )}
          >
            {ok ? "✓" : "—"} {label}
          </span>
        );
      })}
      <span
        className={cn(
          "ml-1 font-medium",
          n >= 5 ? "text-amber-300" : n >= 4 ? "text-primary" : n >= 3 ? "text-emerald-300" : "text-muted-foreground",
        )}
      >
        {flame}
        {n} / 5 stages
      </span>
    </div>
  );
}

type ExplosiveFeedResponse = {
  snapshot_ts: string | null;
  count: number;
  items: ExplosiveItem[];
};

type CatalystFilter = "all" | "earnings" | "fda" | "ipo";

const CATALYST_LABELS: Record<CatalystFilter, string> = {
  all: "All catalysts",
  earnings: "Earnings",
  fda: "FDA",
  ipo: "IPO",
};

async function fetchExplosive(filter: CatalystFilter, minScore: number): Promise<ExplosiveFeedResponse> {
  const sp = new URLSearchParams();
  sp.set("limit", "80");
  if (minScore > 0) sp.set("min_score", String(minScore));
  if (filter !== "all") sp.set("catalyst_type", filter);
  const res = await fetch(`${baseUrl()}/v1/explosive?${sp}`, {
    headers: { Accept: "application/json", ...authHeaders() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as ExplosiveFeedResponse;
}

function formatPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v < 100) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(0)}`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
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

function catalystChipColor(type: string | null): string {
  if (type === "earnings") return "bg-primary/15 text-primary";
  if (type === "fda") return "bg-rose-500/15 text-rose-400";
  if (type === "ipo") return "bg-sky-500/15 text-sky-400";
  return "bg-muted text-muted-foreground";
}

function daysLabel(d: number | null): string {
  if (d === null) return "—";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  return `in ${d}d`;
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 55) return "text-amber-400";
  if (score >= 35) return "text-foreground";
  return "text-muted-foreground";
}

function scoreBarColor(score: number): string {
  if (score >= 75) return "bg-emerald-500";
  if (score >= 55) return "bg-amber-500";
  if (score >= 35) return "bg-foreground/60";
  return "bg-muted-foreground/40";
}

// ---- Catalyst-day buckets (the "Board" grouping) ----

type BucketKey = "imminent" | "this_week" | "next_two_weeks" | "later";

const BUCKETS: { key: BucketKey; label: string; match: (d: number | null) => boolean; tone: string }[] = [
  {
    key: "imminent",
    label: "Today / tomorrow",
    match: (d) => d !== null && d <= 1,
    tone: "text-amber-300",
  },
  {
    key: "this_week",
    label: "This week",
    match: (d) => d !== null && d > 1 && d <= 7,
    tone: "text-primary",
  },
  {
    key: "next_two_weeks",
    label: "Next 2 weeks",
    match: (d) => d !== null && d > 7 && d <= 14,
    tone: "text-foreground",
  },
  {
    key: "later",
    label: "Later / no catalyst",
    match: (d) => d === null || d > 14,
    tone: "text-muted-foreground",
  },
];

// ---- Sub-score sparkbar ----

const SUB_LABELS: { key: keyof ExplosiveSubScores; label: string }[] = [
  { key: "flow_concentration", label: "flow" },
  { key: "iv_term", label: "ivterm" },
  { key: "squeeze", label: "squeeze" },
  { key: "catalyst", label: "cat" },
  { key: "cheap_optionality", label: "cheap" },
  { key: "gex_bonus", label: "gex" },
];

function SubScoreSparkbar({ sub }: { sub: ExplosiveSubScores }) {
  // Each sub-score is normalised 0-1 roughly. Render as a horizontal series
  // of tiny labeled bars showing where the headline score came from.
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-1 sm:grid-cols-6">
      {SUB_LABELS.map(({ key, label }) => {
        const raw = sub[key] ?? 0;
        const pct = Math.max(0, Math.min(100, raw * 100));
        return (
          <div key={key} className="flex flex-col">
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
            <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full", pct >= 60 ? "bg-emerald-500" : pct >= 30 ? "bg-amber-500" : "bg-muted-foreground/40")}
                style={{ width: `${Math.max(4, pct)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Phase-2 confirmation chips ----

const CONFIRMATION_KEYS: { key: keyof ExplosiveSubScores; label: string; tip: string }[] = [
  { key: "iv_vs_rv", label: "IV vs RV", tip: "Implied vol elevated vs realized — options pricing event move" },
  { key: "skew_flip", label: "skew flip", tip: "25Δ risk-reversal skew has flipped recently — options market repositioned" },
  { key: "nope", label: "NOPE", tip: "Net Options Pricing Effect favors the setup direction" },
  { key: "insider_buy", label: "insider buy", tip: "Recent insider buying detected" },
  { key: "volume_profile", label: "volume", tip: "Volume profile out of the ordinary" },
];

function ConfirmationChips({ sub }: { sub: ExplosiveSubScores }) {
  const confirmed = CONFIRMATION_KEYS.filter((c) => (sub[c.key] ?? 0) > 0);
  const total = CONFIRMATION_KEYS.length;
  const n = confirmed.length;
  const flame = n >= 4 ? "🔥 " : "";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {CONFIRMATION_KEYS.map((c) => {
        const active = (sub[c.key] ?? 0) > 0;
        return (
          <span
            key={c.key}
            title={c.tip}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
              active
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-muted/60 text-muted-foreground line-through",
            )}
          >
            {active && "✓ "}
            {c.label}
          </span>
        );
      })}
      <span
        className={cn(
          "ml-1 text-[10px]",
          n >= 4 ? "font-semibold text-amber-300" : n >= 3 ? "text-emerald-300" : "text-muted-foreground",
        )}
      >
        {flame}
        {n} / {total} confirmations
      </span>
    </div>
  );
}

// ---- Setup card ----

function SetupCard({ item, onOpen }: { item: ExplosiveItem; onOpen: (t: string) => void }) {
  const pct = Math.max(2, Math.min(100, item.score));
  const optType = item.top_option_type === "call" ? "C" : item.top_option_type === "put" ? "P" : "";
  const cheap = (item.top_last_price ?? Infinity) <= 0.75;
  return (
    <Card className="border border-border/60 transition-colors hover:border-primary/40">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <button
                type="button"
                onClick={() => onOpen(item.ticker)}
                className="text-xl font-semibold tracking-tight hover:text-primary"
              >
                {item.ticker}
              </button>
              {item.catalyst_label && (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs",
                    catalystChipColor(item.catalyst_type),
                  )}
                >
                  ⚡ {item.catalyst_label} · {daysLabel(item.days_to_catalyst)}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                spot {formatPrice(item.underlying_price)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn("font-mono text-2xl font-semibold tabular-nums", scoreColor(item.score))}>
              {item.score.toFixed(0)}
            </span>
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full", scoreBarColor(item.score))} style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>

        {/* Top contract line */}
        {(item.top_strike != null && item.top_expiry) && (
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="font-mono text-foreground">
              ${item.top_strike.toFixed(item.top_strike < 10 ? 1 : 0)}
              {optType} {item.top_expiry}
            </span>
            {item.top_last_price != null && (
              <span className={cn("ml-2", cheap && "font-semibold text-emerald-400")}>
                @ {formatPrice(item.top_last_price)}
                {cheap && " · cheap"}
              </span>
            )}
            {item.top_volume != null && (
              <span className="ml-2">
                vol {item.top_volume.toLocaleString()}
                {item.top_open_interest != null && ` / OI ${item.top_open_interest.toLocaleString()}`}
              </span>
            )}
          </p>
        )}

        {/* Sub-score sparkbar */}
        <div className="mt-3">
          <SubScoreSparkbar sub={item.sub_scores} />
        </div>

        {/* Confirmation chips */}
        <div className="mt-3">
          <ConfirmationChips sub={item.sub_scores} />
        </div>

        {/* Funnel stages (Phase B): visible 5-stage pass/fail */}
        <div className="mt-3">
          <FunnelStageRow stages={item.stages} />
        </div>

        {/* Signals (engine evidence) */}
        {Object.keys(item.signals).length > 0 && (
          <ul className="mt-3 space-y-0.5 text-[11px] text-muted-foreground">
            {Object.entries(item.signals).slice(0, 4).map(([k, v]) => (
              <li key={k}>
                <span className="text-foreground/70">{k.replace(/_/g, " ")}:</span> {v}
              </li>
            ))}
          </ul>
        )}

        {/* Actions */}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpen(item.ticker)}
            className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground"
          >
            Open dossier ▸
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Page ----

export default function ExplosivePage() {
  const [filter, setFilter] = useState<CatalystFilter>("all");
  const [minScore, setMinScore] = useState(0);
  const [dossierTicker, setDossierTicker] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["explosive", filter, minScore],
    queryFn: () => fetchExplosive(filter, minScore),
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: false,
  });

  const bucketed = useMemo(() => {
    const out = new Map<BucketKey, ExplosiveItem[]>();
    BUCKETS.forEach((b) => out.set(b.key, []));
    for (const item of data?.items ?? []) {
      const b = BUCKETS.find((b) => b.match(item.days_to_catalyst));
      if (b) out.get(b.key)!.push(item);
    }
    return out;
  }, [data]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Board — Explosive setups</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Catalyst-aware shortlist. Each card is a thesis: catalyst countdown +
            sub-score breakdown + Phase-2 confirmation chips + suggested trade.
            4/5 confirmations 🔥 with a catalyst in ≤7d and sub-$1 optionality =
            the 1→100x template.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Snapshot: {data?.snapshot_ts ? `${formatRelative(data.snapshot_ts)} (${new Date(data.snapshot_ts).toLocaleString()})` : "—"} · {data?.count ?? 0} setups
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-9 rounded-full border border-border bg-card px-4 text-sm hover:border-primary/60 disabled:opacity-50"
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Filter row */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(Object.keys(CATALYST_LABELS) as CatalystFilter[]).map((k) => {
          const active = filter === k;
          return (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={cn(
                "h-8 rounded-full px-3 text-xs transition-colors",
                active
                  ? "bg-primary/15 text-primary"
                  : "border border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {CATALYST_LABELS[k]}
            </button>
          );
        })}
        <div className="ml-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span>min score</span>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="h-1.5 w-32"
          />
          <span className="w-8 text-foreground">{minScore}</span>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="p-6 text-sm text-rose-400">
            Failed to load: {(error as Error)?.message ?? "unknown"}
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && data && data.items.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No scored setups yet. Run <code className="rounded bg-muted px-1.5 py-0.5">cfp-jobs explosive-ingest</code> then <code className="rounded bg-muted px-1.5 py-0.5">cfp-jobs explosive-score</code> to populate.
          </CardContent>
        </Card>
      )}

      {/* Catalyst-day grouped feed */}
      {!isLoading && !isError && data && data.items.length > 0 && (
        <div className="space-y-6">
          {BUCKETS.map((b) => {
            const items = bucketed.get(b.key) ?? [];
            if (items.length === 0) return null;
            return (
              <section key={b.key}>
                <header className="mb-2 flex items-baseline justify-between border-b border-border/40 pb-1">
                  <h2 className={cn("text-xs font-medium uppercase tracking-wider", b.tone)}>
                    {b.label}{" "}
                    <span className="text-muted-foreground">({items.length})</span>
                  </h2>
                </header>
                <div className="grid grid-cols-1 gap-3">
                  {items.map((item) => (
                    <SetupCard
                      key={item.ticker}
                      item={item}
                      onOpen={(t) => setDossierTicker(t)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <TickerDossierSheet
        ticker={dossierTicker}
        open={dossierTicker !== null}
        onClose={() => setDossierTicker(null)}
      />
    </div>
  );
}
