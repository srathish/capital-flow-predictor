#!/usr/bin/env node
// Compare the A+ exit/entry fixes (base · --wide · --nogap · both) on the stocks that did NOT suggest them.
//   node shadow/fix_compare.mjs [FROM] [TO] SYM...
import fs from 'node:fs';
import path from 'node:path';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), J = path.join(HERE, 'journal');
const [FROM = '2026-01-02', TO = '2026-10-02', ...SY] = process.argv.slice(2);
const SYMS = SY.length ? SY : ['AAPL', 'ADBE', 'AMZN', 'AVGO', 'COST', 'CRM', 'JPM', 'META', 'NFLX', 'NVDA', 'TSLA'];
const V = { base: '', wide: '.wide', nogap: '.nogap', 'wide+nogap': '.wide.nogap' };
const $ = (v) => (v >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(v));
console.log(`A+ fixes · ${SYMS.length} stocks · ${FROM} → ${TO} · option P&L at $1k premium per trade (real UW prices)\n`);
for (const [name, suf] of Object.entries(V)) {
  const T = [];
  for (const s of SYMS) { const f = path.join(J, `aplus_walk.${s}.${FROM}_${TO}${suf}.json`); if (fs.existsSync(f)) for (const t of JSON.parse(fs.readFileSync(f, 'utf8')).trades) T.push({ s, ...t }); }
  const P = T.filter((t) => t.ret != null), H1 = P.filter((t) => t.D < '2026-06-01'), H2 = P.filter((t) => t.D >= '2026-06-01');
  const sum = (a) => a.reduce((x, t) => x + t.ret, 0) * 1000;
  console.log(`${name.padEnd(11)} trades ${String(T.length).padStart(3)} · priced ${String(P.length).padStart(3)} · win ${P.length ? Math.round(P.filter((t) => t.ret > 0).length / P.length * 100) : 0}% · total ${$(sum(P)).padStart(7)} · avg ${$(P.length ? sum(P) / P.length : 0)}/trade · Jan–May ${$(sum(H1))} (${H1.length}) · Jun–Oct ${$(sum(H2))} (${H2.length})`);
}
