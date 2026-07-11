// Overnight study Phase 4b — FILTERED 2-DTE SWING (research only).
// Combine the night's two best findings: the down-tape+afternoon ENTRY FILTER
// (which rescued the scalp OOS) applied to the 2-DTE HOLD-TO-EXPIRY swing (which
// converts the catch far better than 0DTE). Does filtering make the high-return
// swing robust in test? Real marks (cache_alt), close-basis, train/test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ALT = path.join(HERE, 'cache_alt'), UND = path.join(HERE, 'cache_underlying');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
const occ = (t, day, dir, K) => `${t}${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}${dir > 0 ? 'C' : 'P'}${String(Math.round(K * 1000)).padStart(8, '0')}`;
function ntd(day, n) { const d = new Date(day + 'T00:00:00Z'); let a = 0; while (a < n) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w && w !== 6) a++; } return d.toISOString().slice(0, 10); }
const bars = sym_day => load(sym_day).map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
const spyC = {};
function spy(day) { if (spyC[day]) return spyC[day]; const b = load(path.join(UND, `SPY_${day}.json`)).map(r => ({ ts: Date.parse(r.start_time), close: +r.close })).filter(r => r.close > 0).sort((a, b) => a.ts - b.ts); const reg = b.filter(r => { const h = new Date(r.ts).getUTCHours(); return h >= 13 && h < 20; }); return (spyC[day] = { open: reg[0]?.close, bars: reg }); }
const spyAt = (day, ts) => { const b = spy(day).bars; let i = 0; while (i < b.length - 1 && b[i + 1].ts <= ts) i++; return b[i]?.close; };

const fires = load(path.join(HERE, 'fires_index.json')).filter(f => f.state === 'BULL_REVERSE');
const days = [...new Set(fires.map(f => f.day))].sort();
const split = days[Math.floor(days.length / 2)];
const recs = [];
for (const f of fires) {
  const D = f.day, e1 = ntd(D, 1), e2 = ntd(D, 2), s2 = occ(f.ticker, e2, f.dir, f.K);
  const dD = bars(path.join(ALT, `${s2}_${D}.json`)); if (dD.length < 4) continue;
  const ei = dD.findIndex(o => o.ts >= f.fireTsMs + 60000); if (ei < 0) continue;
  const entry = dD[ei].close;
  const full = [...dD.slice(ei), ...bars(path.join(ALT, `${s2}_${e1}.json`)), ...bars(path.join(ALT, `${s2}_${e2}.json`))];
  if (full.length < 4) continue;
  const expiry = (full.at(-1).close - entry) / entry;
  let tgt = null; for (const o of full) { const g = (o.close - entry) / entry; if (g >= 1.0 || g <= -0.6) { tgt = g; break; } } if (tgt == null) tgt = expiry;
  const sp = spy(D); if (!sp.open) continue;
  const tape = (spyAt(D, f.fireTsMs) - sp.open) / sp.open;
  const mins = (f.fireTsMs - Date.parse(`${D}T13:30:00Z`)) / 60000;
  recs.push({ isTest: D >= split, expiry, tgt, pass: tape >= -0.002 && !(mins >= 240 && mins < 330), day: D });
}
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = x => Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%` : ' -';
function line(label, s, key) {
  const tr = s.filter(r => !r.isTest).map(r => r[key]), te = s.filter(r => r.isTest).map(r => r[key]), all = s.map(r => r[key]);
  console.log(label.padEnd(30) + `n=${String(s.length).padStart(4)}  avg ${pct(mean(all)).padStart(6)}  train ${pct(mean(tr)).padStart(6)}  test ${pct(mean(te)).padStart(6)}  win ${(all.filter(x => x > 0).length / all.length * 100).toFixed(0)}%` + (mean(tr) > 0.03 && mean(te) > 0.03 ? ' ✅' : ''));
}
console.log(`FILTERED 2-DTE SWING — BULL_REVERSE, n=${recs.length} (split ${split})\n`);
console.log('hold to expiry (2 nights):');
line('  no filter', recs, 'expiry');
line('  FILTERED (not-down-tape+not-PM)', recs.filter(r => r.pass), 'expiry');
console.log('\n+100%/-60% target-stop over 2 days:');
line('  no filter', recs, 'tgt');
line('  FILTERED', recs.filter(r => r.pass), 'tgt');
const fp = recs.filter(r => r.pass);
const byDay = {}; for (const r of fp) (byDay[r.day] = byDay[r.day] || []).push(r.expiry);
console.log(`\nfiltered: ${fp.length} trades over ${Object.keys(byDay).length} days (${(fp.length / Object.keys(byDay).length).toFixed(1)}/day)`);
