// PIKA CREDIT SPREADS — simulation + controls + verdict (RESEARCH ONLY, Clause 0).
// Reads design.json + cache_ladder/ (real UW per-minute option marks). Prices both legs,
// computes credit, and evaluates EOD-settle / 50%-TP / 2-min-breach-STOP / STOP+TP exits.
// Costs: 3% round-trip per leg = 0.03*(short_entry+long_entry) option-pts, applied once.
// P&L per 1 contract = (credit - exitValue - cost)*100 dollars; frac = pts/width (per unit risk).
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BF = path.join(HERE, '..', 'velocity-capture', 'backfill');
const CACHE = path.join(HERE, 'cache_ladder');
const TFILTER = (process.env.TICKERS || '').split(',').filter(Boolean);   // optional: restrict tickers
const design = JSON.parse(fs.readFileSync(path.join(HERE, 'design.json'), 'utf8'))
  .filter(d => !TFILTER.length || TFILTER.includes(d.ticker));
const occ = (t, day, cp, K) => `${t}${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}${cp}${String(Math.round(K * 1000)).padStart(8, '0')}`;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

const legCache = {};
function loadLeg(sym, day) {
  const k = `${sym}_${day}`; if (legCache[k]) return legCache[k];
  const p = path.join(CACHE, `${sym}_${day}.json`);
  if (!fs.existsSync(p)) return (legCache[k] = []);
  let rows = []; try { rows = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { rows = []; }
  const s = rows.map(r => ({ ts: Date.parse(r.start_time), close: +r.close })).filter(r => Number.isFinite(r.ts) && Number.isFinite(r.close)).sort((a, b) => a.ts - b.ts);
  return (legCache[k] = s);
}
const lastAtOrBefore = (s, ts) => { let v = null; for (const r of s) { if (r.ts <= ts) v = r.close; else break; } return v; };
function priceAt(s, ts) {                     // entry price: last at/before entry, else nearest within 5m after
  if (!s.length) return null;
  const b = lastAtOrBefore(s, ts); if (b != null && b > 0) return b;
  for (const r of s) { if (r.ts >= ts && r.ts <= ts + 5 * 60000 && r.close > 0) return r.close; }
  return b;    // may be 0 (thin long) or null
}
// backfill spot series per day/ticker
const spotCache = {};
function spots(day, t) {
  const k = `${day}|${t}`; if (spotCache[k]) return spotCache[k];
  const p = path.join(BF, day, `${t}.jsonl.gz`);
  if (!fs.existsSync(p)) return (spotCache[k] = []);
  const rows = zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n')
    .map(l => { try { const j = JSON.parse(l); return { ts: Date.parse(j.requestedTs), spot: +j.spot }; } catch { return null; } })
    .filter(r => r && Number.isFinite(r.ts) && Number.isFinite(r.spot)).sort((a, b) => a.ts - b.ts);
  return (spotCache[k] = rows);
}
const hhmm = ms => new Date(ms).toISOString().slice(11, 16);

// ---- simulate one vertical ----
function simVert(spec, day, ticker, entryTs, sp, settleSpot) {
  const g = spec.width;
  const sS = loadLeg(occ(ticker, day, spec.cp, spec.shortK), day);
  const lS = loadLeg(occ(ticker, day, spec.cp, spec.longK), day);
  const sEntry = priceAt(sS, entryTs);
  if (sEntry == null || !(sEntry > 0)) return { drop: 'no-short-print' };
  const lEntryRaw = priceAt(lS, entryTs);
  const longEntry = (lEntryRaw == null || lEntryRaw < 0) ? 0 : lEntryRaw;
  const shortEntry = sEntry;
  const credit = shortEntry - longEntry;
  if (!(credit > 0)) return { drop: 'nonpos-credit' };
  const cost = 0.03 * (shortEntry + longEntry);
  const marks = sp.filter(p => p.ts >= entryTs).map(p => {
    const sc = lastAtOrBefore(sS, p.ts), lc = lastAtOrBefore(lS, p.ts);
    const sv = clamp((sc == null ? shortEntry : sc) - (lc == null ? longEntry : lc), 0, g);
    return { ts: p.ts, spot: p.spot, sv };
  });
  const eodVal = spec.side > 0 ? clamp(settleSpot - spec.shortK, 0, g) : clamp(spec.shortK - settleSpot, 0, g);
  const mk = (exitVal, ts) => { const pts = credit - exitVal - cost; return { pts, dollars: pts * 100, frac: pts / g, exitTs: ts, exitVal }; };
  const EOD_TS = sp.length ? sp.at(-1).ts : entryTs;
  const eod = mk(eodVal, EOD_TS);
  // TP50
  let tp = null; for (const m of marks) { if (m.sv <= 0.5 * credit) { tp = m; break; } }
  const tpPnl = tp ? mk(tp.sv, tp.ts) : eod;
  // STOP: spot beyond short 2 consecutive min
  let stop = null, run = 0;
  for (const m of marks) { const br = spec.side > 0 ? m.spot >= spec.shortK : m.spot <= spec.shortK; if (br) { run++; if (run >= 2) { stop = m; break; } } else run = 0; }
  const stopPnl = stop ? mk(stop.sv, stop.ts) : eod;
  // STOP+TP first
  let combo = eod; run = 0;
  for (const m of marks) { if (m.sv <= 0.5 * credit) { combo = mk(m.sv, m.ts); break; } const br = spec.side > 0 ? m.spot >= spec.shortK : m.spot <= spec.shortK; if (br) { run++; if (run >= 2) { combo = mk(m.sv, m.ts); break; } } else run = 0; }
  const breached = spec.side > 0 ? settleSpot >= spec.shortK : settleSpot <= spec.shortK;
  return { credit, cost, shortEntry, longEntry, eodVal, eod, tpPnl, stopPnl, combo, breached, side: spec.side, cp: spec.cp, shortK: spec.shortK, longK: spec.longK, width: g };
}

// ---- build all trades ----
const trades = [];   // one per (row, construction)
for (const d of design) {
  const sp = spots(d.day, d.ticker); if (!sp.length) continue;
  const settle = sp.at(-1).spot;
  const base = { day: d.day, ticker: d.ticker, regime: d.regime, relSig: d.domPika.relSig, distPct: d.domPika.distPct };
  const push = (construction, spec) => {
    if (!spec) return; const r = simVert(spec, d.day, d.ticker, d.entryTsMs, sp, settle);
    if (r.drop) { trades.push({ ...base, construction, drop: r.drop }); return; }
    trades.push({ ...base, construction, ...r });
  };
  push('pika', d.dom);
  push('mirror', d.mirror);
  push('weak', d.weak);
  // random: average of all rand specs -> one obs; also keep individuals
  const rs = (d.rand || []).map(spec => simVert(spec, d.day, d.ticker, d.entryTsMs, sp, settle)).filter(r => !r.drop);
  if (rs.length) {
    const avg = key => rs.reduce((s, r) => s + r[key].dollars, 0) / rs.length;
    const avgf = key => rs.reduce((s, r) => s + r[key].frac, 0) / rs.length;
    trades.push({ ...base, construction: 'random', nRand: rs.length,
      eod: { dollars: avg('eod'), frac: avgf('eod') }, tpPnl: { dollars: avg('tpPnl'), frac: avgf('tpPnl') },
      stopPnl: { dollars: avg('stopPnl'), frac: avgf('stopPnl') }, combo: { dollars: avg('combo'), frac: avgf('combo') },
      credit: rs.reduce((s, r) => s + r.credit, 0) / rs.length, breached: rs.reduce((s, r) => s + (r.breached ? 1 : 0), 0) / rs.length });
    for (const r of rs) trades.push({ ...base, construction: 'random_ind', ...r });
  }
  // condor: call-side + put-side, EOD (primary)
  if (d.condor) {
    const c = simVert(d.condor.call, d.day, d.ticker, d.entryTsMs, sp, settle);
    const pu = simVert(d.condor.put, d.day, d.ticker, d.entryTsMs, sp, settle);
    if (!c.drop && !pu.drop) {
      const g = d.condor.call.width, credit = c.credit + pu.credit, cost = c.cost + pu.cost;
      const eodVal = c.eodVal + pu.eodVal;   // at most one side ITM
      const pts = credit - eodVal - cost;
      trades.push({ ...base, construction: 'condor', credit, cost, width: g,
        eod: { dollars: pts * 100, frac: pts / g, exitVal: eodVal }, breached: c.breached || pu.breached,
        tpPnl: { dollars: pts * 100, frac: pts / g }, stopPnl: { dollars: pts * 100, frac: pts / g }, combo: { dollars: pts * 100, frac: pts / g } });
    } else trades.push({ ...base, construction: 'condor', drop: 'leg-missing' });
  }
}

// ---- stats helpers ----
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sum = a => a.reduce((s, x) => s + x, 0);
const pf = a => { const w = sum(a.filter(x => x > 0)), l = -sum(a.filter(x => x < 0)); return l > 0 ? w / l : Infinity; };
const winrate = a => a.filter(x => x > 0).length / a.length;
const pct = (x, dg = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(dg)}%` : '  -');
function boot(a, B = 5000) { const n = a.length, o = []; if (!n) return { lo: NaN, hi: NaN, pPos: NaN }; for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++)s += a[(Math.random() * n) | 0]; o.push(s / n); } o.sort((x, y) => x - y); return { lo: o[(0.025 * B) | 0], hi: o[(0.975 * B) | 0], pPos: o.filter(x => x > 0).length / B }; }
function bootDiff(a, b, B = 5000) { const o = []; for (let k = 0; k < B; k++) { let sa = 0, sb = 0; for (let i = 0; i < a.length; i++)sa += a[(Math.random() * a.length) | 0]; for (let i = 0; i < b.length; i++)sb += b[(Math.random() * b.length) | 0]; o.push(sa / a.length - sb / b.length); } o.sort((x, y) => x - y); return { point: mean(a) - mean(b), lo: o[(0.025 * B) | 0], hi: o[(0.975 * B) | 0], pPos: o.filter(x => x > 0).length / B }; }
// day-block bootstrap (resample whole days) on frac
function dayBlockBoot(rows, key, B = 5000) {
  const byDay = {}; for (const r of rows) (byDay[r.day] ||= []).push(r[key].frac);
  const days = Object.keys(byDay); const o = [];
  for (let b = 0; b < B; b++) { const acc = []; for (let i = 0; i < days.length; i++) { const dd = days[(Math.random() * days.length) | 0]; for (const v of byDay[dd]) acc.push(v); } o.push(mean(acc)); }
  o.sort((x, y) => x - y); return { lo: o[(0.025 * B) | 0], hi: o[(0.975 * B) | 0], pPos: o.filter(x => x > 0).length / B };
}

const G = (r, exit) => r[exit];   // {dollars,frac}
const EXITS = ['eod', 'tpPnl', 'stopPnl', 'combo'];
const EXITLBL = { eod: 'EOD-settle', tpPnl: '50%-TP', stopPnl: '2m-STOP', combo: 'STOP+TP' };
const CONS = ['pika', 'mirror', 'weak', 'random', 'condor'];
const valid = (c, exit) => trades.filter(t => t.construction === c && !t.drop && t[exit]);

console.log(`# PIKA CREDIT SPREADS — simulation`);
console.log(`design rows ${design.length} | trades ${trades.length}`);
const dropByC = {}; for (const t of trades.filter(t => t.drop)) dropByC[`${t.construction}:${t.drop}`] = (dropByC[`${t.construction}:${t.drop}`] || 0) + 1;
console.log('drops:', JSON.stringify(dropByC));

// coverage of legs
const legFiles = fs.existsSync(CACHE) ? fs.readdirSync(CACHE).length : 0;
console.log(`leg cache files: ${legFiles}`);

console.log(`\n${'='.repeat(92)}\n## HEADLINE — win rate / expectancy per construction x exit (per 1 contract)\n${'='.repeat(92)}`);
console.log(`${'construction'.padEnd(12)}${'exit'.padEnd(12)}${'n'.padStart(4)}${'win'.padStart(8)}${'avg$'.padStart(9)}${'avgFrac'.padStart(9)}${'PF'.padStart(7)}${'total$'.padStart(9)}${'medCredit'.padStart(10)}`);
for (const c of CONS) {
  for (const exit of EXITS) {
    if (c === 'condor' && exit !== 'eod') continue;
    const rows = valid(c, exit); if (!rows.length) continue;
    const dol = rows.map(r => G(r, exit).dollars), frac = rows.map(r => G(r, exit).frac);
    const cr = rows.map(r => r.credit).filter(Number.isFinite).sort((a, b) => a - b);
    console.log(`${c.padEnd(12)}${EXITLBL[exit].padEnd(12)}${String(rows.length).padStart(4)}${pct(winrate(dol)).padStart(8)}${('$' + mean(dol).toFixed(0)).padStart(9)}${pct(mean(frac)).padStart(9)}${(Number.isFinite(pf(dol)) ? pf(dol).toFixed(2) : 'inf').padStart(7)}${('$' + sum(dol).toFixed(0)).padStart(9)}${(cr.length ? cr[cr.length >> 1].toFixed(2) : '-').padStart(10)}`);
  }
}

// ---- PIKA vs RANDOM and PIKA vs MIRROR (the whole test), paired by day-ticker ----
console.log(`\n${'='.repeat(92)}\n## LOCATION TEST — sell-at-pika vs sell-at-random / mirror (paired by day-ticker, EOD)\n${'='.repeat(92)}`);
function paired(cA, cB, exit) {
  const A = new Map(valid(cA, exit).map(r => [`${r.day}|${r.ticker}`, r]));
  const B = new Map(valid(cB, exit).map(r => [`${r.day}|${r.ticker}`, r]));
  const keys = [...A.keys()].filter(k => B.has(k));
  const da = keys.map(k => G(A.get(k), exit).frac), db = keys.map(k => G(B.get(k), exit).frac);
  const diffs = keys.map((k, i) => da[i] - db[i]);
  return { n: keys.length, aFrac: mean(da), bFrac: mean(db), diff: mean(diffs), bd: boot(diffs) };
}
for (const exit of ['eod', 'combo']) {
  for (const [a, b] of [['pika', 'random'], ['pika', 'mirror']]) {
    const p = paired(a, b, exit);
    console.log(`[${EXITLBL[exit]}] ${a} vs ${b}: n=${p.n}  ${a}Frac ${pct(p.aFrac)}  ${b}Frac ${pct(p.bFrac)}  diff ${pct(p.diff)}  CI95[${pct(p.bd.lo)},${pct(p.bd.hi)}]  P(pika>${b})=${p.bd.pPos.toFixed(3)}`);
  }
}
// also winrate comparison
for (const [a, b] of [['pika', 'random'], ['pika', 'mirror']]) {
  const ra = valid(a, 'eod'), rb = valid(b, 'eod');
  console.log(`  winrate EOD: ${a} ${pct(winrate(ra.map(r => r.eod.dollars)))}  vs ${b} ${pct(winrate(rb.map(r => r.eod.dollars)))}`);
}

// ---- WEAK vs STRONG node (control 3) ----
console.log(`\n${'='.repeat(92)}\n## STRENGTH TEST — does node strength matter? (control 3)\n${'='.repeat(92)}`);
{
  const p = paired('pika', 'weak', 'eod');
  console.log(`[EOD] dominant-pika vs weak-pika: n=${p.n}  domFrac ${pct(p.aFrac)}  weakFrac ${pct(p.bFrac)}  diff ${pct(p.diff)}  P(dom>weak)=${p.bd.pPos.toFixed(3)}`);
  // tercile by relSig within pika trades
  const pk = valid('pika', 'eod').slice().sort((a, b) => a.relSig - b.relSig);
  const t = Math.floor(pk.length / 3);
  const lab = ['weak relSig', 'mid relSig ', 'strong relSig'];
  [[0, t], [t, 2 * t], [2 * t, pk.length]].forEach(([i, j], k) => {
    const s = pk.slice(i, j), dol = s.map(r => r.eod.dollars);
    console.log(`  ${lab[k]} (relSig ${pct(s[0].relSig,0)}-${pct(s.at(-1).relSig,0)}): n=${s.length} win ${pct(winrate(dol))} avg $${mean(dol).toFixed(0)} frac ${pct(mean(s.map(r=>r.eod.frac)))}`);
  });
}

// ---- REGIME split (control 4) ----
console.log(`\n${'='.repeat(92)}\n## REGIME SPLIT — +gamma (pin) vs -gamma (trend) days (control 4)\n${'='.repeat(92)}`);
for (const c of ['pika', 'condor']) {
  for (const rg of ['pos', 'neg']) {
    const rows = valid(c, 'eod').filter(r => r.regime === rg);
    if (!rows.length) { console.log(`  ${c} ${rg}gamma: (none)`); continue; }
    const dol = rows.map(r => r.eod.dollars);
    console.log(`  ${c.padEnd(7)} ${rg}gamma: n=${String(rows.length).padStart(3)} win ${pct(winrate(dol)).padStart(6)} avg $${mean(dol).toFixed(0).padStart(4)} frac ${pct(mean(rows.map(r => r.eod.frac))).padStart(7)} PF ${(Number.isFinite(pf(dol))?pf(dol).toFixed(2):'inf')} breachRate ${pct(mean(rows.map(r => r.breached ? 1 : 0)))}`);
  }
}

// ---- DEDUP (control 1): pooled vs per-day (avg across tickers) ----
console.log(`\n${'='.repeat(92)}\n## DEDUP — pooled (all ticker-days) vs deduped (1 obs/day = mean across tickers) [pika, EOD]\n${'='.repeat(92)}`);
function dedupStats(c, exit) {
  const rows = valid(c, exit);
  const pooledFrac = rows.map(r => G(r, exit).frac), pooledDol = rows.map(r => G(r, exit).dollars);
  const byDay = {}; for (const r of rows) (byDay[r.day] ||= []).push(G(r, exit).frac);
  const dedFrac = Object.values(byDay).map(a => mean(a));
  return { pooledN: rows.length, pooledWin: winrate(pooledDol), pooledFrac: mean(pooledFrac), pooledDol: mean(pooledDol),
    dedN: dedFrac.length, dedFrac: mean(dedFrac), dedWin: winrate(dedFrac), bpooled: boot(pooledFrac), bded: boot(dedFrac) };
}
for (const c of ['pika', 'condor', 'random', 'mirror']) {
  const s = dedupStats(c, 'eod');
  console.log(`  ${c.padEnd(7)} POOLED n=${String(s.pooledN).padStart(3)} win ${pct(s.pooledWin)} frac ${pct(s.pooledFrac)} avg$ ${s.pooledDol.toFixed(0)} P(mean>0)=${s.bpooled.pPos.toFixed(3)} | DEDUP nDays=${s.dedN} win ${pct(s.dedWin)} frac ${pct(s.dedFrac)} P(mean>0)=${s.bded.pPos.toFixed(3)}`);
}

// ---- WALK-FORWARD halves + day-block bootstrap (controls 5) ----
console.log(`\n${'='.repeat(92)}\n## WALK-FORWARD halves + day-block bootstrap [pika EOD, frac]\n${'='.repeat(92)}`);
{
  const rows = valid('pika', 'eod');
  const days = [...new Set(rows.map(r => r.day))].sort();
  const split = days[Math.floor(days.length / 2)];
  const tr = rows.filter(r => r.day < split), te = rows.filter(r => r.day >= split);
  console.log(`  WF split ${split}: train n=${tr.length} win ${pct(winrate(tr.map(r=>r.eod.dollars)))} frac ${pct(mean(tr.map(r => r.eod.frac)))} | test n=${te.length} win ${pct(winrate(te.map(r=>r.eod.dollars)))} frac ${pct(mean(te.map(r => r.eod.frac)))}`);
  const db = dayBlockBoot(rows, 'eod');
  console.log(`  day-block bootstrap mean frac: CI95[${pct(db.lo)},${pct(db.hi)}]  P(mean>0)=${db.pPos.toFixed(3)}`);
  const dbr = dayBlockBoot(valid('random', 'eod'), 'eod');
  console.log(`  (random control) day-block bootstrap mean frac: CI95[${pct(dbr.lo)},${pct(dbr.hi)}]  P(mean>0)=${dbr.pPos.toFixed(3)}`);
}

// ---- TAIL HONESTY (control 6) ----
console.log(`\n${'='.repeat(92)}\n## TAIL HONESTY — full P&L distribution + worst breaches [pika, EOD]\n${'='.repeat(92)}`);
for (const c of ['pika', 'condor']) {
  const rows = valid(c, 'eod'); if (!rows.length) continue;
  const dol = rows.map(r => r.eod.dollars).sort((a, b) => a - b);
  const q = p => dol[Math.min(dol.length - 1, Math.max(0, Math.round(p * (dol.length - 1))))];
  console.log(`  ${c}: n=${rows.length}  min $${q(0).toFixed(0)}  p5 $${q(.05).toFixed(0)}  p25 $${q(.25).toFixed(0)}  median $${q(.5).toFixed(0)}  p75 $${q(.75).toFixed(0)}  p95 $${q(.95).toFixed(0)}  max $${q(1).toFixed(0)}`);
  const breaches = rows.filter(r => r.breached);
  const losers = rows.filter(r => r.eod.dollars < 0);
  const worst = rows.slice().sort((a, b) => a.eod.dollars - b.eod.dollars).slice(0, 6);
  console.log(`     settle-breach rate ${pct(mean(rows.map(r => r.breached ? 1 : 0)))}  losers ${pct(losers.length / rows.length)}  win $${sum(dol.filter(x=>x>0)).toFixed(0)} vs loss $${sum(dol.filter(x=>x<0)).toFixed(0)}  net $${sum(dol).toFixed(0)}`);
  console.log(`     avg winner $${mean(dol.filter(x=>x>0)).toFixed(0)}  avg loser $${mean(dol.filter(x=>x<0)).toFixed(0)}  worst 6: ${worst.map(r => `${r.ticker.slice(0,3)}${r.day.slice(5)} $${r.eod.dollars.toFixed(0)}`).join(', ')}`);
}
// STOP variant tail (does stopping cap the tail?)
{
  const rows = valid('pika', 'stopPnl');
  const dol = rows.map(r => r.stopPnl.dollars).sort((a, b) => a - b);
  console.log(`  pika 2m-STOP: win ${pct(winrate(dol))} avg $${mean(dol).toFixed(0)} worst $${dol[0].toFixed(0)}  net $${sum(dol).toFixed(0)}  (vs EOD net $${sum(valid('pika','eod').map(r=>r.eod.dollars)).toFixed(0)})`);
}

// ---- write events jsonl (primary: pika + condor, EOD) ----
const ev = [];
for (const r of valid('pika', 'eod')) ev.push({ day: r.day, ticker: r.ticker, minute: '14:00', strike: r.shortK, kind: 'credit',
  side: r.side > 0 ? 'call_spread' : 'put_spread', exit_minute: '20:00', outcome: r.eod.dollars > 0 ? 'win' : 'loss',
  pnl_dollars: +r.eod.dollars.toFixed(2), credit: +r.credit.toFixed(3), construction: 'pika', exit: 'EOD', pnl_frac: +r.eod.frac.toFixed(4), width: r.width, regime: r.regime, relSig: +r.relSig.toFixed(4) });
for (const r of valid('condor', 'eod')) ev.push({ day: r.day, ticker: r.ticker, minute: '14:00', strike: null, kind: 'credit',
  side: 'condor', exit_minute: '20:00', outcome: r.eod.dollars > 0 ? 'win' : 'loss', pnl_dollars: +r.eod.dollars.toFixed(2),
  credit: +r.credit.toFixed(3), construction: 'condor', exit: 'EOD', pnl_frac: +r.eod.frac.toFixed(4), width: r.width, regime: r.regime });
if (!TFILTER.length) {
  fs.writeFileSync(path.join(HERE, 'sell_premium_events.jsonl'), ev.map(e => JSON.stringify(e)).join('\n') + '\n');
  console.log(`\nwrote sell_premium_events.jsonl (${ev.length} events)`);
} else console.log(`\n[TICKER FILTER ${TFILTER.join(',')}] events file NOT overwritten`);
