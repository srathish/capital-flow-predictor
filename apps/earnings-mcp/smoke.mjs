#!/usr/bin/env node
// smoke.mjs — end-to-end check: spawn the server on stdio, list tools, call one raw
// endpoint tool and one composite tool against the live UW API.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ticker = (process.argv[2] || 'CRWD').toUpperCase();
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: ['server.mjs'], cwd: import.meta.dirname }));

const { tools } = await client.listTools();
console.log(`tools listed: ${tools.length}`);
for (const name of ['research_ticker', 'earnings_setup', 'stock_ohlc', 'earnings_afterhours', 'gex_greeks_gex']) {
  const hit = tools.find((t) => t.name === name || t.name.includes(name.split('_').pop()));
  console.log(` ${name}: ${hit ? 'present as ' + hit.name : 'MISSING'}`);
}

console.log(`\n-- raw tool: earnings_ticker(${ticker}) --`);
const raw = await client.callTool({ name: 'earnings_ticker', arguments: { ticker } });
console.log(raw.content[0].text.slice(0, 500));

console.log(`\n-- composite: earnings_setup(${ticker}) --`);
const setup = await client.callTool({ name: 'earnings_setup', arguments: { ticker } });
console.log(setup.content[0].text);

console.log(`\n-- composite: research_ticker(${ticker}) --`);
const res = await client.callTool({ name: 'research_ticker', arguments: { ticker } });
console.log(res.content[0].text);

await client.close();
console.log('\nsmoke OK');
