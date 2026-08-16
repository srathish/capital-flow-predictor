// watchlist.mjs — the weekly Talon-style output that ties the framework together.
// This is the "make us more focused" deliverable: instead of a 500-name firehose or a
// rule-based score, it produces the same shape Skylit's Talon publishes —
//   • a market-context THROTTLE up top (hedge dashboard: risk-on/off)
//   • a BREADTH pulse (how many names are bullish vs bearish this week)
//   • per-name cards: DIRECTION + theme + conviction from the LLM (judgment), paired
//     with OTE / invalidation / first-target / swing from talonLevels (DETERMINISTIC).
// The division of labor is the point: the model decides direction and which setups are
// clean; the dealer structure decides the levels. No more chasing, no more chop.
import { assembleStructure } from './structure.mjs';
import { talonLevels, talonLevelsBearish } from './talon-levels.mjs';
import { buildHedgeDashboard } from './hedge-dashboard.mjs';

const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

// One name → a watchlist row. Uses the LLM planner for DIRECTION/theme/conviction only;
// the tradable levels come from talonLevels (structure), never the model's freelanced numbers.
export async function watchlistRow(gex, config, ticker, { date = null, historySessions = 12, llm, targetExpiry = null, planFromStructure }) {
  const profile = await gex.getProfile(ticker, date ? { date } : {});
  if (!profile) return { ticker, error: 'no-data' };
  const asOf = profile.asofDate || date;
  const history = await gex.getHistory(ticker, { asOfDate: asOf, sessions: historySessions });
  const structure = assembleStructure(profile, history);
  const kingMig = structure.gamma?.king_migration?.direction ?? 'unknown';

  // LLM judgment (direction / setup_type / thesis / conviction). Its levels are ignored.
  let direction = 'watch', clean = false, setup_type = null, thesis = null, confidence = null, why = null;
  try {
    const r = await planFromStructure(profile, history, { config, runDate: asOf, llm, targetExpiry });
    if (r.status === 'ok' && r.plan) {
      direction = r.plan.direction; // long | short | no_trade
      clean = direction !== 'no_trade';
      setup_type = r.plan.setup_type; thesis = r.plan.thesis; confidence = r.plan.confidence;
    } else {
      // LLM couldn't form a clean plan — fall back to the deterministic king-migration bias
      // so the name still appears (as a watch, not a call).
      why = (r.errors || []).slice(0, 1).join('; ') || 'no clean plan';
      direction = kingMig === 'up_bullish' ? 'watch_long' : kingMig === 'down_bearish' ? 'watch_short' : 'neutral';
    }
  } catch (e) {
    if (e.message === 'AUTH') throw e;
    why = String(e.message).slice(0, 60);
    direction = kingMig === 'up_bullish' ? 'watch_long' : kingMig === 'down_bearish' ? 'watch_short' : 'neutral';
  }

  const bear = direction === 'short' || direction === 'watch_short';
  const levels = bear ? talonLevelsBearish(structure) : talonLevels(structure);
  return {
    ticker, spot: r2(structure.spot), as_of: asOf, king_migration: kingMig,
    direction, clean, setup_type, thesis, confidence, note: why, levels,
    total_abs_M: r2(structure.gamma?.total_abs_M),
  };
}

// Build the full watchlist: throttle + breadth + rows. Sequential (LLM calls have the
// 110s hard-stop backstop; a big basket just takes longer, it won't hang the run).
export async function buildWatchlist(gex, config, { tickers, date = null, historySessions = 12, llm, targetExpiry = null, planFromStructure, onRow = null }) {
  const dashboard = await buildHedgeDashboard(gex, { date, historySessions });
  const rows = [];
  for (const t of tickers) {
    const row = await watchlistRow(gex, config, t, { date, historySessions, llm, targetExpiry, planFromStructure });
    rows.push(row);
    if (onRow) onRow(row);
  }
  const isLong = (r) => r.direction === 'long';
  const isShort = (r) => r.direction === 'short';
  const breadth = {
    bullish: rows.filter(isLong).length,
    bearish: rows.filter(isShort).length,
    watch: rows.filter((r) => String(r.direction).startsWith('watch')).length,
    stand_aside: rows.filter((r) => r.direction === 'no_trade' || r.direction === 'neutral').length,
    no_data: rows.filter((r) => r.error).length,
  };
  return { as_of: date || 'today', dashboard, breadth, rows };
}

// ---- render: Talon-style markdown ----
const convStars = (c) => (c ? '★'.repeat(c) + '☆'.repeat(5 - c) : '—');
const fmtLvl = (x) => (x == null ? '—' : x);

function rowCard(r) {
  if (r.error) return `- **${r.ticker}** — _${r.error}_`;
  const L = r.levels || {};
  const dirTag = r.direction === 'long' ? '🟢 LONG' : r.direction === 'short' ? '🔴 SHORT'
    : r.direction === 'watch_long' ? '🟡 watch·long' : r.direction === 'watch_short' ? '🟡 watch·short'
    : r.direction === 'no_trade' ? '⚪ stand-aside' : '⚪ neutral';
  const swing = (L.swing_targets || []).length ? ` · swing ${L.swing_targets.join('/')}` : '';
  const rr = L.rr != null ? ` · R:R ${L.rr}` : '';
  const conv = r.confidence ? ` · conv ${convStars(r.confidence)}` : '';
  const st = r.setup_type && r.setup_type !== 'none' ? ` · _${r.setup_type}_` : '';
  const head = `**${r.ticker}** ${dirTag} — spot ${fmtLvl(r.spot)} · king-mig ${r.king_migration}${st}${conv}`;
  const levelsLine = `  OTE **${fmtLvl(L.ote)}** · inval ${fmtLvl(L.invalidation)} · T1 **${fmtLvl(L.first_target)}**${swing}${rr}`;
  const thesis = r.thesis ? `\n  ${r.thesis}` : (r.note ? `\n  _${r.note}_` : '');
  return `- ${head}\n${levelsLine}${thesis}`;
}

export function renderWatchlist(wl) {
  const d = wl.dashboard, t = d.throttle;
  const throttleEmoji = t.throttle === 'GREEN' ? '🟢' : t.throttle === 'YELLOW' ? '🟡' : '🔴';
  const lines = [];
  lines.push(`# Talon Watchlist — ${wl.as_of}`);
  lines.push('');
  // Market throttle
  lines.push(`## ${throttleEmoji} Market throttle: **${t.throttle}** — ${t.note}`);
  lines.push(`on ${t.on} · off ${t.off} · neutral ${t.neutral}`);
  for (const c of d.components) {
    if (c.error) { lines.push(`- ${c.ticker} (${c.label}) — _${c.error}_`); continue; }
    const rk = c.risk === 'on' ? 'risk-on' : c.risk === 'off' ? 'risk-off' : 'neutral';
    lines.push(`- ${c.ticker.padEnd(5)} (${c.role}/${c.label}) — spot ${fmtLvl(c.spot)} · king-mig ${c.king_migration} → **${rk}**`);
  }
  lines.push('');
  // Breadth pulse
  const b = wl.breadth;
  lines.push(`## Breadth pulse`);
  lines.push(`🟢 ${b.bullish} bullish · 🔴 ${b.bearish} bearish · 🟡 ${b.watch} watch · ⚪ ${b.stand_aside} stand-aside${b.no_data ? ` · ${b.no_data} no-data` : ''}`);
  lines.push('');
  // Rows grouped by direction, conviction-sorted
  const byConv = (a, z) => (z.confidence || 0) - (a.confidence || 0) || (z.levels?.rr || 0) - (a.levels?.rr || 0);
  const longs = wl.rows.filter((r) => r.direction === 'long').sort(byConv);
  const shorts = wl.rows.filter((r) => r.direction === 'short').sort(byConv);
  const watches = wl.rows.filter((r) => String(r.direction).startsWith('watch')).sort(byConv);
  const aside = wl.rows.filter((r) => r.direction === 'no_trade' || r.direction === 'neutral' || r.error);
  if (longs.length) { lines.push(`## 🟢 Bullish setups (${longs.length})`); lines.push(longs.map(rowCard).join('\n')); lines.push(''); }
  if (shorts.length) { lines.push(`## 🔴 Bearish setups (${shorts.length})`); lines.push(shorts.map(rowCard).join('\n')); lines.push(''); }
  if (watches.length) { lines.push(`## 🟡 Watch (structure leaning, no clean plan yet) (${watches.length})`); lines.push(watches.map(rowCard).join('\n')); lines.push(''); }
  if (aside.length) { lines.push(`## ⚪ Stand-aside (${aside.length})`); lines.push(aside.map(rowCard).join('\n')); lines.push(''); }
  // Throttle-aware footer directive
  if (t.throttle === 'RED') lines.push(`> ⚠️ **RED throttle** — hedges are bid. Size down high-beta longs; favor the shorts / stand-asides above until the complex turns.`);
  else if (t.throttle === 'YELLOW') lines.push(`> ⚠️ **YELLOW throttle** — mixed backdrop. Take longs only on the OTE pullback (not chasing), respect every invalidation.`);
  else lines.push(`> ✅ **GREEN throttle** — backdrop supports the bullish map. Still enter at OTE, not extended.`);
  return lines.join('\n');
}
