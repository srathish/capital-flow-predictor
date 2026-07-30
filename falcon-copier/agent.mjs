// THE AGENT — agentic (not rule-based) 0DTE decision layer for SPX/SPY/QQQ. Each minute it assembles the FULL
// data state for all three instruments — every near-money strike's GEX+VEX, a 30-min TIMELINE of the structure
// (so it sees nodes grow / roll down, not a still photo), regime, price path, cross-index — AND reads back its
// OWN running journal (thesis, watched levels, open position) from earlier today. Claude reasons over all of it
// like an analyst, emits a decision (which instrument, direction, conviction, structural target, stop, why) +
// an updated journal note, then a red-team pass tries to refute it. Continuity across the stateless per-minute
// calls comes from re-injecting the journal. No pika/barney/flush thresholds decide — that's doctrine it reasons WITH.
//   one moment:   node agent.mjs --et 15:00
//   watch it build the day:  node agent.mjs --sequence 14:30,14:45,15:00,15:10
import '../apps/gex/scripts/_env-bootstrap.js';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const KEY = process.env.ANTHROPIC_API_KEY, MODEL = process.env.AGENT_MODEL || 'claude-sonnet-5';
const FC = path.join(process.cwd(), 'falcon-copier'), DAY = '2026-07-29';
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? (process.argv[i + 1] || true) : d; };
const M = (x) => +(x / 1e6).toFixed(1);
const etM = (ts) => (+ts.slice(11, 13) - 4) * 60 + +ts.slice(14, 16);
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const INSTR = { SPXW: { map: 80, band: 40, dom: 70, wide: 200, strong: 20e6 }, SPY: { map: 8, band: 4, dom: 7, wide: 20, strong: 20e6 }, QQQ: { map: 8, band: 4, dom: 7, wide: 20, strong: 5e6 } };
const load = (sym) => { const f = path.join(FC, `today_${sym}.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').map(l => JSON.parse(l)) : null; };

function assembleInstrument(sym, etStr) {
  const F = load(sym); if (!F) return null;
  const I = INSTR[sym], target = (+etStr.slice(0, 2)) * 60 + (+etStr.slice(3, 5));
  let idx = 0; for (let i = 0; i < F.length; i++) if (Math.abs(etM(F[i].ts) - target) < Math.abs(etM(F[idx].ts) - target)) idx = i;
  const s = F[idx], spot = s.spot, at = (b) => F[Math.max(0, idx - b)];
  const g0Prev = (k, b) => (at(b).strikes.find(n => n.k === k)?.g0 || 0);
  const domNeg = (fr) => { const d = fr.strikes.filter(n => Math.abs(n.k - fr.spot) <= I.dom && n.g0 < 0).sort((x, y) => x.g0 - y.g0)[0]; return d ? { strike: d.k, gex_M: M(d.g0) } : null; };
  const kingOf = (fr) => { const k = fr.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0]; return k ? k.k : null; };
  const netOf = (fr) => M(fr.strikes.filter(n => Math.abs(n.k - fr.spot) <= I.band).reduce((a, c) => a + c.g0, 0));
  // 30-min STRUCTURE TIMELINE at 6-min steps — the trajectory (node growth / roll-down / regime shift)
  const timeline = [30, 24, 18, 12, 6, 0].filter(b => idx - b >= 0).map(b => { const fr = at(b); const dn = domNeg(fr); return { et: etOf(fr.ts), spot: +fr.spot.toFixed(1), king: kingOf(fr), dom_neg_strike: dn?.strike ?? null, dom_neg_M: dn?.gex_M ?? null, net_gamma_M: netOf(fr) }; });
  const map = s.strikes.filter(n => Math.abs(n.k - spot) <= I.map).sort((a, b) => a.k - b.k).map(n => ({ strike: n.k, gex_M: M(n.g0), vex_M: M(n.v0 || 0), gex_chg15_M: M(n.g0 - g0Prev(n.k, 15)) }));
  const strongWide = s.strikes.filter(n => Math.abs(n.g0) >= I.strong && Math.abs(n.k - spot) <= I.wide).sort((a, b) => a.k - b.k).map(n => ({ strike: n.k, gex_M: M(n.g0), side: n.k > spot ? 'above' : 'below' }));
  const king = s.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0];
  const floor = s.strikes.filter(n => n.g0 >= I.strong && n.k < spot).sort((a, b) => b.k - a.k)[0];
  const ceil = s.strikes.filter(n => n.g0 <= -I.strong && n.k > spot).sort((a, b) => a.k - b.k)[0];
  const band = s.strikes.filter(n => Math.abs(n.k - spot) <= I.band), path30 = F.slice(Math.max(0, idx - 30), idx + 1).map(f => +f.spot.toFixed(1));
  return {
    symbol: sym, spot: +spot.toFixed(2), chg_pct: +(((spot - s.prevClose) / s.prevClose) * 100).toFixed(2), session_high: Math.max(...path30), session_low: Math.min(...path30),
    price_path_30m: path30, structure_timeline_30m: timeline,
    king_node: king ? { strike: king.k, gex_M: M(king.g0) } : null,
    nearest_strong_support_below: floor ? { strike: floor.k, gex_M: M(floor.g0) } : null,
    nearest_strong_resistance_above: ceil ? { strike: ceil.k, gex_M: M(ceil.g0) } : null,
    regime_now: { neg_strikes: band.filter(n => n.g0 < 0).length, pos_strikes: band.filter(n => n.g0 > 0).length, net_gamma_M: netOf(s) },
    strong_nodes_wide: strongWide, gex_vex_map_now: map,
  };
}
function assembleComplex(etStr) {
  const instruments = {}; for (const sym of ['SPXW', 'SPY', 'QQQ']) { const a = assembleInstrument(sym, etStr); if (a) instruments[sym] = a; }
  return { as_of_et: etStr, instruments, note: 'Trade whichever of SPXW/SPY/QQQ has the highest-conviction setup, or stand aside. Use the other two as CONFIRMATION (aligned = stronger; a leading index not confirming weakens the move). flow/dark-pool/tide/VIX are live-only, absent here — reason from structure + regime + cross-index + price action + the 30-min timeline.' };
}

const DOCTRINE = `You are a 0DTE index-options trader (SPXW/SPY/QQQ) reasoning over gamma structure and its evolution to decide ONE thing each minute: is there a high-conviction trade right now — which instrument, which way, where to. You reason like an analyst over ALL the data and your own running notes. You are NOT a rule engine.

WHAT THE DATA IS
- gex_M per strike = 0DTE dealer gamma. POSITIVE (pika) = wall/magnet/pin: price gravitates to it, tends to hold/reject. NEGATIVE (barney) = accelerant: thin, dealers amplify; a rally INTO a big negative node above spot is a wall of dealer selling that tends to reject price DOWN.
- king_node = largest positive node = dominant magnet. vex_M = 0DTE vanna. gex_chg15_M = 15-min node change.
- structure_timeline_30m = the LAST 30 MIN at 6-min steps. THIS is your edge over a snapshot: watch dom_neg_M grow (conviction building at the wall) and dom_neg_strike ROLL DOWN (ceiling chasing price = top confirming), and net_gamma shift (regime change).

HOW TO READ IT (doctrine, synthesize — do not pattern-match)
- REGIME first. Near-money mostly NEGATIVE (net_gamma negative, neg>>pos) = negative-gamma: moves TREND/ACCELERATE, reversals run, price rips toward levels fast (speed is a lure). Mostly POSITIVE = pinned/mean-revert: fade extensions to walls, expect chop.
- EVOLUTION. A dominant negative node growing then ROLLING DOWN across the timeline after price tagged it = a top confirming — that is the trigger, not the tag itself. A positive node growing below = the floor/target firming.
- TARGET = read it off the map: the next large positive node (support/floor). In a negative-gamma flush the move runs there, not a fixed distance.
- CROSS-INDEX. If SPX rallies but QQQ won't confirm (red/weak), the move is suspect. Alignment across the three raises conviction.

DISCIPLINE (where the edge is)
- You CANNOT predict raw direction from structure alone. Reason from REGIME + EVOLUTION + PRICE ACTION + CROSS-INDEX. If they don't line up, STAND ASIDE — most minutes are stand_aside. ~1-3 real trades/day.
- Don't chase: a move already run that you're late to is usually stand_aside (say so).
- Manage to STRUCTURE: target the next node, stop beyond the level that invalidates the thesis.
- Use YOUR RUNNING JOURNAL: continue the thesis you were building; note when your watched trigger fires.
- conviction 0-1 honest: 0.7+ only when regime, evolution, structure, price action and cross-index agree.`;

const TOOL = {
  name: 'emit_decision', description: 'Emit the decision after reasoning over all data + your journal. Call exactly once.',
  input_schema: {
    type: 'object', required: ['direction', 'conviction', 'thesis', 'regime_read', 'key_risk', 'journal_update'],
    properties: {
      instrument: { type: 'string', enum: ['SPXW', 'SPY', 'QQQ', 'none'] },
      direction: { type: 'string', enum: ['long', 'short', 'stand_aside'] },
      conviction: { type: 'number', minimum: 0, maximum: 1 },
      entry_zone: { type: 'string' }, target: { type: 'string' }, stop: { type: 'string' },
      regime_read: { type: 'string' }, thesis: { type: 'string', description: '2-4 sentences synthesizing map+timeline+cross-index+price' },
      key_risk: { type: 'string', description: 'single strongest reason it could be wrong' },
      journal_update: { type: 'string', description: 'your running notes to carry to the next minute: current bias, levels you are watching, what would trigger/invalidate' },
    },
  },
};

async function claude(system, content, tool) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, system, messages: [{ role: 'user', content }], tools: [tool], tool_choice: { type: 'tool', name: tool.name } }),
  });
  const j = await r.json(); if (r.status !== 200) throw new Error(`API ${r.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
  return (j.content || []).find(c => c.type === 'tool_use')?.input || {};
}

const MEM = path.join(FC, `agent_state_${DAY}.json`);
async function step(et, mem) {
  const state = assembleComplex(et);
  const journal = mem.notes ? `YOUR RUNNING JOURNAL (your own notes from earlier today):\n${mem.notes}\nOpen position: ${mem.position ? JSON.stringify(mem.position) : 'none'}` : 'YOUR RUNNING JOURNAL: (empty — first read of the day)';
  const d = await claude(DOCTRINE, `${journal}\n\nFULL DATA STATE @ ${et} ET:\n${JSON.stringify(state, null, 1)}\n\nReason over ALL of it (and continue your journal) and emit your decision.`, TOOL);
  let verdict = null;
  if (d.direction && d.direction !== 'stand_aside') {
    verdict = await claude(`You are the RED TEAM. Try to REFUTE the proposed 0DTE trade — strongest reason it's wrong (fighting regime, late/chasing, misread node/roll-down, no cross-index confirmation, chop). Default skeptical.`,
      `Data @ ${et}:\n${JSON.stringify(state, null, 1)}\n\nProposed: ${JSON.stringify({ instrument: d.instrument, direction: d.direction, conviction: d.conviction, entry: d.entry_zone, target: d.target, thesis: d.thesis })}\n\nDoes it SURVIVE? Emit verdict.`,
      { name: 'emit_verdict', description: 'red-team verdict', input_schema: { type: 'object', required: ['survives', 'strongest_objection', 'adjusted_conviction'], properties: { survives: { type: 'boolean' }, strongest_objection: { type: 'string' }, adjusted_conviction: { type: 'number', minimum: 0, maximum: 1 } } } });
  }
  // persist the agent's own journal → continuity to the next minute
  mem.notes = d.journal_update || mem.notes; mem.log = (mem.log || []).concat({ et, instrument: d.instrument, direction: d.direction, conviction: d.conviction });
  fs.writeFileSync(MEM, JSON.stringify(mem, null, 1));
  const R = state.instruments.SPXW;
  console.log(`\n─── @ ${et} ET · SPX ${R.spot} (${R.chg_pct >= 0 ? '+' : ''}${R.chg_pct}%) · roll ${R.dominant_negative_node?.strike ?? R.structure_timeline_30m.map(t => t.dom_neg_strike).join('→')} ───`);
  console.log(`  → ${(d.instrument && d.instrument !== 'none' ? d.instrument + ' ' : '')}${(d.direction || '?').toUpperCase()}  conviction ${d.conviction}${verdict ? `  · RED TEAM ${verdict.survives ? 'SURVIVES' : 'REFUTED'} (adj ${verdict.adjusted_conviction})` : ''}`);
  if (d.direction !== 'stand_aside') console.log(`     entry ${d.entry_zone || '—'} · target ${d.target || '—'} · stop ${d.stop || '—'}`);
  console.log(`     regime: ${d.regime_read}`);
  console.log(`     thesis: ${d.thesis}`);
  if (verdict && !verdict.survives) console.log(`     red-team: ${verdict.strongest_objection}`);
  console.log(`     journal→ ${d.journal_update}`);
  return mem;
}

const seq = arg('--sequence', null);
let mem = { day: DAY, notes: '', position: null, log: [] };
if (seq) { for (const et of String(seq).split(',')) mem = await step(et.trim(), mem); }
else await step(arg('--et', '15:00'), mem);
