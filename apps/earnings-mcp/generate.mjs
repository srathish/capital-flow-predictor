#!/usr/bin/env node
// generate.mjs — build tools.json (the MCP tool manifest) from the UW OpenAPI spec.
//
//   node generate.mjs [--fetch]     # --fetch pulls a fresh spec from the API first
//
// The manifest is committed; the server only reads tools.json at startup, so a spec
// refresh is an explicit re-generate + review of the diff, never a runtime surprise.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SPEC = path.join(DIR, 'uw-openapi.json');
const OUT = path.join(DIR, 'tools.json');

if (process.argv.includes('--fetch')) {
  const key = process.env.UNUSUAL_WHALES_API_KEY;
  if (!key) { console.error('--fetch needs UNUSUAL_WHALES_API_KEY in env'); process.exit(1); }
  const r = await fetch('https://api.unusualwhales.com/api/openapi', { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) { console.error('spec fetch failed:', r.status); process.exit(1); }
  const { default: yaml } = await import('js-yaml');
  fs.writeFileSync(SPEC, JSON.stringify(yaml.load(await r.text())));
  console.log('refreshed uw-openapi.json');
}

const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));

const SKIP_TAGS = new Set(['websocket']); // socket channels aren't REST-callable over MCP
const snake = (s) => s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();
const trim = (s, n) => { s = (s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const tools = [];
const seen = new Map();
for (const [p, methods] of Object.entries(spec.paths || {})) {
  for (const [method, op] of Object.entries(methods)) {
    if (method !== 'get') continue; // read-only connector: the public API's lone POST (alert save) is intentionally excluded
    const tag = (op.tags || ['misc'])[0];
    if (SKIP_TAGS.has(tag)) continue;

    // tool name: tag + operationId action segment, e.g. earnings_ticker, stock_ohlc
    const action = snake((op.operationId || p).split('.').pop());
    const tagS = snake(tag);
    let name = tagS === action || action.startsWith(tagS + '_') ? action : `${tagS}_${action}`;
    if (seen.has(name)) name = snake((op.operationId || '').replace(/^PublicApi\./, ''));
    if (seen.has(name)) { console.error('unresolvable name collision:', name, p); process.exit(1); }
    seen.set(name, p);

    const params = (op.parameters || []).map((prm) => ({
      name: prm.name,
      in: prm.in,
      required: !!prm.required || prm.in === 'path',
      type: prm.schema?.type === 'integer' ? 'integer' : prm.schema?.type === 'boolean' ? 'boolean' : 'string',
      enum: prm.schema?.enum,
      description: trim(prm.description, 200) || undefined,
    }));

    tools.push({
      name,
      method: 'GET',
      path: p,
      tag,
      description: [trim(op.summary, 120), trim(op.description, 400)].filter(Boolean).join(' — ') || name,
      params,
    });
  }
}

tools.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : a.name < b.name ? -1 : 1));
fs.writeFileSync(OUT, JSON.stringify({ generatedFrom: spec.info?.title + ' ' + spec.info?.version, count: tools.length, tools }, null, 1));
console.log(`wrote tools.json — ${tools.length} tools across ${new Set(tools.map((t) => t.tag)).size} tags`);
