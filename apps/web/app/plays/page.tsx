"use client";

/**
 * Plays tab — Falcon-style live-plays feed. Cards render currently-armed
 * tracked plays (BEAR_RUG / BEAR_TRAPDOOR / BEAR_CONTINUE / BEAR_OVERNIGHT /
 * BULL_REVERSE) with entry mark, live mark, best mark, and % gain.
 *
 * Data sources (all under /v1/plays):
 *   GET /v1/plays/live?ticker=SPXW   — currently open cards
 *   GET /v1/plays/today?date=...     — today's board (open + closed)
 *   GET /v1/plays/summary/today      — header stats
 *
 * Auto-refresh: live plays every 15s (match the tracker poll cadence),
 * today's board every 60s.
 */

import * as React from "react";
import { baseUrl, authHeaders } from "@/lib/api";
import { cn } from "@/lib/utils";

type Tab = "live" | "today";

interface PlayCard {
  play_id: number;
  fire_ts_ms: number;
  trading_day: string;
  ticker: string;
  state: string;
  pattern_name: string;
  option_symbol: string;
  option_type: "put" | "call";
  strike: number;
  expiration: string;
  spot_at_fire: number;
  entry_mark: number;
  entry_bid: number | null;
  entry_ask: number | null;
  current_mark: number | null;
  current_ts_ms: number | null;
  best_mark: number | null;
  best_mark_ts_ms: number | null;
  best_pct_gain: number | null;
  status: string;
  close_ts_ms: number | null;
  close_mark: number | null;
  close_reason: string | null;
  supporting_state: Record<string, unknown> | null;
}

interface PlaysSummary {
  trading_day: string;
  total: number;
  live: number;
  closed: number;
  best_gain_pct: number | null;
  avg_best_gain_pct: number | null;
}

export default function PlaysPage() {
  const [tab, setTab] = React.useState<Tab>("live");
  const [ticker, setTicker] = React.useState<string | null>(null);
  const [live, setLive] = React.useState<PlayCard[]>([]);
  const [today, setToday] = React.useState<PlayCard[]>([]);
  const [summary, setSummary] = React.useState<PlaysSummary | null>(null);
  const [loading, setLoading] = React.useState(false);

  const fetchLive = React.useCallback(async () => {
    const url = `${baseUrl()}/v1/plays/live${ticker ? `?ticker=${ticker}` : ""}`;
    const r = await fetch(url, { headers: authHeaders() });
    if (r.ok) setLive(await r.json());
  }, [ticker]);

  const fetchToday = React.useCallback(async () => {
    const url = `${baseUrl()}/v1/plays/today${ticker ? `?ticker=${ticker}` : ""}`;
    const r = await fetch(url, { headers: authHeaders() });
    if (r.ok) setToday(await r.json());
  }, [ticker]);

  const fetchSummary = React.useCallback(async () => {
    const r = await fetch(`${baseUrl()}/v1/plays/summary/today`, { headers: authHeaders() });
    if (r.ok) setSummary(await r.json());
  }, []);

  React.useEffect(() => {
    setLoading(true);
    Promise.all([fetchLive(), fetchToday(), fetchSummary()]).finally(() => setLoading(false));
  }, [fetchLive, fetchToday, fetchSummary]);

  React.useEffect(() => {
    const liveTimer = setInterval(fetchLive, 15_000);
    const todayTimer = setInterval(fetchToday, 60_000);
    const summaryTimer = setInterval(fetchSummary, 60_000);
    return () => {
      clearInterval(liveTimer);
      clearInterval(todayTimer);
      clearInterval(summaryTimer);
    };
  }, [fetchLive, fetchToday, fetchSummary]);

  const cards = tab === "live" ? live : today;

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <Header summary={summary} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-full bg-foreground/[0.03] p-1 text-sm">
          <TabButton active={tab === "live"} onClick={() => setTab("live")}>
            Live {live.length > 0 && <Badge>{live.length}</Badge>}
          </TabButton>
          <TabButton active={tab === "today"} onClick={() => setTab("today")}>
            Today
          </TabButton>
        </div>
        <TickerFilter value={ticker} onChange={setTicker} />
      </div>

      {loading && cards.length === 0 ? (
        <div className="rounded-lg border border-foreground/10 p-8 text-center text-sm text-muted-foreground">
          Loading plays…
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-lg border border-foreground/10 p-8 text-center text-sm text-muted-foreground">
          {tab === "live" ? "No live plays right now. Watching state machine." : "No plays yet today."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {cards.map((c) => (
            <PlayCardView key={c.play_id} card={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function Header({ summary }: { summary: PlaysSummary | null }) {
  if (!summary) return <h1 className="text-xl font-semibold">Plays</h1>;
  const best = summary.best_gain_pct != null ? Math.round(summary.best_gain_pct * 100) : null;
  const avg = summary.avg_best_gain_pct != null ? Math.round(summary.avg_best_gain_pct * 100) : null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
      <h1 className="text-xl font-semibold">Plays · {summary.trading_day}</h1>
      <div className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{summary.total}</span> total ·{" "}
        <span className="text-emerald-600">{summary.live}</span> live ·{" "}
        <span>{summary.closed}</span> closed
      </div>
      {best !== null && (
        <div className="text-sm text-muted-foreground">
          best <span className="font-medium text-emerald-600">+{best}%</span>
          {avg !== null && (
            <>
              {" "}· avg <span className="font-medium text-foreground">+{avg}%</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-4 py-1.5 transition-colors",
        active ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500/20 px-1 text-[10px] font-semibold text-emerald-700">
      {children}
    </span>
  );
}

const TICKERS = ["SPXW", "SPY", "QQQ"];
function TickerFilter({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-foreground/[0.03] p-1 text-sm">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          "rounded-full px-3 py-1",
          value === null ? "bg-foreground/10 text-foreground" : "text-muted-foreground",
        )}
      >
        All
      </button>
      {TICKERS.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={cn(
            "rounded-full px-3 py-1",
            value === t ? "bg-foreground/10 text-foreground" : "text-muted-foreground",
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function PlayCardView({ card }: { card: PlayCard }) {
  const gain = card.best_pct_gain != null ? Math.round(card.best_pct_gain * 100) : null;
  const currentGain =
    card.current_mark != null ? Math.round(((card.current_mark - card.entry_mark) / card.entry_mark) * 100) : null;
  const isLive = card.status === "live";
  const fireTime = new Date(card.fire_ts_ms).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const stateColor = {
    BEAR_RUG: "bg-red-500/10 text-red-700 border-red-500/30",
    BEAR_TRAPDOOR: "bg-orange-500/10 text-orange-700 border-orange-500/30",
    BEAR_CONTINUE: "bg-amber-500/10 text-amber-700 border-amber-500/30",
    BEAR_OVERNIGHT: "bg-rose-500/10 text-rose-700 border-rose-500/30",
    BULL_REVERSE: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  }[card.state] ?? "bg-foreground/5 text-foreground border-foreground/10";

  return (
    <div className={cn(
      "flex flex-col gap-2 rounded-xl border p-3",
      isLive ? "border-foreground/10 bg-background" : "border-foreground/5 bg-foreground/[0.02]",
    )}>
      <div className="flex items-center justify-between text-xs">
        <span className={cn("rounded-md border px-2 py-0.5 font-medium", stateColor)}>
          {card.state}
        </span>
        <span className="text-muted-foreground">{fireTime}</span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-lg font-semibold">{card.ticker}</span>
        <span className="text-sm text-muted-foreground">
          ${card.strike.toFixed(card.strike < 100 ? 2 : 0)}
          {card.option_type === "put" ? "P" : "C"} · {card.expiration.slice(5)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Entry" value={`$${card.entry_mark.toFixed(2)}`} />
        <Stat
          label="Now"
          value={card.current_mark != null ? `$${card.current_mark.toFixed(2)}` : "—"}
          delta={currentGain}
        />
        <Stat
          label="Best"
          value={card.best_mark != null ? `$${card.best_mark.toFixed(2)}` : "—"}
          delta={gain}
          emphasize
        />
      </div>

      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>pattern: {card.pattern_name}</span>
        <span>spot@fire ${card.spot_at_fire.toFixed(2)}</span>
      </div>

      {!isLive && card.close_reason && (
        <div className="text-[11px] text-muted-foreground">
          closed · {card.close_reason}
          {card.close_mark != null && ` @ $${card.close_mark.toFixed(2)}`}
        </div>
      )}
    </div>
  );
}

function Stat({
  label, value, delta, emphasize,
}: {
  label: string;
  value: string;
  delta?: number | null;
  emphasize?: boolean;
}) {
  const deltaColor = delta == null ? "" : delta >= 0 ? "text-emerald-600" : "text-red-600";
  return (
    <div className="flex flex-col rounded-md bg-foreground/[0.03] px-2 py-1.5">
      <span className="text-[10px] uppercase text-muted-foreground">{label}</span>
      <span className={cn("font-medium", emphasize && "text-base font-semibold")}>{value}</span>
      {delta != null && (
        <span className={cn("text-[10px] font-medium", deltaColor)}>
          {delta >= 0 ? "+" : ""}{delta}%
        </span>
      )}
    </div>
  );
}
