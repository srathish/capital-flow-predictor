// ── Targeted Skylit forward-poller ───────────────────────────────────────
// For the screened candidate basket ONLY, pull the AGGREGATE GEX/VEX (summed
// across ALL expirations = the SWING view, not the 0DTE col0) a few times a
// day. Appends one snapshot per (ticker, poll) to data/snapshots.jsonl so we
// build a forward, hindsight-proof dataset over ~2 months.
//
// Bounded by design: N candidates x 3 polls/day, never the full universe.
//
// Usage: node research/stock-gex/poll.mjs            (polls candidates.json)
//        node research/stock-gex/poll.mjs HOOD NVDA  (ad-hoc tickers)
// RESEARCH TOOLING — does not touch live trading code.
import '../../scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../src/heatseeker/auth.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
fs.mkdirSync(DATA, { recursive: true });
const BAND = 0.20;               // ±20% strikes around spot (swing width, wider than 0DTE)
const nowIso = process.argv.find(a => a.startsWith('--ts='))?.slice(5) || new Date().toISOString();

// --rth-gate: for scheduled runs — only poll on weekdays during US market hours
// (09:30–16:00 ET). TZ-robust: computes ET regardless of the machine's locale.
if (process.argv.includes('--rth-gate')) {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dow = et.getDay(), hm = et.getHours() * 60 + et.getMinutes();
  if (dow === 0 || dow === 6 || hm < 9 * 60 + 30 || hm > 16 * 60) { console.log('outside RTH — skip'); process.exit(0); }
}

// Basket = the VERIFIED names (from verify.mjs), tagged with their thesis + verdict,
// so the forward record manages the entries AND validates whether ENTER beat AVOID.
// Falls back to the raw candidates+pinned if verify hasn't run yet.
const tickers = process.argv.slice(2).filter(a => !a.startsWith('--'));
let basket = tickers.map(t => ({ ticker: t.toUpperCase() }));
if (!basket.length) {
  const vf = path.join(HERE, 'verdicts.json');
  if (fs.existsSync(vf)) {
    basket = JSON.parse(fs.readFileSync(vf, 'utf8')).verdicts.map(v => ({ ticker: v.ticker, side: v.side, verdict: v.verdict, entry_grade: v.grade }));
  } else {
    const cf = path.join(HERE, 'candidates.json');
    if (!fs.existsSync(cf)) { console.error('no verdicts.json or candidates.json — run screen.mjs + verify.mjs first'); process.exit(1); }
    const screened = JSON.parse(fs.readFileSync(cf, 'utf8')).candidates.map(c => ({ ticker: c.ticker, side: c.bias }));
    const pf = path.join(HERE, 'pinned.json');
    const pinned = fs.existsSync(pf) ? (JSON.parse(fs.readFileSync(pf, 'utf8')).pinned || []).map(t => ({ ticker: t })) : [];
    const seen = new Set(screened.map(s => s.ticker));
    basket = [...screened, ...pinned.filter(p => !seen.has(p.ticker))];
  }
}

await initAuth();

async function pullAgg(ticker) {
  const token = await getFreshToken();
  const url = new URL('https://app.skylit.ai/api/data');
  url.searchParams.set('symbol', ticker);
  url.searchParams.set('max_strikes', '150');
  url.searchParams.set('max_expirations', '12');   // aggregate across all expirations = swing view
  url.searchParams.set('nocache', Math.random().toString());
  const r = await fetch(url, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return { ticker, error: `HTTP ${r.status}` };
  const raw = await r.json();
  const spot = raw.CurrentSpot;
  if (spot == null) return { ticker, error: 'no spot' };
  const K = raw.Strikes || [], G = raw.GammaValues || [], V = raw.VannaValues || [];
  const exps = (raw.Expirations || []).length;
  const nodes = [];
  for (let i = 0; i < K.length; i++) {
    const k = +K[i];
    if (!Number.isFinite(k) || Math.abs(k - spot) / spot > BAND) continue;
    const g = (G[i] || []).reduce((a, b) => a + (+b || 0), 0);   // AGGREGATE gamma
    const v = (V[i] || []).reduce((a, b) => a + (+b || 0), 0);   // AGGREGATE vanna
    nodes.push({ k, g: +(g / 1e6).toFixed(2), v: +(v / 1e6).toFixed(2) }); // in $M
  }
  // structural summary off the aggregate surface
  const byMag = [...nodes].sort((a, b) => Math.abs(b.g) - Math.abs(a.g));
  const pika = nodes.filter(n => n.g > 0), barney = nodes.filter(n => n.g < 0);
  const strongestBelow = (list) => list.filter(n => n.k < spot).sort((a, b) => Math.abs(b.g) - Math.abs(a.g))[0] || null;
  const strongestAbove = (list) => list.filter(n => n.k > spot).sort((a, b) => Math.abs(b.g) - Math.abs(a.g))[0] || null;
  const vmag = [...nodes].sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0] || null;
  return {
    ticker, spot, exps, band: BAND, nodes,
    king: byMag[0] || null,                    // biggest node overall
    floor: strongestBelow(pika),               // strongest pika support below spot
    ceiling: strongestAbove(pika),             // strongest pika resistance above spot
    accel_below: strongestBelow(barney),       // barney downside accelerant below
    accel_above: strongestAbove(barney),       // barney squeeze fuel above
    vmag,                                       // biggest vanna magnet
  };
}

const ws = fs.createWriteStream(path.join(DATA, 'snapshots.jsonl'), { flags: 'a' });
console.log(`polling ${basket.length} names (aggregate/swing GEX): ${basket.map(b => b.ticker).join(' ')}`);
let ok = 0;
for (const entry of basket) {
  const t = entry.ticker;
  try {
    const s = await pullAgg(t);
    if (s.error) { console.log(`  ${t.padEnd(6)} ERR ${s.error}`); continue; }
    // tag each snapshot with the entry thesis so the forward record ties to the trade
    ws.write(JSON.stringify({ ts: nowIso, side: entry.side || null, verdict: entry.verdict || null, entry_grade: entry.entry_grade ?? null, ...s }) + '\n');
    ok++;
    const f = s.floor ? `${s.floor.k}(${s.floor.g}M)` : '—';
    const c = s.ceiling ? `${s.ceiling.k}(${s.ceiling.g}M)` : '—';
    const k = s.king ? `${s.king.k}(${s.king.g}M ${s.king.g > 0 ? 'pika' : 'barney'})` : '—';
    console.log(`  ${t.padEnd(6)} spot ${String(s.spot).padStart(7)} | KING ${k.padEnd(20)} floor ${c === '—' ? '' : ''}${f.padEnd(14)} ceiling ${c}`);
  } catch (e) { console.log(`  ${t.padEnd(6)} EXC ${e.message}`); }
  await new Promise(r => setTimeout(r, 300));
}
ws.end();
console.log(`\n${ok}/${basket.length} snapshots appended -> ${path.join(DATA, 'snapshots.jsonl')}`);
