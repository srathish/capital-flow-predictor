// watchlist-score.mjs — validate the Talon framework against reality by scoring
// published watchlists (Talon's OWN levels) AND our system's picks vs actual prices.
//
// KEY MODELING POINT: Talon/OTE entries are PULLBACK fills — a long fills when price
// DIPS to the OTE support (b.low <= ote), a short when price RALLIES to the OTE
// resistance (b.high >= ote). This is the opposite of resolveCard's breakout model
// (fill as price rises through a trigger), so it needs its own resolver. Using the
// wrong fill model would silently mis-score every setup.
//
// Input watchlist file schema (one JSON per resolved week):
//   {
//     "week": "2026-08-03",            // label
//     "entry_date": "2026-07-31",      // Friday before — we run OUR system as-of here (Skylit replay)
//     "resolve_from": "2026-08-03",    // Mon
//     "resolve_to": "2026-08-07",      // Fri (the week the setup should play out)
//     "names": [
//       { "ticker":"NBIS", "direction":"bullish", "ote":40, "invalidation":37, "first_target":45 },
//       ...
//     ]
//   }
import { watchlistRow } from './watchlist.mjs';

const norm = (d) => (d === 'bullish' || d === 'long' ? 'long' : d === 'bearish' || d === 'short' ? 'short' : d);

// Pure: resolve one OTE-pullback setup against forward daily OHLC within [from,to].
// R is in units of initial risk (ote→invalidation distance), signed by direction:
//   target hit → +reward/risk ; invalidation → ~ -1 (or worse on a gap) ; open → marked-to-close.
export function resolveOteSetup(setup, ohlc, { from = null, to = null } = {}) {
  const direction = norm(setup.direction);
  const { ote, invalidation, first_target } = setup;
  const out = { direction, entered: false, entry_date: null, outcome: 'no_fill', exit_date: null, exit_price: null, R: 0, mfe_pct: 0, mae_pct: 0, bars: 0 };
  if (!direction || ote == null || invalidation == null || first_target == null) { out.outcome = 'incomplete'; return out; }
  const long = direction === 'long';
  const risk = Math.abs(ote - invalidation);
  if (!risk) { out.outcome = 'incomplete'; return out; }
  const win = (ohlc || []).filter((d) => (!from || d.date >= from) && (!to || d.date <= to) && d.close != null).sort((a, b) => (a.date < b.date ? -1 : 1));
  out.bars = win.length;
  if (!win.length) return out;

  // entry = pullback fill
  let ei = -1;
  for (let i = 0; i < win.length; i++) { const b = win[i]; if (long ? b.low <= ote : b.high >= ote) { ei = i; break; } }
  if (ei < 0) return out; // never pulled back to the OTE — no fill
  out.entered = true; out.entry_date = win[ei].date;

  const signed = (px) => (long ? px - ote : ote - px) / risk;
  for (let i = ei; i < win.length; i++) {
    const b = win[i];
    const fav = long ? (b.high - ote) / ote : (ote - b.low) / ote;
    const adv = long ? (b.low - ote) / ote : (ote - b.high) / ote;
    if (fav > out.mfe_pct) out.mfe_pct = fav;
    if (adv < out.mae_pct) out.mae_pct = adv;
    // target intraday resolves before the close-basis invalidation on the same bar
    if (long ? b.high >= first_target : b.low <= first_target) { out.outcome = 'target'; out.exit_date = b.date; out.exit_price = first_target; out.R = signed(first_target); return out; }
    if (long ? b.close < invalidation : b.close > invalidation) { out.outcome = 'invalidation'; out.exit_date = b.date; out.exit_price = b.close; out.R = signed(b.close); return out; }
  }
  // window ended with the trade still open → mark to the last close
  const last = win[win.length - 1];
  out.outcome = 'open'; out.exit_date = last.date; out.exit_price = last.close; out.R = signed(last.close);
  return out;
}

// Aggregate resolved setups into hit-rate / expectancy stats (only entered trades count).
export function aggregate(resolved) {
  const entered = resolved.filter((r) => r.entered && r.outcome !== 'incomplete');
  const wins = entered.filter((r) => r.outcome === 'target');
  const n = entered.length;
  const Rs = entered.map((r) => r.R || 0).sort((a, b) => a - b);
  const sumR = Rs.reduce((s, r) => s + r, 0);
  const median = Rs.length ? (Rs.length % 2 ? Rs[(Rs.length - 1) / 2] : (Rs[Rs.length / 2 - 1] + Rs[Rs.length / 2]) / 2) : null;
  return {
    setups: resolved.length,
    no_fill: resolved.filter((r) => r.outcome === 'no_fill').length,
    entered: n,
    hits: wins.length,
    hit_rate: n ? wins.length / n : null,
    avg_R: n ? sumR / n : null,       // mean expectancy per entered setup (risk units) — tail-sensitive
    median_R: median,                 // robust to one gappy close-basis stop
    worst_R: Rs.length ? Rs[0] : null,
    best_R: Rs.length ? Rs[Rs.length - 1] : null,
    total_R: sumR,
  };
}

// ---- render ----
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`);
const R = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(2) + 'R');
const oc = (o) => ({ target: '✅ T1', invalidation: '❌ inval', open: '· open', no_fill: '· no-fill', incomplete: '?', error: '⚠️' }[o] || o);

export function renderScoreReport(result) {
  const L = [];
  L.push(`# Watchlist score — week of ${result.week} (entry ${result.entry_date}, resolved ${result.resolve_from}→${result.resolve_to})`);
  const tb = result.talon_baseline, our = result.our_result, ag = result.agreement;
  L.push('');
  L.push(`**Talon baseline:** ${tb.hits}/${tb.entered} hit T1 · win ${pct(tb.hit_rate)} · mean ${R(tb.avg_R)} · median ${R(tb.median_R)} · worst ${R(tb.worst_R)} · ${tb.no_fill} no-fill (of ${tb.setups})`);
  L.push(`**Our system:**    ${our.hits}/${our.entered} hit T1 · win ${pct(our.hit_rate)} · mean ${R(our.avg_R)} · median ${R(our.median_R)} · worst ${R(our.worst_R)} · ${our.no_fill} no-fill`);
  L.push(`**Agreement:**     direction matched Talon on ${ag.direction_match}/${ag.of} names`);
  L.push('');
  L.push('| Ticker | Talon dir · levels | Talon | Our dir · levels | Ours | agree |');
  L.push('|---|---|---|---|---|:-:|');
  for (const r of result.rows) {
    const tl = r.talon_levels, ol = r.our_levels || {};
    const tLv = `${r.talon_direction} · ${tl.ote}/${tl.invalidation}/${tl.first_target}`;
    const oLv = r.our_direction ? `${r.our_direction} · ${ol.ote ?? '—'}/${ol.invalidation ?? '—'}/${ol.first_target ?? '—'}` : '—';
    L.push(`| ${r.ticker} | ${tLv} | ${oc(r.talon.outcome)} ${R(r.talon.R)} | ${oLv} | ${oc(r.ours?.outcome)} ${R(r.ours?.R)} | ${r.agree_dir ? '✓' : r.agree_dir === false ? '✗' : '—'} |`);
  }
  return L.join('\n');
}

// Aggregate several weeks' results into one combined line.
export function combineResults(results) {
  const flatTalon = results.flatMap((r) => r.rows.map((x) => x.talon));
  const flatOurs = results.flatMap((r) => r.rows.map((x) => x.ours).filter((x) => x && x.outcome !== 'error'));
  const agM = results.reduce((s, r) => s + r.agreement.direction_match, 0);
  const agOf = results.reduce((s, r) => s + r.agreement.of, 0);
  return { talon_baseline: aggregate(flatTalon), our_result: aggregate(flatOurs), agreement: { direction_match: agM, of: agOf }, weeks: results.length };
}

// Orchestrator: score Talon's own levels AND our system's picks for one watchlist week.
// Needs a gex provider (as-of replay), a flow provider (real OHLC), and the LLM.
export async function scoreWatchlist(gex, flow, config, watchlist, { llm, planFromStructure, onName = null } = {}) {
  const { entry_date, resolve_from, resolve_to, names } = watchlist;
  const rows = [];
  for (const nm of names) {
    const ticker = nm.ticker.toUpperCase();
    let ohlc = [];
    // getDailyOHLC returns the most recent ~N daily 'r' candles; the resolver filters to
    // [resolve_from, resolve_to]. 90 rows (~4 months) comfortably covers a July/Aug window.
    try { ohlc = await flow.getDailyOHLC(ticker, { limit: 90 }); } catch { /* leave empty */ }
    // Talon's own published setup, scored against reality
    const talon = resolveOteSetup({ direction: nm.direction, ote: nm.ote, invalidation: nm.invalidation, first_target: nm.first_target }, ohlc, { from: resolve_from, to: resolve_to });
    // Our system's read as-of the entry date, its own levels scored against the same window
    let ours = null, ourRow = null;
    try {
      ourRow = await watchlistRow(gex, config, ticker, { date: entry_date, llm, planFromStructure });
      const L = ourRow.levels || {};
      ours = resolveOteSetup({ direction: ourRow.direction, ote: L.ote, invalidation: L.invalidation, first_target: L.first_target }, ohlc, { from: resolve_from, to: resolve_to });
    } catch (e) { if (e.message === 'AUTH') throw e; ours = { outcome: 'error', error: String(e.message).slice(0, 60), entered: false, R: 0 }; }
    const agree_dir = ourRow ? norm(ourRow.direction) === norm(nm.direction) : null;
    const row = { ticker, talon_direction: norm(nm.direction), our_direction: ourRow?.direction ?? null, agree_dir, talon, ours,
      talon_levels: { ote: nm.ote, invalidation: nm.invalidation, first_target: nm.first_target }, our_levels: ourRow?.levels ?? null, our_conf: ourRow?.confidence ?? null };
    rows.push(row);
    if (onName) onName(row);
  }
  return {
    week: watchlist.week, entry_date, resolve_from, resolve_to,
    talon_baseline: aggregate(rows.map((r) => r.talon)),
    our_result: aggregate(rows.map((r) => r.ours).filter((x) => x && x.outcome !== 'error')),
    agreement: { direction_match: rows.filter((r) => r.agree_dir).length, of: rows.filter((r) => r.agree_dir != null).length },
    rows,
  };
}
