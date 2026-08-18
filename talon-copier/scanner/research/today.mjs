// today.mjs — FORWARD grade: Aug-17 actual move vs our Sunday brief (bucket + conviction + flow read).
// Did the EARLY bucket outperform the WAIT bucket? Did the blow-ups match our readings?
import { loadEnvKeysFrom, resolveFromRoot, log } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { FlowProvider } = await import('../providers/flow-uw.mjs');
const flow = new FlowProvider();

// our Sunday call: [bucket, conviction, flow-read]
const CALL = {
  PYPL:['EARLY',.55,'54↑'], ORCL:['EARLY',.45,'49↑'], HOOD:['EARLY',.45,'51↑'], IONQ:['EARLY',.45,'50 '], RGTI:['EARLY',.45,'52 '], NKE:['EARLY',.40,'52↑'], HAL:['EARLY',.40,'52 '],
  MU:['WAIT',.55,'49▼'], NVDA:['WAIT',.55,'49▼'], MRVL:['WAIT',.50,'50↑'], TSM:['WAIT',.45,'49▼'], MSFT:['WAIT',.45,'50▼'], META:['WAIT',.35,'47▼'], WDC:['WAIT',.50,'46↑'], VST:['WAIT',.40,'44▼'], XBI:['WAIT',.45,'46 '], GDX:['WAIT',.45,'45▼'], ON:['WAIT',.35,'42▼'], DIS:['WAIT',.35,'38▼'], MARA:['WAIT',.30,'49 '],
  HD:['NOTNOW',.35,'47↑'],
  DRAM:['SCAN',.50,'52↑'], BMNR:['SCAN',.45,'52↑'], PLTR:['SCAN',.55,'51↑'], SMH:['SCAN',.42,'44▼'], C:['SCAN',.50,'52↑'], BAC:['SCAN',.45,'53 '], GOOGL:['SCAN',.30,'47▼'], HYG:['SCAN',.35,'65🔥'], USO:['SCAN',.40,'51 '],
};
const rows = [];
for (const t of Object.keys(CALL)) {
  const oh = await flow.getDailyOHLC(t, { limit: 5 }).catch(() => []);
  if (oh.length < 2) continue;
  const c = oh.map((x) => x.close);
  rows.push({ t, today: (c[c.length - 1] / c[c.length - 2] - 1) * 100, close: c[c.length - 1], bucket: CALL[t][0], conv: CALL[t][1], flow: CALL[t][2], dt: oh[oh.length - 1].date });
}
rows.sort((a, b) => b.today - a.today);
log(`\n── ${rows[0]?.dt} moves vs our Sunday read (sorted by today's %) ──\n`);
log('ticker   today%    close     our Sunday call     flow');
log('─'.repeat(58));
for (const r of rows) {
  const tag = r.today >= 4 ? '🚀 BLEW UP' : r.today >= 2 ? '↑ up' : r.today <= -2.5 ? '↓ DOWN' : '·';
  log(`${r.t.padEnd(7)} ${((r.today >= 0 ? '+' : '') + r.today.toFixed(1)).padStart(6)}  ${r.close.toFixed(2).padStart(8)}  ${(r.bucket + ' ' + r.conv.toFixed(2)).padEnd(16)} ${r.flow}  ${tag}`);
}
const early = rows.filter((r) => r.bucket === 'EARLY'), wait = rows.filter((r) => r.bucket === 'WAIT');
const avg = (a) => a.length ? a.reduce((s, r) => s + r.today, 0) / a.length : 0;
log('\n══════════ SCOREBOARD ══════════');
log(`EARLY bucket (we said "buy a starter now"):  avg ${avg(early).toFixed(2)}%  ·  ${early.filter((r) => r.today > 0).length}/${early.length} up`);
log(`WAIT  bucket (we said "flow fighting, wait"): avg ${avg(wait).toFixed(2)}%  ·  ${wait.filter((r) => r.today > 0).length}/${wait.length} up`);
log(`\nBlew up (≥+4%): ${rows.filter((r) => r.today >= 4).map((r) => `${r.t} +${r.today.toFixed(1)}% [${r.bucket}]`).join(', ') || 'none'}`);
log(`Fell (≤-2.5%):  ${rows.filter((r) => r.today <= -2.5).map((r) => `${r.t} ${r.today.toFixed(1)}% [${r.bucket}]`).join(', ') || 'none'}`);
