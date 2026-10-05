#!/usr/bin/env node
// v2 STEP 2 (DESIGN_v2 §1–§3): compact features per filing from the Business/MD&A text downloaded by filings_text.mjs.
//   concepts  occurrences of each fixed concept (DESIGN v1 §7) per filing (acronyms case-sensitive, phrases case-insensitive, plurals)
//   scarce    per concept: occurrences that have a constraint word within 25 words (in-context scarcity, DESIGN_v2 §3)
//   phrases   top 200 2–3-word phrases (count ≥ 3, no stopword at either end) → used for point-in-time emerging-concept discovery
//   → .cache/edgar/textfeat/<T>.json  [{d, f, words, concepts:{c:n}, scarce:{c:n}, phrases:{p:n}}]
import fs from 'node:fs';
import path from 'node:path';
import { CONCEPTS, CONSTRAINTS } from './edgar_exposure.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), IN = path.join(ROOT, '.cache', 'edgar', 'text'), OUT = path.join(ROOT, '.cache', 'edgar', 'textfeat');
const ACR = new Set(['GPU', 'CPU', 'ASIC', 'DRAM', 'NAND', 'EUV', 'LNG', 'SaaS', 'GLP-1', 'AI', 'SMR', 'HBM']);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const CONCEPT_RX = CONCEPTS.map((c) => { const isAcr = c.split(' ').some((w) => ACR.has(w)) && c.length <= 12;
  return [c, new RegExp(`\\b${esc(c).replace(/ /g, '[\\s-]+')}s?\\b`, isAcr ? 'g' : 'gi')]; });
const CONS_RX = new RegExp(`\\b(${CONSTRAINTS.map((x) => esc(x).replace(/ /g, '\\s+')).join('|')})\\b`, 'i');
const STOP = new Set('the of and to in a for on with by as at from or an is are be that this our we its it their which was were has have not including such these other than into may also more any can will each all its fiscal year quarter million billion percent compared period ended net total'.split(' '));
export function features(doc) {
  const text = `${doc.business ?? ''}\n${doc.mdna ?? ''}`, words = text.split(/\s+/).filter(Boolean), concepts = {}, scarce = {};
  for (const [c, rx] of CONCEPT_RX) { let n = 0, s = 0; for (const m of text.matchAll(rx)) { n++; const a = Math.max(0, m.index - 200), win = text.slice(a, m.index + 200); if (CONS_RX.test(win)) s++; } if (n) concepts[c] = n; if (s) scarce[c] = s; }
  const toks = text.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 1), cnt = new Map();
  for (let i = 0; i < toks.length; i++) for (const k of [2, 3]) { if (i + k > toks.length) break; const g = toks.slice(i, i + k); if (STOP.has(g[0]) || STOP.has(g[k - 1]) || g.some((w) => w.length < 3)) continue; const p = g.join(' '); cnt.set(p, (cnt.get(p) ?? 0) + 1); }
  const phrases = Object.fromEntries([...cnt.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 200));
  return { d: doc.d, f: doc.f, words: words.length, concepts, scarce, phrases };
}
if (decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
  fs.mkdirSync(OUT, { recursive: true }); let n = 0, docs = 0;
  for (const t of fs.readdirSync(IN)) { const dir = path.join(IN, t); if (!fs.existsSync(path.join(dir, '_done'))) continue; const f = path.join(OUT, `${t}.json`); if (fs.existsSync(f)) continue;
    const out = []; for (const fn of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) { const doc = JSON.parse(fs.readFileSync(path.join(dir, fn), 'utf8')); if ((doc.words ?? 0) < 300) continue; out.push(features(doc)); docs++; }
    fs.writeFileSync(f, JSON.stringify(out.sort((a, b) => a.d.localeCompare(b.d)))); if (++n % 100 === 0) console.error(`… ${n} companies, ${docs} filings`); }
  console.error(`textfeat: ${n} companies, ${docs} filings`);
}
