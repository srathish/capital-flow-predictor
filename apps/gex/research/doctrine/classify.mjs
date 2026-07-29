// Classify each replay day as CHOP / TREND / MIXED from the SPXW surface, so we can
// test the reversal model where it should work (chop) and see our actual P&L by regime.
//   CHOP  = positive-gamma pin + range >> net move (price oscillated, ended near open)
//   TREND = big net move OR negative-gamma
// Usage: node classify.mjs
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
import Database from 'better-sqlite3';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const load = (day) => { const f = path.join(DIR, `replay_${day}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : []; };
const db = new Database(path.join(process.cwd(), 'data', 'gexester.db'), { readonly: true });
const actual = (day) => { const r = db.prepare('SELECT entry_mark,close_mark FROM tracked_plays WHERE trading_day=? AND close_mark IS NOT NULL AND entry_mark>0').all(day); return { n: r.length, usd: Math.round(r.reduce((a, x) => a + (x.close_mark - x.entry_mark) * 100, 0)) }; };

const days = fs.readdirSync(DIR).filter(f => /replay_2026-07-\d\d_SPXW/.test(f)).map(f => f.slice(7, 17)).sort();
console.log('day          open   close   net%   range%  posGam%  chopScore  LABEL     actual(n,$)');
for (const day of days) {
  const fr = load(day); if (fr.length < 60) { console.log(`${day}   (no data)`); continue; }
  const sp = fr.map(f => f.spot), o = sp[0], c = sp[sp.length - 1], hi = Math.max(...sp), lo = Math.min(...sp);
  const net = (c - o) / o * 100, range = (hi - lo) / o * 100;
  const posGam = fr.filter(f => f.strikes.reduce((a, b) => a + b.g0, 0) > 0).length / fr.length * 100;
  const chop = range / Math.max(Math.abs(net), 0.15);          // range >> net = oscillated
  const label = (posGam >= 55 && chop >= 2.5) ? 'CHOP' : (Math.abs(net) >= 0.5 || posGam < 45) ? 'TREND' : 'MIXED';
  const a = actual(day);
  console.log(`${day}   ${o.toFixed(0)}  ${c.toFixed(0)}  ${(net>=0?'+':'')+net.toFixed(2)}  ${range.toFixed(2).padStart(5)}   ${posGam.toFixed(0).padStart(3)}     ${chop.toFixed(1).padStart(4)}     ${label.padEnd(6)}  ${a.n}f ${(a.usd>=0?'+$':'-$')+Math.abs(a.usd)}`);
}
