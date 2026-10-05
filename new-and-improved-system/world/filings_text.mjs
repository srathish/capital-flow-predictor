#!/usr/bin/env node
// v2 STEP 1 (DESIGN_v2 §1): download every 10-K / 10-Q / 20-F filed since 2022 for the world universe and keep ONLY the sections
// that describe the business: 10-K Item 1 (Business) + Item 7 (MD&A) · 10-Q Part I Item 2 (MD&A) · 20-F Item 4 (Information on the
// Company) + Item 5 (Operating and Financial Review). Risk Factors are excluded. Free (SEC EDGAR), ~6 req/s, 0 Skylit credits.
//   → .cache/edgar/text/<T>/<filingDate>_<form>.json  {d, f, business, mdna, words}
import fs from 'node:fs';
import path from 'node:path';
import { worldUniverse } from './collect.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), OUT = path.join(ROOT, '.cache', 'edgar', 'text');
const UA = { 'User-Agent': 'research saieagle@gmail.com' }, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let gateT = 0; const gate = async () => { const now = Date.now(), at = Math.max(now, gateT + 125); gateT = at; if (at > now) await sleep(at - now); }; // shared ~8 req/s across workers
async function get(u, json) { for (let k = 0; k < 5; k++) { await gate(); const r = await fetch(u, { headers: UA }).catch(() => null);
  if (r?.status === 429 || r?.status === 503) { await sleep(4000 * (k + 1)); continue; } if (!r?.ok) return null; return json ? r.json().catch(() => null) : r.text().catch(() => null); } return null; }
export function htmlToText(h) {
  return h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;|&#x2019;/gi, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"').replace(/&#\d+;|&\w+;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
// pick the occurrence of `start` whose section (up to the next `end`) is LONGEST — skips the table of contents
export function section(text, start, end, max = 400000) {
  let best = ''; for (const m of text.matchAll(start)) { const s = m.index, rest = text.slice(s + m[0].length), e = rest.search(end); const body = e < 0 ? rest.slice(0, max) : rest.slice(0, e); if (body.length > best.length) best = body; }
  return best.slice(0, max);
}
const RX = {
  k_bus: /item\s*1\s*[.:—–-]?\s*business\b/gi, k_bus_end: /item\s*1a\s*[.:—–-]?\s*risk\s*factors|item\s*2\s*[.:—–-]?\s*properties/i,
  k_mdna: /item\s*7\s*[.:—–-]?\s*management['’]?s\s*discussion/gi, k_mdna_end: /item\s*7a\s*[.:—–-]?|item\s*8\s*[.:—–-]?\s*financial\s*statements/i,
  q_mdna: /item\s*2\s*[.:—–-]?\s*management['’]?s\s*discussion/gi, q_mdna_end: /item\s*3\s*[.:—–-]?\s*quantitative|item\s*4\s*[.:—–-]?\s*controls/i,
  f_bus: /item\s*4\s*[.:—–-]?\s*information\s*on\s*the\s*company/gi, f_bus_end: /item\s*4a\s*[.:—–-]?|item\s*5\s*[.:—–-]?\s*operating/i,
  f_mdna: /item\s*5\s*[.:—–-]?\s*operating\s*and\s*financial\s*review/gi, f_mdna_end: /item\s*6\s*[.:—–-]?\s*directors/i,
};
if (decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
  const U = worldUniverse(); let docs = 0, empty = 0, n = 0;
  async function one({ t, cik }) {
    const dir = path.join(OUT, t); if (fs.existsSync(path.join(dir, '_done'))) { n++; return; }
    fs.mkdirSync(dir, { recursive: true });
    const sub = await get(`https://data.sec.gov/submissions/CIK${cik}.json`, true); if (!sub) { n++; return; }
    const lists = [sub.filings?.recent ?? {}];
    for (const f of sub.filings?.files ?? []) if (f.filingTo >= '2022-01-01') { const x = await get(`https://data.sec.gov/submissions/${f.name}`, true); if (x) lists.push(x); }
    for (const R of lists) for (let i = 0; i < (R.form ?? []).length; i++) {
      const form = R.form[i], d = R.filingDate[i]; if (!['10-K', '10-Q', '20-F'].includes(form) || d < '2022-01-01') continue;
      const f = path.join(dir, `${d}_${form}.json`); if (fs.existsSync(f)) continue;
      const acc = R.accessionNumber[i].replace(/-/g, ''), doc = R.primaryDocument[i]; if (!doc) continue;
      const html = await get(`https://www.sec.gov/Archives/edgar/data/${+cik}/${acc}/${doc}`, false); if (!html) continue;
      const text = htmlToText(html);
      let business = '', mdna = '';
      if (form === '10-K') { business = section(text, RX.k_bus, RX.k_bus_end); mdna = section(text, RX.k_mdna, RX.k_mdna_end); }
      else if (form === '10-Q') mdna = section(text, RX.q_mdna, RX.q_mdna_end);
      else { business = section(text, RX.f_bus, RX.f_bus_end); mdna = section(text, RX.f_mdna, RX.f_mdna_end); }
      const words = (business + ' ' + mdna).split(/\s+/).length; if (words < 300) empty++;
      fs.writeFileSync(f, JSON.stringify({ d, f: form, business, mdna, words })); docs++;
    }
    fs.writeFileSync(path.join(dir, '_done'), ''); n++;
    if (n % 25 === 0) console.error(`… ${n}/${U.length} companies · ${docs} docs · ${empty} with <300 words of section text`);
  }
  const queue = [...U]; await Promise.all(Array.from({ length: 10 }, async () => { while (queue.length) await one(queue.shift()); }));
  console.error(`done: ${n} companies · ${docs} docs · ${empty} thin`);
}
