#!/usr/bin/env node
// daily_structure.mjs — PURE GEX/VEX daily ranker (NO flow gate). Pulls current (or --date) Skylit
// structure for the tracked set, ranks the TOP 10 on structure alone via Sonnet, captures how each
// name's king/floor/barney/magnet nodes shifted vs a baseline date, and SAVES a dated snapshot so we
// can watch the levels evolve day-over-day.
//   node research/daily_structure.mjs                    (today's EOD structure, baseline vs 2026-08-14)
//   node research/daily_structure.mjs 2026-08-14         (historical snapshot, no baseline)
import { loadConfig, loadEnvKeysFrom, resolveFromRoot, log } from '../lib/util.mjs';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['ANTHROPIC_API_KEY', 'UNUSUAL_WHALES_API_KEY']);
const { GexProvider } = await import('../providers/gex-skylit.mjs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig();
const gex = new GexProvider({ maxStrikes: cfg.ingest.max_strikes, maxExpirations: cfg.ingest.max_expirations, eodHHMM: cfg.ingest.skylit_eod_hhmm });
try { await gex.init(); } catch (e) { console.log('AUTH-FAIL', e.message); process.exit(2); }
const AKEY = process.env.ANTHROPIC_API_KEY;
const DATE = process.argv.find((a) => /^\d{4}-\d\d-\d\d$/.test(a)) || null;
const LABEL = DATE || new Date().toISOString().slice(0, 10);
const BASELINE = DATE ? null : '2026-08-14';     // compare today's levels to the Sunday-watchlist baseline
const REF = DATE ? Date.parse(DATE + 'T20:00:00Z') : Date.now();
const M = (x) => Math.round(x / 1e6 * 100) / 100;
const pct = (k, s) => Math.round((k - s) / s * 1000) / 10;
const daysTo = (E) => Math.round((Date.parse(E) - REF) / 864e5);
async function sonnet(system, user, maxTok = 16000) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': AKEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: maxTok, system, messages: [{ role: 'user', content: user }] }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return (j.content || []).map((c) => c.text).filter(Boolean).join('');
}
function matrix(p) {
  const S = p.strikes, exps = (p.expirations || []).slice(0, 6), out = [`spot ${p.spot.toFixed(2)}`];
  for (const E of exps) {
    const g = S.map((s) => ({ k: s.strike, v: s.perExpiry?.[E] || 0 })).filter((x) => x.v).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 5);
    const v = S.map((s) => ({ k: s.strike, v: s.perExpiryVanna?.[E] || 0 })).filter((x) => x.v).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 5);
    if (!g.length && !v.length) continue;
    const f = (n) => `${n.k}${n.v >= 0 ? '+' : ''}${M(n.v)}(${pct(n.k, p.spot)}%)`;
    out.push(`  ${E} ${String(daysTo(E)).padStart(3)}d| G ${g.map(f).join(' ') || '—'} | V ${v.map(f).join(' ') || '—'}`);
  }
  return out.join('\n');
}
function nodes(p) {
  const S = p.strikes, spot = p.spot;
  const king = S.slice().sort((a, b) => Math.abs(b.gexAgg) - Math.abs(a.gexAgg))[0];
  const floor = S.filter((s) => s.gexAgg > 0 && s.strike < spot).sort((a, b) => b.strike - a.strike)[0];
  const barney = S.filter((s) => s.gexAgg < 0 && s.strike > spot).sort((a, b) => a.gexAgg - b.gexAgg)[0];
  const mag = S.filter((s) => s.vexAgg > 0 && s.strike > spot).sort((a, b) => b.vexAgg - a.vexAgg)[0];
  const nd = (x, key) => x ? { k: x.strike, v: +M(x[key]), pct: pct(x.strike, spot) } : null;
  return { spot: +spot.toFixed(2), king: nd(king, 'gexAgg'), floor: nd(floor, 'gexAgg'), barney: nd(barney, 'gexAgg'), magnet: nd(mag, 'vexAgg') };
}
const NAMES = 'MU NVDA PLTR MRVL WDC TSM ORCL META MSFT HOOD PYPL MARA NKE DIS HD GDX XBI HAL VST IONQ RGTI ON DRAM BMNR SMH'.split(' ');
const snap = {}, blocks = [];
for (const t of NAMES) {
  try { const p = await gex.getProfile(t, DATE ? { date: DATE } : {}); if (!p) { log(`${t}: no structure`); continue; } snap[t] = nodes(p); blocks.push(`### ${t}\n${matrix(p)}`); }
  catch (e) { if (e.message === 'AUTH') { log('AUTH died'); break; } log(`${t}: ${e.message}`); }
}
log(`\nPulled ${blocks.length}/${NAMES.length} names' ${LABEL} structure. Ranking on PURE GEX/VEX (NO flow gate)…\n`);
const SYS = `You are a single-name GEX/VEX swing analyst ranking stocks for a buy-this-week swing off the ${LABEL} Skylit EOD structure. Rank by BULLISH STRUCTURE ONLY — you have NO options-flow / ask-side data and must NOT invent any; judge purely on the gamma/vanna maps.
Single-name hierarchy: (1) SQUEEZE — negative gamma (barney) above spot NEAR price = dealers must chase up = the biggest single-name move; weight it highest. (2) VANNA magnet above spot = melt-up target, but magnets FAR above tend to OVERSHOOT the realistic move, so weight NEAR magnets more than distant ones. (3) PINNING — positive-gamma floor below + air pocket above = support to lean on (secondary on single names). Per matrix: G=gamma$M, V=vanna$M, %=distance from spot; the expiry holding the real SIZE drives hedging, not a thin near-dated strike.
Output a RANKED TOP 10. For each: "N. TICKER — one-line structural thesis (king node, squeeze, nearest magnet, key %s)". End with exactly: "TOP10: t1,t2,...,t10". Be decisive; pure structure only.`;
const read = await sonnet(SYS, blocks.join('\n\n'));
log(read);
const m = read.match(/TOP10:\s*(.+)/i);
const top10 = m ? m[1].split(/[,\s]+/).map((x) => x.trim().toUpperCase().replace(/[^A-Z]/g, '')).filter(Boolean).slice(0, 10) : [];

// baseline delta: how did the top-10's levels shift vs the baseline date?
let base = {};
if (BASELINE && top10.length) {
  log(`\n── how the levels moved (${BASELINE} → ${LABEL}) for today's top 10 ──`);
  for (const t of top10) {
    try {
      const bp = await gex.getProfile(t, { date: BASELINE }); if (!bp) continue;
      base[t] = nodes(bp);
      const a = snap[t], b = base[t];
      if (!a || !b) continue;
      const dK = (x, y) => x && y ? `${y.k}→${x.k}` : '—';
      log(`  ${t.padEnd(6)} spot ${b.spot}→${a.spot} (${pct(a.spot, b.spot) >= 0 ? '+' : ''}${pct(a.spot, b.spot)}%) · king ${dK(a.king, b.king)} · vanna-magnet ${dK(a.magnet, b.magnet)}`);
    } catch { /* skip */ }
  }
}
const dir = path.join(HERE, 'tracking'); fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, `structure-${LABEL}.json`);
fs.writeFileSync(out, JSON.stringify({ date: LABEL, asof: DATE || 'current-eod', baseline: BASELINE, top10, nodes: snap, baseline_nodes: base, synthesis: read }, null, 1));
log(`\n→ TOP 10 (${LABEL}, pure structure): ${top10.join(', ')}`);
log(`→ saved research/tracking/structure-${LABEL}.json`);
