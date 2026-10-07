#!/usr/bin/env node
// Live paper test — monthly orchestrator (frozen rules; DESIGN_v6 + DESIGN_engines amendment 5 + E2c).
//   1. data_refresh.mjs (UW prices + SEC filings since the last run)   2. paper_money.mjs (money list portfolio step)
//   3. engines.mjs --live --clean-concepts (mover radar)               4. commodity / freight / crypto sleeve step
//   5. judge_lists.mjs (commentary)                                     6. scorecard → world/paper/scorecard.md
//   node world/paper_run.mjs [--no-refresh]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isTradingDay } from './prices_clean.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), W = path.join(ROOT, 'world'), PAPER = path.join(W, 'paper'), C = path.join(ROOT, '.cache');
const rd = (f, d = null) => { try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d; } catch { return d; } };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const run = (args, opts = {}) => { const r = spawnSync(process.execPath, ['--max-old-space-size=16000', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 50e6, ...opts }); if (r.status !== 0) console.error(`step failed: ${args.join(' ')}\n${(r.stderr || '').slice(-800)}`); return r.stdout || ''; };
fs.mkdirSync(PAPER, { recursive: true });
if (!process.argv.includes('--no-refresh')) run([path.join(W, 'data_refresh.mjs')]);
const money = run([path.join(W, 'paper_money.mjs')]);
run([path.join(W, 'engines.mjs'), '--live', '--clean-concepts']);
const S = rd(path.join(PAPER, 'money_state.json')), asOf = S.marks.at(-1).d;
const radarFile = fs.readdirSync(path.join(W, 'live')).filter((f) => f.startsWith('radar_')).sort().at(-1), radar = rd(path.join(W, 'live', radarFile));
// ---- commodity sleeve step ----
const LIST = ['GLD', 'SLV', 'PPLT', 'PALL', 'CPER', 'USO', 'BNO', 'UNG', 'UGA', 'DBA', 'CORN', 'WEAT', 'SOYB', 'CANE', 'DBC', 'URA', 'LIT', 'REMX', 'BDRY', 'BWET', 'BITO'];
const A = new Map(LIST.map((t) => [t, (rd(path.join(C, 'commodity', `${t}.json`), []) || []).filter((x) => isTradingDay(x.d))]));
const at = (b, d) => { let r = -1; for (let i = b.length - 1; i >= 0; i--) if (b[i].d <= d) { r = i; break; } return r; };
const SL = rd(path.join(PAPER, 'sleeve_state.json'), { start: asOf, eq: 1, held: [], marks: [] });
if (SL.held.length && SL.lastD && SL.lastD < asOf) { const rs = SL.held.map(({ t, px }) => { const b = A.get(t), j = at(b, asOf); return j >= 0 ? b[j].c / px - 1 : 0; }); SL.eq *= 1 + (mean(rs) ?? 0); }
const held = []; for (const [t, b] of A) { const j = at(b, asOf), j12 = at(b, new Date(Date.parse(asOf) - 365 * 864e5).toISOString().slice(0, 10)); if (j < 0 || j12 < 0 || b[0].d > new Date(Date.parse(asOf) - 395 * 864e5).toISOString().slice(0, 10)) continue;
  const w = Math.min(200, j + 1); let ma = 0; for (let q = j - w + 1; q <= j; q++) ma += b[q].c; if (b[j].c / b[j12].c - 1 > 0 && b[j].c > ma / w) held.push({ t, px: b[j].c }); }
if (SL.lastD !== asOf) SL.marks.push({ d: asOf, eq: SL.eq }); SL.held = held; SL.lastD = asOf; fs.writeFileSync(path.join(PAPER, 'sleeve_state.json'), JSON.stringify(SL, null, 1));
// ---- ledger (every list with prices, for later grading) ----
const ledgerF = path.join(PAPER, 'ledger.jsonl'), ledger = fs.existsSync(ledgerF) ? fs.readFileSync(ledgerF, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
if (!ledger.some((e) => e.asOf === asOf)) { const e = { asOf, money: S.pos.map((x) => ({ t: x.t, px: x.last })), radar: radar.rows.map((r) => ({ t: r.t, E: r.E, px: r.c, why: r.why })), sleeve: held }; fs.appendFileSync(ledgerF, JSON.stringify(e) + '\n'); ledger.push(e); }
// ---- live report + judgment ----
const md = [`# Live lists as of ${asOf} (frozen rules; paper test)\n`, money, `\n## Mover radar (${radar.rows.length} names)\n`, ...radar.rows.map((r) => `- ${r.t} (${r.E}) — ${r.why}`), `\n## Commodity / freight / crypto sleeve\nHolding: ${held.map((x) => x.t).join(', ') || 'cash'}`].join('\n');
const liveF = path.join(W, 'live', `${asOf}.md`); fs.writeFileSync(liveF, md + '\n'); spawnSync(process.execPath, [path.join(W, 'judge_lists.mjs'), liveF], { cwd: ROOT, encoding: 'utf8', timeout: 700000 });
// ---- scorecard: grade every past list once its 6-month window has passed (interim marks before) ----
const priceAt = (t, d) => { const b = [...(rd(path.join(C, 'wdaily', `${t}.json`), []) || [])].filter((x) => isTradingDay(x.d) && x.d <= d); return b.at(-1)?.c ?? null; };
const sc = [`# Paper-test scorecard — updated ${asOf}\n`, `Money list paper portfolio: **${(S.marks.at(-1).eq * 100).toFixed(1)}** vs SPY **${(S.marks.at(-1).spy * 100).toFixed(1)}** (both started at 100 on ${S.start})`,
  `Commodity sleeve: **${(SL.eq * 100).toFixed(1)}** (started at 100 on ${SL.start})\n`, '| list date | radar: avg return so far | money list names: avg return so far | sleeve holdings |', '|---|---|---|---|'];
for (const e of ledger) { const g = (arr) => mean(arr.map((x) => { const p = priceAt(x.t, asOf); return p && x.px ? p / x.px - 1 : null; }).filter((x) => x != null)); sc.push(`| ${e.asOf} | ${g(e.radar)?.toFixed?.(3) ?? '—'} | ${g(e.money)?.toFixed?.(3) ?? '—'} | ${e.sleeve.map((x) => x.t).join(', ')} |`); }
fs.writeFileSync(path.join(PAPER, 'scorecard.md'), sc.join('\n') + '\n'); console.log(sc.join('\n'));
