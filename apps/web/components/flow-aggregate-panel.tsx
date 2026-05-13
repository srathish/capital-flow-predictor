"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { FlowAggregateResponse, FlowSuggestedPlaysResponse } from "@/lib/types";

// Per-ticker UW flow aggregator. Pulls every alert we've ingested for the
// ticker (no time-window dropdown — the server defaults to days=730 which
// is effectively "everything UW gives us"), then summarizes:
//
//   * Overall bull/bear verdict + plain-English reason
//   * Expiry-bucket profile (0-7d / 7-30d / 30-90d / 90d+) with per-bucket
//     call vs put premium + bullish score
//   * Top strikes by dollar premium (with furthest expiry)
//   * Largest single tickets (with % at ask = institutional aggression)
//
// Shared between /lab and /flow.

function fmtUsd(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(digits)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(digits)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(digits)}K`;
  return `$${n.toFixed(0)}`;
}

export function FlowAggregatePanel() {
  const [ticker, setTicker] = useState("NVDA");
  const [data, setData] = useState<FlowAggregateResponse | null>(null);
  const [suggest, setSuggest] = useState<FlowSuggestedPlaysResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setError(null);
    const sym = ticker.trim().toUpperCase();
    try {
      const [agg, sug] = await Promise.all([
        api.flowAggregate(sym),
        api.flowSuggestPlays(sym, 3).catch(() => null),
      ]);
      setData(agg);
      setSuggest(sug);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }

  const verdictCls =
    data?.verdict === "bullish"
      ? "bg-green-900/30 text-green-300 border-green-700/60"
      : data?.verdict === "bearish"
        ? "bg-rose-900/30 text-rose-300 border-rose-700/60"
        : "bg-muted/40 text-muted-foreground border-border";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-medium">Flow aggregate · all UW data we have</h3>
        <span className="text-xs text-muted-foreground">
          Bull/bear lean · expiry profile · top strikes · largest tickets
        </span>
      </div>
      <div className="mb-3 flex gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker"
          className="w-32 rounded border border-border bg-background px-2 py-1 text-sm uppercase"
          maxLength={12}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
          }}
        />
        <button
          type="button"
          onClick={go}
          disabled={loading || !ticker.trim()}
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
        >
          {loading ? "…" : "Analyze"}
        </button>
        {data && (
          <span className="ml-2 self-center text-xs text-muted-foreground">
            {data.coverage_summary}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {data && (
        <div className="space-y-3 text-sm">
          {/* Verdict + headline metrics */}
          <div className={`rounded border px-3 py-2 ${verdictCls}`}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide">{data.verdict}</span>
              <span className="font-mono text-xs">
                score {data.bullish_score >= 0 ? "+" : ""}{data.bullish_score.toFixed(2)}
              </span>
            </div>
            <p className="text-xs">{data.verdict_reason}</p>
          </div>

          {suggest && <SuggestedPlaysBlock data={suggest} />}

          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded border border-border/50 p-2">
              <div className="text-muted-foreground">Alerts</div>
              <div className="font-mono text-base">{data.n_alerts}</div>
            </div>
            <div className="rounded border border-border/50 p-2">
              <div className="text-muted-foreground">Total premium</div>
              <div className="font-mono text-base">{fmtUsd(data.total_premium)}</div>
            </div>
            <div className="rounded border border-border/50 p-2">
              <div className="text-muted-foreground">Call premium</div>
              <div className="font-mono text-base text-green-300">{fmtUsd(data.total_call_premium)}</div>
            </div>
            <div className="rounded border border-border/50 p-2">
              <div className="text-muted-foreground">Put premium</div>
              <div className="font-mono text-base text-rose-300">{fmtUsd(data.total_put_premium)}</div>
            </div>
            <div className="rounded border border-border/50 p-2">
              <div className="text-muted-foreground">Net call ask‑side</div>
              <div className="font-mono text-base">{fmtUsd(data.net_call_premium)}</div>
            </div>
            <div className="rounded border border-border/50 p-2">
              <div className="text-muted-foreground">Net put ask‑side</div>
              <div className="font-mono text-base">{fmtUsd(data.net_put_premium)}</div>
            </div>
            <div className="rounded border border-border/50 p-2">
              <div className="text-muted-foreground">LEAP call ({"≥90d"})</div>
              <div className="font-mono text-base">{fmtUsd(data.leap_call_premium)}</div>
            </div>
            <div className="rounded border border-border/50 p-2">
              <div className="text-muted-foreground">LEAP put ({"≥90d"})</div>
              <div className="font-mono text-base">{fmtUsd(data.leap_put_premium)}</div>
            </div>
          </div>

          {data.expiry_buckets.some((b) => b.n_alerts > 0) && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Expiry profile · where the money is concentrated in time
                </span>
                <span className="text-xs text-foreground">{data.expiry_headline}</span>
              </div>
              <div className="overflow-hidden rounded border border-border/50">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left">Window</th>
                      <th className="px-2 py-1 text-right">Alerts</th>
                      <th className="px-2 py-1 text-right text-green-300">Call $</th>
                      <th className="px-2 py-1 text-right text-rose-300">Put $</th>
                      <th className="px-2 py-1 text-left">Mix</th>
                      <th className="px-2 py-1 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.expiry_buckets.map((b) => {
                      const total = b.call_premium + b.put_premium;
                      const callPct = total > 0 ? (b.call_premium / total) * 100 : 0;
                      const scoreCls =
                        b.bullish_score > 0.15
                          ? "text-green-300"
                          : b.bullish_score < -0.15
                            ? "text-rose-300"
                            : "text-muted-foreground";
                      return (
                        <tr key={b.label} className="border-t border-border/40">
                          <td className="px-2 py-1 font-mono font-semibold">{b.label}</td>
                          <td className="px-2 py-1 text-right">{b.n_alerts}</td>
                          <td className="px-2 py-1 text-right font-mono text-green-300">{fmtUsd(b.call_premium)}</td>
                          <td className="px-2 py-1 text-right font-mono text-rose-300">{fmtUsd(b.put_premium)}</td>
                          <td className="px-2 py-1">
                            {total > 0 ? (
                              <div className="flex h-2 w-32 overflow-hidden rounded bg-muted/40">
                                <div className="h-full bg-green-500/70" style={{ width: `${callPct}%` }} />
                                <div className="h-full bg-rose-500/70" style={{ width: `${100 - callPct}%` }} />
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className={`px-2 py-1 text-right font-mono ${scoreCls}`}>
                            {b.bullish_score >= 0 ? "+" : ""}{b.bullish_score.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Score = (call ask-side premium − put ask-side premium) / total bucket premium. Above
                +0.15 = buyers lifting offers on calls; below −0.15 = buyers lifting offers on puts.
              </p>
            </div>
          )}

          {data.oi_growth_strikes.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Open interest growth · positions added to in last {data.oi_growth_window_days}d
                </span>
                <span className="text-xs text-muted-foreground">
                  Daily OI deltas summed per strike. Positive Δ = positions opening (or
                  netting open); negative = closing.
                </span>
              </div>
              <div className="overflow-hidden rounded border border-border/50">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left">Strike</th>
                      <th className="px-2 py-1 text-left">Type</th>
                      <th className="px-2 py-1 text-left">Expiry</th>
                      <th className="px-2 py-1 text-right">ΔOI ({data.oi_growth_window_days}d)</th>
                      <th className="px-2 py-1 text-right">Current OI</th>
                      <th className="px-2 py-1 text-right">Streak</th>
                      <th className="px-2 py-1 text-right">Days w/ data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.oi_growth_strikes.map((s, i) => {
                      const isGrowth = s.oi_delta > 0;
                      const sideCls = s.option_type === "call" ? "text-green-300" : "text-rose-300";
                      const deltaCls = isGrowth
                        ? "text-green-300"
                        : s.oi_delta < 0
                          ? "text-rose-300"
                          : "text-muted-foreground";
                      return (
                        <tr
                          key={`${s.strike}-${s.option_type}-${s.expiry}-${i}`}
                          className="border-t border-border/40"
                        >
                          <td className="px-2 py-1 font-mono font-semibold">${s.strike.toFixed(2)}</td>
                          <td className={`px-2 py-1 uppercase ${sideCls}`}>{s.option_type}</td>
                          <td className="px-2 py-1 font-mono">{s.expiry ?? "—"}</td>
                          <td className={`px-2 py-1 text-right font-mono ${deltaCls}`}>
                            {s.oi_delta > 0 ? "+" : ""}{s.oi_delta.toLocaleString()}
                          </td>
                          <td className="px-2 py-1 text-right font-mono">{s.current_oi.toLocaleString()}</td>
                          <td className="px-2 py-1 text-right font-mono">
                            {s.days_of_oi_increases !== null ? `${s.days_of_oi_increases}d` : "—"}
                          </td>
                          <td className="px-2 py-1 text-right">{s.days_with_data}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                "Streak" = consecutive trading days OI has grown on this contract (UW signal).
                Big positive deltas on far-dated calls = real bullish accumulation;
                deep-OTM put accumulation often = hedging, not directional bearish bets.
              </p>
            </div>
          )}

          {data.top_strikes.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Top strikes by $ premium
                {data.top_strikes[0] && (
                  <>
                    {" "}— biggest:{" "}
                    <span className="font-mono text-foreground">
                      ${data.top_strikes[0].strike} {data.top_strikes[0].option_type}s
                    </span>{" "}
                    ({fmtUsd(data.top_strikes[0].total_premium)})
                  </>
                )}
              </div>
              <div className="overflow-hidden rounded border border-border/50">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left">Strike</th>
                      <th className="px-2 py-1 text-left">Type</th>
                      <th className="px-2 py-1 text-right">Premium</th>
                      <th className="px-2 py-1 text-right">Alerts</th>
                      <th className="px-2 py-1 text-right">Furthest expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_strikes.map((s, i) => (
                      <tr key={`${s.strike}-${s.option_type}-${i}`} className="border-t border-border/40">
                        <td className="px-2 py-1 font-mono font-semibold">${s.strike.toFixed(2)}</td>
                        <td className={`px-2 py-1 uppercase ${s.option_type === "call" ? "text-green-300" : "text-rose-300"}`}>
                          {s.option_type}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">{fmtUsd(s.total_premium)}</td>
                        <td className="px-2 py-1 text-right">{s.alert_count}</td>
                        <td className="px-2 py-1 text-right font-mono">{s.largest_expiry ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.top_trades.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Largest single tickets
              </div>
              <div className="overflow-hidden rounded border border-border/50">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left">Date</th>
                      <th className="px-2 py-1 text-left">Type</th>
                      <th className="px-2 py-1 text-left">Strike</th>
                      <th className="px-2 py-1 text-left">Expiry</th>
                      <th className="px-2 py-1 text-right">Premium</th>
                      <th className="px-2 py-1 text-right">% at ask</th>
                      <th className="px-2 py-1 text-left">Alert</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_trades.map((t, i) => (
                      <tr key={`${t.option_chain ?? i}-${i}`} className="border-t border-border/40">
                        <td className="px-2 py-1 font-mono">{t.ts.slice(0, 10)}</td>
                        <td className={`px-2 py-1 uppercase ${t.option_type === "call" ? "text-green-300" : "text-rose-300"}`}>
                          {t.option_type}
                        </td>
                        <td className="px-2 py-1 font-mono">${t.strike.toFixed(2)}</td>
                        <td className="px-2 py-1 font-mono">{t.expiry ?? "—"}</td>
                        <td className="px-2 py-1 text-right font-mono">{fmtUsd(t.total_premium)}</td>
                        <td className="px-2 py-1 text-right font-mono">
                          {t.ask_side_pct !== null ? `${(t.ask_side_pct * 100).toFixed(0)}%` : "—"}
                        </td>
                        <td className="px-2 py-1 text-[10px] text-muted-foreground">{t.alert ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.n_alerts === 0 && (
            <p className="text-xs text-muted-foreground">
              No UW flow alerts ingested for {data.ticker} yet. Pull fresh data with{" "}
              <code className="font-mono">cfp-jobs flow {data.ticker.toLowerCase()}</code>{" "}
              and try again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}


// ---------- Suggested Plays (PROCEED/WAIT/SKIP gate + ranked candidates) ----------


function SuggestedPlaysBlock({ data }: { data: FlowSuggestedPlaysResponse }) {
  const gateCls =
    data.gate === "proceed"
      ? "border-green-600 bg-green-950/50 text-green-200"
      : data.gate === "skip"
        ? "border-rose-700 bg-rose-950/50 text-rose-200"
        : "border-amber-600 bg-amber-950/40 text-amber-200";
  const gateLabel = data.gate.toUpperCase();

  return (
    <div className="space-y-3">
      {/* Top-of-section verdict gate */}
      <div className={`rounded border px-3 py-2 ${gateCls}`}>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider">
            Suggested action · {gateLabel}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wide">
            spot {data.spot ? `$${data.spot.toFixed(2)}` : "—"} · {data.n_candidates_considered} candidates considered
          </span>
        </div>
        <p className="text-xs">{data.gate_reason}</p>
      </div>

      {data.plays.length > 0 && (
        <div className="space-y-2">
          {data.plays.map((p) => {
            const convictionCls =
              p.conviction === "high"
                ? "bg-green-900/40 text-green-200 border-green-700"
                : p.conviction === "medium"
                  ? "bg-amber-900/30 text-amber-200 border-amber-700/60"
                  : "bg-muted/40 text-muted-foreground border-border";
            const sideCls = p.option_type === "call" ? "text-green-300" : "text-rose-300";
            return (
              <div
                key={`${p.rank}-${p.strike}-${p.option_type}-${p.expiry}`}
                className="rounded border border-border/60 p-3"
              >
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-base font-semibold">
                      #{p.rank} · ${p.strike.toFixed(2)}{" "}
                      <span className={`uppercase ${sideCls}`}>{p.option_type}</span>{" "}
                      <span className="font-mono text-xs text-muted-foreground">
                        exp {p.expiry} ({p.days_to_expiry}d)
                      </span>
                    </span>
                  </div>
                  <span
                    className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${convictionCls}`}
                  >
                    {p.conviction} · {p.conviction_score.toFixed(0)}/100
                  </span>
                </div>

                {/* Trade structure line — the actionable summary */}
                <div className="mb-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                  <div className="rounded border border-border/40 px-2 py-1">
                    <div className="text-muted-foreground">Contracts</div>
                    <div className="font-mono text-sm">{p.contracts}</div>
                  </div>
                  <div className="rounded border border-border/40 px-2 py-1">
                    <div className="text-muted-foreground">R:R</div>
                    <div className="font-mono text-sm">{p.risk_to_reward}</div>
                  </div>
                  <div className="rounded border border-border/40 px-2 py-1">
                    <div className="text-muted-foreground">Target / stop</div>
                    <div className="font-mono text-sm">
                      +{((p.target_payout_multiple - 1) * 100).toFixed(0)}% / {(p.stop_loss_pct * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div className="rounded border border-border/40 px-2 py-1">
                    <div className="text-muted-foreground">Spot target (approx)</div>
                    <div className="font-mono text-sm">
                      {p.approx_spot_target !== null ? `$${p.approx_spot_target.toFixed(2)}` : "—"}
                    </div>
                  </div>
                </div>

                {/* Evidence chips */}
                <ul className="mb-2 space-y-0.5 text-xs">
                  {p.why.map((w, i) => (
                    <li key={i} className="text-foreground">
                      • {w}
                    </li>
                  ))}
                </ul>

                {/* Caveats (trap detection) */}
                {p.caveats.length > 0 && (
                  <ul className="mb-2 space-y-0.5 rounded border border-rose-700/40 bg-rose-950/30 p-2 text-[11px]">
                    {p.caveats.map((c, i) => (
                      <li key={i} className="text-rose-200">⚠ {c}</li>
                    ))}
                  </ul>
                )}

                {/* Ensemble row + flip */}
                <div className="grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                  <div>
                    Ensemble:{" "}
                    <span className={p.ensemble_aligned ? "text-green-300" : "text-amber-300"}>
                      {p.ensemble_alignment_count}/{p.ensemble_total_voters} agents agree
                    </span>
                    {p.ensemble_pm_signal && (
                      <span> · PM {p.ensemble_pm_signal}</span>
                    )}
                  </div>
                  <div>
                    Invalidation: <span className="text-foreground">{p.flip_condition}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">{data.method_note}</p>
    </div>
  );
}
