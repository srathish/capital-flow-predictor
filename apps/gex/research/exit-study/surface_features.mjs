// Overnight study Phase 5 — GEX SURFACE pin-escape classifier (research only).
// The un-mined vein: use the SURFACE (not price) to classify escalator vs pin.
//   At fire and fire+30m, find the King (max |gamma|) + its share (|g|/sum|g|).
//   escalator = King share FALLING and spot RISING away from King (trend forming)
//   pin       = King share holding/rising, spot stuck (chop)
// Switching strategy: escalator -> HOLD to close; pin -> SCALP (exit at +30m).
// Tests whether the surface robustly (both halves) captures the +65% trend-day
// hold that price/tape could not. Real option marks for P&L. Train/test split.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const ARCHIVE = path.join(HERE, '..', '..', 'data', 'skylit-archive', 'intraday');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

const frameCache = {};
function frames(day, ticker) {
  const k = `${day}|${ticker}`; if (frameCache[k]) return frameCache[k];
  const p = path.join(ARCHIVE, day, `${ticker}.jsonl.gz`);
  if (!fs.existsSync(p)) return (frameCache[k] = []);
  const rows = zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).map(s => ({ tsMs: Date.parse(s.requestedTs), spot: s.spot, strikes: s.strikes || [] })).filter(s => s.spot != null).sort((a, b) => a.tsMs - b.tsMs);
  return (frameCache[k] = rows);
}
function king(frame) {
  let tot = 0, best = null;
  for (const r of frame.strikes) { const g = Math.abs(Number(r.gamma) || 0); tot += g; if (!best || g > best.ag) best = { strike: Number(r.strike), ag: g }; }
  return best ? { strike: best.strike, share: best.ag / (tot || 1) } : null;
}
const frameAt = (fr, ts) => { let i = 0; while (i < fr.length - 1 && fr[i + 1].tsMs <= ts) i++; return fr[i]; };

function marks(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`)).map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= fire.fireTsMs + 60000); if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close, s = opt.slice(ei), t0 = s[0].ts;
  let e30 = null; for (const o of s) if (e30 == null && o.ts - t0 >= 30 * 60000) e30 = (o.close - entry) / entry;
  return { eod: (s.at(-1).close - entry) / entry, e30: e30 ?? (s.at(-1).close - entry) / entry };
}

const fires = load(path.join(HERE, 'fires_index.json')).filter(f => f.state === 'BULL_REVERSE' && f.src === 'replay');
const days = [...new Set(fires.map(f => f.day))].sort();
const split = days[Math.floor(days.length / 2)];
const recs = [];
for (const f of fires) {
  const m = marks(f); if (!m) continue;
  const fr = frames(f.day, f.ticker); if (fr.length < 6) continue;
  const f0 = frameAt(fr, f.fireTsMs), f1 = frameAt(fr, f.fireTsMs + 30 * 60000);
  if (!f0 || !f1 || f1.tsMs <= f0.tsMs) continue;
  const k0 = king(f0), k1 = king(f1); if (!k0 || !k1) continue;
  const shareSlope = k1.share - k0.share;                 // <0 = pin weakening
  const spotRise = (f1.spot - f0.spot) / f0.spot;         // >0 = climbing
  const escapeGrow = (Math.abs(f1.spot - k1.strike) - Math.abs(f0.spot - k0.strike)) / f0.spot; // >0 = leaving King
  const escalator = shareSlope < 0 && spotRise > 0 && escapeGrow > 0;
  recs.push({ isTest: f.day >= split, eod: m.eod, e30: m.e30, escalator, shareSlope, spotRise });
}
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = x => Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%` : ' -';
function line(label, s, key) {
  const tr = s.filter(r => !r.isTest).map(r => r[key]), te = s.filter(r => r.isTest).map(r => r[key]), all = s.map(r => r[key]);
  console.log(label.padEnd(34) + `n=${String(s.length).padStart(4)}  avg ${pct(mean(all)).padStart(6)}  train ${pct(mean(tr)).padStart(6)}  test ${pct(mean(te)).padStart(6)}  win ${(all.filter(x => x > 0).length / all.length * 100).toFixed(0)}%` + (mean(tr) > 0.05 && mean(te) > 0.05 ? ' ✅' : ''));
}
console.log(`GEX SURFACE PIN-ESCAPE — BULL_REVERSE (replay), n=${recs.length} (split ${split})\n`);
const esc = recs.filter(r => r.escalator), pin = recs.filter(r => !r.escalator);
console.log(`escalator-classified: ${esc.length}  |  pin-classified: ${pin.length}\n`);
console.log('escalator days -> HOLD to close:');
line('  escalator + HOLD', esc, 'eod');
line('  (same fires if scalped)', esc, 'e30');
console.log('\npin days -> SCALP (+30m):');
line('  pin + SCALP', pin, 'e30');
line('  (same fires if held)', pin, 'eod');
// the switching strategy P&L: escalator uses eod, pin uses e30
const sw = recs.map(r => ({ isTest: r.isTest, g: r.escalator ? r.eod : r.e30 }));
console.log('\nSWITCHING STRATEGY (surface: escalator->hold, pin->scalp):');
line('  switch', sw, 'g');
line('  vs always-scalp', recs.map(r => ({ isTest: r.isTest, g: r.e30 })), 'g');
line('  vs always-hold', recs.map(r => ({ isTest: r.isTest, g: r.eod })), 'g');
