// STEP 2 — VERIFY with Skylit: the map says WHERE (level, room, invalidation), never WHICH WAY.
// Per candidate × direction (from Step 1):
//   map     heat_heatmap gamma on the weekly expiry (batched 10/call, 1 credit) → A+ check with the exact failing reason
//   entry   the retest that HOLDS at the level; skip if the day opens > 0.3 ATR beyond it and slides in (cut OOS losses 75%)
//   stop    daily CLOSE beyond max(1 strike, 0.5 ATR) — 8/13 autopsied losers hit target later after a 1-strike stop
//   vol     tempest_events (earnings inside the hold → no trade) + tempest_iv (IV rank) — batched 10/call, 1 credit
//   option  UW chain (no Skylit credits): expiries 2–7 weeks out ("buy time"), strikes within 2% of the level → the tightest
//           real bid/ask with OI ≥ 100; shows bid/ask/mid so the card's cost is what you'd actually pay. A+ cards only.
//   context vanna lean (batched, 1 credit) + UW headlines (no Skylit credits)
import { heatmapLive, mcp } from '../feeds/skylit.js';
import { headlines, optionSymbols, contractQuote } from '../feeds/uw.js';
import { normalizeBoard } from '../map/board.js';
import { hierarchy } from '../map/hierarchy.js';
import { aplusDiagnose, APLUS } from '../system/aplus.js';
import { vexLean } from '../system/stockrules.js';
import { refreshDaily, weekly, buyTime, addDays, dow, tdRange, features, prevTD } from './common.mjs';

const chunks = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
async function batched(syms, fn) { const out = new Map(); for (const c of chunks(syms, 10)) { try { for (const [k, v] of await fn(c)) out.set(k, v); } catch (e) { console.error('batch fail', c.join(','), e.message.slice(0, 120)); } } return out; }

export async function verify(cands, { D, contracts = true }) {
  const syms = cands.map((c) => c.sym), wexp = weekly(D), cexp = buyTime(D);
  const hold = tdRange(D, APLUS.HOLD), holdEnd = hold.filter((d) => d < cexp).at(-1) ?? D;
  const spy = await refreshDaily('SPY', D);
  const daily = new Map(); for (const s of syms) daily.set(s, await refreshDaily(s, D));
  const ev = await batched(syms, async (c) => (await mcp('tempest_events', { symbols: c.join(',') })).data.symbols.map((x) => [x.symbol, x.events]));
  const iv = await batched(syms, async (c) => (await mcp('tempest_iv', { symbols: c.join(',') })).data.symbols.map((x) => [x.symbol, x.iv]));
  const gam = await batched(syms, async (c) => (await heatmapLive(c, { metric: 'gamma', expirations: wexp })).map((x) => [x.symbol, x]));
  const van = await batched(syms, async (c) => (await heatmapLive(c, { metric: 'vanna', expirations: wexp })).map((x) => [x.symbol, x]));
  const monday = addDays(D, -((dow(D) + 6) % 7));
  const cards = [];
  for (const c of cands) {
    const bars = daily.get(c.sym) ?? [], f = bars.length >= 60 ? features(bars, spy.filter((b) => b.d <= bars.at(-1).d)) : c.feat;
    const wk = bars.filter((b) => b.d >= monday && b.d < D), weekHi = Math.max(-Infinity, ...wk.map((b) => b.h)), weekLo = Math.min(Infinity, ...wk.map((b) => b.l));
    const e = ev.get(c.sym), next = e?.next_date ?? e?.earnings_context?.date ?? null, earnIn = next && next >= D && next <= holdEnd;
    const v = iv.get(c.sym), raw = gam.get(c.sym), lean = van.get(c.sym)?.strikes?.length ? vexLean(van.get(c.sym)) : null;
    const base = { D, sym: c.sym, find: c.why, trend: f?.trend ?? null, rs20: f ? +f.rs20.toFixed(4) : null, atr: f ? +f.atr.toFixed(2) : null,
      vol: { ivRank: v?.iv_rank ?? null, ivPct: v?.iv_pct ?? null, iv30: v?.svx30 != null ? +v.svx30.toFixed(1) : null, nextEarnings: next, impliedMove: e?.implied_move_pct ?? null },
      vanna: lean, mapExpiry: wexp, decision: null };
    if (!raw?.strikes?.length) { for (const dir of c.dirs) cards.push({ ...base, dir, status: 'NO MAP', reason: `no weekly ${wexp} map for ${c.sym}` }); continue; }
    const board = normalizeBoard({ ...raw, symbol: c.sym }); board.zone = board.spot * APLUS.ZONE_PCT;
    const diag = aplusDiagnose({ board, hier: hierarchy(board), chart: f?.trend ?? 'mixed', weekHi, weekLo });
    for (const dir of c.dirs) {
      const d = diag.find((x) => x.dir === dir), card = { ...base, dir, spot: +board.spot.toFixed(2) };
      if (!d.ok) { cards.push({ ...card, status: 'NO TRADE', reason: d.reason, level: d.entry ?? null }); continue; }
      if (earnIn) { cards.push({ ...card, status: 'NO TRADE', reason: `earnings ${next} inside the hold (implied ±${e?.implied_move_pct ?? '?'}%) — options overprice earnings 80% of the time`, level: d.entry }); continue; }
      const sg = dir === 'up' ? 1 : -1, stopClose = +(d.entry - sg * Math.max(Math.abs(d.entry - d.stop), APLUS.STOP_ATR * (f?.atr ?? 0))).toFixed(2);
      cards.push({ ...card, status: 'A+', plan: { zone: +board.zone.toFixed(3), entry: d.entry, entryType: d.entryType, share: +d.share.toFixed(3), target: d.target, targetType: d.targetType, t2: d.t2, nodeStop: d.stop, stopClose, rr: d.rr, holdEnd, why: d.why,
        entryRule: `wait for 09:35+; buy the 1-min bar that tags ${d.entry} (±${board.zone.toFixed(2)}) and CLOSES back ${dir === 'up' ? 'above' : 'below'} it (1st/2nd tap, before 15:30). SKIP if the day opens ${dir === 'up' ? 'above' : 'below'} ${(d.entry + sg * APLUS.SLIDE_ATR * (f?.atr ?? 0)).toFixed(2)} (slides into the level).`,
        exitRule: `half at ${d.target}, stop → entry; rest at ${d.t2 ?? d.target}; out on a daily CLOSE ${dir === 'up' ? 'below' : 'above'} ${stopClose}; time exit ${holdEnd}.` } });
    }
  }
  // contracts + headlines for the A+ cards only
  for (const card of cards.filter((x) => x.status === 'A+')) {
    if (contracts) card.contract = await pickContract(card.sym, card.dir, card.plan.entry, D);
    card.news = await headlines(card.sym, 3);
    const rank = card.vol.ivRank == null ? null : Math.round(card.vol.ivRank);
    card.volNote = rank == null ? 'IV rank n/a' : rank >= 70 ? `IV rich (rank ${rank}) — premium is expensive; a debit spread caps the IV-crush risk` : rank <= 30 ? `IV cheap (rank ${rank}) — favorable to buy premium` : `IV normal (rank ${rank})`;
  }
  return cards;
}

async function pickContract(sym, dir, level, D) {
  const type = dir === 'up' ? 'call' : 'put', lo = addDays(D, 14), hi = addDays(D, 50);
  const all = (await optionSymbols(sym, prevTD(D))).filter((o) => o.type === type && o.exp >= lo && o.exp <= hi && Math.abs(o.strike - level) / level <= 0.02);
  if (!all.length) return { note: `no ${type}s 2–7 weeks out within 2% of ${level}` };
  // per expiry, the 2 strikes nearest the level; quote up to 10 of them (UW, free) and keep the tightest liquid one
  const byExp = {}; for (const o of all) (byExp[o.exp] ??= []).push(o);
  const pick = Object.values(byExp).flatMap((xs) => xs.sort((a, b) => Math.abs(a.strike - level) - Math.abs(b.strike - level)).slice(0, 2)).sort((a, b) => a.exp.localeCompare(b.exp)).slice(0, 10);
  const q = []; for (const o of pick) { const x = await contractQuote(o.id); if (x) q.push({ ...o, ...x }); }
  const ok = q.filter((x) => x.oi >= 100 && x.bid > 0 && x.spreadPct != null).sort((a, b) => a.spreadPct - b.spreadPct || a.exp.localeCompare(b.exp));
  const best = ok[0] ?? q.filter((x) => x.bid > 0).sort((a, b) => b.oi - a.oi)[0];
  if (!best) return { note: 'no quoted contract near the level' };
  return { occ: best.id, exp: best.exp, strike: best.strike, type, bid: best.bid, ask: best.ask, mid: best.mid, spreadPct: best.spreadPct, oi: best.oi, volume: best.volume, iv: best.iv, quoteDate: best.date,
    liquid: best.oi >= 100 && best.spreadPct <= 10, note: best.oi >= 100 && best.spreadPct <= 10 ? 'liquid' : `thin — spread ${best.spreadPct}% / OI ${best.oi}; use a limit at mid or skip` };
}
