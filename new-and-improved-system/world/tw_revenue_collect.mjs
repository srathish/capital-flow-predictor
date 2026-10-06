#!/usr/bin/env node
// Taiwan monthly revenue (MOPS t21sc03 summary pages): every TWSE "sii" + TPEx "otc" company, domestic (_0) + foreign/KY (_1),
// Jan 2010 → latest complete month. Source: https://mopsov.twse.com.tw/nas/t21/{sii|otc}/t21sc03_{ROCyear}_{month}_{0|1}.html
// (Big5 HTML, tables grouped by 產業別, revenue in NT$ thousands). Raw parse cached per page → .cache/tw/raw/{market}_{yyyy}_{mm}.json
// (resumable). avail = 10th of the following month (statutory deadline); months whose deadline hasn't passed are fetched but not cached.
// Pre-2013 pages list companies twice (sub-industry + parent group 電子工業/化學生技醫療) → first occurrence kept.
// Note: pages are regenerated (出表日期) so values include any later corrections; pre-2013 figures are standalone (pre-IFRS) revenue.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), OUT = path.join(ROOT, '.cache', 'tw'), RAW = path.join(OUT, 'raw');
export const BELLWETHERS = { 2330: 'TSMC', 2317: 'Hon Hai', 2382: 'Quanta', 3231: 'Wistron', 6669: 'Wiwynn', 2356: 'Inventec', 2308: 'Delta', 2454: 'MediaTek', 3711: 'ASE',
  2345: 'Accton', 3533: 'Lotes', 2383: 'Elite Material', 2368: 'Gold Circuit', 3017: 'Asia Vital', 2360: 'Chroma', 3037: 'Unimicron', 2408: 'Nanya Tech', 2344: 'Winbond',
  2337: 'Macronix', 8299: 'Phison', 2379: 'Realtek', 3008: 'Largan', 2449: 'King Yuan', 3661: 'Alchip', 3443: 'Global Unichip', 2395: 'Advantech' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let next = 0; const gate = async () => { const now = Date.now(), t = Math.max(now, next); next = t + 1100; if (t > now) await sleep(t - now); };
const pad = (n) => String(n).padStart(2, '0'), num = (s) => { const v = Number(s.replace(/[,\s]/g, '')); return Number.isFinite(v) ? v : null; };
const avail = (y, m) => (m === 12 ? `${y + 1}-01-10` : `${y}-${pad(m + 1)}-10`);

async function page(market, y, m, kind) {
  const url = `https://mopsov.twse.com.tw/nas/t21/${market}/t21sc03_${y - 1911}_${m}_${kind}.html`;
  for (let k = 0; k < 6; k++) { await gate(); const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (research)' } }).catch(() => null);
    if (r?.status === 404) return ''; if (!r?.ok) { await sleep(3000 * 2 ** k); continue; }
    const html = new TextDecoder('big5').decode(await r.arrayBuffer()); if (html.includes('查無資料') || html.includes('營業收入統計表')) return html; await sleep(3000 * 2 ** k); }
  throw new Error(`failed ${url}`);
}
export function parse(html) {
  const rows = [], seen = new Set(), out = html.match(/出表日期：(\d+)\/(\d+)\/(\d+)/), chunks = html.split('產業別：').slice(1);
  for (const c of chunks) { const ind = c.match(/^([^<]+)/)[1].trim();
    for (const [, code, name, rev] of c.matchAll(/<tr align=right><td align=center>([0-9A-Z]+)<\/td><td align=left>([^<]*)<\/td><td nowrap>([^<]*)<\/td>/g)) { const v = num(rev); if (v != null && !seen.has(code)) seen.add(code), rows.push({ code, name: name.trim(), ind, rev: v }); } }
  return { outDate: out ? `${+out[1] + 1911}-${out[2]}-${out[3]}` : null, rows };
}
async function month(market, y, m) {
  const f = path.join(RAW, `${market}_${y}_${pad(m)}.json`); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const a = parse(await page(market, y, m, 0)), b = parse(await page(market, y, m, 1)), o = { market, ym: `${y}-${pad(m)}`, avail: avail(y, m), outDate: a.outDate, rows: [...a.rows, ...b.rows.map((r) => ({ ...r, kind: 1 }))] };
  if (o.avail <= new Date().toISOString().slice(0, 10) && o.rows.length) fs.writeFileSync(f, JSON.stringify(o)); return o;
}
function build() {
  const companies = {}, months = {}, ind = {};
  for (const fn of fs.readdirSync(RAW).sort()) { const o = JSON.parse(fs.readFileSync(path.join(RAW, fn), 'utf8')), M = (months[o.ym] ??= { avail: o.avail, rev: {} });
    for (const r of o.rows) { r.ind = r.ind.replace(/[（(].*$/, '').trim(); M.rev[r.code] = r.rev; companies[r.code] = { name: r.name, industry: r.ind, market: o.market }; (ind[o.ym] ??= {})[r.code] = r.ind; } }
  const sorted = Object.fromEntries(Object.keys(months).sort().map((k) => [k, months[k]])), idx = {}, bw = {};
  for (const ym of Object.keys(sorted)) { const prev = `${+ym.slice(0, 4) - 1}${ym.slice(4)}`, P = sorted[prev]; if (!P) continue;
    const acc = {}; for (const [c, v] of Object.entries(sorted[ym].rev)) { const pv = P.rev[c]; if (pv == null) continue; const g = (acc[companies[c].industry] ??= { rev: 0, prev: 0, n: 0 }); g.rev += v; g.prev += pv; g.n++; }
    for (const [g, a] of Object.entries(acc)) (idx[g] ??= {})[ym] = { rev: a.rev, yoy: a.prev > 0 ? +(a.rev / a.prev - 1).toFixed(4) : null, n: a.n };
    for (const [c, nm] of Object.entries(BELLWETHERS)) { const v = sorted[ym].rev[c], pv = P.rev[c]; if (v == null) continue; (bw[`${c} ${nm}`] ??= {})[ym] = { rev: v, yoy: pv > 0 ? +(v / pv - 1).toFixed(4) : null, n: 1 }; } }
  fs.writeFileSync(path.join(OUT, 'revenue.json'), JSON.stringify({ source: 'mopsov.twse.com.tw t21sc03', unit: 'NT$ thousands', companies, months: sorted }));
  fs.writeFileSync(path.join(OUT, 'industry_index.json'), JSON.stringify({ note: 'industry = company latest classification; sums over companies present in month and same month prior year', industries: idx, bellwethers: bw }));
  return { months: Object.keys(sorted), companies: Object.keys(companies).length, industries: Object.keys(idx), bw: Object.keys(bw) };
}
if (decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
  fs.mkdirSync(RAW, { recursive: true }); const now = new Date();
  for (let y = 2010; y <= now.getFullYear(); y++) for (let m = 1; m <= 12; m++) { if (y === now.getFullYear() && m >= now.getMonth() + 1) break;
    for (const mk of ['sii', 'otc']) { const o = await month(mk, y, m); console.error(`${mk} ${y}-${pad(m)} rows=${o.rows.length}${fs.existsSync(path.join(RAW, `${mk}_${y}_${pad(m)}.json`)) ? '' : ' (not cached: incomplete)'}`); } }
  const s = build(); console.error(`built: ${s.months[0]}→${s.months.at(-1)} (${s.months.length} months) · ${s.companies} companies · ${s.industries.length} industries · ${s.bw.length} bellwethers`);
}
