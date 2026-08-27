#!/usr/bin/env node
// server.mjs — Unusual Whales research MCP connector.
//
//   node server.mjs                # stdio (Claude Code / Claude Desktop)
//   PORT=8787 node server.mjs      # Streamable HTTP at /mcp (claude.ai custom connector, Railway)
//
// Exposes the ENTIRE UW public API (tools.json, generated from their OpenAPI spec by
// generate.mjs — GET endpoints only, websocket channels excluded) plus five composite
// research tools that fan out across endpoints and return distilled evidence blocks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { uw, apiKey } from './src/uw.mjs';
import { registerComposite } from './src/composite.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'tools.json'), 'utf8'));
const MAX_CHARS = 45_000; // cap any single response so one fat endpoint can't blow the context

function zodFor(p) {
  let s;
  if (p.enum?.length) s = z.enum(p.enum.map(String));
  else if (p.type === 'integer') s = z.number().int();
  else if (p.type === 'boolean') s = z.boolean();
  else s = z.string();
  if (p.description) s = s.describe(p.description);
  return p.required ? s : s.optional();
}

function buildServer() {
  const server = new McpServer(
    { name: 'uw-research', version: '0.1.0' },
    {
      instructions:
        'Unusual Whales market-research connector: the full UW public API as read-only tools, plus composite research tools. For a single-name workup start with research_ticker; for earnings potential use upcoming_earnings_calendar → earnings_setup → flow_conviction_check; use the raw endpoint tools for drill-downs. Flow is a lean, not proof — verify ask-side/opening before treating premium as conviction.',
    }
  );

  registerComposite(server);

  for (const t of manifest.tools) {
    const schema = {};
    for (const p of t.params) schema[p.name] = zodFor(p);
    server.registerTool(
      t.name,
      { description: `[${t.tag}] ${t.description}`, inputSchema: schema },
      async (args = {}) => {
        let url = t.path;
        const query = new URLSearchParams();
        for (const p of t.params) {
          const v = args[p.name];
          if (v == null || v === '') continue;
          if (p.in === 'path') url = url.replace(`{${p.name}}`, encodeURIComponent(String(v).toUpperCase()));
          else query.append(p.name, String(v));
        }
        if (/\{[^}]+\}/.test(url)) {
          const missing = url.match(/\{([^}]+)\}/g).join(', ');
          return { content: [{ type: 'text', text: `Missing required path parameter(s): ${missing}` }], isError: true };
        }
        const qs = query.toString();
        try {
          const j = await uw(url + (qs ? `?${qs}` : ''));
          let out = JSON.stringify(j, null, 1);
          if (out.length > MAX_CHARS)
            out = out.slice(0, MAX_CHARS) + `\n…TRUNCATED at ${MAX_CHARS} chars — narrow with limit/date/page params.`;
          return { content: [{ type: 'text', text: out }] };
        } catch (e) {
          return { content: [{ type: 'text', text: `error calling ${t.path}: ${e.message}` }], isError: true };
        }
      }
    );
  }
  return server;
}

if (!apiKey()) {
  console.error('FATAL: UNUSUAL_WHALES_API_KEY not set (env or repo-root .env)');
  process.exit(1);
}

if (process.env.PORT) {
  // ---- Streamable HTTP (stateless: one server+transport per request) --------------------
  const { default: express } = await import('express');
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // optional shared-secret path segment: set MCP_PATH_TOKEN and the endpoint becomes
  // /mcp/<token> — claude.ai custom connectors can't send custom headers without OAuth,
  // so the secret lives in the URL. Leave unset for a plain /mcp (NOT recommended public).
  const token = process.env.MCP_PATH_TOKEN;
  const mcpPath = token ? `/mcp/${token}` : '/mcp';

  app.get('/', (_req, res) => res.json({ ok: true, service: 'uw-research-mcp', tools: manifest.count + 5 }));
  app.post(mcpPath, async (req, res) => {
    try {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('mcp request failed:', e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null });
    }
  });
  // stateless server: no SSE resumption, no sessions to delete
  const reject = (_req, res) => res.status(405).set('Allow', 'POST').send('Method Not Allowed');
  app.get(mcpPath, reject);
  app.delete(mcpPath, reject);

  const port = +process.env.PORT;
  app.listen(port, () => console.error(`uw-research MCP listening on :${port} at ${token ? '/mcp/<token>' : '/mcp'} (${manifest.count} generated + 5 composite tools)`));
} else {
  // ---- stdio ----------------------------------------------------------------------------
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  console.error(`uw-research MCP on stdio (${manifest.count} generated + 5 composite tools)`);
}
