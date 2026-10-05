#!/usr/bin/env node
// THESIS ENGINE (live only) — Leopold-style bottleneck reasoning over our point-in-time data. Judged ONLY by its live log:
// LLMs know what happened before their cutoff, so any historical replay would be look-ahead. 0 Skylit credits (headless `claude -p`).
//   node world/thesis.mjs            → builds today's data digest, asks the analyst, saves world/theses/<date>.json (+ .md)
//   node world/thesis.mjs --digest   → print the digest only (no LLM call)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { worldUniverse } from './collect.mjs';
import { CONCEPTS } from './edgar_exposure.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache');
const rd = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const today = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10), addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const U = worldUniverse(), T = U.map((x) => x.t), NAME = Object.fromEntries(U.map((x) => [x.t, x.name]));
const px = (t) => { const b = rd(path.join(C, 'wdaily', `${t}.json`), []); return b.length ? b : (rd(path.join(C, 'daily', `${t}.json`), []) || []).map((x) => ({ d: new Date((x.t + 43200) * 1000).toISOString().slice(0, 10), c: x.c })); };
const ret = (b, a, z) => { const p = b.filter((x) => x.d <= a).at(-1), q = b.filter((x) => x.d <= z).at(-1); return p && q && q.d > p.d ? q.c / p.c - 1 : null; };
const pct = (x) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`);

// ---- 1. concept attention + scarcity trends from Business/MD&A text (latest 2 quarters vs prior 4), point-in-time = today ----
const recentA = addD(today, -183), priorA = addD(today, -548);
const conc = Object.fromEntries(CONCEPTS.map((c) => [c, { recCos: new Set(), priCos: new Set(), recScarce: 0, priScarce: 0, recWords: 0, priWords: 0, recMent: 0, priMent: 0, scarceCos: {} }]));
let recDocs = 0, priDocs = 0;
for (const t of T) for (const f of rd(path.join(C, 'edgar', 'textfeat', `${t}.json`), []) || []) {
  if (f.d > today || f.d <= priorA) continue; const rec = f.d > recentA; rec ? recDocs++ : priDocs++;
  for (const [c, n] of Object.entries(f.concepts)) { const o = conc[c]; if (!o) continue; (rec ? o.recCos : o.priCos).add(t); rec ? (o.recMent += n) : (o.priMent += n); }
  for (const [c, n] of Object.entries(f.scarce)) { const o = conc[c]; if (!o) continue; rec ? (o.recScarce += n) : (o.priScarce += n); if (rec) o.scarceCos[t] = (o.scarceCos[t] ?? 0) + n; }
}
const rows = CONCEPTS.map((c) => { const o = conc[c], mentRec = o.recMent / Math.max(1, recDocs), mentPri = o.priMent / Math.max(1, priDocs), scRec = o.recScarce / Math.max(1, recDocs), scPri = o.priScarce / Math.max(1, priDocs);
  const basket = [...o.recCos].filter((t) => px(t).length > 130), r3 = basket.map((t) => ret(px(t), addD(today, -91), today)).filter((x) => x != null);
  return { c, companies: o.recCos.size, attnGrowth: mentPri > 0 ? mentRec / mentPri - 1 : null, scarcity: scRec, scarcityGrowth: scPri > 0 ? scRec / scPri - 1 : null,
    topScarce: Object.entries(o.scarceCos).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => `${t}(${n})`), basket3m: r3.length ? r3.sort((a, b) => a - b)[r3.length >> 1] : null }; })
  .filter((r) => r.companies >= 3);
// ---- 2. insider open-market buys in the last 60 days ----
const ins = T.flatMap((t) => (rd(path.join(C, 'uw', 'insiderP', `${t}.json`), []) || []).filter((x) => x.f >= addD(today, -60) && x.f <= today && x.v >= 1e5).map((x) => ({ t, ...x })))
  .reduce((m, x) => { (m[x.t] ??= { t: x.t, v: 0, who: new Set() }); m[x.t].v += x.v; m[x.t].who.add(x.who); return m; }, {});
// ---- 3. Situational Awareness LP latest 13F (benchmark + reference, NOT copied blindly) ----
const sa = (rd(path.join(C, 'edgar', 'sa_13f.json'), []) || []).filter((q) => q.filed <= today).at(-1);

export function digest() {
  const L = [`DATA DIGEST as of ${today} (point-in-time: SEC filings' Business + MD&A sections from ${T.length} companies, UW insider buys, SA LP 13F).`, ''];
  L.push('A. CONCEPTS WHERE COMPANIES ARE TALKING MORE (mentions per filing, last 6 months vs the 12 months before). basket3m = median 3-month return of companies mentioning it (= how much is already priced).');
  for (const r of [...rows].filter((r) => r.attnGrowth != null).sort((a, b) => b.attnGrowth - a.attnGrowth).slice(0, 25)) L.push(`  ${r.c}: attention ${pct(r.attnGrowth)} · ${r.companies} cos · basket3m ${pct(r.basket3m)}`);
  L.push('', 'B. CONCEPTS WITH RISING SCARCITY LANGUAGE (shortage / lead times / capacity constrained / sold out / price increases within ~25 words of the concept), with the companies saying it most.');
  for (const r of [...rows].filter((r) => r.scarcity > 0).sort((a, b) => (b.scarcity * (1 + Math.max(0, b.scarcityGrowth ?? 0))) - (a.scarcity * (1 + Math.max(0, a.scarcityGrowth ?? 0)))).slice(0, 20))
    L.push(`  ${r.c}: scarcity ${(r.scarcity * 100).toFixed(1)} per 100 filings (${pct(r.scarcityGrowth)} vs prior) · basket3m ${pct(r.basket3m)} · loudest: ${r.topScarce.join(' ')}`);
  L.push('', 'C. INSIDER OPEN-MARKET BUYS ≥ $100k (last 60 days):');
  for (const x of Object.values(ins).sort((a, b) => b.v - a.v).slice(0, 25)) L.push(`  ${x.t} (${(NAME[x.t] ?? '').slice(0, 30)}): $${(x.v / 1e6).toFixed(2)}M by ${x.who.size} insider(s)`);
  if (sa) { const longs = sa.holdings.filter((h) => !h.putCall), tot = longs.reduce((a, h) => a + h.value, 0);
    L.push('', `D. SITUATIONAL AWARENESS LP 13F (filed ${sa.filed}, period ${sa.period}) — the benchmark to beat: ${longs.sort((a, b) => b.value - a.value).slice(0, 15).map((h) => `${h.ticker ?? h.name} ${(h.value / tot * 100).toFixed(0)}%`).join(', ')}`); }
  L.push('', `E. ALLOWED TICKERS (pick ONLY from these): ${T.join(' ')}`);
  return L.join('\n');
}
const PROMPT = (dg) => `You are a thematic equity analyst in the style of Leopold Aschenbrenner's "Situational Awareness": reason from first principles about where a demand shock creates a PHYSICAL or ECONOMIC BOTTLENECK, then find who owns the bottleneck before the market prices it.

Rules:
- Use the data digest below plus your general knowledge. Do not invent data points; cite the digest section (A/B/C/D) for each claim you take from it.
- Think in causal chains: demand shock → constrained input → owner of the constraint → why their earnings must rise → what the market is missing.
- Prefer bottlenecks that are NOT yet priced (basket3m low/moderate) over themes that already ran. Say explicitly what is priced in.
- Picks must come ONLY from the allowed tickers in section E. Long only. 10 to 20 picks, weights summing to 100.
- Be specific and falsifiable: for each thesis state what evidence over the next 6 months would prove it wrong.

Return ONLY valid JSON (no markdown) with this shape:
{"asOf":"${today}","theses":[{"title":"","chain":["step 1","step 2","..."],"bottleneck":"","beneficiaries":["TICK"],"whyNow":"","pricedIn":"","killCriteria":"","confidence":0.0}],"picks":[{"ticker":"","weight":0,"thesis":"","rationale":""}],"avoid":[{"ticker":"","why":""}]}

${dg}`;

if (decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
  const dg = digest();
  if (process.argv.includes('--digest')) { console.log(dg); process.exit(0); }
  const r = spawnSync('claude', ['-p', '--output-format', 'text', '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch,Read,Glob,Grep'], { input: PROMPT(dg), encoding: 'utf8', maxBuffer: 1 << 26, timeout: 900000 });
  const raw = (r.stdout ?? '').trim(); const m = raw.match(/\{[\s\S]*\}$/); let out = null; try { out = JSON.parse(m ? m[0] : raw); } catch {}
  const dir = path.join(ROOT, 'world', 'theses'); fs.mkdirSync(dir, { recursive: true });
  const rec = { asOf: today, generatedAt: new Date().toISOString(), digest: dg, result: out, raw: out ? undefined : raw.slice(0, 20000), stderr: r.stderr?.slice(0, 2000) };
  fs.writeFileSync(path.join(dir, `${today}.json`), JSON.stringify(rec, null, 1));
  if (!out) { console.error('analyst did not return valid JSON — raw saved'); process.exit(1); }
  const valid = new Set(T); const picks = (out.picks ?? []).filter((p) => valid.has(p.ticker));
  const md = [`# Thesis engine — ${today}`, '', ...((out.theses ?? []).flatMap((t) => [`## ${t.title} (confidence ${t.confidence})`, `- **Chain:** ${(t.chain ?? []).join(' → ')}`, `- **Bottleneck:** ${t.bottleneck}`, `- **Beneficiaries:** ${(t.beneficiaries ?? []).join(', ')}`, `- **Why now:** ${t.whyNow}`, `- **Priced in:** ${t.pricedIn}`, `- **Wrong if:** ${t.killCriteria}`, ''])),
    '## Picks (scored live: 6-month return vs universe median, vs copying SA LP, vs momentum)', '', '| Ticker | Weight | Thesis | Why |', '|---|---|---|---|', ...picks.map((p) => `| ${p.ticker} | ${p.weight} | ${p.thesis} | ${(p.rationale ?? '').replace(/\|/g, '/').slice(0, 160)} |`),
    '', (out.avoid?.length ? `**Avoid:** ${out.avoid.map((a) => `${a.ticker} (${a.why})`).join('; ')}` : '')];
  fs.writeFileSync(path.join(dir, `${today}.md`), md.join('\n')); console.log(md.join('\n'));
}
