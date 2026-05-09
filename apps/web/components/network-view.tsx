"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { NetworkBucket, NetworkEdge, NetworkNode, NetworkResponse } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// react-force-graph-2d uses canvas + window — strict client-only.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const BUCKET_COLOR: Record<NetworkBucket, string> = {
  leader: "#00C805",
  mid: "#9c9ca5",
  laggard: "#FF5000",
  unranked: "#3f3f46",
};

type GNode = NetworkNode & { x?: number; y?: number; vx?: number; vy?: number };
type GLink = { source: string | GNode; target: string | GNode; correlation: number };

// react-force-graph's generic types are very loose at the boundary; cast at
// callback edges to the shapes we actually populate.
type AnyNode = Record<string, unknown> & GNode;
type AnyLink = Record<string, unknown> & GLink;

export function NetworkView() {
  const router = useRouter();
  const [windowDays, setWindowDays] = useState(60);
  // Default 0.70 — at 0.55 the sector universe shows almost every edge
  // and the graph reads as noise. 0.70 surfaces only meaningful clusters.
  const [minCorr, setMinCorr] = useState(0.70);
  const [horizon, setHorizon] = useState<5 | 10 | 20>(10);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [hovered, setHovered] = useState<NetworkNode | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // ref into ForceGraph2D so we can zoomToFit / tune forces after layout settles.
  // The lib's TS types are loose; treat the imperative handle as `any`.
  const fgRef = useRef<unknown>(null);

  const handleEngineStop = useCallback(() => {
    // After force simulation settles, fit the graph to the canvas with padding.
    const fg = fgRef.current as { zoomToFit?: (ms: number, pad: number) => void } | null;
    if (fg?.zoomToFit) fg.zoomToFit(400, 60);
  }, []);

  // Tune the d3 forces once on mount: stronger repulsion + shorter links so
  // dense clusters spread out and labels don't overlap.
  const handleGraphRefReady = useCallback(() => {
    const fg = fgRef.current as {
      d3Force?: (name: string) => { strength?: (v: number) => void; distance?: (v: number) => void } | null;
    } | null;
    if (!fg?.d3Force) return;
    const charge = fg.d3Force("charge");
    if (charge?.strength) charge.strength(-380);
    const link = fg.d3Force("link");
    if (link?.distance) link.distance(80);
  }, []);

  useEffect(() => {
    handleGraphRefReady();
  }, [handleGraphRefReady]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["network-correlation", windowDays, minCorr, horizon],
    queryFn: () =>
      api.correlationNetwork({ window: windowDays, minCorrelation: minCorr, horizon }),
    retry: false,
  });

  // Track container size so the graph fills it.
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        setSize({
          w: containerRef.current.clientWidth,
          h: Math.max(480, Math.min(700, window.innerHeight - 240)),
        });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const graphData = useMemo(() => {
    if (!data) return { nodes: [] as GNode[], links: [] as GLink[] };
    return {
      nodes: data.nodes.map((n) => ({ ...n })) as GNode[],
      links: data.edges.map((e) => ({ ...e })) as GLink[],
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Sector network</h1>
          <p className="text-sm text-muted-foreground">
            Pairwise correlation graph over {data?.universe.length ?? "—"} sector ETFs by rolling correlation,
            sized by your XGB rank, with the option to expand a sector into its constituents.
          </p>
        </div>
        <Controls
          windowDays={windowDays}
          onWindowChange={setWindowDays}
          minCorr={minCorr}
          onMinCorrChange={setMinCorr}
          horizon={horizon}
          onHorizonChange={setHorizon}
        />
      </div>

      <Legend response={data} />

      <Card className="overflow-hidden">
        <CardContent className="relative p-0" style={{ minHeight: 520 }}>
          <div ref={containerRef} className="w-full">
            {isLoading && <Skeleton className="m-4 h-[480px] w-[calc(100%-2rem)]" />}
            {error && (
              <div className="p-6 text-sm text-signal-bearish">
                Failed to load network: {(error as Error).message}
              </div>
            )}
            {data && data.nodes.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground">
                No network data — universe has no overlapping price history in this window.
              </div>
            )}
            {data && data.nodes.length > 0 && (
              <ForceGraph2D
                ref={fgRef as never}
                graphData={graphData as { nodes: AnyNode[]; links: AnyLink[] }}
                width={size.w}
                height={size.h}
                backgroundColor="rgba(0,0,0,0)"
                onEngineStop={handleEngineStop}
                nodeRelSize={1}
                nodeVal={(n) => {
                  // Per spec: size ∝ rank — top-ranked sectors biggest, laggards smallest.
                  // ForceGraph2D treats nodeVal as area, so a flat scale on rank gives
                  // a clear visual hierarchy. Unranked nodes get the smallest size.
                  const node = n as AnyNode;
                  const ranked = data?.nodes.length ?? 26;
                  if (node.rank == null) return 4;
                  // rank 1 -> max, rank N -> min
                  const inverse = ranked - node.rank + 1;          // 1..N (laggard..leader)
                  return 4 + inverse * 1.5;                          // ~4..~43
                }}
                nodeColor={(n) => BUCKET_COLOR[(n as AnyNode).bucket]}
                nodeLabel={(n) => {
                  const node = n as AnyNode;
                  return `${node.id} — ${node.bucket}${node.return_window != null ? ` (${(node.return_window * 100).toFixed(1)}% over ${windowDays}d)` : ""}`;
                }}
                linkColor={(l) => {
                  const r = (l as AnyLink).correlation;
                  const alpha = Math.min(0.9, Math.abs(r) * 1.1);
                  return r >= 0
                    ? `rgba(255,255,255,${alpha})`
                    : `rgba(255,80,0,${alpha})`;
                }}
                linkWidth={(l) => 0.5 + Math.abs((l as AnyLink).correlation) * 3.5}
                linkDirectionalParticles={0}
                cooldownTicks={120}
                onNodeHover={(n) => setHovered((n as AnyNode | null) ?? null)}
                onNodeClick={(n) => router.push(`/sectors/${encodeURIComponent((n as AnyNode).id)}`)}
                nodeCanvasObjectMode={() => "after"}
                nodeCanvasObject={(n, ctx, globalScale) => {
                  const node = n as AnyNode;
                  const ranked = data?.nodes.length ?? 26;
                  const inverse = node.rank == null ? 0 : ranked - node.rank + 1;
                  const radius = (4 + inverse * 1.5) ** 0.5 * 1.4;
                  // Ticker label inside the node, white.
                  const fontSize = Math.max(10, 14 / globalScale);
                  ctx.font = `${fontSize}px var(--font-jb-mono), ui-monospace, monospace`;
                  ctx.textAlign = "center";
                  ctx.textBaseline = "middle";
                  ctx.fillStyle = "#fff";
                  ctx.fillText(node.id, node.x ?? 0, node.y ?? 0);
                  // Rank "#N" below the node, muted gray.
                  if (node.rank != null) {
                    ctx.font = `${Math.max(8, 10 / globalScale)}px var(--font-jb-mono), ui-monospace, monospace`;
                    ctx.fillStyle = "rgba(255,255,255,0.5)";
                    ctx.fillText(`#${node.rank}`, node.x ?? 0, (node.y ?? 0) + radius + 6);
                  }
                }}
              />
            )}
          </div>
          {hovered && (
            <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-card/95 px-3 py-2 text-xs shadow-lg ring-1 ring-border">
              <div className="font-semibold">{hovered.id}</div>
              <div className="text-muted-foreground">
                {hovered.bucket}
                {hovered.rank != null && ` · rank #${hovered.rank}`}
              </div>
              {hovered.return_window != null && (
                <div className="num">
                  {windowDays}d return: {(hovered.return_window * 100).toFixed(2)}%
                </div>
              )}
              <div className="num text-muted-foreground">
                avg |r|: {hovered.avg_correlation.toFixed(2)}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Hover for sector detail · click a node to drill into its constituents · drag to reposition.
      </p>
    </div>
  );
}

function Controls({
  windowDays, onWindowChange,
  minCorr, onMinCorrChange,
  horizon, onHorizonChange,
}: {
  windowDays: number; onWindowChange: (v: number) => void;
  minCorr: number; onMinCorrChange: (v: number) => void;
  horizon: 5 | 10 | 20; onHorizonChange: (v: 5 | 10 | 20) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      <label className="flex items-center gap-2">
        <span>Min correlation</span>
        <input
          type="range" min={0} max={0.95} step={0.05}
          value={minCorr}
          onChange={(e) => onMinCorrChange(parseFloat(e.target.value))}
          className="accent-primary"
        />
        <span className="num w-10 text-foreground">{minCorr.toFixed(2)}</span>
      </label>
      <label className="flex items-center gap-2">
        <span>Window</span>
        <select
          value={windowDays}
          onChange={(e) => onWindowChange(parseInt(e.target.value))}
          className="rounded-full border border-border bg-card px-3 py-1 text-foreground"
        >
          <option value={30}>30d</option>
          <option value={60}>60d</option>
          <option value={90}>90d</option>
          <option value={180}>180d</option>
        </select>
      </label>
      <label className="flex items-center gap-2">
        <span>Horizon</span>
        <select
          value={horizon}
          onChange={(e) => onHorizonChange(parseInt(e.target.value) as 5 | 10 | 20)}
          className="rounded-full border border-border bg-card px-3 py-1 text-foreground"
        >
          <option value={5}>5d</option>
          <option value={10}>10d</option>
          <option value={20}>20d</option>
        </select>
      </label>
    </div>
  );
}

function Legend({ response }: { response: NetworkResponse | undefined }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-full bg-signal-bullish" /> Predicted leader (top 3)
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-full bg-muted-foreground" /> Mid pack
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-full bg-signal-bearish" /> Predicted laggard (bottom 3)
      </span>
      <span className="ml-auto text-[10px]">
        size = rank · edge = correlation
        {response && (
          <span className="ml-2 text-[10px] opacity-70">
            ({response.nodes.length} nodes · {response.edges.length} edges · {response.n_obs} bars)
          </span>
        )}
      </span>
    </div>
  );
}
