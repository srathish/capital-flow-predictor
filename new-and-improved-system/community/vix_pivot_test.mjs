// vix_pivot_test.mjs — what is TheArchitect's VIX pivot, and does "VIX below pivot = bullish / above = bearish" predict SPX?
// 1) extract his posted pivots (pre-10:30 ET posts) from the Discord dumps
// 2) fit candidate formulas on VIX's prior-day bar (Atlas daily) → which one is he using?
// 3) test the rule with REAL VIX 1-min: at 10:15 ET (after his 10:05–10:15 "10M rule" window), side of pivot → SPX 10:15→16:00
//    on (a) his posted days, (b) every day using the best-fit formula, vs (c) a no-pivot control (VIX vs its own open).
import fs from 'node:fs';
import path from 'node:path';
import { atlasHistory } from '../feeds/skylit.js';
import { etToUnix } from '../lib/time.js';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname);
const DUMPS = path.join(HERE, 'dumps');
const etDate = (iso) => new Date(Date.parse(iso) - 4 * 3600e3).toISOString().slice(0, 10);
const etHM = (iso) => new Date(Date.parse(iso) - 4 * 3600e3).toISOString().slice(11, 16);

// ---------- 1) posted pivots ----------
const posted = {};
for (const f of fs.readdirSync(DUMPS).filter((x) => x.startsWith('dc_') && x.endsWith('.json'))) {
  for (const m of JSON.parse(fs.readFileSync(path.join(DUMPS, f), 'utf8'))) {
    if (!(m.author || '').startsWith('TheArchitect') || !m.time || !m.text) continue;
    const hm = etHM(m.time); if (hm < '06:00' || hm > '10:30') continue;
    const mt = m.text.match(/pivot[^0-9$\n]{0,28}\$?\s?(\d{1,2}\.\d{1,2})/i); if (!mt) continue;
    const v = +mt[1]; if (v < 9 || v > 60) continue;
    const d = etDate(m.time); if (!posted[d] || m.time < posted[d].time) posted[d] = { pivot: v, time: m.time, hm };
  }
}
const wide = JSON.parse(fs.readFileSync(path.join(HERE, 'ledgers', 'vix_pivots_posted.json'), 'utf8'));
for (const [d, v] of Object.entries(wide)) if (!posted[d]) posted[d] = { pivot: v.pivot, time: v.time, hm: '' };
const pdays = Object.keys(posted).sort();
console.log(`posted pivots found: ${pdays.length} days (${pdays[0]} → ${pdays[pdays.length - 1]})`);

// ---------- data ----------
const NOW = Math.floor(Date.now() / 1000), START = etToUnix('2025-10-01', '09:30');
const vixD = await atlasHistory('VIX', 'D', START - 10 * 86400, NOW);
const spxD = await atlasHistory('SPX', 'D', START - 10 * 86400, NOW);
const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10);
const VD = new Map(vixD.map((b) => [ymd(b.t), b])); const days = [...VD.keys()].sort();
const prevOf = (d) => { const i = days.indexOf(d); return i > 0 ? VD.get(days[i - 1]) : null; };
async function minutes(sym) { const m = new Map(); for (let a = START; a < NOW; a += 110 * 86400) for (const b of await atlasHistory(sym, '1', a, Math.min(NOW, a + 110 * 86400))) m.set(b.t, b); return m; }
const vixM = await minutes('VIX'), spxM = await minutes('SPX');
console.log(`VIX daily ${vixD.length}, VIX 1-min ${vixM.size}, SPX 1-min ${spxM.size}\n`);
const at = (M, d, hhmm) => { const t = etToUnix(d, hhmm); for (let k = 0; k <= 3; k++) { const b = M.get(t + k * 60) ?? M.get(t - k * 60); if (b) return b; } return null; };

// ---------- 2) formula fit ----------
const F = {
  'rolling 5-day (H+L+C)/3': (p, o, d) => { const i = days.indexOf(d); if (i < 5) return NaN; const w = days.slice(i - 5, i).map((x) => VD.get(x)); return (Math.max(...w.map((b) => b.h)) + Math.min(...w.map((b) => b.l)) + w[4].c) / 3; },
  'prior close': (p, o) => p.c,
  'prior (H+L+C)/3 (classic pivot)': (p, o) => (p.h + p.l + p.c) / 3,
  'prior (H+L)/2': (p, o) => (p.h + p.l) / 2,
  'prior (H+L+2C)/4': (p, o) => (p.h + p.l + 2 * p.c) / 4,
  'prior (O+H+L+C)/4': (p, o) => (p.o + p.h + p.l + p.c) / 4,
  'today open': (p, o) => o,
  '(today open + prior H + prior L + prior C)/4': (p, o) => (o + p.h + p.l + p.c) / 4,
};
console.log('=== which formula matches his posted pivot? (prior-day VIX bar) ===');
const fit = [];
for (const [name, fn] of Object.entries(F)) {
  const err = []; for (const d of pdays) { const p = prevOf(d), today = VD.get(d); if (!p || !today) continue; const v = fn(p, today.o, d); if (Number.isFinite(v)) err.push(Math.abs(v - posted[d].pivot)); }
  err.sort((a, b) => a - b);
  const mae = err.reduce((a, x) => a + x, 0) / err.length;
  fit.push({ name, fn, mae });
  console.log(`  ${name.padEnd(46)} n=${err.length}  mean |err| ${mae.toFixed(3)}  median ${err[Math.floor(err.length / 2)].toFixed(3)}  within ±0.05: ${(err.filter((x) => x <= 0.05).length / err.length * 100).toFixed(0)}%  within ±0.25: ${(err.filter((x) => x <= 0.25).length / err.length * 100).toFixed(0)}%`);
}
fit.sort((a, b) => a.mae - b.mae); const best = fit[0];
console.log(`  → closest: ${best.name}\n`);

// ---------- 3) rule test ----------
function evalDay(d, pivot) {
  const s0 = at(spxM, d, '10:15'), s1 = at(spxM, d, '15:59'), v0 = at(vixM, d, '10:15'), vo = at(vixM, d, '09:31');
  if (!s0 || !s1 || !v0 || !vo) return null;
  // 10M rule: every VIX 1-min close 10:05–10:15 on the same side of the pivot
  let below = 0, above = 0; for (let m = 5; m <= 15; m++) { const b = at(vixM, d, `10:${String(m).padStart(2, '0')}`); if (!b) continue; if (b.c < pivot) below++; else above++; }
  const side10 = below > 0 && above === 0 ? 'below' : above > 0 && below === 0 ? 'above' : 'mixed';
  return { d, pivot, vix: v0.c, side: v0.c < pivot ? 'below' : 'above', side10, spx: (s1.c - s0.c) / s0.c * 1e4, vixVsOpen: v0.c < vo.o ? 'below' : 'above' };
}
const score = (rows, sideKey, label) => {
  const R = rows.filter((r) => r[sideKey] === 'below' || r[sideKey] === 'above');
  const right = R.filter((r) => (r[sideKey] === 'below') === (r.spx > 0));
  const bel = R.filter((r) => r[sideKey] === 'below'), abv = R.filter((r) => r[sideKey] === 'above');
  const m = (a) => (a.length ? a.reduce((s, r) => s + r.spx, 0) / a.length : NaN);
  const signed = R.map((r) => (r[sideKey] === 'below' ? 1 : -1) * r.spx); const ms = m(R.map((r, i) => ({ spx: signed[i] })));
  const sd = Math.sqrt(signed.reduce((s, x) => s + (x - ms) ** 2, 0) / Math.max(1, signed.length - 1)); const t = ms / (sd / Math.sqrt(signed.length));
  console.log(`  ${label.padEnd(52)} n=${String(R.length).padStart(3)}  right ${(right.length / R.length * 100).toFixed(0).padStart(3)}%  | VIX below → SPX ${m(bel).toFixed(0).padStart(4)}bps (up ${(bel.filter((r) => r.spx > 0).length / Math.max(1, bel.length) * 100).toFixed(0)}%, n=${bel.length})  above → ${m(abv).toFixed(0).padStart(4)}bps (up ${(abv.filter((r) => r.spx > 0).length / Math.max(1, abv.length) * 100).toFixed(0)}%, n=${abv.length})  | signed ${ms.toFixed(1)}bps t=${t.toFixed(1)}`);
};
const postedRows = pdays.map((d) => evalDay(d, posted[d].pivot)).filter(Boolean);
const allRows = days.filter((d) => d >= '2025-10-15').map((d) => { const p = prevOf(d), t = VD.get(d); return p && t && Number.isFinite(best.fn(p, t.o, d)) ? evalDay(d, best.fn(p, t.o, d)) : null; }).filter(Boolean);
const baseUp = allRows.filter((r) => r.spx > 0).length / allRows.length * 100;
console.log(`=== does it predict SPX from 10:15 to the close? (baseline: SPX up ${baseUp.toFixed(0)}% of all ${allRows.length} days) ===`);
score(postedRows, 'side', 'HIS posted pivot · side at 10:15');
score(postedRows, 'side10', 'HIS posted pivot · 10M rule (10:05–10:15 all one side)');
score(postedRows, 'vixVsOpen', 'control on his days · VIX vs its own open (no pivot)');
score(allRows, 'side', `ALL days · ${best.name} · side at 10:15`);
score(allRows, 'side10', `ALL days · ${best.name} · 10M rule`);
score(allRows, 'vixVsOpen', 'ALL days · control: VIX vs its own open (no pivot)');
fs.writeFileSync(path.join(HERE, 'ledgers', 'vix_pivot_rows.json'), JSON.stringify({ posted, postedRows, allRows, bestFormula: best.name }, null, 1));
