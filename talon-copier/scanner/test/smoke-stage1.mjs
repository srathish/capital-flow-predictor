// smoke-stage1.mjs — LIVE smoke of Stage 1 on the Stage 0 cache (needs ENV_FILE for
// the persistence history pull). Assumes data/raw/2026-08-14/ exists (run smoke-stage0 first).
import { scan } from '../stage1-scan.mjs';
import { loadConfig } from '../lib/util.mjs';

const config = loadConfig();
const { scanFile, topK, out } = await scan({ config, date: '2026-08-14', expiry: '2026-08-21' });

console.log('\nscan file:', scanFile);
console.log(`scored ${out.scored} · dropped ${out.dropped} · top ${topK.length}\n`);
console.log('RANKED:');
for (const m of topK) {
  const bt = m.magnet_gamma_before_target_pct == null ? '-' : `${(m.magnet_gamma_before_target_pct * 100).toFixed(0)}%`;
  console.log(`  ${m.ticker.padEnd(6)} score ${m.flow_through_score.toFixed(5)} | magnet ${m.magnet.strike} (${(m.magnet.gex / 1e6).toFixed(2)}M ${m.magnet.sign}, +${(m.magnet.dist_pct * 100).toFixed(1)}%) norm ${m.magnet.magnet_norm.toFixed(3)}`);
  console.log(`         pathRes ${m.path.path_resistance_norm.toFixed(4)} · wall ${m.path.wall_penalty.toFixed(2)} · negBonus ${m.path.neg_gamma_bonus} · prox ${m.proximity_weight.toFixed(3)} · persist ${m.persistence.days}d×${m.persistence.mult.toFixed(2)} · %γ-dies-before-8/21 ${bt}`);
  if (m.magnet.respecified_from) console.log(`         (retargeted from ${m.magnet.respecified_from} — wall on path)`);
}
const drop = out.tickers.filter((r) => r.dropped);
console.log('\nDROPPED:', drop.length ? drop.map((r) => `${r.ticker}(${r.dropped})`).join(', ') : 'none');
console.log('\n✓ smoke-stage1 complete');
