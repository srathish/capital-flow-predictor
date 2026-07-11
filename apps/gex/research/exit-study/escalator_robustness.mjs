// Overnight study Phase 6d — surface escalator: real signal or circular? (research)
// Phase 5 escalator ("cut at +15m") looked strong (+25% test mid). Two threats:
//  (1) costs — but the move is bigger (~+21%), so a 2-3% cost is a small haircut.
//  (2) CIRCULARITY — escalator includes spot-rise, which mechanically = call up.
//      Test whether the SURFACE adds anything beyond a pure spot-rise classifier.
// Compare, net of calibrated cost, train/test: escalator (full surface) vs
// spot-rise-only vs share-falling-only. If escalator ~= spot-rise-only, the
// surface adds nothing.
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
function king(fr) { let tot = 0, best = null; for (const r of fr.strikes) { const g = Math.abs(Number(r.gamma) || 0); tot += g; if (!best || g > best.ag) best = { strike: +r.strike, ag: g }; } return best ? { strike: best.strike, share: best.ag / (tot || 1) } : null; }
const at = (fr, ts) => { let i = 0; while (i < fr.length - 1 && fr[i + 1].tsMs <= ts) i++; return fr[i]; };
function e15(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`)).map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= fire.fireTsMs + 60000); if (ei < 0) return null;
  const entry = opt[ei].close, s = opt.slice(ei), t0 = s[0].ts; let last = s[0];
  for (const o of s) { if (o.ts - t0 <= 15 * 60000) last = o; else break; }
  return (last.close - entry) / entry;
}
const COST = { SPY: 0.019 * 1.5, QQQ: 0.014 * 1.5, SPXW: 0.022 * 1.5 };
const net = (g, rt) => { const h = rt / 2; return ((1 + g) * (1 - h) - (1 + h)) / (1 + h); };
const fires = load(path.join(HERE, 'fires_index.json')).filter(f => f.state === 'BULL_REVERSE' && f.src === 'replay');
const R = [];
for (const f of fires) {
  const g = e15(f); if (g == null) continue;
  const fr = frames(f.day, f.ticker); if (fr.length < 5) continue;
  const f0 = at(fr, f.fireTsMs), f1 = at(fr, f.fireTsMs + 15 * 60000); if (!f0 || !f1 || f1.tsMs <= f0.tsMs) continue;
  const k0 = king(f0), k1 = king(f1); if (!k0 || !k1) continue;
  R.push({ day: f.day, g, cost: COST[f.ticker] ?? 0.03,
    spotRise: (f1.spot - f0.spot) > 0, shareFall: (k1.share - k0.share) < 0,
    escape: (Math.abs(f1.spot - k1.strike) - Math.abs(f0.spot - k0.strike)) > 0 });
}
const days = [...new Set(R.map(r => r.day))].sort(); const split = days[Math.floor(days.length / 2)];
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = x => Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%` : ' -';
function stat(sub) { const tr = sub.filter(r => r.day < split).map(r => net(r.g, r.cost)), te = sub.filter(r => r.day >= split).map(r => net(r.g, r.cost)); return { n: sub.length, tr: mean(tr), te: mean(te), win: sub.filter(r => r.g > 0).length / sub.length }; }
console.log(`ESCALATOR ROBUSTNESS — cut@+15m, net calibrated cost, n=${R.length} split ${split}\n`);
console.log('classifier'.padEnd(26) + 'n'.padStart(6) + 'train'.padStart(9) + 'test'.padStart(9) + 'win'.padStart(7));
for (const [lab, pred] of [
  ['escalator (full surface)', r => r.spotRise && r.shareFall && r.escape],
  ['spot-rise ONLY', r => r.spotRise],
  ['share-falling ONLY', r => r.shareFall],
  ['spot-rise + escape (no share)', r => r.spotRise && r.escape],
  ['NOT escalator (rest)', r => !(r.spotRise && r.shareFall && r.escape)],
]) { const s = stat(R.filter(pred)); console.log(lab.padEnd(26) + String(s.n).padStart(6) + pct(s.tr).padStart(9) + pct(s.te).padStart(9) + (s.win * 100).toFixed(0).padStart(6) + '%'); }
console.log('\nCircularity read: if "escalator" ≈ "spot-rise only", the surface adds nothing.');
