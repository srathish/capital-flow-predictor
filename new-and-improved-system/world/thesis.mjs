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
const today = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10), RUN = process.env.THESIS_TAG ? `${new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10)}_${process.env.THESIS_TAG}` : null, addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
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
  const basket = [...o.recCos].filter((t) => px(t).length > 130), medOf = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : null; };
  const r3 = basket.map((t) => ret(px(t), addD(today, -91), today)).filter((x) => x != null), r12 = medOf(basket.map((t) => ret(px(t), addD(today, -365), today))), r24 = medOf(basket.map((t) => ret(px(t), addD(today, -730), today)));
  return { c, companies: o.recCos.size, attnGrowth: mentPri > 0 ? mentRec / mentPri - 1 : null, scarcity: scRec, scarcityGrowth: scPri > 0 ? scRec / scPri - 1 : null,
    topScarce: Object.entries(o.scarceCos).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => `${t}(${n})`), basket3m: r3.length ? r3.sort((a, b) => a - b)[r3.length >> 1] : null, basket12m: r12, basket24m: r24 }; })
  .filter((r) => r.companies >= 3);
// ---- 2. insider open-market buys in the last 60 days ----
const ins = T.flatMap((t) => (rd(path.join(C, 'uw', 'insiderP', `${t}.json`), []) || []).filter((x) => x.f >= addD(today, -60) && x.f <= today && x.v >= 1e5).map((x) => ({ t, ...x })))
  .reduce((m, x) => { (m[x.t] ??= { t: x.t, v: 0, who: new Set() }); m[x.t].v += x.v; m[x.t].who.add(x.who); return m; }, {});
// ---- 3. Situational Awareness LP latest 13F (benchmark + reference, NOT copied blindly) ----
const sa = (rd(path.join(C, 'edgar', 'sa_13f.json'), []) || []).filter((q) => q.filed <= today).at(-1);

// ---- 4. real-world scarcity: FRED input prices / output (live) + PJM capacity auctions ----
const FRED = { PCU334413334413: 'PPI semiconductors & related devices', PCU33443344: 'PPI semiconductor & electronic components', IPG3344S: 'Industrial production: semiconductors',
  PCU335311335311: 'PPI power/distribution/specialty transformers', PCU335313335313: 'PPI switchgear & switchboard apparatus', PCU2211222112: 'PPI electric power transmission/control/distribution',
  APU000072610: 'Average US electricity price per kWh', DHHNGSP: 'Henry Hub natural gas spot', PCOPPUSDM: 'Global copper price', PALUMUSDM: 'Global aluminum price', TLPWRCONS: 'Construction spending: power', TLCOMCONS: 'Construction spending: commercial' };
async function fred() { const { FRED_API_KEY } = await import('../feeds/env.js'); const K = FRED_API_KEY ?? process.env.FRED_API_KEY; if (!K) return [];
  const out = []; for (const [id, name] of Object.entries(FRED)) { try { const j = await (await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${K}&file_type=json&observation_start=${addD(today, -800)}&observation_end=${today}`)).json();
    const o = (j.observations ?? []).filter((x) => x.value !== '.').map((x) => ({ d: x.date, v: +x.value })); if (!o.length) continue; const last = o.at(-1), near = (days) => o.filter((x) => x.d <= addD(last.d, -days)).at(-1);
    const ch = (b) => (b ? last.v / b.v - 1 : null); out.push({ id, name, d: last.d, v: last.v, c3: ch(near(85)), c12: ch(near(360)) }); } catch {} } return out; }
const FREDROWS = await fred();
// PJM Base Residual Auction RTO clearing prices ($/MW-day), delivery year — public PJM results (the AI-power shortage signal of 2024)
const PJM = [['2024/25', 28.92, 'Jul 2022'], ['2025/26', 269.92, 'Jul 2024'], ['2026/27', 329.17, 'Jul 2025 (at the price cap)']];
export function digest() {
  const L = [`DATA DIGEST as of ${today} (point-in-time: SEC filings' Business + MD&A sections from ${T.length} companies, UW insider buys, SA LP 13F).`, ''];
  L.push('A. CONCEPTS WHERE COMPANIES ARE TALKING MORE (mentions per filing, last 6 months vs the 12 months before). basket 3m/12m/24m = median return of companies mentioning it — judge "already priced" on ALL THREE, not 3m alone.');
  for (const r of [...rows].filter((r) => r.attnGrowth != null).sort((a, b) => b.attnGrowth - a.attnGrowth).slice(0, 25)) L.push(`  ${r.c}: attention ${pct(r.attnGrowth)} · ${r.companies} cos · basket 3m ${pct(r.basket3m)} / 12m ${pct(r.basket12m)} / 24m ${pct(r.basket24m)}`);
  L.push('', 'B. CONCEPTS WITH RISING SCARCITY LANGUAGE (shortage / lead times / capacity constrained / sold out / price increases within ~25 words of the concept), with the companies saying it most.');
  for (const r of [...rows].filter((r) => r.scarcity > 0).sort((a, b) => (b.scarcity * (1 + Math.max(0, b.scarcityGrowth ?? 0))) - (a.scarcity * (1 + Math.max(0, a.scarcityGrowth ?? 0)))).slice(0, 20))
    L.push(`  ${r.c}: scarcity ${(r.scarcity * 100).toFixed(1)} per 100 filings (${pct(r.scarcityGrowth)} vs prior) · basket 3m ${pct(r.basket3m)} / 12m ${pct(r.basket12m)} / 24m ${pct(r.basket24m)} · loudest: ${r.topScarce.join(' ')}`);
  L.push('', 'C. INSIDER OPEN-MARKET BUYS ≥ $100k (last 60 days):');
  for (const x of Object.values(ins).sort((a, b) => b.v - a.v).slice(0, 25)) L.push(`  ${x.t} (${(NAME[x.t] ?? '').slice(0, 30)}): $${(x.v / 1e6).toFixed(2)}M by ${x.who.size} insider(s)`);
  if (sa) { const longs = sa.holdings.filter((h) => !h.putCall), tot = longs.reduce((a, h) => a + h.value, 0);
    L.push('', `D. SITUATIONAL AWARENESS LP 13F (filed ${sa.filed}, period ${sa.period}) — the benchmark to beat: ${longs.sort((a, b) => b.value - a.value).slice(0, 15).map((h) => `${h.ticker ?? h.name} ${(h.value / tot * 100).toFixed(0)}%`).join(', ')}`); }
  L.push('', 'F. REAL-WORLD SCARCITY INDICATORS (FRED, latest print; change vs ~3 and ~12 months earlier):');
  for (const f of FREDROWS) L.push(`  ${f.name}: ${f.v} (${f.d}) · 3m ${pct(f.c3)} · 12m ${pct(f.c12)}`);
  L.push('', 'G. PJM CAPACITY AUCTION (RTO $/MW-day, by delivery year — when it was set): ' + PJM.map(([y, p, w]) => `${y} $${p} (${w})`).join(' · '));
  L.push('', `E. ALLOWED TICKERS (pick ONLY from these): ${T.join(' ')}`);
  return L.join('\n');
}
const PROMPT = (dg) => `You are a thematic equity analyst in the style of Leopold Aschenbrenner's "Situational Awareness": reason from first principles about where a demand shock creates a PHYSICAL or ECONOMIC BOTTLENECK, then find who owns the bottleneck before the market prices it.

Rules:
- Use the data digest below plus your general knowledge. Do not invent data points; cite the digest section (A/B/C/D/F/G) for each claim you take from it.
- Think in causal chains: demand shock → constrained input → owner of the constraint → why their earnings must rise → what the market is missing.
- Prefer bottlenecks that are NOT yet priced over themes that already ran. Judge 'priced' on the 3m, 12m AND 24m basket moves together (a theme up 5x over 24m is priced even if flat for 3m). Say explicitly what is priced in.
- Use section F (real input prices / output) and G (power auctions) as the hard evidence of scarcity — a rising input price is stronger evidence than rising mentions.
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
  fs.writeFileSync(path.join(dir, `${RUN ?? today}.json`), JSON.stringify(rec, null, 1));
  if (!out) { console.error('analyst did not return valid JSON — raw saved'); process.exit(1); }
  const valid = new Set(T); const picks = (out.picks ?? []).filter((p) => valid.has(p.ticker));
  const md = [`# Thesis engine — ${today}`, '', ...((out.theses ?? []).flatMap((t) => [`## ${t.title} (confidence ${t.confidence})`, `- **Chain:** ${(t.chain ?? []).join(' → ')}`, `- **Bottleneck:** ${t.bottleneck}`, `- **Beneficiaries:** ${(t.beneficiaries ?? []).join(', ')}`, `- **Why now:** ${t.whyNow}`, `- **Priced in:** ${t.pricedIn}`, `- **Wrong if:** ${t.killCriteria}`, ''])),
    '## Picks (scored live: 6-month return vs universe median, vs copying SA LP, vs momentum)', '', '| Ticker | Weight | Thesis | Why |', '|---|---|---|---|', ...picks.map((p) => `| ${p.ticker} | ${p.weight} | ${p.thesis} | ${(p.rationale ?? '').replace(/\|/g, '/').slice(0, 160)} |`),
    '', (out.avoid?.length ? `**Avoid:** ${out.avoid.map((a) => `${a.ticker} (${a.why})`).join('; ')}` : '')];
  fs.writeFileSync(path.join(dir, `${RUN ?? today}.md`), md.join('\n')); console.log(md.join('\n'));
}
