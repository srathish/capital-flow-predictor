// Overnight study Phase 3f — CHOP SCALP (research only). User insight: chop days
// still pay — via fast scalps, not holds. Phase 3c showed chop SCALP30 = +4%/+4%
// (robust). Here: find the BEST fast exit for chop, and a REALIZABLE version
// (can't know chop ex-ante, so gate out down-tape — the bull-tape-gate idea — and
// scalp fast). All on real 0DTE marks, close-basis, train/test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache'), UND = path.join(HERE, 'cache_underlying');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
const spyC = {};
function spy(day) {
  if (spyC[day]) return spyC[day];
  const b = load(path.join(UND, `SPY_${day}.json`)).map(r => ({ ts: Date.parse(r.start_time), close: +r.close })).filter(r => r.close > 0).sort((a, b) => a.ts - b.ts);
  const reg = b.filter(r => { const h = new Date(r.ts).getUTCHours(); return h >= 13 && h < 20; });
  return (spyC[day] = { open: reg[0]?.close, close: reg.at(-1)?.close, bars: reg });
}
const spyAt = (day, ts) => { const b = spy(day).bars; let i = 0; while (i < b.length - 1 && b[i + 1].ts <= ts) i++; return b[i]?.close; };

function steps(f) {
  const opt = load(path.join(CACHE, `${f.sym}_${f.day}.json`)).map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= f.fireTsMs + 60000); if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close, s = opt.slice(ei), t0 = s[0].ts;
  return s.map(o => ({ dtMin: (o.ts - t0) / 60000, g: (o.close - entry) / entry }));
}
// fast exits
function target(tp) { return S => { for (const s of S) { if (s.g >= tp) return s.g; if (s.g <= -0.5) return s.g; } return S.at(-1).g; }; }
function timeExit(m) { return S => { for (const s of S) if (s.dtMin >= m) return s.g; return S.at(-1).g; }; }
function targetOrTime(tp, m) { return S => { for (const s of S) { if (s.g >= tp) return s.g; if (s.dtMin >= m) return s.g; if (s.g <= -0.5) return s.g; } return S.at(-1).g; }; }
const EXITS = {
  't+20': target(0.2), 't+30': target(0.3), 't+50': target(0.5),
  'time10': timeExit(10), 'time20': timeExit(20),
  't30/20m': targetOrTime(0.3, 20), 't50/15m': targetOrTime(0.5, 15), 't40/20m': targetOrTime(0.4, 20),
};

const fires = load(path.join(HERE, 'fires_index.json')).filter(f => f.state === 'BULL_REVERSE');
const days = [...new Set(fires.map(f => f.day))].sort();
const split = days[Math.floor(days.length / 2)];
const recs = [];
for (const f of fires) {
  const S = steps(f); const sp = spy(f.day); if (!S || !sp.open) continue;
  const dayMove = (sp.close - sp.open) / sp.open;
  const tapeNow = (spyAt(f.day, f.fireTsMs) - sp.open) / sp.open;
  recs.push({
    isTest: f.day >= split, S,
    chop: Math.abs(dayMove) < 0.005, down: dayMove < -0.005,
    tapeDown: tapeNow < -0.002,               // realizable: SPY below open at fire
  });
}
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = x => Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%` : ' -';
function tbl(label, subset) {
  console.log(`\n== ${label}  (n=${subset.length}) ==`);
  const rows = Object.keys(EXITS).map(k => {
    const tr = subset.filter(r => !r.isTest).map(r => EXITS[k](r.S)), te = subset.filter(r => r.isTest).map(r => EXITS[k](r.S));
    const all = subset.map(r => EXITS[k](r.S));
    return { k, trM: mean(tr), teM: mean(te), win: all.filter(x => x > 0).length / all.length };
  }).sort((a, b) => Math.min(b.trM, b.teM) - Math.min(a.trM, a.teM));
  for (const r of rows) console.log('  ' + r.k.padEnd(10) + `train ${pct(r.trM).padStart(6)}  test ${pct(r.teM).padStart(6)}  win ${(r.win * 100).toFixed(0)}%` + (r.trM > 0.02 && r.teM > 0.02 ? ' ✅' : ''));
}
console.log(`CHOP SCALP STUDY — BULL_REVERSE, n=${recs.length} (split ${split})`);
tbl('CHOP days only (hindsight)', recs.filter(r => r.chop));
tbl('REALIZABLE: exclude down-tape (SPY>=open at fire), all days', recs.filter(r => !r.tapeDown));
tbl('ALL fires (no filter)', recs);
