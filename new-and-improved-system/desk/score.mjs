#!/usr/bin/env node
// STEP 3b — SCORE every card the desk ever produced, mechanically and identically to the backtest (shared system/aplus.js):
//   entry = first retest that holds on the card's session (09:35–15:30), skipped on a slide-in; exits = manage() with the
//   daily-close stop at plan.stopClose; priced on the card's contract with real UW 1-min option bars ($1k premium per trade).
// Then compares YOUR picks (take) vs your passes vs undecided — the question this whole desk exists to answer:
// does your Step-1 judgment beat the mechanical list?            node desk/score.mjs [FROM] [TO]
import fs from 'node:fs';
import path from 'node:path';
import { atlasHistory } from '../feeds/skylit.js';
import { optionBars } from '../shadow/cache.js';
import { retestHolds, slidIn, manage } from '../system/aplus.js';
import { etToUnix, todayET } from '../lib/time.js';
import { tdRange, isTD, prevTD, ROOT } from './common.mjs';

const [FROM = '2000-01-01', TO = '2100-01-01'] = process.argv.slice(2);
const J = path.join(ROOT, 'desk', 'journal'), BARS = path.join(ROOT, '.cache', 'bars');
const nowMin = (() => { const n = new Date(Date.now() - 4 * 3600e3); return n.getUTCHours() * 60 + n.getUTCMinutes(); })();
const lastDone = isTD(todayET()) && nowMin >= 16 * 60 + 15 ? todayET() : prevTD(todayET());
const hm = (t) => new Date((t - 4 * 3600) * 1000).toISOString().slice(11, 16);
const px = (bars, t) => { let best = null; for (const b of bars) { if (b.t > t) break; best = b; } if (!best) best = bars.find((b) => b.t > t) ?? null; return best ? best.c : null; };
const ymdET = (t) => new Date((t - 4 * 3600) * 1000).toISOString().slice(0, 10);
async function minutes(sym, days) { // one Atlas call (1 credit) per card for any missing days, split into the shared per-day cache
  const miss = days.filter((d) => !fs.existsSync(path.join(BARS, d, `${sym}.json`)));
  if (miss.length) { const all = await atlasHistory(sym, '1', etToUnix(miss[0], '09:30'), etToUnix(miss.at(-1), '16:00')).catch(() => []); const by = {}; for (const b of all) (by[ymdET(b.t)] ??= []).push(b);
    for (const d of miss) if (by[d]) { fs.mkdirSync(path.join(BARS, d), { recursive: true }); fs.writeFileSync(path.join(BARS, d, `${sym}.json`), JSON.stringify(by[d])); } }
  return async (d) => { const f = path.join(BARS, d, `${sym}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; };
}

const rows = [];
for (const f of fs.readdirSync(J).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f)).sort()) {
  const doc = JSON.parse(fs.readFileSync(path.join(J, f), 'utf8')); if (doc.D < FROM || doc.D > TO || doc.D > lastDone) continue;
  for (const c of doc.cards.filter((x) => x.plan && x.contract?.occ)) {
    const hold = tdRange(c.D, 30).filter((d) => d <= c.plan.holdEnd), done = hold.filter((d) => d <= lastDone);
    const get = await minutes(c.sym, done), bars = await get(c.D);
    const row = { D: c.D, sym: c.sym, dir: c.dir, decision: c.decision?.choice ?? 'undecided', status: c.status, contract: c.contract.occ };
    if (!bars.length) { rows.push({ ...row, result: 'no bars' }); continue; }
    const a = { dir: c.dir, entry: c.plan.entry, target: c.plan.target, t2: c.plan.t2, stop: c.plan.nodeStop };
    if (slidIn(a, bars[0].o, c.atr ?? 0)) { rows.push({ ...row, result: 'skipped (slide-in)' }); continue; }
    let fill = null;
    for (let bi = 0; bi < bars.length && !fill; bi++) { if (hm(bars[bi].t) < '09:35' || hm(bars[bi].t) > '15:30') continue; if (retestHolds(a, bars, bi, c.plan.zone)) fill = { ...a, t: bars[bi].t }; }
    if (!fill) { rows.push({ ...row, result: 'no retest that held' }); continue; }
    const legs = await manage({ fill, holdDays: done, getBars: get, stopLvl: c.plan.stopClose, zone: c.plan.zone });
    const e0 = px(await optionBars(c.contract.occ, c.D), fill.t);
    if (!e0) { rows.push({ ...row, result: 'triggered — option unpriced' }); continue; }
    const closed = legs.length && legs.reduce((s, l) => s + l.f, 0) >= 0.999;
    let ret = 0, priced = true; for (const l of legs) { const p = px(await optionBars(c.contract.occ, l.d), l.t); if (p == null) { priced = false; break; } ret += (p - e0) / e0 * l.f; }
    if (!closed) { const lastD = done.at(-1), mark = px(await optionBars(c.contract.occ, lastD), etToUnix(lastD, '16:00')); const left = 1 - legs.reduce((s, l) => s + l.f, 0); if (mark != null) ret += (mark - e0) / e0 * left; else priced = false; }
    rows.push({ ...row, result: closed ? legs.map((l) => `${l.why}@${l.d.slice(5)}`).join(' · ') : `OPEN (marked ${done.at(-1)})`, entryAt: hm(fill.t), in: e0, ret: priced ? +ret.toFixed(3) : null, closed });
  }
}
const $ = (v) => (v >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(v));
console.log(`desk score · cards with a plan + contract, sessions ≤ ${lastDone} · $1k premium per trade, real option prices\n`);
for (const r of rows) console.log(`  ${r.D} ${r.sym.padEnd(5)} ${r.dir === 'up' ? 'CALL' : 'PUT '} [${r.decision.padEnd(9)}] ${r.result}${r.ret != null ? `  ${r.entryAt} in $${r.in} → ${(r.ret * 100).toFixed(0)}% (${$(r.ret * 1000)})` : ''}`);
console.log('');
for (const g of ['take', 'pass', 'undecided']) {
  const R = rows.filter((r) => r.decision === g), T = R.filter((r) => r.ret != null);
  console.log(`${g.padEnd(9)} cards ${String(R.length).padStart(3)} · triggered ${String(T.length).padStart(3)} · win ${T.length ? Math.round(T.filter((r) => r.ret > 0).length / T.length * 100) : 0}% · P&L ${$(T.reduce((s, r) => s + r.ret, 0) * 1000)}${T.some((r) => !r.closed) ? ' (incl. open, marked)' : ''}`);
}
fs.writeFileSync(path.join(J, 'score.json'), JSON.stringify(rows, null, 1));
