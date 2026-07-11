// Overnight study Phase 5b — does the SURFACE signal LEAD? (research only).
// Phase 5 showed escalator vs pin separates winners/losers, but was measured at
// the exit moment (near-circular). Here the decision is made at +15m using only
// <=+15m surface, then we measure the FORWARD outcome (+15m -> later). If the
// surface at +15m predicts what happens AFTER +15m, it's a true lead indicator.
// Switching: escalator@15 -> hold to EOD ; pin@15 -> exit at +15m. Real marks.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const ARCHIVE = path.join(HERE, '..', '..', 'data', 'skylit-archive', 'intraday');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
const fc = {};
function frames(day, ticker) {
  const k = `${day}|${ticker}`; if (fc[k]) return fc[k];
  const p = path.join(ARCHIVE, day, `${ticker}.jsonl.gz`); if (!fs.existsSync(p)) return (fc[k] = []);
  return (fc[k] = zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    .map(s => ({ tsMs: Date.parse(s.requestedTs), spot: s.spot, strikes: s.strikes || [] })).filter(s => s.spot != null).sort((a, b) => a.tsMs - b.tsMs));
}
function king(frame) { let tot = 0, best = null; for (const r of frame.strikes) { const g = Math.abs(Number(r.gamma) || 0); tot += g; if (!best || g > best.ag) best = { strike: +r.strike, ag: g }; } return best ? { strike: best.strike, share: best.ag / (tot || 1) } : null; }
const at = (fr, ts) => { let i = 0; while (i < fr.length - 1 && fr[i + 1].tsMs <= ts) i++; return fr[i]; };
function optSteps(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`)).map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= fire.fireTsMs + 60000); if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close, s = opt.slice(ei), t0 = s[0].ts;
  const gAt = min => { let last = s[0]; for (const o of s) { if (o.ts - t0 <= min * 60000) last = o; else break; } return (last.close - entry) / entry; };
  return { e15: gAt(15), eod: (s.at(-1).close - entry) / entry };
}
const fires = load(path.join(HERE, 'fires_index.json')).filter(f => f.state === 'BULL_REVERSE' && f.src === 'replay');
const days = [...new Set(fires.map(f => f.day))].sort(); const split = days[Math.floor(days.length / 2)];
const recs = [];
for (const f of fires) {
  const m = optSteps(f); if (!m) continue;
  const fr = frames(f.day, f.ticker); if (fr.length < 5) continue;
  const f0 = at(fr, f.fireTsMs), f15 = at(fr, f.fireTsMs + 15 * 60000); if (!f0 || !f15 || f15.tsMs <= f0.tsMs) continue;
  const k0 = king(f0), k15 = king(f15); if (!k0 || !k15) continue;
  const escalator = (k15.share - k0.share) < 0 && (f15.spot - f0.spot) > 0 && (Math.abs(f15.spot - k15.strike) - Math.abs(f0.spot - k0.strike)) > 0;
  recs.push({ isTest: f.day >= split, e15: m.e15, eod: m.eod, escalator });
}
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = x => Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%` : ' -';
function line(label, s, key) {
  const tr = s.filter(r => !r.isTest).map(r => r[key]), te = s.filter(r => r.isTest).map(r => r[key]), all = s.map(r => r[key]);
  console.log(label.padEnd(36) + `n=${String(s.length).padStart(4)}  avg ${pct(mean(all)).padStart(6)}  train ${pct(mean(tr)).padStart(6)}  test ${pct(mean(te)).padStart(6)}  win ${(all.filter(x => x > 0).length / all.length * 100).toFixed(0)}%` + (mean(tr) > 0.05 && mean(te) > 0.05 ? ' ✅' : ''));
}
const esc = recs.filter(r => r.escalator), pin = recs.filter(r => !r.escalator);
console.log(`SURFACE-LEAD (decide @ +15m) — BULL_REVERSE (replay), n=${recs.length} (split ${split})`);
console.log(`escalator@15: ${esc.length}  pin@15: ${pin.length}\n`);
console.log('KEY: does escalator@15 predict the FORWARD (+15m->EOD) move? compare hold(eod) vs cut(e15):');
line('escalator@15 -> HOLD to EOD', esc, 'eod');
line('escalator@15 -> cut at +15m', esc, 'e15');
line('pin@15 -> HOLD to EOD', pin, 'eod');
line('pin@15 -> cut at +15m', pin, 'e15');
const sw = recs.map(r => ({ isTest: r.isTest, g: r.escalator ? r.eod : r.e15 }));
console.log('\nSWITCHING (escalator@15->hold EOD, pin@15->cut@15m):');
line('  switch', sw, 'g');
line('  vs always-hold EOD', recs.map(r => ({ isTest: r.isTest, g: r.eod })), 'g');
line('  vs always-cut @15m', recs.map(r => ({ isTest: r.isTest, g: r.e15 })), 'g');
