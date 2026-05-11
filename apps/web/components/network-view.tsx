"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type {
  ExpandedSectorResponse,
  LeadLagResponse,
  NetworkBucket,
  NetworkNode,
  NetworkResponse,
  WatchlistResponse,
  WatchlistSignal,
} from "@/lib/types";
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

// Distinct color for macro nodes so they read as "context, not predictions".
const MACRO_COLOR = "#7dd3fc"; // sky-300

type Mode = "correlation" | "lead-lag";
type SignFilter = "all" | "positive" | "negative";

// Watchlist signal aggregated per ETF (sector). Drives the portfolio overlay
// ring drawn around each sector node.
type SectorOverlay = {
  netWeight: number;          // sum(long target_weight) - sum(short target_weight)
  longCount: number;
  shortCount: number;
  topLongs: string[];         // top 3 long tickers by weight, for tooltip
  topShorts: string[];
};

type GNode = NetworkNode & {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
  // For expanded constituent nodes
  isConstituent?: boolean;
  parentEtf?: string;
  weight?: number | null;
};
type GLink = {
  source: string | GNode;
  target: string | GNode;
  correlation: number; // for correlation/expand modes
  // lead-lag fields
  lag?: number;
  pValue?: number;
  // expand-mode tether
  isTether?: boolean;
  // marks edges that survived MST (for backbone overlay)
  inMst?: boolean;
};

// react-force-graph's generic types are very loose at the boundary; cast at
// callback edges to the shapes we actually populate.
type AnyNode = Record<string, unknown> & GNode;
type AnyLink = Record<string, unknown> & GLink;

export function NetworkView() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("correlation");
  const [windowDays, setWindowDays] = useState(60);
  // Default 0.70 — at 0.55 the sector universe shows almost every edge
  // and the graph reads as noise. 0.70 surfaces only meaningful clusters.
  // The slider min is also 0.50 (anything lower is uninformative noise).
  const [minCorr, setMinCorr] = useState(0.70);
  const [horizon, setHorizon] = useState<5 | 10 | 20>(10);
  const [signFilter, setSignFilter] = useState<SignFilter>("all");
  const [showMstOnly, setShowMstOnly] = useState(false);
  const [maxP, setMaxP] = useState(0.05);
  const [maxLag, setMaxLag] = useState(10);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [hovered, setHovered] = useState<GNode | null>(null);
  const [search, setSearch] = useState("");
  const [expandedEtf, setExpandedEtf] = useState<string | null>(null);
  // Time slider: 0 = today (asOf = null → server uses NOW), N = N business days ago.
  // We let the user scrub ~2y of history.
  const [daysBack, setDaysBack] = useState(0);
  const [includeMacros, setIncludeMacros] = useState(false);
  const [showPortfolio, setShowPortfolio] = useState(true);
  // Shock-mode (lead-lag): clicking a node simulates a -X% jolt that propagates
  // through Granger edges with the recorded lags. shockSource is the origin
  // node id; shockTimer is "days since shock" advanced by the animation loop.
  const [shockMode, setShockMode] = useState(false);
  const [shockSource, setShockSource] = useState<string | null>(null);
  const [shockTimer, setShockTimer] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // ref into ForceGraph2D so we can zoomToFit / tune forces after layout settles.
  // The lib's TS types are loose; treat the imperative handle as `any`.
  const fgRef = useRef<unknown>(null);

  const handleEngineStop = useCallback(() => {
    // After force simulation settles, fit graph with tight padding so the
    // cluster fills the canvas — too much padding shrinks the graph and
    // makes labels look oversized relative to nodes.
    const fg = fgRef.current as { zoomToFit?: (ms: number, pad: number) => void } | null;
    if (fg?.zoomToFit) fg.zoomToFit(400, 24);
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
  }, [handleGraphRefReady, mode]);

  // Resolve the "as of" calendar date from the daysBack slider. We subtract
  // *calendar* days from today; the backend forward-fills weekends/holidays.
  // Sending null when daysBack == 0 lets the server use NOW() and keeps the
  // cache key stable for "live" loads.
  const asOf = useMemo<string | null>(() => {
    if (daysBack <= 0) return null;
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    return d.toISOString().slice(0, 10);
  }, [daysBack]);

  // Primary data: correlation OR lead-lag, depending on mode.
  const corrQuery = useQuery({
    queryKey: ["network-correlation", windowDays, minCorr, horizon, asOf, includeMacros],
    queryFn: () =>
      api.correlationNetwork({
        window: windowDays,
        minCorrelation: minCorr,
        horizon,
        asOf: asOf ?? undefined,
        includeMacros,
      }),
    enabled: mode === "correlation",
    retry: false,
  });

  // Watchlist for the portfolio overlay — aggregated per-sector net signal.
  // Cached separately so the slider doesn't refetch it.
  const watchlistQuery = useQuery({
    queryKey: ["watchlist-for-network"],
    queryFn: () => api.watchlist(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const sectorOverlay = useMemo<Map<string, SectorOverlay>>(() => {
    const m = new Map<string, SectorOverlay>();
    const wl = watchlistQuery.data as WatchlistResponse | undefined;
    if (!wl) return m;
    for (const s of wl.sectors) {
      let net = 0;
      let longCount = 0;
      let shortCount = 0;
      const longs: { t: string; w: number }[] = [];
      const shorts: { t: string; w: number }[] = [];
      for (const it of s.items) {
        const w = it.target_weight ?? 0;
        const sig = it.final_signal as WatchlistSignal;
        if (sig === "long") {
          net += w;
          longCount += 1;
          longs.push({ t: it.ticker, w });
        } else if (sig === "short") {
          net -= w;
          shortCount += 1;
          shorts.push({ t: it.ticker, w });
        }
      }
      longs.sort((a, b) => b.w - a.w);
      shorts.sort((a, b) => b.w - a.w);
      m.set(s.sector, {
        netWeight: net,
        longCount,
        shortCount,
        topLongs: longs.slice(0, 3).map((x) => x.t),
        topShorts: shorts.slice(0, 3).map((x) => x.t),
      });
    }
    return m;
  }, [watchlistQuery.data]);

  const llQuery = useQuery({
    queryKey: ["network-lead-lag", maxP, maxLag, horizon],
    queryFn: () =>
      api.leadLagNetwork({ maxP, minLag: 1, maxLag, horizon }),
    enabled: mode === "lead-lag",
    retry: false,
  });

  // Optional: expanded sector view (overlays constituents around the parent ETF).
  const expandQuery = useQuery({
    queryKey: ["network-expand", expandedEtf, windowDays, minCorr],
    queryFn: () =>
      api.expandSector(expandedEtf!, { window: windowDays, minCorrelation: minCorr, top: 12 }),
    enabled: !!expandedEtf,
    retry: false,
  });

  const isLoading =
    (mode === "correlation" && corrQuery.isLoading) ||
    (mode === "lead-lag" && llQuery.isLoading);
  const error =
    (mode === "correlation" ? corrQuery.error : llQuery.error) as Error | null;

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

  // Build the unified graph data for the current mode + overlays.
  const graphData = useMemo(() => {
    const nodes: GNode[] = [];
    const links: GLink[] = [];

    if (mode === "correlation") {
      const data = corrQuery.data as NetworkResponse | undefined;
      if (data) {
        nodes.push(...data.nodes.map((n) => ({ ...n })));
        // Apply sign filter for correlation mode.
        for (const e of data.edges) {
          if (signFilter === "positive" && e.correlation < 0) continue;
          if (signFilter === "negative" && e.correlation > 0) continue;
          links.push({ source: e.source, target: e.target, correlation: e.correlation });
        }
      }
    } else {
      const data = llQuery.data as LeadLagResponse | undefined;
      if (data) {
        nodes.push(...data.nodes.map((n) => ({ ...n })));
        for (const e of data.edges) {
          links.push({
            source: e.source,
            target: e.target,
            // p-value strength as a pseudo-correlation for line opacity/width
            // lower p => thicker, more opaque. Map p∈[0, max_p] → strength∈[1..0.2].
            correlation: 1 - Math.min(1, e.p_value / Math.max(1e-6, maxP)),
            lag: e.lag,
            pValue: e.p_value,
          });
        }
      }
    }

    // Overlay expanded constituents around their parent ETF, if any.
    const exp = expandQuery.data as ExpandedSectorResponse | undefined;
    if (exp && expandedEtf) {
      const known = new Set(nodes.map((n) => n.id));
      // Anchor the parent ETF if it's already in the graph (it should be).
      const parent = nodes.find((n) => n.id === exp.etf);
      const cx = parent?.x;
      const cy = parent?.y;
      const radius = 80;
      const constituentsOnly = exp.nodes.filter((n) => !n.is_parent);
      constituentsOnly.forEach((n, i) => {
        if (known.has(n.id)) return;
        const angle = (i / Math.max(1, constituentsOnly.length)) * Math.PI * 2;
        const initX = cx != null ? cx + Math.cos(angle) * radius : undefined;
        const initY = cy != null ? cy + Math.sin(angle) * radius : undefined;
        nodes.push({
          id: n.id,
          name: n.name,
          rank: null,
          score: null,
          bucket: "unranked",
          return_window: n.return_window,
          avg_correlation: n.parent_correlation ?? 0,
          isConstituent: true,
          parentEtf: exp.etf,
          weight: n.weight,
          x: initX,
          y: initY,
        });
        known.add(n.id);
      });
      for (const e of exp.edges) {
        if (signFilter === "positive" && e.correlation < 0) continue;
        if (signFilter === "negative" && e.correlation > 0) continue;
        links.push({
          source: e.source,
          target: e.target,
          correlation: e.correlation,
          isTether: e.is_tether,
        });
      }
    }

    // MST overlay — compute minimum spanning tree using |correlation| as weight
    // (we want strongest edges; treat 1-|r| as cost). Mark edges that survive.
    if (links.length > 0) {
      const idIndex = new Map<string, number>();
      nodes.forEach((n, i) => idIndex.set(n.id, i));
      const sorted = links
        .map((l, idx) => {
          const sId = typeof l.source === "string" ? l.source : (l.source as GNode).id;
          const tId = typeof l.target === "string" ? l.target : (l.target as GNode).id;
          return { idx, sId, tId, cost: 1 - Math.abs(l.correlation) };
        })
        .filter((e) => idIndex.has(e.sId) && idIndex.has(e.tId))
        .sort((a, b) => a.cost - b.cost);

      // Union-find
      const parent = nodes.map((_, i) => i);
      const find = (x: number): number => {
        while (parent[x] !== x) {
          parent[x] = parent[parent[x]];
          x = parent[x];
        }
        return x;
      };
      const union = (a: number, b: number): boolean => {
        const ra = find(a);
        const rb = find(b);
        if (ra === rb) return false;
        parent[ra] = rb;
        return true;
      };
      for (const e of sorted) {
        const a = idIndex.get(e.sId)!;
        const b = idIndex.get(e.tId)!;
        if (union(a, b)) links[e.idx].inMst = true;
      }
    }

    return { nodes, links };
  }, [mode, corrQuery.data, llQuery.data, expandQuery.data, expandedEtf, signFilter, maxP]);

  // Visible links (after MST filter).
  const visibleLinks = useMemo(() => {
    if (!showMstOnly) return graphData.links;
    return graphData.links.filter((l) => l.inMst);
  }, [graphData.links, showMstOnly]);

  // Adjacency for hover-isolate (built from VISIBLE links so highlighting
  // matches what the user sees).
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of visibleLinks) {
      const sId = typeof l.source === "string" ? l.source : (l.source as GNode).id;
      const tId = typeof l.target === "string" ? l.target : (l.target as GNode).id;
      if (!m.has(sId)) m.set(sId, new Set());
      if (!m.has(tId)) m.set(tId, new Set());
      m.get(sId)!.add(tId);
      m.get(tId)!.add(sId);
    }
    return m;
  }, [visibleLinks]);

  // BFS along *directed* lead-lag edges from `shockSource`, accumulating
  // lag days as edge cost. Returns Map<nodeId, arrival_day>. The source
  // arrives at day 0. Unreachable nodes are absent.
  const shockArrivals = useMemo<Map<string, number>>(() => {
    const arrivals = new Map<string, number>();
    if (mode !== "lead-lag" || !shockSource) return arrivals;
    const ll = llQuery.data as LeadLagResponse | undefined;
    if (!ll) return arrivals;
    // Build forward adjacency: source -> [(target, lag)]
    const fwd = new Map<string, { t: string; lag: number }[]>();
    for (const e of ll.edges) {
      const bucket = fwd.get(e.source) ?? [];
      bucket.push({ t: e.target, lag: Math.max(1, e.lag) });
      fwd.set(e.source, bucket);
    }
    // Dijkstra (lags are small positive ints, but using a simple priority queue
    // is fine here — universe is <50 nodes).
    arrivals.set(shockSource, 0);
    const queue: { id: string; day: number }[] = [{ id: shockSource, day: 0 }];
    while (queue.length) {
      queue.sort((a, b) => a.day - b.day);
      const cur = queue.shift()!;
      const curDay = arrivals.get(cur.id);
      if (curDay !== undefined && cur.day > curDay) continue;
      const nbrs = fwd.get(cur.id) ?? [];
      for (const { t, lag } of nbrs) {
        const nd = cur.day + lag;
        const prev = arrivals.get(t);
        if (prev === undefined || nd < prev) {
          arrivals.set(t, nd);
          queue.push({ id: t, day: nd });
        }
      }
    }
    return arrivals;
  }, [shockSource, llQuery.data, mode]);

  // Animation: when shockSource is set, advance shockTimer 1 day every 220ms
  // until we cover the max arrival; then auto-fade by clearing after a pause.
  useEffect(() => {
    if (!shockSource) return;
    let cancelled = false;
    setShockTimer(0);
    const maxDay = Math.max(0, ...Array.from(shockArrivals.values()));
    let day = 0;
    const tick = () => {
      if (cancelled) return;
      day += 1;
      setShockTimer(day);
      if (day <= maxDay + 2) {
        setTimeout(tick, 220);
      } else {
        // Hold for a beat so the user sees the final state, then reset.
        setTimeout(() => {
          if (!cancelled) {
            setShockSource(null);
            setShockTimer(0);
          }
        }, 1800);
      }
    };
    const id = setTimeout(tick, 220);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [shockSource, shockArrivals]);

  const isVisible = useCallback(
    (id: string): boolean => {
      if (!hovered) return true;
      if (id === hovered.id) return true;
      const nbrs = adjacency.get(hovered.id);
      return !!nbrs && nbrs.has(id);
    },
    [hovered, adjacency]
  );

  const isLinkLit = useCallback(
    (l: GLink): boolean => {
      if (!hovered) return true;
      const sId = typeof l.source === "string" ? l.source : (l.source as GNode).id;
      const tId = typeof l.target === "string" ? l.target : (l.target as GNode).id;
      return sId === hovered.id || tId === hovered.id;
    },
    [hovered]
  );

  const renderedGraph = useMemo(
    () => ({ nodes: graphData.nodes, links: visibleLinks }),
    [graphData.nodes, visibleLinks]
  );

  // Search-to-focus: zoom + center on a matching node, by id (case-insensitive).
  const focusNode = useCallback((query: string) => {
    const q = query.trim().toUpperCase();
    if (!q) return;
    const node = graphData.nodes.find((n) => n.id.toUpperCase().includes(q));
    if (!node || node.x == null || node.y == null) return;
    const fg = fgRef.current as {
      centerAt?: (x: number, y: number, ms?: number) => void;
      zoom?: (k: number, ms?: number) => void;
    } | null;
    fg?.centerAt?.(node.x, node.y, 600);
    fg?.zoom?.(4, 600);
    setHovered(node);
  }, [graphData.nodes]);

  // Drag-to-pin: when a node is dragged, fix it in place. Click pinned node to release.
  const handleNodeDragEnd = useCallback((n: AnyNode) => {
    if (n.x != null) n.fx = n.x;
    if (n.y != null) n.fy = n.y;
  }, []);

  const handleNodeClick = useCallback((n: AnyNode, e: MouseEvent) => {
    const node = n as GNode;
    // Shift+click expands the sector into its constituents in-place.
    // Plain click drills to the sector page (or triggers a shock in shock mode).
    // Alt/Option-click releases a pinned node.
    if (e.altKey) {
      n.fx = undefined;
      n.fy = undefined;
      return;
    }
    if (e.shiftKey && !node.isConstituent) {
      setExpandedEtf((cur) => (cur === node.id ? null : node.id));
      return;
    }
    if (mode === "lead-lag" && shockMode) {
      setShockSource(node.id);
      return;
    }
    router.push(`/sectors/${encodeURIComponent(node.id)}`);
  }, [router, mode, shockMode]);

  const totalEdges = graphData.links.length;
  const visibleEdgeCount = visibleLinks.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Sector network</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "correlation" ? (
              <>
                Pairwise correlation graph over {corrQuery.data?.universe.length ?? "—"} sector ETFs by rolling correlation,
                sized by your XGB rank. Shift-click a sector to expand its top constituents.
              </>
            ) : (
              <>
                Granger lead → follower DAG over {llQuery.data?.universe.length ?? "—"} sector ETFs.
                Direction = which sector tends to move first; opacity = significance.
              </>
            )}
          </p>
        </div>
        <Controls
          mode={mode}
          onModeChange={(m) => {
            setMode(m);
            setExpandedEtf(null);
            setHovered(null);
          }}
          windowDays={windowDays}
          onWindowChange={setWindowDays}
          minCorr={minCorr}
          onMinCorrChange={setMinCorr}
          horizon={horizon}
          onHorizonChange={setHorizon}
          signFilter={signFilter}
          onSignFilterChange={setSignFilter}
          showMstOnly={showMstOnly}
          onShowMstOnlyChange={setShowMstOnly}
          maxP={maxP}
          onMaxPChange={setMaxP}
          maxLag={maxLag}
          onMaxLagChange={setMaxLag}
          search={search}
          onSearchChange={setSearch}
          onSearchSubmit={() => focusNode(search)}
          expandedEtf={expandedEtf}
          onClearExpansion={() => setExpandedEtf(null)}
        />
      </div>

      <Legend
        mode={mode}
        nodeCount={graphData.nodes.length}
        edgeCount={visibleEdgeCount}
        totalEdges={totalEdges}
        nObs={
          mode === "correlation"
            ? corrQuery.data?.n_obs
            : llQuery.data?.edges.length
        }
      />

      <Card className="overflow-hidden">
        <CardContent className="relative p-0" style={{ minHeight: 520 }}>
          <div ref={containerRef} className="w-full">
            {isLoading && <Skeleton className="m-4 h-[480px] w-[calc(100%-2rem)]" />}
            {error && (
              <div className="p-6 text-sm text-signal-bearish">
                Failed to load network: {(error as Error).message}
              </div>
            )}
            {!isLoading && !error && graphData.nodes.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground">
                No network data — try widening the window or lowering the threshold.
              </div>
            )}
            {graphData.nodes.length > 0 && (
              <ForceGraph2D
                ref={fgRef as never}
                graphData={renderedGraph as { nodes: AnyNode[]; links: AnyLink[] }}
                width={size.w}
                height={size.h}
                backgroundColor="rgba(0,0,0,0)"
                onEngineStop={handleEngineStop}
                nodeRelSize={1}
                nodeVal={(n) => {
                  const node = n as AnyNode;
                  // Constituent nodes are sized by weight (smaller than parent ETFs).
                  if (node.isConstituent) {
                    const w = node.weight ?? 0.01;
                    return 4 + Math.min(20, Math.sqrt(w) * 80);
                  }
                  // Per spec: size ∝ rank — top-ranked sectors biggest, laggards smallest.
                  // Use the count of CURRENT ranked nodes (excluding constituents) so the
                  // scale isn't affected by an open sector expansion.
                  const ranked = graphData.nodes.filter((g) => g.rank != null).length || 26;
                  if (node.rank == null) return 4;
                  const inverse = ranked - node.rank + 1;
                  return 4 + inverse * 1.5;
                }}
                nodeColor={(n) => {
                  const node = n as AnyNode;
                  let col: string;
                  if (node.isConstituent) {
                    col = "#a3a3ad";
                  } else if (node.kind === "macro") {
                    col = MACRO_COLOR;
                  } else {
                    col = BUCKET_COLOR[node.bucket];
                  }
                  // Shock overlay: nodes that have "arrived" by the current
                  // timer step are heated to red, fading back to base color
                  // as more time passes since their arrival.
                  if (shockSource) {
                    const arrival = shockArrivals.get(node.id);
                    if (arrival === undefined) {
                      col = withAlpha(col, 0.18); // unreachable: dim
                    } else if (shockTimer >= arrival) {
                      const since = shockTimer - arrival;
                      // Fresh shocks burn red; older arrivals fade to amber.
                      col = since <= 1 ? "#FF3030" : since <= 3 ? "#FF9030" : "#FFD060";
                    } else {
                      col = withAlpha(col, 0.25); // not yet hit
                    }
                  }
                  if (!hovered) return col;
                  return isVisible(node.id) ? col : withAlpha(col, 0.12);
                }}
                nodeLabel={(n) => {
                  const node = n as AnyNode;
                  if (mode === "lead-lag") {
                    return `${node.id} — ${node.bucket} · degree ${Math.round(node.avg_correlation)}`;
                  }
                  return `${node.id} — ${node.bucket}${node.return_window != null ? ` (${(node.return_window * 100).toFixed(1)}% over ${windowDays}d)` : ""}`;
                }}
                linkColor={(l) => {
                  const link = l as AnyLink;
                  if (link.isTether) {
                    return isLinkLit(link) ? "rgba(120,200,255,0.55)" : "rgba(120,200,255,0.05)";
                  }
                  const r = link.correlation;
                  const baseAlpha = Math.min(0.9, Math.abs(r) * 1.1);
                  const alpha = isLinkLit(link) ? baseAlpha : baseAlpha * 0.08;
                  if (mode === "lead-lag") {
                    return `rgba(180,170,255,${alpha})`;
                  }
                  return r >= 0
                    ? `rgba(255,255,255,${alpha})`
                    : `rgba(255,80,0,${alpha})`;
                }}
                linkWidth={(l) => {
                  const link = l as AnyLink;
                  const base = 0.5 + Math.abs(link.correlation) * 3.5;
                  if (link.inMst && showMstOnly === false) return base * 1.3;
                  return base;
                }}
                linkDirectionalParticles={mode === "lead-lag" ? 2 : 0}
                linkDirectionalParticleWidth={2}
                linkDirectionalParticleSpeed={0.006}
                linkDirectionalArrowLength={mode === "lead-lag" ? 4 : 0}
                linkDirectionalArrowRelPos={1}
                cooldownTicks={120}
                onNodeHover={(n) => setHovered((n as AnyNode | null) ?? null)}
                onNodeClick={(n, e) => handleNodeClick(n as AnyNode, e)}
                onNodeDragEnd={(n) => handleNodeDragEnd(n as AnyNode)}
                nodeCanvasObjectMode={() => "after"}
                nodeCanvasObject={(n, ctx, globalScale) => {
                  const node = n as AnyNode;
                  const ranked = graphData.nodes.filter((g) => g.rank != null).length || 26;
                  let radius: number;
                  if (node.isConstituent) {
                    const w = node.weight ?? 0.01;
                    radius = (4 + Math.min(20, Math.sqrt(w) * 80)) ** 0.5 * 1.4;
                  } else {
                    const inverse = node.rank == null ? 0 : ranked - node.rank + 1;
                    radius = (4 + inverse * 1.5) ** 0.5 * 1.4;
                  }
                  // Portfolio overlay ring — green for net-long sector exposure,
                  // orange for net-short. Width scales with the net weight.
                  if (
                    showPortfolio &&
                    !node.isConstituent &&
                    node.kind !== "macro"
                  ) {
                    const ov = sectorOverlay.get(node.id);
                    if (ov && (ov.longCount > 0 || ov.shortCount > 0)) {
                      const ringWorld = 2.5 / globalScale + Math.min(3, Math.abs(ov.netWeight) * 12) / globalScale;
                      ctx.beginPath();
                      ctx.arc(node.x ?? 0, node.y ?? 0, radius + ringWorld * 1.2, 0, Math.PI * 2);
                      ctx.lineWidth = ringWorld;
                      ctx.strokeStyle =
                        ov.netWeight >= 0
                          ? "rgba(0,200,5,0.85)"
                          : "rgba(255,80,0,0.85)";
                      ctx.stroke();
                    }
                  }
                  // Shock pulse — draw an expanding ring on nodes that just got hit.
                  if (shockSource) {
                    const arrival = shockArrivals.get(node.id);
                    if (arrival !== undefined && shockTimer === arrival) {
                      const pulseWorld = (radius + 4) * 1.8;
                      ctx.beginPath();
                      ctx.arc(node.x ?? 0, node.y ?? 0, pulseWorld, 0, Math.PI * 2);
                      ctx.lineWidth = 1.5 / globalScale;
                      ctx.strokeStyle = "rgba(255,60,60,0.7)";
                      ctx.stroke();
                    }
                  }
                  // Render labels at a CONSTANT screen size regardless of zoom.
                  // Lightweight-charts: world_size * globalScale = screen pixels.
                  // So world_size = target_screen_px / globalScale.
                  const labelScreenPx = node.isConstituent ? 9 : 11;
                  const labelWorld = labelScreenPx / globalScale;
                  ctx.font = `${labelWorld}px var(--font-jb-mono), ui-monospace, monospace`;
                  ctx.textAlign = "center";
                  ctx.textBaseline = "middle";
                  const visible = isVisible(node.id);
                  ctx.fillStyle = visible ? "#fff" : "rgba(255,255,255,0.18)";
                  ctx.fillText(node.id, node.x ?? 0, node.y ?? 0);
                  // Pin indicator if node is fixed.
                  if (node.fx != null && node.fy != null) {
                    const pinPx = 8 / globalScale;
                    ctx.font = `${pinPx}px var(--font-jb-mono), ui-monospace, monospace`;
                    ctx.fillStyle = visible ? "rgba(255,200,80,0.85)" : "rgba(255,200,80,0.18)";
                    ctx.fillText("●", (node.x ?? 0) + radius + pinPx * 0.5, (node.y ?? 0) - radius - pinPx * 0.3);
                  }
                  if (node.rank != null && !node.isConstituent) {
                    const rankWorld = 9 / globalScale;
                    ctx.font = `${rankWorld}px var(--font-jb-mono), ui-monospace, monospace`;
                    ctx.fillStyle = visible
                      ? "rgba(255,255,255,0.5)"
                      : "rgba(255,255,255,0.1)";
                    ctx.fillText(`#${node.rank}`, node.x ?? 0, (node.y ?? 0) + radius + rankWorld * 0.7);
                  }
                }}
              />
            )}
          </div>
          {hovered && (
            <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-card/95 px-3 py-2 text-xs shadow-lg ring-1 ring-border">
              <div className="font-semibold">
                {hovered.id}
                {hovered.kind === "macro" && (
                  <span className="ml-2 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-300">macro</span>
                )}
              </div>
              <div className="text-muted-foreground">
                {hovered.isConstituent
                  ? `constituent of ${hovered.parentEtf}`
                  : hovered.kind === "macro"
                  ? "context overlay"
                  : hovered.bucket}
                {hovered.rank != null && ` · rank #${hovered.rank}`}
              </div>
              {hovered.weight != null && (
                <div className="num">weight: {(hovered.weight * 100).toFixed(2)}%</div>
              )}
              {hovered.return_window != null && (
                <div className="num">
                  {windowDays}d return: {(hovered.return_window * 100).toFixed(2)}%
                </div>
              )}
              {!hovered.isConstituent && (
                <div className="num text-muted-foreground">
                  {mode === "lead-lag" ? "degree" : "avg |r|"}: {hovered.avg_correlation.toFixed(2)}
                </div>
              )}
              {showPortfolio &&
                !hovered.isConstituent &&
                hovered.kind !== "macro" &&
                (() => {
                  const ov = sectorOverlay.get(hovered.id);
                  if (!ov || (ov.longCount === 0 && ov.shortCount === 0)) return null;
                  return (
                    <div className="mt-1 border-t border-border pt-1 text-[11px]">
                      <div className="num text-muted-foreground">
                        watchlist: {ov.netWeight >= 0 ? "+" : ""}
                        {(ov.netWeight * 100).toFixed(1)}% net
                      </div>
                      {ov.topLongs.length > 0 && (
                        <div className="text-signal-bullish">↑ {ov.topLongs.join(", ")}</div>
                      )}
                      {ov.topShorts.length > 0 && (
                        <div className="text-signal-bearish">↓ {ov.topShorts.join(", ")}</div>
                      )}
                    </div>
                  );
                })()}
              {shockSource && shockArrivals.has(hovered.id) && (
                <div className="mt-1 border-t border-border pt-1 num text-[11px] text-amber-300">
                  shock arrives day +{shockArrivals.get(hovered.id)}
                </div>
              )}
            </div>
          )}
          {shockSource && (
            <div className="pointer-events-none absolute right-3 top-3 rounded-lg bg-card/95 px-3 py-2 text-xs shadow-lg ring-1 ring-border">
              <div className="font-semibold text-amber-300">
                Shock from {shockSource}
              </div>
              <div className="num text-muted-foreground">
                day +{shockTimer} · {shockArrivals.size - 1} followers
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3 rounded-xl border border-border bg-card/40 px-4 py-3">
        {mode === "correlation" && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="w-14 shrink-0 font-semibold uppercase tracking-wide text-foreground/80">
              When
            </span>
            <input
              type="range"
              min={0}
              max={504}
              step={1}
              value={daysBack}
              onChange={(e) => setDaysBack(parseInt(e.target.value))}
              className="flex-1 accent-primary"
              title="Drag back in time to replay how the network looked"
            />
            <span className="num w-28 text-foreground">
              {daysBack === 0
                ? "now"
                : `${asOf} (-${daysBack}d)`}
            </span>
            {daysBack !== 0 && (
              <button
                type="button"
                onClick={() => setDaysBack(0)}
                className="rounded-full border border-border bg-card px-3 py-1 text-foreground hover:bg-muted"
              >
                Reset to now
              </button>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="w-14 shrink-0 font-semibold uppercase tracking-wide text-foreground/80">
            Layers
          </span>
          {mode === "correlation" && (
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={includeMacros}
                onChange={(e) => setIncludeMacros(e.target.checked)}
                className="accent-primary"
              />
              <span title="Add VIX, TLT, dollar, gold, oil, HY, BTC as context nodes">
                Macros
              </span>
            </label>
          )}
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={showPortfolio}
              onChange={(e) => setShowPortfolio(e.target.checked)}
              className="accent-primary"
            />
            <span title="Ring each sector by net watchlist exposure (long/short)">
              Watchlist ring
            </span>
          </label>
          {mode === "lead-lag" && (
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={shockMode}
                onChange={(e) => {
                  setShockMode(e.target.checked);
                  if (!e.target.checked) setShockSource(null);
                }}
                className="accent-primary"
              />
              <span title="Click a node to simulate a shock propagating along Granger lags">
                Shock mode
              </span>
            </label>
          )}
          {shockSource && (
            <button
              type="button"
              onClick={() => setShockSource(null)}
              className="rounded-full border border-border bg-card px-3 py-1 text-foreground hover:bg-muted"
            >
              Clear shock ✕
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Hover to isolate · click a node to drill into the sector · shift-click to expand into constituents · drag to pin · alt-click a pin to release{mode === "lead-lag" ? " · shock mode: click a node to fire a propagation simulation" : ""}.
      </p>
    </div>
  );
}

function Controls({
  mode, onModeChange,
  windowDays, onWindowChange,
  minCorr, onMinCorrChange,
  horizon, onHorizonChange,
  signFilter, onSignFilterChange,
  showMstOnly, onShowMstOnlyChange,
  maxP, onMaxPChange,
  maxLag, onMaxLagChange,
  search, onSearchChange, onSearchSubmit,
  expandedEtf, onClearExpansion,
}: {
  mode: Mode; onModeChange: (m: Mode) => void;
  windowDays: number; onWindowChange: (v: number) => void;
  minCorr: number; onMinCorrChange: (v: number) => void;
  horizon: 5 | 10 | 20; onHorizonChange: (v: 5 | 10 | 20) => void;
  signFilter: SignFilter; onSignFilterChange: (v: SignFilter) => void;
  showMstOnly: boolean; onShowMstOnlyChange: (v: boolean) => void;
  maxP: number; onMaxPChange: (v: number) => void;
  maxLag: number; onMaxLagChange: (v: number) => void;
  search: string; onSearchChange: (v: string) => void; onSearchSubmit: () => void;
  expandedEtf: string | null; onClearExpansion: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {/* Mode toggle */}
      <div className="inline-flex overflow-hidden rounded-full border border-border">
        <button
          type="button"
          className={`px-3 py-1 ${mode === "correlation" ? "bg-card text-foreground" : "bg-transparent"}`}
          onClick={() => onModeChange("correlation")}
        >
          Correlation
        </button>
        <button
          type="button"
          className={`px-3 py-1 ${mode === "lead-lag" ? "bg-card text-foreground" : "bg-transparent"}`}
          onClick={() => onModeChange("lead-lag")}
        >
          Lead-lag
        </button>
      </div>

      {/* Mode-specific knobs */}
      {mode === "correlation" ? (
        <>
          <label className="flex items-center gap-2">
            <span>Min |r|</span>
            <input
              type="range" min={0.5} max={0.95} step={0.05}
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
          <div className="inline-flex overflow-hidden rounded-full border border-border">
            {(["all", "positive", "negative"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`px-3 py-1 ${signFilter === s ? "bg-card text-foreground" : "bg-transparent"}`}
                onClick={() => onSignFilterChange(s)}
                title={s === "negative" ? "Show only inverse pairs (hedges)" : undefined}
              >
                {s === "all" ? "All" : s === "positive" ? "+only" : "−only"}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <label className="flex items-center gap-2">
            <span>Max p</span>
            <input
              type="range" min={0.001} max={0.10} step={0.005}
              value={maxP}
              onChange={(e) => onMaxPChange(parseFloat(e.target.value))}
              className="accent-primary"
            />
            <span className="num w-12 text-foreground">{maxP.toFixed(3)}</span>
          </label>
          <label className="flex items-center gap-2">
            <span>Max lag</span>
            <select
              value={maxLag}
              onChange={(e) => onMaxLagChange(parseInt(e.target.value))}
              className="rounded-full border border-border bg-card px-3 py-1 text-foreground"
            >
              <option value={3}>3d</option>
              <option value={5}>5d</option>
              <option value={10}>10d</option>
              <option value={20}>20d</option>
            </select>
          </label>
        </>
      )}

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

      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={showMstOnly}
          onChange={(e) => onShowMstOnlyChange(e.target.checked)}
          className="accent-primary"
        />
        <span title="Show only the minimum spanning tree backbone">MST only</span>
      </label>

      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          onSearchSubmit();
        }}
      >
        <input
          type="text"
          placeholder="Find ticker"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-28 rounded-full border border-border bg-card px-3 py-1 text-foreground placeholder:text-muted-foreground/50"
        />
      </form>

      {expandedEtf && (
        <button
          type="button"
          onClick={onClearExpansion}
          className="rounded-full border border-border bg-card px-3 py-1 text-foreground hover:bg-muted"
        >
          Collapse {expandedEtf} ✕
        </button>
      )}
    </div>
  );
}

function Legend({
  mode, nodeCount, edgeCount, totalEdges, nObs,
}: {
  mode: Mode;
  nodeCount: number;
  edgeCount: number;
  totalEdges: number;
  nObs: number | undefined;
}) {
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
        {mode === "correlation" ? "size = rank · edge = correlation" : "size = degree · arrow = leader → follower · opacity = significance"}
        <span className="ml-2 text-[10px] opacity-70">
          ({nodeCount} nodes · {edgeCount}{edgeCount !== totalEdges ? `/${totalEdges}` : ""} edges
          {nObs != null && mode === "correlation" ? ` · ${nObs} bars` : ""})
        </span>
      </span>
    </div>
  );
}

// Convert a hex color to an rgba string with the given alpha. Falls back to
// the original string if parsing fails (e.g. for already-rgba inputs).
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
    const hex =
      color.length === 4
        ? color
            .slice(1)
            .split("")
            .map((c) => c + c)
            .join("")
        : color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}
