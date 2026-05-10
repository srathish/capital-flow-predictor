"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Office v2 — Smallville-style top-down view of the agent ensemble.
 *
 * Layout (single floor plan, 16:9):
 *   - Analyst Pit       (5 quantitative analysts)
 *   - Persona Hall      (13 famous-investor personas wander here)
 *   - Bull Office       (bull_researcher)
 *   - Bear Office       (bear_researcher)
 *   - Synthesis Desk    (trader -> risk_manager -> portfolio_manager)
 *
 * Each agent is a colored disc with their initials. Discs wander randomly
 * inside their assigned room (new target every 2-4s, CSS transition animates
 * the move). Hover shows a speech bubble with the thesis. Click pops a modal.
 *
 * Shares the same data model as v1 (`api.agents`, `api.runEnsemble`,
 * `api.getRunStatus`) so the run controls and live polling are identical.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AgentSignalEntry, AgentsForTickerResponse, SignalKind } from "@/lib/types";
import { SignalBadge } from "@/components/ui/badge";

// ---- Agent roster (same order/keys as v1 ensemble-view) ----

type RoomKey = "analysts" | "personas" | "bull" | "bear" | "synthesis";

interface AgentMeta {
  id: string;
  initials: string;
  display: string;
  emoji: string;
  room: RoomKey;
}

const AGENTS: AgentMeta[] = [
  // Analyst Pit
  { id: "technicals",        initials: "TC", display: "Technicals",        emoji: "📈", room: "analysts" },
  { id: "fundamentals",      initials: "FN", display: "Fundamentals",      emoji: "📊", room: "analysts" },
  { id: "sentiment",         initials: "SE", display: "Sentiment",         emoji: "💬", room: "analysts" },
  { id: "news",              initials: "NW", display: "News",              emoji: "📰", room: "analysts" },
  { id: "flow",              initials: "FL", display: "Flow",              emoji: "🌊", room: "analysts" },
  // Persona Hall
  { id: "buffett",           initials: "WB", display: "Buffett",           emoji: "🧓", room: "personas" },
  { id: "burry",             initials: "MB", display: "Burry",             emoji: "🥁", room: "personas" },
  { id: "druckenmiller",     initials: "SD", display: "Druckenmiller",     emoji: "🌍", room: "personas" },
  { id: "taleb",             initials: "NT", display: "Taleb",             emoji: "🦢", room: "personas" },
  { id: "soros",             initials: "GS", display: "Soros",             emoji: "♻️", room: "personas" },
  { id: "simons",            initials: "JS", display: "Simons",            emoji: "🧮", room: "personas" },
  { id: "klarman",           initials: "SK", display: "Klarman",           emoji: "🛡️", room: "personas" },
  { id: "greenblatt",        initials: "JG", display: "Greenblatt",        emoji: "✨", room: "personas" },
  { id: "minervini",         initials: "MM", display: "Minervini",         emoji: "📐", room: "personas" },
  { id: "cathie_wood",       initials: "CW", display: "Cathie Wood",       emoji: "🚀", room: "personas" },
  { id: "damodaran",         initials: "AD", display: "Damodaran",         emoji: "📚", room: "personas" },
  { id: "lynch",             initials: "PL", display: "Lynch",             emoji: "🛒", room: "personas" },
  { id: "ackman",            initials: "BA", display: "Ackman",            emoji: "📣", room: "personas" },
  // Researcher offices
  { id: "bull_researcher",   initials: "🐂", display: "Bull Researcher",   emoji: "🐂", room: "bull" },
  { id: "bear_researcher",   initials: "🐻", display: "Bear Researcher",   emoji: "🐻", room: "bear" },
  // Synthesis desk
  { id: "trader",            initials: "TR", display: "Trader",            emoji: "🎯", room: "synthesis" },
  { id: "risk_manager",      initials: "RM", display: "Risk Manager",      emoji: "🛟", room: "synthesis" },
  { id: "portfolio_manager", initials: "PM", display: "Portfolio Mgr",     emoji: "👔", room: "synthesis" },
];

// Room layout — percentages of the office canvas. Each room is a rectangle
// in (x%, y%, w%, h%). Synthesis spans the bottom; analysts left column;
// personas center; bull/bear stacked on the right.
const ROOMS: Record<RoomKey, { x: number; y: number; w: number; h: number; label: string }> = {
  analysts:  { x:  1, y:  1, w: 22, h: 75, label: "Analyst Pit" },
  personas:  { x: 24, y:  1, w: 50, h: 75, label: "Persona Hall" },
  bull:      { x: 75, y:  1, w: 24, h: 37, label: "Bull Office" },
  bear:      { x: 75, y: 39, w: 24, h: 37, label: "Bear Office" },
  synthesis: { x:  1, y: 77, w: 98, h: 22, label: "Synthesis Desk" },
};

// ---- Movement state ----

interface AgentPos {
  // Position is in PERCENT of the OFFICE canvas (not the room) so we can
  // render every disc in the same coordinate space.
  x: number;
  y: number;
}

function randomPosInRoom(room: RoomKey, padding = 6): AgentPos {
  const r = ROOMS[room];
  const x = r.x + padding + Math.random() * Math.max(0, r.w - padding * 2);
  const y = r.y + padding + Math.random() * Math.max(0, r.h - padding * 2);
  return { x, y };
}

// ---- The component ----

export function OfficeView({ ticker }: { ticker: string }) {
  const upper = ticker.toUpperCase();
  const [activeRunTs, setActiveRunTs] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Fetch latest or live run — same shape as v1.
  const latest = useQuery({
    queryKey: ["agents", upper],
    queryFn: () => api.agents(upper),
    enabled: activeRunTs === null,
    retry: false,
  });
  const live = useQuery({
    queryKey: ["agents-run", upper, activeRunTs],
    queryFn: () => api.getRunStatus(upper, activeRunTs!),
    enabled: activeRunTs !== null,
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && d.is_complete ? false : 1500;
    },
    retry: false,
  });
  const runMutation = useMutation({
    mutationFn: () => api.runEnsemble(upper),
    onSuccess: (res: any) => {
      setActiveRunTs(res.run_ts);
      setRunError(null);
    },
    onError: (err: Error) => setRunError(err.message),
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

  const expectedTotal = isLiveActive ? live.data?.expected_total ?? 23 : 23;
  const completedCount = isLiveActive
    ? live.data?.completed ?? 0
    : data?.signals.length ?? 0;
  const isComplete = isLiveActive ? live.data?.is_complete ?? false : true;

  const byAgent = useMemo(
    () => new Map((data?.signals ?? []).map((s) => [s.agent, s])),
    [data]
  );

  // ---- Wandering animation ----
  // Each agent owns a target position. Every 2-4s we re-pick a target. CSS
  // transition (transform + ~3s ease) handles the actual interpolation.
  const [positions, setPositions] = useState<Record<string, AgentPos>>(() => {
    const init: Record<string, AgentPos> = {};
    for (const a of AGENTS) init[a.id] = randomPosInRoom(a.room);
    return init;
  });
  const tickRef = useRef<number | null>(null);
  useEffect(() => {
    function tick() {
      setPositions((prev) => {
        const next = { ...prev };
        for (const a of AGENTS) {
          if (Math.random() < 0.55) next[a.id] = randomPosInRoom(a.room);
        }
        return next;
      });
      tickRef.current = window.setTimeout(tick, 2200 + Math.random() * 1800);
    }
    tickRef.current = window.setTimeout(tick, 800);
    return () => {
      if (tickRef.current) window.clearTimeout(tickRef.current);
    };
  }, []);

  // Bullish/bearish/neutral color, or pulsing blue if no signal yet.
  function discClasses(sig: AgentSignalEntry | undefined, live: boolean): string {
    if (!sig) {
      return live
        ? "bg-primary/30 text-primary ring-2 ring-primary/40 animate-pulse"
        : "bg-muted/40 text-muted-foreground ring-1 ring-border";
    }
    const m: Record<SignalKind, string> = {
      bullish: "bg-signal-bullish text-white ring-2 ring-signal-bullish/60",
      bearish: "bg-signal-bearish text-white ring-2 ring-signal-bearish/60",
      neutral: "bg-muted text-foreground ring-1 ring-border",
    };
    return m[sig.signal];
  }

  const selectedAgent = selectedId
    ? AGENTS.find((a) => a.id === selectedId)
    : null;
  const selectedSignal = selectedAgent ? byAgent.get(selectedAgent.id) : undefined;

  const counts = useMemo(() => {
    const c = { bullish: 0, bearish: 0, neutral: 0 };
    for (const s of data?.signals ?? []) c[s.signal]++;
    return c;
  }, [data]);

  return (
    <div className="space-y-4">
      {/* Header — mirrors v1 controls plus a v1<->v2 toggle */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {upper} · Office View
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Smallville</h1>
          <p className="text-xs text-muted-foreground">
            {data
              ? `${isLiveActive && !isComplete ? "Running" : "Last run"} · ${completedCount}/${expectedTotal} agents in`
              : "No ensemble run yet."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card p-1 text-xs font-semibold">
            <Link
              href={`/agents/${encodeURIComponent(upper)}`}
              className="rounded-full px-3 py-1.5 text-muted-foreground hover:text-foreground"
            >
              Grid (v1)
            </Link>
            <span className="rounded-full bg-primary px-3 py-1.5 text-white">
              Office (v2)
            </span>
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
        <div className="rounded-lg border border-signal-bearish/30 bg-signal-bearish/5 p-3 text-sm text-signal-bearish">
          {runError}
        </div>
      )}

      {/* Office floor plan — 16:9 canvas. */}
      <div
        className="relative w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card to-background"
        style={{ aspectRatio: "16 / 9" }}
      >
        {/* Subtle grid backdrop — pixel-art floor tile feel. */}
        <div
          className="absolute inset-0 opacity-[0.10] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        {/* Rooms */}
        {(Object.entries(ROOMS) as [RoomKey, (typeof ROOMS)[RoomKey]][]).map(
          ([key, r]) => (
            <div
              key={key}
              className="absolute rounded-lg border border-dashed border-border/70 bg-background/30"
              style={{
                left: `${r.x}%`,
                top: `${r.y}%`,
                width: `${r.w}%`,
                height: `${r.h}%`,
              }}
            >
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {r.label}
              </div>
            </div>
          )
        )}

        {/* Agents — absolutely positioned, smooth-transition movement. */}
        {AGENTS.map((a) => {
          const sig = byAgent.get(a.id);
          const pos = positions[a.id];
          const isSelected = selectedId === a.id;
          const isHovered = hoveredId === a.id;
          const isLive = isLiveActive && !isComplete && !sig;
          return (
            <button
              key={a.id}
              type="button"
              onMouseEnter={() => setHoveredId(a.id)}
              onMouseLeave={() => setHoveredId((h) => (h === a.id ? null : h))}
              onClick={() => setSelectedId(a.id)}
              className={cn(
                "absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-bold shadow-lg transition-all duration-[2800ms] ease-in-out hover:scale-110 hover:z-20",
                discClasses(sig, isLive),
                isSelected && "scale-125 ring-4 ring-primary/70 z-30"
              )}
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              title={a.display}
            >
              <span className="leading-none">{a.initials}</span>

              {/* Speech bubble on hover */}
              {isHovered && sig?.rationale && (
                <div className="absolute -top-2 left-1/2 z-40 w-72 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-card p-3 text-left text-xs shadow-xl">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      {a.emoji} {a.display}
                    </span>
                    <SignalBadge signal={sig.signal} />
                  </div>
                  <p className="line-clamp-4 leading-snug text-muted-foreground">
                    {sig.rationale}
                  </p>
                  <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    conf <span className="num text-foreground">{sig.confidence.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Live "thinking" tag */}
              {isLive && (
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold uppercase text-primary">
                  thinking…
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend + selected-agent detail */}
      <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-lg border border-border bg-card p-3 text-xs">
          <div className="mb-2 font-semibold uppercase tracking-wide text-muted-foreground">
            Legend
          </div>
          <div className="space-y-1.5">
            <LegendDot color="bg-signal-bullish" label="Bullish signal in" />
            <LegendDot color="bg-signal-bearish" label="Bearish signal in" />
            <LegendDot color="bg-muted" label="Neutral / no edge" />
            <LegendDot color="bg-primary/30 ring-2 ring-primary/40 animate-pulse" label="Thinking (live run)" />
            <LegendDot color="bg-muted/40" label="Pending — no signal yet" />
          </div>
          <p className="mt-3 text-muted-foreground">
            Hover any agent for their thesis · click for full detail.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 text-sm">
          {selectedAgent ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-base font-semibold">
                  {selectedAgent.emoji} {selectedAgent.display}
                </div>
                {selectedSignal && (
                  <div className="flex items-center gap-2 text-xs">
                    <SignalBadge signal={selectedSignal.signal} />
                    <span className="text-muted-foreground">
                      conf <span className="num text-foreground">{selectedSignal.confidence.toFixed(2)}</span>
                    </span>
                  </div>
                )}
              </div>
              {selectedSignal?.rationale ? (
                <p className="leading-relaxed text-muted-foreground">{selectedSignal.rationale}</p>
              ) : (
                <p className="text-muted-foreground">
                  No signal yet for this agent on this run.{" "}
                  {isLiveActive && !isComplete && "Still thinking…"}
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">
              Click an agent in the office to read their full thesis here.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("inline-block h-3 w-3 rounded-full", color)} />
      <span className="text-foreground">{label}</span>
    </div>
  );
}
