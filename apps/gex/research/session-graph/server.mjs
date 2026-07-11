// Session Mesh dashboard (research only) — a live view of the Claude sessions in this
// codebase and how they talk through the coordination mailbox. Parses mailbox.md into
// a session graph + message stream and serves it; the page polls every 2s so you watch
// the sessions converse in real time. No deps, no trading logic.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COORD = path.join(HERE, '..', '..', '.coordination');
const MAILBOX = path.join(COORD, 'mailbox.md');
const PORT = Number(process.env.MESH_PORT || 5179);

const COMMAND_CENTER = process.env.COMMAND_CENTER || 'Bellwether';
const ROLES = {
  Bellwether: 'GEX/VEX engine · 0DTE tracker · walkforward research · orchestration',
  Athena: 'advisory theses · brain knowledge vault · fire cross-exam',
};

function parse() {
  const txt = fs.existsSync(MAILBOX) ? fs.readFileSync(MAILBOX, 'utf8') : '';
  const blocks = txt.split(/^### /m).slice(1);
  const messages = [];
  for (const b of blocks) {
    const header = b.split('\n')[0];
    const m = header.match(/^(MSG[^·]*)·\s*([^·]+?)\s*·\s*FROM:\s*(\w+)\s*·\s*TO:\s*(\w+)(?:\s*·\s*RE:\s*(.+))?/);
    if (!m) continue;
    const [, id, ts, from, to, re] = m;
    const rest = b.split('\n').slice(1).join('\n');
    const status = (rest.match(/STATUS:\s*(\w+)/) || [, 'open'])[1];
    const body = rest.replace(/STATUS:.*/s, '').replace(/^-{2,}\s*$/gm, '').trim();
    messages.push({ id: id.trim(), ts: ts.trim(), from, to, re: re?.trim() || null, status, body });
  }
  const sessions = {};
  const touch = s => (sessions[s] = sessions[s] || { name: s, role: ROLES[s] || 'session', sent: 0, recv: 0, lastTs: null, lastIdx: -1 });
  messages.forEach((msg, i) => { touch(msg.from).sent++; touch(msg.to).recv++; sessions[msg.from].lastTs = msg.ts; sessions[msg.from].lastIdx = i; });
  // ensure the command center always exists as a node even before it posts
  touch(COMMAND_CENTER); sessions[COMMAND_CENTER].command = true;
  for (const s of Object.values(sessions)) s.command = s.name === COMMAND_CENTER;
  const edges = {};
  for (const msg of messages) { const k = `${msg.from}>${msg.to}`; edges[k] = edges[k] || { from: msg.from, to: msg.to, count: 0 }; edges[k].count++; }
  return { commandCenter: COMMAND_CENTER, sessions: Object.values(sessions), edges: Object.values(edges), messages, count: messages.length, updatedAt: Date.now() };
}

const HTML = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
http.createServer((req, res) => {
  if (req.url.startsWith('/api/graph')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(parse()));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  }
}).listen(PORT, '127.0.0.1', () => console.log(`[session-mesh] http://127.0.0.1:${PORT}  (reading ${MAILBOX})`));
