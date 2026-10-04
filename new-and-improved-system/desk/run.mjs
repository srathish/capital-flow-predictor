#!/usr/bin/env node
// THE DESK — find → verify with Skylit → you decide → it scores. Never sends orders.
//   node desk/run.mjs [TICKER ...] [--momentum 15] [--no-themes] [--date YYYY-MM-DD] [--no-contracts] [--refresh-universe]
//   then: node desk/decide.mjs <date> <SYM> take|pass [up|down] [note…]   ·   later: node desk/score.mjs
// Output: desk/journal/<date>.json (cards + your decisions) and desk/journal/<date>.md (readable cards).
import fs from 'node:fs';
import path from 'node:path';
import { account } from '../feeds/skylit.js';
import { findCandidates } from './find.mjs';
import { verify } from './verify.mjs';
import { sessionDate } from './common.mjs';

const argv = process.argv.slice(2), flag = (k) => { const i = argv.indexOf(`--${k}`); if (i < 0) return false; argv.splice(i, 1); return true; };
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv.splice(i, 2)[1] : d; };
const D = opt('date', sessionDate()), momentumN = +opt('momentum', 15), themes = !flag('no-themes'), contracts = !flag('no-contracts'), refreshUniverse = flag('refresh-universe');
const tickers = argv.filter((a) => /^[A-Za-z.]{1,6}$/.test(a)).map((a) => a.toUpperCase());
const J = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), 'journal'); fs.mkdirSync(J, { recursive: true });

const a0 = await account().catch(() => null);
const { cands, hotThemes, note } = await findCandidates({ tickers, D, momentumN, themes, refreshUniverse });
const cards = await verify(cands, { D, contracts });
const a1 = await account().catch(() => null), used = a0 && a1 ? a0.creditsBalance - a1.creditsBalance : null;

// keep any decisions already made for this date
const jf = path.join(J, `${D}.json`), prev = fs.existsSync(jf) ? JSON.parse(fs.readFileSync(jf, 'utf8')) : null;
for (const c of cards) { const p = prev?.cards?.find((x) => x.sym === c.sym && x.dir === c.dir); if (p?.decision) c.decision = p.decision; }
fs.writeFileSync(jf, JSON.stringify({ D, generatedAt: new Date().toISOString(), hotThemes, note, creditsUsed: used, cards }, null, 1));

const pc = (x) => (x == null ? '-' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%');
const A = cards.filter((c) => c.status === 'A+'), N = cards.filter((c) => c.status !== 'A+');
const L = [`# Desk · session ${D}`, '', `Candidates ${cands.length} → **${A.length} A+ trade card${A.length === 1 ? '' : 's'}** · ${N.length} no-trade · credits used ${used ?? '?'}`,
  hotThemes.length ? `Hot themes: ${hotThemes.map((t) => `${t.theme} (${pc(t.r20)} 20d, ${Math.round(t.breadth * 100)}% up this week)`).join(' · ')}` : '', note ? `> ⚠ ${note}` : '', ''];
for (const c of A) {
  const p = c.plan, k = c.contract;
  L.push(`## ${c.sym} — ${c.dir === 'up' ? 'CALL' : 'PUT'} at ${p.entry}`, '',
    `- **Why this stock:** ${c.find.join('; ')}`,
    `- **Map (where):** ${p.why}. Spot ${c.spot}. Vanna lean ${c.vanna ?? 'n/a'}.`,
    `- **Entry:** ${p.entryRule}`,
    `- **Exit:** ${p.exitRule}`,
    `- **Volatility:** ${c.volNote}; next earnings ${c.vol.nextEarnings ?? 'n/a'}.`,
    `- **Contract:** ${k?.occ ? `${k.occ} — bid $${k.bid} / ask $${k.ask} (mid $${k.mid}, spread ${k.spreadPct}%), OI ${k.oi}, IV ${k.iv}% as of ${k.quoteDate} (${k.note})` : k?.note ?? 'not fetched'}`,
    ...(c.news?.length ? [`- **News:** ${c.news.map((h) => `${h.at.slice(5, 10)} ${h.headline.slice(0, 110)}`).join(' · ')}`] : []),
    `- **Decide:** \`node desk/decide.mjs ${D} ${c.sym} take|pass ${c.dir}\``, '');
}
L.push('## No trade (and why)', '', '| Stock | Side | Why it was on the list | Why not |', '|---|---|---|---|');
for (const c of N) L.push(`| ${c.sym} | ${c.dir === 'up' ? 'long' : 'short'} | ${c.find.join('; ').slice(0, 90)} | ${c.reason} |`);
const md = L.filter((x) => x !== null).join('\n');
fs.writeFileSync(path.join(J, `${D}.md`), md);
console.log(md);
