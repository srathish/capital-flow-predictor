"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { baseUrl, authHeaders } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type ExplosiveSubScores = {
  flow_concentration: number;
  iv_term: number;
  squeeze: number;
  catalyst: number;
  cheap_optionality: number;
  gex_bonus: number;
  iv_vs_rv?: number;
  skew_flip?: number;
  nope?: number;
  insider_buy?: number;
  volume_profile?: number;
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
  signals: Record<string, string>;
};

type ContractHistoryPoint = {
  trade_date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  open_interest: number | null;
  iv_close: number | null;
  underlying_close: number | null;
};

type FlowPerStrikePoint = {
  expiry: string;
  strike: number;
  call_premium: number | null;
  call_ask_premium: number | null;
  call_volume: number | null;
  call_oi: number | null;
};

type IvTermPoint = {
  expiry: string;
  dte: number | null;
  iv: number | null;
};

type MaxPainPoint = {
  expiry: string;
  max_pain_strike: number | null;
};

type CorrelationPeer = {
  ticker: string;
  correlation: number | null;
};

type TopNetImpactEntry = {
  rank: number | null;
  net_premium: number | null;
  net_delta: number | null;
  net_gamma: number | null;
};

type ExplosiveDetailResponse = {
  item: ExplosiveItem;
  contract_history: ContractHistoryPoint[];
  flow_per_strike: FlowPerStrikePoint[];
  iv_term: IvTermPoint[];
  max_pain: MaxPainPoint[];
  correlations: CorrelationPeer[];
  market_impact: TopNetImpactEntry | null;
};

const SUB_SCORE_LABELS: Record<keyof ExplosiveSubScores, string> = {
  flow_concentration: "Flow concentration",
  iv_term: "IV term inversion",
  squeeze: "Squeeze setup",
  catalyst: "Catalyst proximity",
  cheap_optionality: "Cheap optionality",
  gex_bonus: "GEX overlay",
  iv_vs_rv: "IV vs RV",
  skew_flip: "Skew flip",
  nope: "NOPE",
  insider_buy: "Insider buy",
  volume_profile: "Magnet strike",
};

async function fetchDetail(ticker: string): Promise<ExplosiveDetailResponse> {
  const res = await fetch(`${baseUrl()}/v1/explosive/${encodeURIComponent(ticker)}/detail`, {
    headers: { Accept: "application/json", ...authHeaders() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as ExplosiveDetailResponse;
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e9) return `${v < 0 ? "-" : ""}$${(Math.abs(v) / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${v < 0 ? "-" : ""}$${(Math.abs(v) / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${v < 0 ? "-" : ""}$${(Math.abs(v) / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v < 1) return `$${v.toFixed(2)}`;
  if (v < 100) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(0)}`;
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function catalystChipColor(type: string | null): string {
  if (type === "earnings") return "bg-primary/15 text-primary";
  if (type === "fda") return "bg-rose-500/15 text-rose-400";
  if (type === "ipo") return "bg-sky-500/15 text-sky-400";
  return "bg-muted text-muted-foreground";
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 55) return "text-amber-400";
  if (score >= 35) return "text-foreground";
  return "text-muted-foreground";
}

function SubScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(2, Math.min(100, value));
  const color =
    value >= 75 ? "bg-emerald-500" : value >= 55 ? "bg-amber-500" : value >= 35 ? "bg-foreground/60" : "bg-muted-foreground/40";
  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="w-32 shrink-0 text-muted-foreground">{label}</div>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-8 shrink-0 text-right tabular-nums">{value.toFixed(0)}</div>
    </div>
  );
}

function ContractHistoryChart({ points }: { points: ContractHistoryPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        No contract history yet. Run <code className="rounded bg-muted px-1 py-0.5">cfp-jobs explosive-drilldown</code>.
      </div>
    );
  }
  const closes = points.map((p) => p.close ?? 0).filter((v) => v > 0);
  if (closes.length === 0) {
    return <div className="p-4 text-xs text-muted-foreground">No closing prices.</div>;
  }
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = Math.max(max - min, 1e-6);
  const W = 320;
  const H = 80;
  const points2d = points
    .filter((p) => p.close != null)
    .map((p, i, arr) => ({
      x: (i / Math.max(arr.length - 1, 1)) * W,
      y: H - ((p.close! - min) / range) * H,
    }));
  const path = points2d.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  return (
    <div className="p-3">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="text-emerald-400">
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{fmtPrice(min)}</span>
        <span>{points.length} days</span>
        <span>{fmtPrice(max)}</span>
      </div>
    </div>
  );
}

function StrikeBars({ points, underlying }: { points: FlowPerStrikePoint[]; underlying: number | null }) {
  if (points.length === 0) {
    return <div className="p-4 text-xs text-muted-foreground">No flow data yet.</div>;
  }
  const max = Math.max(
    ...points.map((p) => Math.max(p.call_ask_premium ?? 0, p.call_premium ?? 0)),
    1,
  );
  return (
    <div className="space-y-1 p-3">
      {points.slice(0, 12).map((p) => {
        const ask = p.call_ask_premium ?? 0;
        const total = Math.max(ask, p.call_premium ?? 0);
        const otm = underlying != null && p.strike > underlying;
        return (
          <div key={`${p.expiry}-${p.strike}`} className="flex items-center gap-2 text-xs">
            <div className={cn("w-20 shrink-0 font-mono", otm && "text-emerald-400")}>
              ${p.strike < 10 ? p.strike.toFixed(1) : p.strike.toFixed(0)} {p.expiry.slice(5)}
            </div>
            <div className="h-3 flex-1 overflow-hidden rounded-sm bg-muted">
              <div
                className={cn("h-full", otm ? "bg-emerald-500/60" : "bg-foreground/30")}
                style={{ width: `${(total / max) * 100}%` }}
              />
            </div>
            <div className="w-16 shrink-0 text-right tabular-nums">{fmtMoney(total)}</div>
          </div>
        );
      })}
    </div>
  );
}

function IvCurve({ points }: { points: IvTermPoint[] }) {
  const usable = points.filter((p) => p.iv != null && p.dte != null);
  if (usable.length === 0) {
    return <div className="p-4 text-xs text-muted-foreground">No IV term structure.</div>;
  }
  const W = 320;
  const H = 80;
  const ivs = usable.map((p) => p.iv!);
  const min = Math.min(...ivs);
  const max = Math.max(...ivs);
  const range = Math.max(max - min, 1e-6);
  const dteMin = Math.min(...usable.map((p) => p.dte!));
  const dteMax = Math.max(...usable.map((p) => p.dte!));
  const dteRange = Math.max(dteMax - dteMin, 1);
  const path = usable.map((p, i) => {
    const x = ((p.dte! - dteMin) / dteRange) * W;
    const y = H - ((p.iv! - min) / range) * H;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  const inverted = usable[0].iv! > usable[usable.length - 1].iv!;
  return (
    <div className="p-3">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={inverted ? "text-rose-400" : "text-sky-400"}>
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{dteMin}d ({fmtPct(usable[0].iv)})</span>
        <span>{inverted ? "inverted" : "normal"}</span>
        <span>{dteMax}d ({fmtPct(usable[usable.length - 1].iv)})</span>
      </div>
    </div>
  );
}

export default function ExplosiveDrilldownPage() {
  const params = useParams<{ ticker: string }>();
  const ticker = (params?.ticker ?? "").toUpperCase();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["explosive-detail", ticker],
    queryFn: () => fetchDetail(ticker),
    enabled: !!ticker,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <Card>
          <CardContent className="p-6 text-sm text-rose-400">
            {(error as Error)?.message ?? "Not found"} —{" "}
            <Link href="/explosive" className="underline">back to explosive feed</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const it = data.item;

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/explosive" className="text-xs text-muted-foreground hover:text-foreground">
            ← Explosive feed
          </Link>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{it.ticker}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span>spot {fmtPrice(it.underlying_price)}</span>
            {it.catalyst_label && (
              <>
                <span>·</span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs", catalystChipColor(it.catalyst_type))}>
                  {it.catalyst_label}
                </span>
                <span>
                  {it.days_to_catalyst !== null
                    ? it.days_to_catalyst === 0
                      ? "today"
                      : `in ${it.days_to_catalyst}d`
                    : ""}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Score</div>
          <div className={cn("text-5xl font-semibold tabular-nums", scoreColor(it.score))}>
            {it.score.toFixed(0)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Top OTM contract</h2>
              {it.top_option_symbol && (
                <span className="font-mono text-[10px] text-muted-foreground">{it.top_option_symbol}</span>
              )}
            </div>
            {it.top_strike != null && it.top_expiry ? (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Strike</div>
                  <div className="font-mono">${it.top_strike.toFixed(it.top_strike < 10 ? 1 : 0)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Expiry</div>
                  <div className="font-mono">{it.top_expiry}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last</div>
                  <div className={cn("font-mono", it.top_last_price != null && it.top_last_price <= 0.75 && "text-emerald-400")}>
                    {fmtPrice(it.top_last_price)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Vol / OI</div>
                  <div className="font-mono">
                    {it.top_volume?.toLocaleString() ?? "—"} / {it.top_open_interest?.toLocaleString() ?? "—"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No contract yet identified.</div>
            )}
            <div className="mt-3 border-t border-border pt-2">
              <ContractHistoryChart points={data.contract_history} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Sub-scores</h2>
            <div className="space-y-1.5">
              {(Object.keys(SUB_SCORE_LABELS) as (keyof ExplosiveSubScores)[]).map((k) => (
                <SubScoreBar key={k} label={SUB_SCORE_LABELS[k]} value={it.sub_scores[k] ?? 0} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-semibold">Flow per strike (latest)</h2>
            <StrikeBars points={data.flow_per_strike} underlying={it.underlying_price} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-semibold">IV term structure</h2>
            <IvCurve points={data.iv_term} />
            {data.max_pain.length > 0 && (
              <div className="border-t border-border p-3">
                <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Max pain by expiry</h3>
                <div className="space-y-1 text-xs">
                  {data.max_pain.map((mp) => (
                    <div key={mp.expiry} className="flex justify-between font-mono">
                      <span className="text-muted-foreground">{mp.expiry}</span>
                      <span>${mp.max_pain_strike?.toFixed(2) ?? "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-semibold">Why this rank</h2>
            <div className="space-y-1 text-xs">
              {Object.entries(it.signals).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="w-32 shrink-0 text-muted-foreground">{k.replace("_", " ")}</span>
                  <span>{v}</span>
                </div>
              ))}
              {Object.keys(it.signals).length === 0 && (
                <div className="text-muted-foreground">No rationale captured.</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-semibold">Market context</h2>
            {data.market_impact && (
              <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Net Δ rank</div>
                  <div className="font-mono">#{data.market_impact.rank ?? "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Net premium</div>
                  <div className="font-mono">{fmtMoney(data.market_impact.net_premium)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Net gamma</div>
                  <div className="font-mono">{fmtMoney(data.market_impact.net_gamma)}</div>
                </div>
              </div>
            )}
            <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Peer correlations</h3>
            <div className="space-y-1 text-xs">
              {data.correlations.length === 0 && (
                <div className="text-muted-foreground">No peer correlations stored.</div>
              )}
              {data.correlations.map((c) => (
                <div key={c.ticker} className="flex justify-between">
                  <Link href={`/explosive/${encodeURIComponent(c.ticker)}`} className="hover:text-primary">
                    {c.ticker}
                  </Link>
                  <span className="font-mono tabular-nums">
                    {c.correlation != null ? c.correlation.toFixed(2) : "—"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
