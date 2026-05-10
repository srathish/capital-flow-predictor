"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Office v3 — isometric "sims" view of the agent ensemble.
 *
 * Top-down 2.5D office rendered as a single SVG scene. World is a tile grid
 * projected to screen with iso(x, y, z). Each agent is a tiny walking person
 * (head, torso, legs, shadow) wandering inside an assigned room, on top of
 * an actual floor plan with desks, tables, chairs, plants, and a kitchen
 * counter — the same Sims-style office the user can peek into and click on.
 *
 * Data wiring (api.agents, runEnsemble, getRunStatus, signal colors, hover
 * speech bubble, click-to-detail panel) is unchanged from v2.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AgentSignalEntry, AgentsForTickerResponse, SignalKind } from "@/lib/types";
import { SignalBadge } from "@/components/ui/badge";

// ────────────────────────────────────────────────────────────────────────────
// Agent roster
// ────────────────────────────────────────────────────────────────────────────

type RoomKey = "analysts" | "personas" | "bull" | "bear" | "synthesis";

interface AgentMeta {
  id: string;
  initials: string;
  display: string;
  emoji: string;
  room: RoomKey;
}

const AGENTS: AgentMeta[] = [
  // Analyst Pit — quants at workstations
  { id: "technicals",        initials: "TC", display: "Technicals",        emoji: "👨‍💻", room: "analysts" },
  { id: "fundamentals",      initials: "FN", display: "Fundamentals",      emoji: "👨‍🔬", room: "analysts" },
  { id: "sentiment",         initials: "SE", display: "Sentiment",         emoji: "🧐",   room: "analysts" },
  { id: "news",              initials: "NW", display: "News",              emoji: "🤳",   room: "analysts" },
  { id: "flow",              initials: "FL", display: "Flow",              emoji: "🕵️",   room: "analysts" },
  // Persona Hall — investors mingling between tables in the open atrium
  { id: "buffett",           initials: "WB", display: "Buffett",           emoji: "👴",   room: "personas" },
  { id: "burry",             initials: "MB", display: "Burry",             emoji: "🥸",   room: "personas" },
  { id: "druckenmiller",     initials: "SD", display: "Druckenmiller",     emoji: "🤵",   room: "personas" },
  { id: "taleb",             initials: "NT", display: "Taleb",             emoji: "🧔",   room: "personas" },
  { id: "soros",             initials: "GS", display: "Soros",             emoji: "🧓",   room: "personas" },
  { id: "simons",            initials: "JS", display: "Simons",            emoji: "👨‍🔬", room: "personas" },
  { id: "klarman",           initials: "SK", display: "Klarman",           emoji: "👨‍💼", room: "personas" },
  { id: "greenblatt",        initials: "JG", display: "Greenblatt",        emoji: "🤓",   room: "personas" },
  { id: "minervini",         initials: "MM", display: "Minervini",         emoji: "💪",   room: "personas" },
  { id: "cathie_wood",       initials: "CW", display: "Cathie Wood",       emoji: "👩‍💻", room: "personas" },
  { id: "damodaran",         initials: "AD", display: "Damodaran",         emoji: "👨‍🏫", room: "personas" },
  { id: "lynch",             initials: "PL", display: "Lynch",             emoji: "🧑‍💼", room: "personas" },
  { id: "ackman",            initials: "BA", display: "Ackman",            emoji: "👨‍⚖️", room: "personas" },
  // Researcher offices — private rooms
  { id: "bull_researcher",   initials: "BU", display: "Bull Researcher",   emoji: "🐂",   room: "bull" },
  { id: "bear_researcher",   initials: "BE", display: "Bear Researcher",   emoji: "🐻",   room: "bear" },
  // Synthesis kitchen / counter — execs working at the long bar
  { id: "trader",            initials: "TR", display: "Trader",            emoji: "🧠",   room: "synthesis" },
  { id: "risk_manager",      initials: "RM", display: "Risk Manager",      emoji: "🧯",   room: "synthesis" },
  { id: "portfolio_manager", initials: "PM", display: "Portfolio Mgr",     emoji: "👔",   room: "synthesis" },
];

// ────────────────────────────────────────────────────────────────────────────
// World + iso projection
// ────────────────────────────────────────────────────────────────────────────

// Tile grid in world units. iso() maps a tile point (x, y, z) onto the SVG
// plane. We pick TILE_W:TILE_H = 16:9 so the projected world matches the
// container's 16:9 aspect ratio with no letterboxing.
const TILE_W = 16;
const TILE_H = 9;
const WALL_H = 26;     // wall-top z (in screen units, not tiles)
const FLOOR_Z = 0;

function iso(x: number, y: number, z = 0): { sx: number; sy: number } {
  return {
    sx: (x - y) * TILE_W,
    sy: (x + y) * TILE_H - z,
  };
}

// World rectangle (tile coords). Rooms partition it.
const WORLD_W = 100;
const WORLD_H = 56;

interface RoomRect {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  floor: string;       // floor color
  floorEdge: string;   // outline / grout color
}

const ROOMS: Record<RoomKey, RoomRect> = {
  analysts:  { x:  2, y:  2, w: 26, h: 22, label: "Analyst Pit",    floor: "#1d2230", floorEdge: "#2a3142" },
  synthesis: { x:  2, y: 26, w: 26, h: 28, label: "Synthesis Kitchen", floor: "#23202a", floorEdge: "#2f2a36" },
  personas:  { x: 30, y:  2, w: 38, h: 52, label: "Persona Hall",   floor: "#2a2632", floorEdge: "#37313f" },
  bull:      { x: 70, y:  2, w: 28, h: 24, label: "Bull Office",    floor: "#1c2a26", floorEdge: "#264039" },
  bear:      { x: 70, y: 28, w: 28, h: 26, label: "Bear Office",    floor: "#2a1d20", floorEdge: "#3a2629" },
};

// ────────────────────────────────────────────────────────────────────────────
// Furniture
// ────────────────────────────────────────────────────────────────────────────

type FurnitureKind =
  | "desk"          // long monitor desk for analysts
  | "table"         // round restaurant table
  | "chair"         // dining chair
  | "exec_desk"     // big executive desk
  | "exec_chair"    // executive chair
  | "bookshelf"     // bookshelf (back wall)
  | "plant"         // potted plant
  | "counter"       // long kitchen / synthesis counter
  | "stool"         // bar stool
  | "rug";          // floor rug accent

interface Furniture {
  kind: FurnitureKind;
  x: number;        // tile x (footprint center, in world coords)
  y: number;        // tile y
  rot?: 0 | 1;      // 0 = facing front-right, 1 = rotated 90°
}

// Hand-placed furniture per room. Coordinates chosen to leave clean walking
// lanes for the wandering sims.
const FURNITURE: Furniture[] = [
  // ───── Analyst Pit ─────
  { kind: "rug",  x: 14, y: 14 },
  { kind: "desk", x:  8, y:  8 },
  { kind: "desk", x:  8, y: 14 },
  { kind: "desk", x:  8, y: 20 },
  { kind: "desk", x: 22, y:  8 },
  { kind: "desk", x: 22, y: 14 },
  { kind: "desk", x: 22, y: 20 },
  { kind: "plant", x:  4, y:  4 },
  { kind: "plant", x: 26, y:  4 },

  // ───── Synthesis Kitchen ─────
  // Long counter island — three execs work along the bar.
  { kind: "counter", x:  6, y: 36 },
  { kind: "counter", x: 14, y: 36 },
  { kind: "counter", x: 22, y: 36 },
  { kind: "stool",   x:  6, y: 42 },
  { kind: "stool",   x: 14, y: 42 },
  { kind: "stool",   x: 22, y: 42 },
  { kind: "plant",   x:  4, y: 30 },
  { kind: "plant",   x: 26, y: 30 },
  { kind: "plant",   x:  4, y: 50 },
  { kind: "plant",   x: 26, y: 50 },

  // ───── Persona Hall (the restaurant atrium) ─────
  // Round tables in a 2x4 grid with chairs around each.
  ...buildPersonaTables(),

  // ───── Bull Office ─────
  { kind: "rug",        x: 84, y: 14 },
  { kind: "exec_desk",  x: 84, y: 12 },
  { kind: "exec_chair", x: 84, y:  8 },
  { kind: "bookshelf",  x: 74, y:  6 },
  { kind: "plant",      x: 95, y:  5 },
  { kind: "plant",      x: 95, y: 22 },

  // ───── Bear Office ─────
  { kind: "rug",        x: 84, y: 40 },
  { kind: "exec_desk",  x: 84, y: 38 },
  { kind: "exec_chair", x: 84, y: 34 },
  { kind: "bookshelf",  x: 74, y: 32 },
  { kind: "plant",      x: 95, y: 31 },
  { kind: "plant",      x: 95, y: 50 },
];

function buildPersonaTables(): Furniture[] {
  const out: Furniture[] = [];
  // 4 rows × 2 cols of tables.
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 2; col++) {
      const tx = 38 + col * 18;
      const ty = 8 + row * 12;
      out.push({ kind: "table", x: tx, y: ty });
      // 4 chairs around each table
      out.push({ kind: "chair", x: tx - 3, y: ty });
      out.push({ kind: "chair", x: tx + 3, y: ty });
      out.push({ kind: "chair", x: tx,     y: ty - 3 });
      out.push({ kind: "chair", x: tx,     y: ty + 3 });
    }
  }
  // a couple of plants in the corners
  out.push({ kind: "plant", x: 33, y:  4 });
  out.push({ kind: "plant", x: 65, y:  4 });
  out.push({ kind: "plant", x: 33, y: 51 });
  out.push({ kind: "plant", x: 65, y: 51 });
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Wandering motion
// ────────────────────────────────────────────────────────────────────────────

interface AgentPos {
  x: number;
  y: number;
}

function randomPosInRoom(room: RoomKey, padding = 4): AgentPos {
  const r = ROOMS[room];
  const x = r.x + padding + Math.random() * Math.max(0, r.w - padding * 2);
  const y = r.y + padding + Math.random() * Math.max(0, r.h - padding * 2);
  return { x, y };
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export function OfficeView({ ticker }: { ticker: string }) {
  const upper = ticker.toUpperCase();
  const [activeRunTs, setActiveRunTs] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Data fetch — same as v2.
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

  // Wander targets — re-pick every 2-4s, CSS transition animates the move.
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

  const counts = useMemo(() => {
    const c = { bullish: 0, bearish: 0, neutral: 0 };
    for (const s of data?.signals ?? []) c[s.signal]++;
    return c;
  }, [data]);

  const selectedAgent = selectedId ? AGENTS.find((a) => a.id === selectedId) : null;
  const selectedSignal = selectedAgent ? byAgent.get(selectedAgent.id) : undefined;

  // ───── Z-order: combine furniture + agents and sort back-to-front ─────
  const renderables = useMemo(() => {
    type Item =
      | { kind: "furn"; f: Furniture; depth: number }
      | { kind: "agent"; a: AgentMeta; pos: AgentPos; depth: number };
    const items: Item[] = [];
    for (const f of FURNITURE) {
      // rugs render under everything else regardless of x+y
      const depth = f.kind === "rug" ? -1e6 + (f.x + f.y) : f.x + f.y;
      items.push({ kind: "furn", f, depth });
    }
    for (const a of AGENTS) {
      const p = positions[a.id];
      items.push({ kind: "agent", a, pos: p, depth: p.x + p.y + 0.5 });
    }
    items.sort((a, b) => a.depth - b.depth);
    return items;
  }, [positions]);

  // ───── World viewBox bounds (the fully-zoomed-out "home" view) ─────
  // Iso bounds: sx ∈ [(0 − WORLD_H)·TW, WORLD_W·TW]
  //             sy ∈ [0, (WORLD_W + WORLD_H)·TH]
  const home = useMemo(() => {
    const minSx = (0 - WORLD_H) * TILE_W;
    const maxSx = WORLD_W * TILE_W;
    const minSy = -WALL_H - 30; // headroom for walls + sim heads
    const maxSy = (WORLD_W + WORLD_H) * TILE_H + 40;
    return { x: minSx, y: minSy, w: maxSx - minSx, h: maxSy - minSy };
  }, []);

  // ───── Pan + zoom ─────
  // The SVG viewBox is driven by `view`. Wheel zooms (anchored to cursor),
  // pointer-drag on the background pans. Sim clicks are suppressed for
  // ~120ms after a real pan so a click-release at the end of a drag does
  // not accidentally select a sim.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState(home);
  const dragRef = useRef<{ px: number; py: number; vx: number; vy: number; moved: boolean } | null>(null);
  const justPannedRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const ZOOM_MIN = 0.1; // smallest viewBox = 10% of home (deepest zoom-in)
  const ZOOM_MAX = 1.0; // largest = home (cannot zoom out past full plan)

  // Wheel: scroll up = zoom in (anchored to cursor). Attached natively so we
  // can preventDefault — React's wheel handlers are passive by default.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      setView((v) => {
        const factor = Math.exp(e.deltaY * 0.0015);
        const ratio = home.h / home.w;
        let newW = v.w * factor;
        // Clamp to [home.w * ZOOM_MIN, home.w * ZOOM_MAX]
        newW = Math.min(home.w * ZOOM_MAX, Math.max(home.w * ZOOM_MIN, newW));
        const newH = newW * ratio;
        // Anchor: keep the world point under the cursor stationary
        const wx = v.x + px * v.w;
        const wy = v.y + py * v.h;
        let nx = wx - px * newW;
        let ny = wy - py * newH;
        // Clamp panning so we cannot scroll the world off screen
        nx = Math.min(home.x + home.w - newW, Math.max(home.x, nx));
        ny = Math.min(home.y + home.h - newH, Math.max(home.y, ny));
        return { x: nx, y: ny, w: newW, h: newH };
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [home]);

  // Pointer drag → pan
  useEffect(() => {
    function move(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = e.clientX - d.px;
      const dy = e.clientY - d.py;
      if (!d.moved && Math.hypot(dx, dy) > 4) {
        d.moved = true;
        setIsDragging(true);
      }
      if (!d.moved) return;
      setView((v) => {
        let nx = d.vx - (dx / rect.width) * v.w;
        let ny = d.vy - (dy / rect.height) * v.h;
        nx = Math.min(home.x + home.w - v.w, Math.max(home.x, nx));
        ny = Math.min(home.y + home.h - v.h, Math.max(home.y, ny));
        return { ...v, x: nx, y: ny };
      });
    }
    function up() {
      const d = dragRef.current;
      dragRef.current = null;
      if (d?.moved) {
        // Suppress the upcoming click so we don't select a sim by accident.
        justPannedRef.current = true;
        setTimeout(() => { justPannedRef.current = false; }, 120);
      }
      setIsDragging(false);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [home]);

  function onSvgPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    // Start drag from any pointer-down on the SVG. If the user clicks a sim,
    // they release at <4px and the click fires normally.
    dragRef.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y, moved: false };
  }

  function zoomBy(factor: number) {
    setView((v) => {
      const ratio = home.h / home.w;
      let newW = v.w * factor;
      newW = Math.min(home.w * ZOOM_MAX, Math.max(home.w * ZOOM_MIN, newW));
      const newH = newW * ratio;
      // Anchor zoom on the center of the current view.
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      let nx = cx - newW / 2;
      let ny = cy - newH / 2;
      nx = Math.min(home.x + home.w - newW, Math.max(home.x, nx));
      ny = Math.min(home.y + home.h - newH, Math.max(home.y, ny));
      return { x: nx, y: ny, w: newW, h: newH };
    });
  }

  const zoomPct = Math.round((home.w / view.w) * 100);

  return (
    <div className="space-y-4">
      {/* Header ─ same controls as v2 */}
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

      {/* Iso office canvas — 16:9 */}
      <div
        className="relative w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-[#0d0e14] via-[#0a0b10] to-[#06070b] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)]"
        style={{ aspectRatio: "16 / 9" }}
      >
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={onSvgPointerDown}
          className="h-full w-full select-none touch-none"
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
        >
          <defs>
            {/* Floor highlight gradient — top of each tile is slightly lighter */}
            <linearGradient id="floor-sheen" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="white" stopOpacity="0.04" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </linearGradient>
            {/* Shadow under each agent */}
            <radialGradient id="sim-shadow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="black" stopOpacity="0.55" />
              <stop offset="100%" stopColor="black" stopOpacity="0" />
            </radialGradient>
            {/* Plant fronds */}
            <radialGradient id="plant-frond" cx="50%" cy="35%" r="60%">
              <stop offset="0%" stopColor="#5cd28a" />
              <stop offset="60%" stopColor="#2d8a52" />
              <stop offset="100%" stopColor="#1b5734" />
            </radialGradient>
            {/* Glass wall (subtle blue tint) */}
            <linearGradient id="glass-wall" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#7cc9ff" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#5b87b8" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* Pass 1: floors */}
          {(Object.entries(ROOMS) as [RoomKey, RoomRect][]).map(([key, r]) => (
            <Floor key={key} room={r} />
          ))}

          {/* Pass 2: back walls of each room (rendered before contents so
              furniture/sims occlude them naturally) */}
          {(Object.entries(ROOMS) as [RoomKey, RoomRect][]).map(([key, r]) => (
            <RoomWalls key={key} room={r} kind={key} />
          ))}

          {/* Pass 3: room labels (etched into the floor near the back-left) */}
          {(Object.entries(ROOMS) as [RoomKey, RoomRect][]).map(([key, r]) => {
            const p = iso(r.x + 1.5, r.y + 1.5, 1);
            return (
              <text
                key={`label-${key}`}
                x={p.sx}
                y={p.sy}
                fontSize="11"
                fontWeight="700"
                letterSpacing="2"
                fill="rgba(255,255,255,0.22)"
                style={{ textTransform: "uppercase" }}
              >
                {r.label}
              </text>
            );
          })}

          {/* Pass 4: furniture + sims in painter's order */}
          {renderables.map((it, idx) => {
            if (it.kind === "furn") {
              return <FurnitureNode key={`f-${idx}`} f={it.f} />;
            }
            const sig = byAgent.get(it.a.id);
            const isLive = isLiveActive && !isComplete && !sig;
            return (
              <Sim
                key={it.a.id}
                agent={it.a}
                pos={it.pos}
                signal={sig}
                live={isLive}
                hovered={hoveredId === it.a.id}
                selected={selectedId === it.a.id}
                onHover={(h) => setHoveredId(h ? it.a.id : null)}
                onClick={() => {
                  if (justPannedRef.current) return;
                  setSelectedId(it.a.id);
                }}
              />
            );
          })}
        </svg>

        {/* Zoom controls — top-right of the canvas. */}
        <div className="pointer-events-none absolute right-3 top-3 z-20 flex flex-col items-end gap-1.5">
          <div className="pointer-events-auto flex items-center overflow-hidden rounded-lg border border-border bg-card/90 text-sm font-semibold shadow backdrop-blur">
            <button
              type="button"
              onClick={() => zoomBy(0.7)}
              className="px-2.5 py-1 text-foreground hover:bg-accent disabled:opacity-40"
              disabled={view.w <= home.w * ZOOM_MIN + 0.5}
              aria-label="Zoom in"
              title="Zoom in"
            >
              +
            </button>
            <span className="border-l border-border px-2 py-1 text-xs tabular-nums text-muted-foreground">
              {zoomPct}%
            </span>
            <button
              type="button"
              onClick={() => zoomBy(1 / 0.7)}
              className="border-l border-border px-2.5 py-1 text-foreground hover:bg-accent disabled:opacity-40"
              disabled={view.w >= home.w * ZOOM_MAX - 0.5}
              aria-label="Zoom out"
              title="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setView(home)}
              className="border-l border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Reset view"
              title="Reset view"
            >
              reset
            </button>
          </div>
          <div className="pointer-events-none rounded-md bg-card/80 px-2 py-0.5 text-[10px] text-muted-foreground shadow backdrop-blur">
            scroll to zoom · drag to pan
          </div>
        </div>

        {/* Tooltip overlay anchored above the hovered sim. Rendered as
            absolutely-positioned HTML so it can use Tailwind. */}
        {hoveredId && (() => {
          const a = AGENTS.find((x) => x.id === hoveredId);
          const sig = a ? byAgent.get(a.id) : undefined;
          if (!a || !sig?.rationale) return null;
          const p = positions[a.id];
          const { sx, sy } = iso(p.x, p.y, 36);
          // Convert iso (sx, sy) to a percentage of the *current* SVG view,
          // so the bubble tracks the sim while the user pans/zooms.
          const left = ((sx - view.x) / view.w) * 100;
          const top = ((sy - view.y) / view.h) * 100;
          // Hide the bubble if the sim is offscreen.
          if (left < 0 || left > 100 || top < 0 || top > 100) return null;
          return (
            <div
              className="pointer-events-none absolute z-30 w-72 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-card p-3 text-xs shadow-xl"
              style={{ left: `${left}%`, top: `${top}%` }}
            >
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
          );
        })()}
      </div>

      {/* Legend + selected-agent detail panel */}
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
            Hover any sim for their thesis · click for full detail.
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
              Click a sim in the office to read their full thesis here.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components: floor, walls, furniture, sim
// ────────────────────────────────────────────────────────────────────────────

function isoPoly(corners: [number, number, number][]): string {
  return corners
    .map(([x, y, z]) => {
      const p = iso(x, y, z);
      return `${p.sx},${p.sy}`;
    })
    .join(" ");
}

/** A single room floor — flat parallelogram at z=0 with a sheen overlay. */
function Floor({ room }: { room: RoomRect }) {
  const pts = isoPoly([
    [room.x,           room.y,           FLOOR_Z],
    [room.x + room.w,  room.y,           FLOOR_Z],
    [room.x + room.w,  room.y + room.h,  FLOOR_Z],
    [room.x,           room.y + room.h,  FLOOR_Z],
  ]);
  return (
    <g>
      <polygon points={pts} fill={room.floor} stroke={room.floorEdge} strokeWidth="1.2" />
      <polygon points={pts} fill="url(#floor-sheen)" />
    </g>
  );
}

/** Two back walls (left and top edges of the room). Front-facing walls are
 *  omitted so we can "look in" from the camera angle. */
function RoomWalls({ room, kind }: { room: RoomRect; kind: RoomKey }) {
  // Left wall (along y=room.y, spans x in [room.x, room.x + room.w])
  const leftWall = isoPoly([
    [room.x,          room.y, FLOOR_Z],
    [room.x + room.w, room.y, FLOOR_Z],
    [room.x + room.w, room.y, WALL_H],
    [room.x,          room.y, WALL_H],
  ]);
  // Right wall (along x=room.x, spans y in [room.y, room.y + room.h])
  const rightWall = isoPoly([
    [room.x, room.y,          FLOOR_Z],
    [room.x, room.y + room.h, FLOOR_Z],
    [room.x, room.y + room.h, WALL_H],
    [room.x, room.y,          WALL_H],
  ]);
  // Glass for the bull/bear offices, opaque for the rest.
  const glass = kind === "bull" || kind === "bear";
  const fillL = glass ? "url(#glass-wall)" : "rgba(255,255,255,0.04)";
  const fillR = glass ? "url(#glass-wall)" : "rgba(0,0,0,0.25)";
  const stroke = "rgba(255,255,255,0.10)";
  return (
    <g>
      <polygon points={leftWall} fill={fillL} stroke={stroke} strokeWidth="0.8" />
      <polygon points={rightWall} fill={fillR} stroke={stroke} strokeWidth="0.8" />
      {/* Top capping line on each wall to suggest depth */}
      {(() => {
        const a = iso(room.x, room.y, WALL_H);
        const b = iso(room.x + room.w, room.y, WALL_H);
        const c = iso(room.x, room.y + room.h, WALL_H);
        return (
          <>
            <line x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
            <line x1={a.sx} y1={a.sy} x2={c.sx} y2={c.sy} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
          </>
        );
      })()}
    </g>
  );
}

/** Iso cuboid (a box footprint in tile coords with a height in screen units).
 *  Renders top + two visible side faces. */
function IsoBox({
  x, y, w, h, height,
  top = "#3a3a48",
  left = "#272731",
  right = "#1d1d27",
  stroke = "rgba(0,0,0,0.4)",
}: {
  x: number; y: number; w: number; h: number; height: number;
  top?: string; left?: string; right?: string; stroke?: string;
}) {
  const topFace = isoPoly([
    [x,     y,     height],
    [x + w, y,     height],
    [x + w, y + h, height],
    [x,     y + h, height],
  ]);
  const leftFace = isoPoly([
    [x,     y + h, 0],
    [x + w, y + h, 0],
    [x + w, y + h, height],
    [x,     y + h, height],
  ]);
  const rightFace = isoPoly([
    [x + w, y,     0],
    [x + w, y + h, 0],
    [x + w, y + h, height],
    [x + w, y,     height],
  ]);
  return (
    <g>
      <polygon points={leftFace}  fill={left}  stroke={stroke} strokeWidth="0.6" />
      <polygon points={rightFace} fill={right} stroke={stroke} strokeWidth="0.6" />
      <polygon points={topFace}   fill={top}   stroke={stroke} strokeWidth="0.6" />
    </g>
  );
}

function FurnitureNode({ f }: { f: Furniture }) {
  switch (f.kind) {
    case "rug": {
      // Soft accent rug under desks/exec rooms — flat, slightly inset.
      const pts = isoPoly([
        [f.x - 6, f.y - 5, 0.2],
        [f.x + 6, f.y - 5, 0.2],
        [f.x + 6, f.y + 5, 0.2],
        [f.x - 6, f.y + 5, 0.2],
      ]);
      return <polygon points={pts} fill="rgba(116,82,160,0.12)" stroke="rgba(116,82,160,0.25)" strokeWidth="0.6" />;
    }
    case "desk": {
      // Long desk + 2 monitors + a chair tucked behind.
      return (
        <g>
          <IsoBox x={f.x - 2.5} y={f.y - 1} w={5} h={2} height={6} top="#3a3441" left="#26222b" right="#1a171d" />
          {/* Monitors */}
          <IsoBox x={f.x - 2}   y={f.y - 0.6} w={1.4} h={0.4} height={11} top="#0e1218" left="#0a0d12" right="#070a0e" />
          <IsoBox x={f.x + 0.6} y={f.y - 0.6} w={1.4} h={0.4} height={11} top="#0e1218" left="#0a0d12" right="#070a0e" />
          {/* Chair */}
          <IsoBox x={f.x - 0.7} y={f.y + 1.4} w={1.4} h={1.4} height={5} top="#4d3744" left="#3a2832" right="#2a1f25" />
        </g>
      );
    }
    case "table": {
      // Round restaurant table — disc on a pedestal.
      const top = iso(f.x, f.y, 5);
      return (
        <g>
          <IsoBox x={f.x - 0.4} y={f.y - 0.4} w={0.8} h={0.8} height={5} top="#2c2630" left="#1f1b22" right="#15131a" />
          <ellipse cx={top.sx} cy={top.sy} rx={2.0 * TILE_W} ry={2.0 * TILE_H} fill="#1a1820" stroke="#3b3340" strokeWidth="0.8" />
          {/* Place setting hint — small white plates */}
          <ellipse cx={top.sx - 16} cy={top.sy - 4} rx="4" ry="2" fill="#e8e3dc" opacity="0.85" />
          <ellipse cx={top.sx + 16} cy={top.sy - 4} rx="4" ry="2" fill="#e8e3dc" opacity="0.85" />
          <ellipse cx={top.sx}      cy={top.sy + 7} rx="4" ry="2" fill="#e8e3dc" opacity="0.85" />
        </g>
      );
    }
    case "chair": {
      // Burgundy dining chair — small box with a back.
      return (
        <g>
          <IsoBox x={f.x - 0.7} y={f.y - 0.7} w={1.4} h={1.4} height={4} top="#4a2630" left="#371b24" right="#26121a" />
          <IsoBox x={f.x - 0.7} y={f.y + 0.5} w={1.4} h={0.2} height={9} top="#5a2e3a" left="#3f2028" right="#26121a" />
        </g>
      );
    }
    case "exec_desk": {
      // Wide executive desk
      return (
        <g>
          <IsoBox x={f.x - 4} y={f.y - 1.4} w={8} h={2.8} height={7} top="#3f3947" left="#2a242f" right="#1c181f" />
          <IsoBox x={f.x - 1.2} y={f.y - 0.8} w={2.4} h={0.5} height={11} top="#0e1218" left="#0a0d12" right="#070a0e" />
        </g>
      );
    }
    case "exec_chair": {
      return (
        <g>
          <IsoBox x={f.x - 1.3} y={f.y - 1.3} w={2.6} h={2.6} height={6} top="#3a2638" left="#291b27" right="#1a111a" />
          <IsoBox x={f.x - 1.3} y={f.y + 1.0} w={2.6} h={0.3} height={13} top="#4a3148" left="#321f30" right="#1a111a" />
        </g>
      );
    }
    case "bookshelf": {
      // Tall thin bookshelf flush with the back wall.
      return (
        <g>
          <IsoBox x={f.x - 0.5} y={f.y - 0.4} w={6} h={0.8} height={16} top="#2a2230" left="#1d1722" right="#120e15" />
          {/* Book stripes */}
          {[0, 1, 2, 3].map((i) => {
            const p = iso(f.x - 0.5 + (i + 0.5) * 1.4, f.y, 8 + i * 0.5);
            return (
              <rect
                key={i}
                x={p.sx - 6}
                y={p.sy - 6}
                width={12}
                height={3}
                fill={["#a3603a", "#4d6a99", "#7a4f6e", "#5a8a5a"][i]}
                opacity="0.9"
              />
            );
          })}
        </g>
      );
    }
    case "plant": {
      const trunk = iso(f.x, f.y, 0);
      const fronds = iso(f.x, f.y, 10);
      return (
        <g>
          <IsoBox x={f.x - 0.6} y={f.y - 0.6} w={1.2} h={1.2} height={3} top="#3a2a22" left="#291e18" right="#1a130f" />
          <ellipse cx={fronds.sx} cy={fronds.sy} rx={2.2 * TILE_W} ry={1.4 * TILE_H} fill="url(#plant-frond)" />
          <line x1={trunk.sx} y1={trunk.sy - 3} x2={fronds.sx} y2={fronds.sy + 4} stroke="#22150d" strokeWidth="2" />
        </g>
      );
    }
    case "counter": {
      // Long kitchen counter — like the bar/island in the reference.
      return (
        <g>
          <IsoBox x={f.x - 3} y={f.y - 1.2} w={6} h={2.4} height={7} top="#2c303a" left="#1b1e25" right="#10131a" />
          {/* Steel band on top */}
          {(() => {
            const a = iso(f.x - 3, f.y - 1.2, 7.2);
            const b = iso(f.x + 3, f.y - 1.2, 7.2);
            return <line x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke="#7d8493" strokeWidth="1.5" />;
          })()}
        </g>
      );
    }
    case "stool": {
      const top = iso(f.x, f.y, 6);
      return (
        <g>
          <IsoBox x={f.x - 0.2} y={f.y - 0.2} w={0.4} h={0.4} height={6} top="#3a3a3a" left="#28282a" right="#1a1a1c" />
          <ellipse cx={top.sx} cy={top.sy} rx="6" ry="3" fill="#4a3038" stroke="#2a1c22" strokeWidth="0.6" />
        </g>
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Sim — a tiny isometric person
// ────────────────────────────────────────────────────────────────────────────

function shirtColor(sig: AgentSignalEntry | undefined, live: boolean): string {
  if (!sig) return live ? "#7aa3ff" : "#5b6478";
  const m: Record<SignalKind, string> = {
    bullish: "#22c55e",
    bearish: "#ef4444",
    neutral: "#9ca3af",
  };
  return m[sig.signal];
}

function shirtRing(sig: AgentSignalEntry | undefined, live: boolean): string {
  if (!sig) return live ? "rgba(122,163,255,0.5)" : "rgba(91,100,120,0.5)";
  const m: Record<SignalKind, string> = {
    bullish: "rgba(34,197,94,0.65)",
    bearish: "rgba(239,68,68,0.65)",
    neutral: "rgba(156,163,175,0.55)",
  };
  return m[sig.signal];
}

function Sim({
  agent, pos, signal, live, hovered, selected, onHover, onClick,
}: {
  agent: AgentMeta;
  pos: AgentPos;
  signal: AgentSignalEntry | undefined;
  live: boolean;
  hovered: boolean;
  selected: boolean;
  onHover: (h: boolean) => void;
  onClick: () => void;
}) {
  const ground = iso(pos.x, pos.y, 0);
  const head = iso(pos.x, pos.y, 22);
  const torso = iso(pos.x, pos.y, 12);
  const shirt = shirtColor(signal, live);
  const ring = shirtRing(signal, live);
  const scale = selected ? 1.25 : hovered ? 1.15 : 1.0;
  return (
    <g
      style={{
        cursor: "pointer",
        transition: "transform 2800ms ease-in-out",
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onClick}
    >
      {/* Shadow under feet */}
      <ellipse cx={ground.sx} cy={ground.sy + 2} rx={9 * scale} ry={3.5 * scale} fill="url(#sim-shadow)" />

      {/* Live "thinking" pulse around feet */}
      {live && (
        <ellipse
          cx={ground.sx}
          cy={ground.sy + 2}
          rx={13}
          ry={5}
          fill="none"
          stroke="rgba(122,163,255,0.55)"
          strokeWidth="1.2"
        >
          <animate attributeName="rx" values="9;15;9" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.8;0;0.8" dur="1.6s" repeatCount="indefinite" />
        </ellipse>
      )}

      {/* Group with hover/selected scaling */}
      <g transform={`translate(${ground.sx}, ${ground.sy}) scale(${scale}) translate(${-ground.sx}, ${-ground.sy})`}>
        {/* Legs */}
        <rect x={ground.sx - 3} y={torso.sy + 2} width="2" height="6" fill="#1f2229" rx="0.5" />
        <rect x={ground.sx + 1} y={torso.sy + 2} width="2" height="6" fill="#1f2229" rx="0.5" />

        {/* Torso (signal-colored shirt) */}
        <rect
          x={ground.sx - 5}
          y={torso.sy - 4}
          width="10"
          height="9"
          rx="2.5"
          fill={shirt}
          stroke={ring}
          strokeWidth="1.2"
        />

        {/* Head — circle with the persona emoji centered on top */}
        <circle
          cx={head.sx}
          cy={head.sy}
          r="6.5"
          fill="#f5e8d4"
          stroke={selected ? "#ffffff" : "rgba(0,0,0,0.45)"}
          strokeWidth={selected ? 1.6 : 0.8}
        />
        <text
          x={head.sx}
          y={head.sy + 3}
          fontSize="9"
          textAnchor="middle"
          style={{ pointerEvents: "none" }}
        >
          {agent.emoji}
        </text>

        {/* Initials tag below the feet */}
        <g style={{ pointerEvents: "none" }}>
          <rect
            x={ground.sx - 9}
            y={ground.sy + 6}
            width="18"
            height="8"
            rx="2"
            fill="rgba(10,12,16,0.7)"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth="0.5"
          />
          <text
            x={ground.sx}
            y={ground.sy + 12}
            fontSize="6"
            fontWeight="700"
            textAnchor="middle"
            fill={hovered || selected ? "#ffffff" : "rgba(255,255,255,0.65)"}
            letterSpacing="0.5"
          >
            {agent.initials}
          </text>
        </g>
      </g>
    </g>
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
