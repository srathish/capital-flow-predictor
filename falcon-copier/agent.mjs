// THE AGENT — agentic (not rule-based) 0DTE decision layer for SPX/SPY/QQQ. Each minute it assembles the FULL
// data state for all three (every near-money strike's GEX+VEX, a 30-min STRUCTURE TIMELINE so it sees nodes
// grow / roll down, regime, wide node map incl. distant Kings, cross-index, price path), reads back its OWN
// running journal AND the lessons it has learned from past sessions, and reasons like an analyst — producing
// TWO risk-posture reads: CONSERVATIVE (needs confirmation, stands aside when unsure) and AGGRESSIVE (pulls the
// trigger on aligned reads, tap-reject w/ tight stop). It is not two rulebooks — it's one reasoning agent with
// two risk appetites, deciding entries itself. Then it LEARNS: --reflect reviews its calls vs what price did and
// writes lessons that get re-injected next time.  No pika/barney/flush thresholds decide — that's doctrine it reasons WITH.
//   watch it build the day (both postures):  node agent.mjs --sequence 14:30,14:45,15:00,15:10
//   learn from it:                           node agent.mjs --reflect
import '../apps/gex/scripts/_env-bootstrap.js';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const KEY = process.env.ANTHROPIC_API_KEY, MODEL = process.env.AGENT_MODEL || 'claude-sonnet-5';
const FC = path.join(process.cwd(), 'falcon-copier'), DAY = process.env.AGENT_DAY || '2026-07-29';
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? (process.argv[i + 1] || true) : d; };
const M = (x) => +(x / 1e6).toFixed(1);
const etM = (ts) => (+ts.slice(11, 13) - 4) * 60 + +ts.slice(14, 16);
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const INSTR = { SPXW: { map: 80, band: 40, dom: 70, wide: 200, strong: 20e6 }, SPY: { map: 8, band: 4, dom: 7, wide: 20, strong: 20e6 }, QQQ: { map: 8, band: 4, dom: 7, wide: 20, strong: 5e6 } };
const load = (sym) => { const f = path.join(FC, `today_${sym}.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').map(l => JSON.parse(l)) : null; };
const LESSONS_FILE = path.join(FC, 'agent_lessons.json');
const loadLessons = () => fs.existsSync(LESSONS_FILE) ? JSON.parse(fs.readFileSync(LESSONS_FILE, 'utf8')) : [];

function assembleInstrument(sym, etStr) {
  const F = load(sym); if (!F) return null;
  const I = INSTR[sym], target = (+etStr.slice(0, 2)) * 60 + (+etStr.slice(3, 5));
  let idx = 0; for (let i = 0; i < F.length; i++) if (Math.abs(etM(F[i].ts) - target) < Math.abs(etM(F[idx].ts) - target)) idx = i;
  const s = F[idx], spot = s.spot, at = (b) => F[Math.max(0, idx - b)];
  const g0Prev = (k, b) => (at(b).strikes.find(n => n.k === k)?.g0 || 0);
  const domNeg = (fr) => { const d = fr.strikes.filter(n => Math.abs(n.k - fr.spot) <= I.dom && n.g0 < 0).sort((x, y) => x.g0 - y.g0)[0]; return d ? { strike: d.k, gex_M: M(d.g0) } : null; };
  const kingOf = (fr) => { const k = fr.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0]; return k ? k.k : null; };
  const netOf = (fr) => M(fr.strikes.filter(n => Math.abs(n.k - fr.spot) <= I.band).reduce((a, c) => a + c.g0, 0));
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
function assembleComplex(etStr) { const instruments = {}; for (const sym of ['SPXW', 'SPY', 'QQQ']) { const a = assembleInstrument(sym, etStr); if (a) instruments[sym] = a; } return { as_of_et: etStr, instruments }; }
// what SPX actually did after a decision — for the learning/reflection pass
function outcomeAfter(etStr, mins = 45) {
  const F = load('SPXW'), t0 = (+etStr.slice(0, 2)) * 60 + (+etStr.slice(3, 5));
  const win = F.filter(f => { const m = etM(f.ts); return m >= t0 && m <= t0 + mins; }); if (!win.length) return null;
  const s0 = win[0].spot, hi = Math.max(...win.map(f => f.spot)), lo = Math.min(...win.map(f => f.spot)), end = win[win.length - 1].spot;
  return { spot_at: +s0.toFixed(1), high_next: +hi.toFixed(1), low_next: +lo.toFixed(1), spot_45m: +end.toFixed(1), max_up: +(hi - s0).toFixed(1), max_down: +(lo - s0).toFixed(1) };
}

const DOCTRINE = `You are a 0DTE index-options trader (SPXW/SPY/QQQ) reasoning over gamma structure and its 30-minute evolution to decide, each minute, if there is a trade — which instrument, which way, where. You reason like an analyst over ALL the data + your own journal + your learned lessons. You are NOT a rule engine; you decide entries yourself.

WHAT THE DATA IS
- gex_M per strike = 0DTE dealer gamma. POSITIVE (pika) = wall/magnet/pin: price gravitates to it, tends to hold/reject. NEGATIVE (barney) = accelerant: thin, dealers amplify; a rally INTO a big negative node above spot is a wall of dealer selling that tends to reject price DOWN.
- king_node = largest positive node = dominant magnet. vex_M = 0DTE vanna. gex_chg15_M = 15-min node change.
- structure_timeline_30m = last 30 min at 6-min steps. THIS is the edge over a snapshot: watch dom_neg_M grow (conviction building at a wall) and dom_neg_strike ROLL DOWN (ceiling chasing price = top confirming), and net_gamma shift (regime change).

HOW TO READ IT (doctrine — synthesize, do not pattern-match)
- REGIME first. Near-money mostly NEGATIVE = negative-gamma: moves TREND/ACCELERATE, reversals run, price rips toward levels fast (speed is a lure). Mostly POSITIVE = pinned/mean-revert: fade extensions to walls, expect chop.
- EVOLUTION: a dominant negative node growing then rolling down after price tagged it = a top confirming. A positive node growing below = the floor firming (the target).
- TARGET: read it off the map — the next large positive node (support/floor); in a negative-gamma flush the move runs there.
- CROSS-INDEX: SPX rallying but QQQ not confirming (weak) = suspect. Alignment across the three = conviction.
- TIMELINESS vs CERTAINTY is a real judgment: waiting for full confirmation (e.g. the roll-down) is safer but the entry is worse; acting at the tap of a confirmed wall is earlier but riskier. Weigh it — that is your job, not a fixed rule.

YOU PRODUCE TWO RISK-POSTURE READS OVER THE SAME ANALYSIS:
- CONSERVATIVE: demand strong, multi-signal confirmation. Prefer standing aside over a marginal trade. Only act on high-certainty setups.
- AGGRESSIVE: a decisive trigger-puller. When regime + structure + evolution + cross-index align, ACT — take the tap-reject at a confirmed wall with a TIGHT stop just beyond it (small risk for a large structural target). Manage risk with the stop, not by avoiding entries. Still stand aside on genuine chop.
Both reason over the same data. They should often differ (that's the point). Give each a direction, conviction, entry, structural target, stop, and one-line why.`;

const TOOL = {
  name: 'emit_decisions', description: 'Emit the shared read plus a conservative and an aggressive decision, and update your journal. Call exactly once.',
  input_schema: {
    type: 'object', required: ['regime_read', 'shared_thesis', 'conservative', 'aggressive', 'journal_update'],
    properties: {
      regime_read: { type: 'string' },
      shared_thesis: { type: 'string', description: '2-4 sentences: the synthesis across map+timeline+cross-index+price that both postures share' },
      conservative: { type: 'object', required: ['direction', 'conviction', 'why'], properties: { instrument: { type: 'string', enum: ['SPXW', 'SPY', 'QQQ', 'none'] }, direction: { type: 'string', enum: ['long', 'short', 'stand_aside'] }, conviction: { type: 'number', minimum: 0, maximum: 1 }, entry: { type: 'string' }, target: { type: 'string' }, stop: { type: 'string' }, why: { type: 'string' } } },
      aggressive: { type: 'object', required: ['direction', 'conviction', 'why'], properties: { instrument: { type: 'string', enum: ['SPXW', 'SPY', 'QQQ', 'none'] }, direction: { type: 'string', enum: ['long', 'short', 'stand_aside'] }, conviction: { type: 'number', minimum: 0, maximum: 1 }, entry: { type: 'string' }, target: { type: 'string' }, stop: { type: 'string' }, why: { type: 'string' } } },
      journal_update: { type: 'string', description: 'running notes to carry to the next minute: current bias, levels watched, what triggers/invalidates' },
    },
  },
};

async function claude(system, content, tool, maxTok = 1800) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, max_tokens: maxTok, system, messages: [{ role: 'user', content }], tools: [tool], tool_choice: { type: 'tool', name: tool.name } }) });
  const j = await r.json(); if (r.status !== 200) throw new Error(`API ${r.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
  return (j.content || []).find(c => c.type === 'tool_use')?.input || {};
}

const MEM = path.join(FC, `agent_state_${DAY}.json`);
const sysWithLessons = () => { const L = loadLessons(); return DOCTRINE + (L.length ? `\n\nLESSONS YOU LEARNED FROM PAST SESSIONS (apply them):\n${L.map((x, i) => `${i + 1}. ${x.lesson}`).join('\n')}` : ''); };
const fmt = (d) => d && d.direction !== 'stand_aside' ? `${d.instrument && d.instrument !== 'none' ? d.instrument + ' ' : ''}${d.direction.toUpperCase()} ${d.entry || ''}→${d.target || '?'} (conv ${d.conviction}, stop ${d.stop || '?'})` : `stand aside (${d?.conviction ?? '?'})`;

async function step(et, mem) {
  const state = assembleComplex(et);
  const journal = mem.notes ? `YOUR RUNNING JOURNAL (your notes from earlier today):\n${mem.notes}` : 'YOUR RUNNING JOURNAL: (empty — first read of the day)';
  const d = await claude(sysWithLessons(), `${journal}\n\nFULL DATA STATE @ ${et} ET:\n${JSON.stringify(state, null, 1)}\n\nReason over ALL of it and emit your two-posture decision + journal update.`, TOOL);
  mem.notes = d.journal_update || mem.notes; mem.log = (mem.log || []).concat({ et, regime: d.regime_read, thesis: d.shared_thesis, conservative: d.conservative, aggressive: d.aggressive });
  fs.writeFileSync(MEM, JSON.stringify(mem, null, 1));
  const R = state.instruments.SPXW;
  console.log(`\n─── @ ${et} ET · SPX ${R.spot} (${R.chg_pct >= 0 ? '+' : ''}${R.chg_pct}%) · domNeg ${R.structure_timeline_30m.map(t => t.dom_neg_strike).join('→')} · regime ${R.regime_now.net_gamma_M}M ───`);
  console.log(`  CONSERVATIVE: ${fmt(d.conservative)}`);
  console.log(`  AGGRESSIVE:   ${fmt(d.aggressive)}`);
  console.log(`  read: ${d.shared_thesis}`);
  return mem;
}

async function reflect() {
  const mem = fs.existsSync(MEM) ? JSON.parse(fs.readFileSync(MEM, 'utf8')) : null;
  if (!mem?.log?.length) { console.log('no decision log to reflect on — run --sequence first'); return; }
  const review = mem.log.map(e => ({ et: e.et, conservative: `${e.conservative.direction} (${e.conservative.conviction})`, aggressive: `${e.aggressive.direction} ${e.aggressive.entry || ''}→${e.aggressive.target || ''} (${e.aggressive.conviction})`, what_price_did_next_45m: outcomeAfter(e.et) }));
  const out = await claude(
    `You are the same 0DTE agent, now REVIEWING your own decisions against what price actually did, to LEARN. For each decision compare your conservative vs aggressive call to the real outcome. Be blunt about where you were too cautious (stood aside on a move you should have taken — e.g. "the tap of the King node WAS the right short") or too aggressive (chased and got stopped). Then distill 2-4 durable, general LESSONS (not "on 7/29 do X" — transferable judgment about reading regime/evolution/timing) to apply in future sessions.`,
    `Your decisions today (${DAY}) and the actual outcomes:\n${JSON.stringify(review, null, 1)}\n\nReflect and emit your lessons.`,
    { name: 'emit_lessons', description: 'lessons learned', input_schema: { type: 'object', required: ['grade', 'lessons'], properties: { grade: { type: 'string', description: 'honest self-grade of today: what you got right/wrong' }, lessons: { type: 'array', items: { type: 'string' }, description: '2-4 durable transferable lessons' } } } }, 1500);
  const lessons = Array.isArray(out.lessons) ? out.lessons : typeof out.lessons === 'string' ? out.lessons.split('\n').map(s => s.replace(/^\s*[\d.\-)]+\s*/, '').trim()).filter(Boolean) : Object.values(out.lessons || {}).map(String);
  console.log(`\n═══ REFLECTION · ${DAY} ═══\n  self-grade: ${out.grade}\n  LESSONS LEARNED:`);
  lessons.forEach((l, i) => console.log(`   ${i + 1}. ${l}`));
  const all = loadLessons().concat(lessons.map(l => ({ day: DAY, lesson: l })));
  fs.writeFileSync(LESSONS_FILE, JSON.stringify(all, null, 1));
  console.log(`\n  → saved ${out.lessons.length} lessons to agent_lessons.json (${all.length} total; re-injected into future reasoning)`);
}

if (arg('--reflect', false)) await reflect();
else { const seq = arg('--sequence', null); let mem = { day: DAY, notes: '', log: [] }; if (seq) { for (const et of String(seq).split(',')) mem = await step(et.trim(), mem); } else await step(arg('--et', '15:00'), mem); }
