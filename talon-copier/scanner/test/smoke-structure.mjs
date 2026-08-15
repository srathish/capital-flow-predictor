// smoke-structure.mjs — does the structure-driven LLM catch NBIS's negative-gamma
// squeeze EARLY (at ~$190, before the +83% rip)? Uses cached data (no Skylit). Needs
// ANTHROPIC_API_KEY. This is the test of "JS assembles, LLM deciphers daily".
import { planFromStructure, anthropicLLM } from '../stage2-plan.mjs';
import { assembleStructure } from '../lib/structure.mjs';
import { loadConfig, readJson, resolveFromRoot } from '../lib/util.mjs';

const config = loadConfig();
const T = process.argv[2] || 'NBIS';
const dates = (process.argv[3] || '2026-07-31,2026-08-04,2026-08-07').split(',');

for (const date of dates) {
  const rec = readJson(resolveFromRoot(`data/raw/${date}/${T}.json`));
  const hist = readJson(resolveFromRoot(`data/raw/${date}/${T}.history.json`));
  if (!rec) { console.log(`\n${T} ${date}: no cache`); continue; }
  const s = assembleStructure(rec.profile, hist?.history || null);
  console.log(`\n=== ${T} ${date} · spot $${rec.profile.spot.toFixed(0)} ===`);
  console.log(`  king: ${s.king.strike} ${s.king.gex_M}M ${s.king.gamma}-gamma ${s.king.position} · migration ${s.king_migration.direction} · ${s.spot_context}`);
  console.log(`  neg-gamma pockets (fuel): ${s.negative_gamma_pockets.map((n) => `${n.strike}(${n.gex_M}M,${n.trend})`).join(' ') || 'none'}`);
  const r = await planFromStructure(rec.profile, hist?.history || null, { config, runDate: date, llm: anthropicLLM });
  if (r.status === 'ok') {
    const p = r.plan;
    console.log(`  → ${p.direction.toUpperCase()}: ${p.thesis}`);
    if (p.direction !== 'no_trade') console.log(`     ${p.contract.expiry} $${p.contract.strike}${p.contract.type[0].toUpperCase()} · entry ${p.entry_trigger}→target ${p.target} · stop<${p.invalidation} · conf ${p.confidence}/5`);
  } else console.log(`  → discarded: ${r.errors.join('; ')}`);
}
