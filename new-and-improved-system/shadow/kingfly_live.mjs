#!/usr/bin/env node
// King-pin butterfly FORWARD paper system — live part (DESIGN_king_pin_fly.md; rules frozen 2026-10-17).
// Runs 10:55–14:35 ET on weekdays (launchd com.srathish.kingflylive). Every 5 minutes: Skylit live board for SPY+QQQ
// (1 credit per call), saved to .cache/skylit_live/{date}.jsonl; trigger = first poll 11:00–14:30 where the king (largest
// |gamma| within ±2%) is positive, has been the king for the last 3 polls (15 min), and spot is within $0.50 of it → one
// paper signal per ticker-day in results_kingfly/forward_signals.jsonl. No orders, nothing posted.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SH = path.dirname(fileURLToPath(import.meta.url)), C = path.join(SH, '..', '.cache', 'skylit_live'), R = path.join(SH, 'results_kingfly'); fs.mkdirSync(C, { recursive: true }); fs.mkdirSync(R, { recursive: true });
process.env.SKYLIT_BUDGET ??= '50';
const k = await import('../feeds/skylit.js');
const etNow = () => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()); const g = (t) => p.find((x) => x.type === t).value; return { d: `${g('year')}-${g('month')}-${g('day')}`, m: +g('hour') * 60 + +g('minute') }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hist = { SPY: [], QQQ: [] }, done = new Set(); const SF = path.join(R, 'forward_signals.jsonl');
if (fs.existsSync(SF)) for (const l of fs.readFileSync(SF, 'utf8').split('\n').filter(Boolean)) { const j = JSON.parse(l); done.add(j.d + j.T); }
while (true) { const { d, m } = etNow(); if (m > 875) break; if (m < 660) { await sleep(30000); continue; }
  try { const boards = await k.heatmapLive(['SPY', 'QQQ'], { metric: 'gamma' });
    for (const b of boards) { const T = b.symbol; if (!hist[T]) continue; const s = b.spot, near = b.strikes.filter((x) => Math.abs(x.strike / s - 1) <= 0.02); if (!near.length) continue;
      const kg = near.reduce((a, x) => (Math.abs(x.value) > Math.abs(a.value) ? x : a));
      fs.appendFileSync(path.join(C, `${d}.jsonl`), JSON.stringify({ t: new Date().toISOString(), m, T, spot: s, strikes: b.strikes.map((x) => [x.strike, +x.value.toPrecision(4), x.nodeType ?? '']) }) + '\n');
      hist[T].push({ m, king: kg.strike }); const last3 = hist[T].slice(-4, -1);
      if (!done.has(d + T) && m <= 870 && kg.value > 0 && Math.abs(s - kg.strike) <= 0.5 && last3.length === 3 && last3.every((x) => x.king === kg.strike) && m - last3[0].m <= 20) {
        done.add(d + T); const sig = { d, T, m, king: kg.strike, spot: s, ctrl: s < kg.strike ? kg.strike + 2 : kg.strike - 2, at: new Date().toISOString() }; fs.appendFileSync(SF, JSON.stringify(sig) + '\n'); console.log('signal', JSON.stringify(sig)); } } }
  catch (e) { console.error('poll failed:', e.message.slice(0, 160)); if (/credit guard/.test(e.message)) break; }
  await sleep(5 * 60 * 1000); }
console.log('live session done');
