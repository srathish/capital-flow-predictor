// SIDE LOGGER (research-only) — snapshots CANDIDATE senses each RTH minute to research/candidate_senses/${DAY}.jsonl
// for LATER study, WITHOUT entering the agent's decision prompt. This keeps agent.mjs FROZEN so the RUNNER/scale-out
// change accrues a CLEAN sample — these senses are logged, NOT acted on yet (per the review discipline).
// Candidate senses: OPEX / quad-witching day label · VIX1D intraday SLOPE (the 0DTE-IV crush/theta-tax rate) ·
// dealer delta/vega FLOW per index (the rate-of-pull behind the pin). All UW REST; no Skylit, no LLM, no book.
//   run:  node falcon-copier/sense_logger.mjs      (go.sh launches it alongside the agent)
import '../apps/gex/scripts/_env-bootstrap.js';
import fs from 'node:fs'; import path from 'node:path';
const UWKEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const FC = path.join(process.cwd(), 'falcon-copier');
const DAY = process.env.AGENT_DAY || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const DIR = path.join(FC, 'research', 'candidate_senses'); fs.mkdirSync(DIR, { recursive: true });
const OUT = path.join(DIR, `${DAY}.jsonl`);
const H = { Authorization: 'Bearer ' + UWKEY, Accept: 'application/json' };
const get = (p) => fetch('https://api.unusualwhales.com/api/' + p, { headers: H, signal: AbortSignal.timeout(9000) }).then(x => x.ok ? x.json() : null).catch(() => null);
const nowET = () => new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5);
const F = (x) => x == null ? null : Math.round(+x);

// OPEX: monthly = 3rd Friday; quad-witching = 3rd Friday of Mar/Jun/Sep/Dec — computed, no API
function opexFlags(dayStr) {
  const [y, mo, d] = dayStr.split('-').map(Number);
  const dow1 = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();   // day-of-week of the 1st
  const thirdFri = 1 + ((5 - dow1 + 7) % 7) + 14;
  const is_opex = d === thirdFri;
  return { is_opex, is_quad_witching: is_opex && [3, 6, 9, 12].includes(mo) };
}

let _lastVix1d = null, _lastVixMin = null;
async function snapshot() {
  const et = nowET(), etMin = (+et.slice(0, 2)) * 60 + (+et.slice(3, 5));
  const [spyTS, spyGF, qqqGF] = await Promise.all([get('stock/SPY/volatility/term-structure'), get('stock/SPY/greek-flow'), get('stock/QQQ/greek-flow')]);
  const spy0 = (spyTS?.data || []).find(x => +x.dte === 0), vix1d = spy0 ? +(+spy0.volatility * 100).toFixed(2) : null;
  let vix1d_slope = null;   // %/min — the 0DTE-IV crush(−)/expansion(+) RATE = the chop-theta-tax meter (a pinned regime bleeds premium fast)
  if (vix1d != null && _lastVix1d != null && _lastVixMin != null) { const dt = Math.max(1, etMin - _lastVixMin); vix1d_slope = +((vix1d - _lastVix1d) / dt).toFixed(3); }
  if (vix1d != null) { _lastVix1d = vix1d; _lastVixMin = etMin; }
  const gf = (r) => { const b = (r?.data || []).slice(-1)[0]; return b ? { dir_delta: F(b.dir_delta_flow), total_delta: F(b.total_delta_flow), dir_vega: F(b.dir_vega_flow) } : null; };   // dir_delta = the directional dealer-hedging flow = the pin's rate-of-pull
  const row = { et, ts: new Date().toISOString(), ...opexFlags(DAY), vix1d, vix1d_slope, delta_vega_flow: { SPY: gf(spyGF), QQQ: gf(qqqGF) } };
  try { fs.appendFileSync(OUT, JSON.stringify(row) + '\n'); } catch { }
  return row;
}

if (process.argv.includes('--once')) { console.log(JSON.stringify(await snapshot(), null, 1)); }
else {
  console.log(`  📊 sense-logger started (${DAY}) → research/candidate_senses/${DAY}.jsonl · research-ONLY, NOT in the agent's decisions · Ctrl-C to stop`);
  for (; ;) {
    const et = nowET(), m = (+et.slice(0, 2)) * 60 + (+et.slice(3, 5));
    if (m >= 9 * 60 + 30 && m <= 16 * 60) { try { const r = await snapshot(); console.log(`  ${et} · vix1d ${r.vix1d}${r.vix1d_slope != null ? ` (${r.vix1d_slope > 0 ? '+' : ''}${r.vix1d_slope}/min)` : ''} · SPY Δflow ${r.delta_vega_flow?.SPY?.dir_delta ?? '—'}${r.is_opex ? ' · ⚠OPEX' : ''}`); } catch { } }
    await new Promise(r => setTimeout(r, 60000));
  }
}
