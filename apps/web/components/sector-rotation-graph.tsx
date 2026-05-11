"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import type { RrgQuadrant, RrgSector } from "@/lib/types";
import { cn } from "@/lib/utils";

const QUADRANT_LABEL: Record<RrgQuadrant, string> = {
  leading:    "Leading",
  weakening:  "Weakening",
  lagging:    "Lagging",
  improving:  "Improving",
};

const QUADRANT_TONE: Record<RrgQuadrant, string> = {
  leading:    "text-signal-bullish",
  weakening:  "text-amber-600 dark:text-amber-400",
  lagging:    "text-signal-bearish",
  improving:  "text-sky-600 dark:text-sky-400",
};

// Background fills for each quadrant — kept faint so trails read clearly.
const QUADRANT_BG: Record<RrgQuadrant, string> = {
  leading:    "fill-signal-bullish/[0.06]",
  weakening:  "fill-amber-500/[0.06]",
  lagging:    "fill-signal-bearish/[0.06]",
  improving:  "fill-sky-500/[0.06]",
};

// Stroke colors for sector trails — match the quadrant the head currently sits in.
const HEAD_STROKE: Record<RrgQuadrant, string> = {
  leading:    "stroke-signal-bullish",
  weakening:  "stroke-amber-500",
  lagging:    "stroke-signal-bearish",
  improving:  "stroke-sky-500",
};

const TAIL_OPTIONS = [4, 8, 12] as const;

export function SectorRotationGraph() {
  const [tailWeeks, setTailWeeks] = useState<number>(8);
  const [filter, setFilter] = useState<RrgQuadrant | "all">("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["sector-rrg", { tailWeeks }],
    queryFn: () => api.sectorRrg({ tailWeeks }),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const filtered = useMemo<RrgSector[]>(() => {
    if (!data) return [];
    if (filter === "all") return data.sectors;
    return data.sectors.filter((s) => s.head_quadrant === filter);
  }, [data, filter]);

  if (isLoading) {
    return <Skeleton className="h-[480px] w-full" />;
  }

  if (error || !data || data.sectors.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Rotation map unavailable — need at least 3 months of price history.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Sector rotation map</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Relative strength vs {data.benchmark} on the x-axis, RS momentum on the y-axis.
              Head = today; tail = past {tailWeeks} weeks.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <QuadrantFilter value={filter} onChange={setFilter} />
            <div className="inline-flex rounded-full border border-border bg-card p-0.5 text-xs">
              {TAIL_OPTIONS.map((w) => {
                const active = w === tailWeeks;
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setTailWeeks(w)}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 transition-colors",
                      active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {w}w
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <RrgPlot sectors={filtered} />
        <RrgLegend />
      </CardContent>
    </Card>
  );
}

function QuadrantFilter({
  value, onChange,
}: { value: RrgQuadrant | "all"; onChange: (v: RrgQuadrant | "all") => void }) {
  const opts: Array<{ key: RrgQuadrant | "all"; label: string }> = [
    { key: "all",       label: "All" },
    { key: "leading",   label: "Leading" },
    { key: "improving", label: "Improving" },
    { key: "weakening", label: "Weakening" },
    { key: "lagging",   label: "Lagging" },
  ];
  return (
    <div className="inline-flex rounded-full border border-border bg-card p-0.5 text-[11px]">
      {opts.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={cn(
              "rounded-full px-2.5 py-0.5 transition-colors",
              active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function RrgPlot({ sectors }: { sectors: RrgSector[] }) {
  const [hover, setHover] = useState<string | null>(null);

  // Collect all (rs_ratio, rs_momentum) values to size the viewbox so every
  // sector tail is visible, with the (100, 100) origin always centered.
  const range = useMemo(() => {
    let maxDev = 1.5; // ensure the chart doesn't feel cramped when everything sits near origin
    for (const s of sectors) {
      for (const p of s.points) {
        maxDev = Math.max(maxDev, Math.abs(p.rs_ratio - 100), Math.abs(p.rs_momentum - 100));
      }
    }
    return { lo: 100 - maxDev * 1.15, hi: 100 + maxDev * 1.15 };
  }, [sectors]);

  // Plot geometry. SVG y-axis is inverted (positive momentum = up on screen).
  const W = 720, H = 520, PAD = 36;
  const x = (rs: number) => PAD + ((rs - range.lo) / (range.hi - range.lo)) * (W - 2 * PAD);
  const y = (mom: number) => H - PAD - ((mom - range.lo) / (range.hi - range.lo)) * (H - 2 * PAD);
  const cx = x(100), cy = y(100);

  return (
    <div className="relative w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Sector rotation map">
        {/* Quadrant backgrounds */}
        <rect x={cx}        y={PAD}      width={W - PAD - cx}    height={cy - PAD}      className={QUADRANT_BG.leading} />
        <rect x={cx}        y={cy}       width={W - PAD - cx}    height={H - PAD - cy}  className={QUADRANT_BG.weakening} />
        <rect x={PAD}       y={cy}       width={cx - PAD}        height={H - PAD - cy}  className={QUADRANT_BG.lagging} />
        <rect x={PAD}       y={PAD}      width={cx - PAD}        height={cy - PAD}      className={QUADRANT_BG.improving} />

        {/* Axes through (100, 100) */}
        <line x1={PAD} x2={W - PAD} y1={cy}  y2={cy}  className="stroke-border" strokeWidth={1} />
        <line x1={cx}  x2={cx}      y1={PAD} y2={H - PAD} className="stroke-border" strokeWidth={1} />

        {/* Axis labels (subtle) */}
        <text x={W - PAD - 4} y={cy - 6}  textAnchor="end"   className="fill-muted-foreground text-[10px]">RS-Ratio →</text>
        <text x={cx + 6}      y={PAD + 12} textAnchor="start" className="fill-muted-foreground text-[10px]">RS-Momentum ↑</text>

        {/* Quadrant captions */}
        <text x={W - PAD - 6}   y={PAD + 14}    textAnchor="end"   className="fill-signal-bullish/80 text-[11px] font-medium">Leading</text>
        <text x={W - PAD - 6}   y={H - PAD - 6} textAnchor="end"   className="fill-amber-500/80 text-[11px] font-medium">Weakening</text>
        <text x={PAD + 6}       y={H - PAD - 6} textAnchor="start" className="fill-signal-bearish/80 text-[11px] font-medium">Lagging</text>
        <text x={PAD + 6}       y={PAD + 14}    textAnchor="start" className="fill-sky-500/80 text-[11px] font-medium">Improving</text>

        {/* Sector trails */}
        {sectors.map((s) => {
          const pts = s.points
            .map((p) => `${x(p.rs_ratio).toFixed(1)},${y(p.rs_momentum).toFixed(1)}`)
            .join(" ");
          const head = s.points[s.points.length - 1];
          const isHover = hover === s.symbol;
          const stroke = HEAD_STROKE[s.head_quadrant];
          return (
            <g
              key={s.symbol}
              onMouseEnter={() => setHover(s.symbol)}
              onMouseLeave={() => setHover((h) => (h === s.symbol ? null : h))}
              className="cursor-default"
            >
              <polyline
                points={pts}
                fill="none"
                className={cn(stroke, isHover ? "opacity-100" : "opacity-50")}
                strokeWidth={isHover ? 2 : 1.25}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <circle
                cx={x(head.rs_ratio)}
                cy={y(head.rs_momentum)}
                r={isHover ? 5.5 : 4}
                className={cn(stroke, "fill-background")}
                strokeWidth={2}
              />
              <text
                x={x(head.rs_ratio) + 7}
                y={y(head.rs_momentum) - 4}
                className={cn("fill-foreground text-[10px] font-medium", !isHover && "opacity-70")}
              >
                {s.symbol}
              </text>
            </g>
          );
        })}
      </svg>

      {hover && <HoverTooltip s={sectors.find((x) => x.symbol === hover)!} />}
    </div>
  );
}

function HoverTooltip({ s }: { s: RrgSector }) {
  const head = s.points[s.points.length - 1];
  const headTs = new Date(head.ts);
  return (
    <div className="pointer-events-none absolute right-2 top-2 max-w-[240px] rounded-md border border-border bg-popover/95 p-2 text-[11px] shadow-lg backdrop-blur">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{s.symbol}</span>
        <span className={cn("text-[10px] uppercase tracking-wide", QUADRANT_TONE[s.head_quadrant])}>
          {QUADRANT_LABEL[s.head_quadrant]}
        </span>
      </div>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
        <dt>RS-Ratio</dt>
        <dd className="text-right font-mono text-foreground">{head.rs_ratio.toFixed(2)}</dd>
        <dt>RS-Momentum</dt>
        <dd className="text-right font-mono text-foreground">{head.rs_momentum.toFixed(2)}</dd>
        <dt>Rotation</dt>
        <dd className="text-right capitalize text-foreground">{s.rotation}</dd>
        <dt>As of</dt>
        <dd className="text-right text-foreground">{headTs.toISOString().slice(0, 10)}</dd>
      </dl>
    </div>
  );
}

function RrgLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span><span className={cn("inline-block h-2 w-2 rounded-full bg-signal-bullish align-middle")} /> Leading — outperforming &amp; accelerating</span>
      <span><span className={cn("inline-block h-2 w-2 rounded-full bg-sky-500 align-middle")} /> Improving — underperforming but turning up</span>
      <span><span className={cn("inline-block h-2 w-2 rounded-full bg-amber-500 align-middle")} /> Weakening — outperforming but fading</span>
      <span><span className={cn("inline-block h-2 w-2 rounded-full bg-signal-bearish align-middle")} /> Lagging — underperforming &amp; decelerating</span>
    </div>
  );
}
