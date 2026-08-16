#!/usr/bin/env node
// Is the edge SELECTIVITY? The vanna magnet is the one signal with positive evidence
// (case study + aggregate corr +0.11). Test: buying calls ONLY on strong-vanna-magnet-above
// setups (optionally + uptrend + IV not rich) vs spraying every week. If the selective
// subset's option P&L >> baseline, that's the melt-up edge the mechanical test washed out.
import { resolveFromRoot, readJson, log } from '../../lib/util.mjs';
const OHLC = readJson(resolveFromRoot('research/backtest/ohlc_cache.json')) || {};
const STRUCT = readJson(resolveFromRoot('research/backtest/struct_cache.json')) || {};
const SEVEN = [...new Set(Object.keys(STRUCT).map((k) => k.split('|')[0]))].filter((t) => OHLC[t]); // ALL cached names (7 + 32 = OOS generalization)
const iso = (d) => d.toISOString().slice(0, 10);
const WEEKS = [];
for (let d = new Date('2025-11-17T00:00:00Z'); d <= new Date('2026-08-10T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 7)) { const mon = new Date(d), fri = new Date(d), to = new Date(d); fri.setUTCDate(mon.getUTCDate() - 3); to.setUTCDate(mon.getUTCDate() + 12); WEEKS.push({ entry: iso(fri), from: iso(mon), to: iso(to) }); }
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
const normCdf = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2); let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
function bs(type, S, K, T, sig, r = 0.04) { if (T <= 0) return Math.max(type === 'C' ? S - K : K - S, 0); const sq = sig * Math.sqrt(T); const d1 = (Math.log(S / K) + (r + sig * sig / 2) * T) / sq, d2 = d1 - sq; return type === 'C' ? S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2) : K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1); }
function realizedVol(c) { const r = []; for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1])); if (r.length < 5) return 0.4; const m = mean(r); return Math.max(Math.sqrt(mean(r.map((x) => (x - m) ** 2)) * 252), 0.12); }
function thirdFriday(y, m) { const fr = []; for (let day = 1; day <= 31; day++) { const dd = new Date(Date.UTC(y, m - 1, day)); if (dd.getUTCMonth() !== m - 1) break; if (dd.getUTCDay() === 5) fr.push(dd); } return fr[2]; }
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
function pickExpiry(entry) { const [y, m] = entry.split('-').map(Number); for (let k = 0; k < 3; k++) { const mm = m + k, yy = y + Math.floor((mm - 1) / 12), mo = ((mm - 1) % 12) + 1; const tf = iso(thirdFriday(yy, mo)); if (daysBetween(entry, tf) >= 25) return tf; } return null; }
const atmStrike = (s) => { const i = s < 25 ? 0.5 : s < 50 ? 1 : s < 100 ? 2.5 : s < 200 ? 5 : 10; return Math.round(s / i) * i; };
const barsIn = (t, from, to) => (OHLC[t] || []).filter((b) => b.d >= from && b.d <= to && b.c != null).sort((a, b) => a.d < b.d ? -1 : 1);
const closesTo = (t, date, k) => (OHLC[t] || []).filter((b) => b.d <= date && b.c != null).sort((a, b) => a.d < b.d ? -1 : 1).slice(-k).map((b) => b.c);

// per (stock,week): vanna-magnet-above score, uptrend flag, IV, and a 10-day ATM CALL BS return
const rows = [];
for (const w of WEEKS) for (const t of SEVEN) {
  const st = STRUCT[`${t}|${w.entry}`]; if (!st || !st.spot) continue;
  const bars = barsIn(t, w.from, w.to); if (bars.length < 6) continue;
  const spot = st.spot, maxV = Math.max(...st.v.map((n) => Math.abs(n.m)), 0.01);
  const vAbove = st.v.filter((n) => n.m > 0 && n.k > spot * 1.005).sort((a, b) => b.m - a.m)[0];
  const vScore = vAbove ? vAbove.m / maxV : 0;               // 0..1 strength of the melt-up magnet
  const vDist = vAbove ? (vAbove.k - spot) / spot : 0;        // how far the magnet is
  const closes = closesTo(t, w.entry, 20); if (closes.length < 20) continue;
  const uptrend = spot > mean(closes);
  const sig = realizedVol(closesTo(t, w.entry, 22));
  const expiry = pickExpiry(w.entry); if (!expiry) continue;
  const K = atmStrike(spot), eB = bars[0], xB = bars[Math.min(10, bars.length - 1)];
  const en = bs('C', eB.o, K, daysBetween(eB.d, expiry) / 365, sig); if (!(en > 0.02)) continue;
  const ex = bs('C', xB.c, K, Math.max(daysBetween(xB.d, expiry) / 365, 0), sig);
  rows.push({ t, entry: w.entry, vScore, vDist, uptrend, callRet: (ex - en) / en * 100 });
}
const rep = (name, rs) => { const P = rs.map((r) => r.callRet); log(`${name.padEnd(34)} n=${String(rs.length).padStart(3)}  mean ${fmt(mean(P)).padStart(7)}  median ${fmt(median(P)).padStart(7)}  win ${(P.filter((x) => x > 0).length / P.length * 100 || 0).toFixed(0).padStart(3)}%`); };
log(`\n════ SELECTIVE vanna-melt-up (buy ATM call, 10d) — ${rows.length} stock-weeks ════`);
log('(BS ~+10pt optimistic vs real — subtract for a real estimate)\n');
rep('ALL weeks (spray)', rows);
const srt = [...rows].sort((a, b) => a.vScore - b.vScore); const t3 = Math.floor(srt.length / 3);
rep('LOW vanna tercile', srt.slice(0, t3));
rep('HIGH vanna tercile', srt.slice(2 * t3));
rep('vScore=1.0 (max magnet)', rows.filter((r) => r.vScore >= 0.999));
rep('HIGH vanna & uptrend', rows.filter((r) => r.vScore >= 0.999 && r.uptrend));
rep('HIGH vanna & uptrend & magnet 3-20% away', rows.filter((r) => r.vScore >= 0.999 && r.uptrend && r.vDist >= 0.03 && r.vDist <= 0.20));
rep('uptrend only (no vanna filter)', rows.filter((r) => r.uptrend));

log('\n── OVERFIT CHECK on the +66% subset (HIGH vanna & uptrend & magnet 3-20%, n=29) ──');
const sub = rows.filter((r) => r.vScore >= 0.999 && r.uptrend && r.vDist >= 0.03 && r.vDist <= 0.20);
const byT = {}; for (const r of sub) (byT[r.t] ||= []).push(r.callRet);
for (const t of SEVEN) if (byT[t]) log(`  ${t.padEnd(5)} n=${byT[t].length}  mean ${fmt(mean(byT[t]))}  median ${fmt(median(byT[t]))}`);
const P = [...sub.map((r) => r.callRet)].sort((a, b) => b - a);
log(`  distinct stocks: ${Object.keys(byT).length}/7   ex-top3: mean ${fmt(mean(P.slice(3)))} median ${fmt(median(P.slice(3)))}   worst ${fmt(P[P.length - 1])}`);
const months = {}; for (const r of sub) { const m = r.entry.slice(0, 7); months[m] = (months[m] || 0) + 1; }
log(`  months spanned: ${Object.keys(months).length}  (${Object.entries(months).map(([m, n]) => m + ':' + n).join(' ')})`);
for (const r of [...sub].sort((a, b) => b.callRet - a.callRet).slice(0, 6)) log(`    top ${r.t.padEnd(5)} ${r.entry} ${fmt(r.callRet)}`);
