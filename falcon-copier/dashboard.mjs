// LOCALHOST DASHBOARD — SPX/SPY/QQQ side by side + the agent's read + its trade blotter, on one page.
// Reads agent_dashboard.json (written by agent.mjs each minute). Trade cards show ✗ (potential / watching) and
// flip to ✓ (confirmed) once conviction clears the bar — Falcon-style. Auto-refreshes.  Usage: node dashboard.mjs
//   then open http://localhost:8790
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path';
const FC = path.join(process.cwd(), 'falcon-copier'), PORT = 8790, CONFIRM = 0.6;
const readState = () => { const f = path.join(FC, 'agent_dashboard.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Falcon-copier · Agentic 0DTE</title><style>
:root{--bg:#0b0e14;--panel:#141924;--panel2:#1b2230;--ink:#e8ecf4;--mut:#8a93a6;--line:#232c3d;--grn:#3ddc84;--red:#ff5c6c;--amb:#ffcc55;--vio:#a877ff;--blu:#5aa9ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-variant-numeric:tabular-nums}
.wrap{max-width:1400px;margin:0 auto;padding:18px}
header{display:flex;align-items:baseline;gap:14px;margin-bottom:14px}
h1{font-size:17px;margin:0;letter-spacing:.3px}.sub{color:var(--mut);font-size:13px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
.sym{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}.sym b{font-size:16px}.px{font-size:22px;font-weight:700}
.chg{font-size:13px;font-weight:600}.up{color:var(--grn)}.dn{color:var(--red)}
.reg{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;letter-spacing:.4px;text-transform:uppercase}
.reg.neg{background:rgba(255,92,108,.15);color:var(--red)}.reg.pos{background:rgba(61,220,132,.15);color:var(--grn)}
.kv{display:flex;justify-content:space-between;padding:3px 0;border-top:1px solid var(--line);color:var(--mut);font-size:12.5px}.kv b{color:var(--ink);font-weight:600}
.roll{font-size:12px;color:var(--amb);letter-spacing:.3px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px}
.panel h2{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--mut);margin:0 0 10px}
.read{color:#cdd6e6;font-size:13.5px;line-height:1.5}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
.cards.solo{grid-template-columns:1fr}
.phdr{display:flex;align-items:center;gap:12px;margin-bottom:10px}.phdr h2{margin:0}
.toggle{display:inline-flex;gap:2px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:2px;margin-left:auto}
.toggle button{background:none;border:none;color:var(--mut);font:inherit;font-size:11.5px;padding:4px 12px;border-radius:6px;cursor:pointer}
.toggle button.on{background:var(--blu);color:#08111f;font-weight:700}
.tc{position:relative;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px 12px 12px 12px}
.tc .mode{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--mut);margin-bottom:6px}
.tc .dir{font-size:15px;font-weight:700}.tc .dir.long{color:var(--grn)}.tc .dir.short{color:var(--red)}.tc .dir.aside{color:var(--mut)}
.tc .lv{color:var(--mut);font-size:12.5px;margin-top:4px}.tc .lv b{color:var(--ink)}
.tc .idea{background:rgba(90,169,255,.1);border:1px solid rgba(90,169,255,.25);border-radius:7px;padding:6px 9px;margin:8px 0;font-size:12.5px;color:#cfe0ff}
.tc .why{color:#b9c2d4;font-size:12px;margin-top:7px;line-height:1.45}
.badge{position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:7px;display:grid;place-items:center;font-size:15px;font-weight:800}
.badge.x{background:rgba(255,204,85,.14);color:var(--amb);border:1px solid rgba(255,204,85,.35)}
.badge.ok{background:rgba(61,220,132,.16);color:var(--grn);border:1px solid rgba(61,220,132,.4)}
.conv{height:5px;background:var(--line);border-radius:3px;margin-top:9px;overflow:hidden}.conv i{display:block;height:100%;border-radius:3px}
table{width:100%;border-collapse:collapse;font-size:12.5px}th{text-align:left;color:var(--mut);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:.4px}
td{padding:6px 8px;border-bottom:1px solid var(--line)}.pl.up{color:var(--grn)}.pl.dn{color:var(--red)}
.tag{font-size:11px;padding:1px 7px;border-radius:5px;font-weight:600}.tag.long{background:rgba(61,220,132,.14);color:var(--grn)}.tag.short{background:rgba(255,92,108,.14);color:var(--red)}
.muted{color:var(--mut)}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
details{margin-top:8px}summary{cursor:pointer;color:var(--mut);font-size:12px}
.jr{color:#aeb8cc;font-size:12.5px;white-space:pre-wrap;line-height:1.5;margin-top:8px}
.empty{color:var(--mut);text-align:center;padding:30px}
.status{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px 16px;color:var(--amb);font-size:13px;margin-bottom:14px;text-align:center;font-weight:600}
.tag.open{background:rgba(90,169,255,.2);color:var(--blu);animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
.open-pill{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.4px;color:var(--blu);background:rgba(90,169,255,.16);padding:1px 6px;border-radius:5px;vertical-align:middle}
.why-tag{font-size:10px;color:var(--mut);font-weight:600;margin-left:6px;padding:1px 6px;border-radius:4px;background:var(--bg)}
.trend{display:inline-block;font-size:11px;font-weight:700;padding:1px 8px;border-radius:6px;margin-left:6px}.trend.up{background:rgba(61,220,132,.15);color:var(--grn)}.trend.down{background:rgba(255,92,108,.15);color:var(--red)}.trend.chop{background:rgba(138,147,166,.15);color:var(--mut)}
tr.open-row td{background:rgba(90,169,255,.06);border-bottom:1px solid rgba(90,169,255,.22)}
</style></head><body><div class="wrap">
<header><h1>🦅 Falcon-copier</h1><span class="sub">agentic 0DTE · <span id="asof">—</span></span><span class="sub" id="conn"></span></header>
<div id="app"><div class="empty">waiting for the agent to write its first snapshot…</div></div>
</div><script>
const CONFIRM=${CONFIRM};
let view='both';const setView=v=>{view=v;tick();};
const modes=()=>view==='both'?['conservative','aggressive']:[view];
const f1=x=>x==null?'—':(x>=0?'+':'')+(+x).toFixed(1);
const usd=x=>x==null?'—':(x>=0?'+$':'-$')+Math.abs(Math.round(x)).toLocaleString();
const ago=m=>m==null?'':m<120?m+'m':m<1440?Math.round(m/60)+'h':Math.round(m/1440)+'d';
const dirCls=d=>d==='long'?'long':d==='short'?'short':'aside';
const exitReason=(w)=>{if(!w)return '';w=String(w);if(w.includes('target'))return '✓ target hit';if(w.includes('stop'))return '✗ stop hit';if(w.includes('EOD'))return '⏰ EOD flat';if(w.includes('revers'))return '↺ reversed';if(w.includes('invalidated')||w.includes('stood aside')||w.includes('exit'))return '⊘ exit';return w;};
function instCard(sym,s){if(!s)return '';const neg=(s.regime?.net_gamma_M||0)<0;const roll=(s.dom_neg_roll||[]).filter((v,i,a)=>i===0||v!==a[i-1]).join('→');
 return \`<div class="card"><div class="sym"><b>\${sym}</b><span><span class="px">\${(+s.spot).toFixed(2)}</span> <span class="chg \${s.chg_pct>=0?'up':'dn'}">\${s.chg_pct>=0?'+':''}\${s.chg_pct}%</span></span></div>
 <div><span class="reg \${neg?'neg':'pos'}">\${neg?'negative γ · trend':'positive γ · pinned'}</span></div>
 <div class="kv"><span>King (0DTE)</span><b>\${s.king?.strike??'—'} <span class="muted">(\${s.king?.gex_M??'?'}M)</span></b></div>
 \${s.htf?.agg_king?\`<div class="kv"><span>HTF king (full surface)</span><b>\${s.htf.agg_king.strike} <span class="muted">(\${s.htf.agg_king.gex_M}M · net \${s.htf.agg_net_gamma_M}M)</span></b></div>\`:''}
 \${s.em?.expected_range?\`<div class="kv"><span>Expected range (0DTE straddle)</span><b>\${s.em.expected_range[0]}–\${s.em.expected_range[1]} <span class="muted">(±\${s.em.expected_move_pts})</span></b></div>\`:''}
 <div class="kv"><span>Support ↓ / Resist ↑</span><b>\${s.support_below?.strike??'—'} / \${s.resist_above?.strike??'—'}</b></div>
 <div class="kv"><span>Net γ / Net vanna</span><b>\${s.regime?.net_gamma_M??'?'}M / \${s.regime?.net_vanna_M??'?'}M</b></div>
 <div class="kv"><span>Dominant-neg roll</span><b class="roll">\${roll||'—'}</b></div>
 \${s.flow?\`<div class="kv"><span>Flow (ask)</span><b>\${s.flow.lean??'—'}</b></div>\`:''}
 \${s.dark_pool?\`<div class="kv"><span>DP value area</span><b>\${s.dark_pool.value_area_low}–\${s.dark_pool.value_area_high} (POC \${s.dark_pool.poc})</b></div>\`:''}
 </div>\`;}
function tradeCard(mode,d,pos){if(!d)return '';const conf=d.direction!=='stand_aside'&&d.conviction>=CONFIRM;const potential=d.direction!=='stand_aside'&&!conf;
 const badge=d.direction==='stand_aside'?'':(conf?'<div class="badge ok">✓</div>':'<div class="badge x">✗</div>');
 const cvColor=conf?'var(--grn)':(d.direction==='stand_aside'?'var(--mut)':'var(--amb)');
 const idea=pos?\`<div class="idea"><span class="open-pill">● OPEN</span> <b>\${pos.instrument} \${pos.strike?pos.strike+pos.cp:''}</b> · fired <b>\${pos.entryET||'—'}</b> \${pos.entry_premium!=null?'· entry <b>\$'+(+pos.entry_premium).toFixed(2)+'</b>':''}\${pos.live_premium!=null?' → <b>\$'+(+pos.live_premium).toFixed(2)+'</b> <span class="'+(pos.live_ret_pct>=0?'pl up':'pl dn')+'">'+(pos.live_ret_pct>=0?'+':'')+pos.live_ret_pct+'% unrealized</span>':''}</div>\`:'';
 return \`<div class="tc">\${badge}<div class="mode">\${mode} \${conf?'· confirmed':(potential?'· potential':'')}</div>
 <div class="dir \${dirCls(d.direction)}">\${d.instrument&&d.instrument!=='none'?d.instrument+' ':''}\${(d.direction||'').toUpperCase().replace('_',' ')}</div>
 \${idea}
 \${d.direction!=='stand_aside'?\`<div class="lv">entry <b>\${d.entry||'—'}</b> · target <b>\${d.target||'—'}</b> · stop <b>\${d.stop||'—'}</b></div>\`:''}
 <div class="why">\${d.why||''}</div>
 <div class="conv"><i style="width:\${Math.round((d.conviction||0)*100)}%;background:\${cvColor}"></i></div>
 <div class="lv" style="margin-top:5px">conviction \${d.conviction??'—'}</div></div>\`;}
const opt=(x)=>x.strike?\`\${x.instrument} \${x.strike}\${x.cp}\`:x.instrument;
const prem=(p)=>p!=null?'\$'+(+p).toFixed(2):'—';
function blotter(book){let rows='';for(const m of modes()){const b=book?.[m]||{open:null,closed:[]};
 if(b.open)rows+=\`<tr class="open-row"><td>\${m}</td><td>\${opt(b.open)} <span class="tag \${b.open.dir}">\${b.open.dir}</span> <span class="tag open">● OPEN</span></td><td>\${b.open.entryET||''}</td><td>\${prem(b.open.entry_premium)}</td><td>\${b.open.live_premium!=null?prem(b.open.live_premium)+' <span class="muted">now</span>':'<span class="muted">—</span>'}</td><td class="\${(b.open.live_ret_pct||0)>=0?'pl up':'pl dn'}">\${b.open.live_ret_pct!=null?(b.open.live_ret_pct>=0?'+':'')+b.open.live_ret_pct+'% <span class="muted">unrl</span>':'—'}</td></tr>\`;
 for(const c of (b.closed||[]))rows+=\`<tr><td>\${m}</td><td>\${opt(c)} <span class="tag \${c.dir}">\${c.dir}</span></td><td>\${c.entryET||''}</td><td>\${prem(c.entry_premium)}</td><td>\${prem(c.exit_premium)} <span class="muted">\${c.exitET||''}</span></td><td class="pl \${(c.pnl_usd??c.opt_ret_pct??c.pnl)>=0?'up':'dn'}">\${c.opt_ret_pct!=null?(c.opt_ret_pct>=0?'+':'')+c.opt_ret_pct+'%':f1(c.pnl)+'pt'}\${c.pnl_usd!=null?' <span class="muted">'+usd(c.pnl_usd)+'</span>':''} <span class="why-tag">\${exitReason(c.why)}</span></td></tr>\`;}
 return rows||'<tr><td colspan=6 class="muted">no trades yet</td></tr>';}
function pnl(book,m){const b=book?.[m]||{closed:[]};return (b.closed||[]).reduce((a,c)=>a+(c.pnl_usd??0),0);}
async function tick(){try{const r=await fetch('/state',{cache:'no-store'});const st=await r.json();document.getElementById('conn').textContent='● live';
 if(!st){document.getElementById('app').innerHTML='<div class="empty">no snapshot yet — run the agent</div>';return;}
 document.getElementById('asof').textContent=(st.day||'')+' '+(st.as_of_et||'')+' ET';
 const ins=st.instruments||{};const flow=st.uw_layers?.options_flow||{};const dp=st.uw_layers?.dark_pool||{};
 for(const k in ins){ins[k].flow=flow[k];ins[k].dark_pool=dp[k==='SPXW'?'SPY':k];}
 const d=st.decision||{};const cp=pnl(st.book,'conservative'),ap=pnl(st.book,'aggressive');
 const hasData=Object.keys(ins).length>0;
 document.getElementById('app').innerHTML=\`
 \${st.status?\`<div class="status">⏸ \${st.status}</div>\`:''}
 \${hasData?\`<div class="grid3">\${instCard('SPXW',ins.SPXW)}\${instCard('SPY',ins.SPY)}\${instCard('QQQ',ins.QQQ)}</div>
 <div class="panel"><div class="phdr"><h2>Agent read \${d.dominant_trend?.direction?'<span class="trend '+d.dominant_trend.direction+'">trend '+d.dominant_trend.direction.toUpperCase()+(d.dominant_trend.strength?' ('+d.dominant_trend.strength+')':'')+'</span>':''} \${st.uw_layers?.market_tide_flow_lean?('· tide '+st.uw_layers.market_tide_flow_lean.lean):''} \${st.uw_layers?.vix?.level?('· VIX '+st.uw_layers.vix.level+' '+(st.uw_layers.vix.band||'')+(st.uw_layers.vix.tilt?' · '+st.uw_layers.vix.tilt+' tilt':'')+(st.uw_layers.vix.term_structure?' · '+st.uw_layers.vix.term_structure:'')):''}\${st.uw_layers?.econ_calendar?.next_high_impact?(' · '+(st.uw_layers.econ_calendar.in_event_window?'⚠ ':'📅 ')+st.uw_layers.econ_calendar.next_high_impact.event+' in '+ago(st.uw_layers.econ_calendar.next_high_impact.minutes_away)):''}</h2>
     <div class="toggle"><button class="\${view==='both'?'on':''}" onclick="setView('both')">Both</button><button class="\${view==='conservative'?'on':''}" onclick="setView('conservative')">Conservative</button><button class="\${view==='aggressive'?'on':''}" onclick="setView('aggressive')">Aggressive</button></div></div>
   <div class="read"><b>\${d.regime_read||''}</b><br>\${d.shared_thesis||''}</div>
   <div class="cards\${view!=='both'?' solo':''}">\${modes().map(m=>tradeCard(m,d[m],st.book?.[m]?.open)).join('')}</div></div>\`:''}
 <div class="two">
   <div class="panel"><h2>Trade blotter · realized (risk-parity $): conservative <span class="\${cp>=0?'pl up':'pl dn'}">\${usd(cp)}</span> · aggressive <span class="\${ap>=0?'pl up':'pl dn'}">\${usd(ap)}</span></h2>
     <table><thead><tr><th>posture</th><th>option</th><th>fired</th><th>entry \$</th><th>exit \$</th><th>return</th></tr></thead><tbody>\${blotter(st.book)}</tbody></table></div>
   <div class="panel"><h2>Journal & lessons</h2><div class="jr">\${(st.journal||'(none)').slice(0,700)}</div>
     \${(st.lessons&&st.lessons.length)?'<details><summary>durable lessons ('+st.lessons.length+')</summary><div class="jr">'+st.lessons.map((l,i)=>(i+1)+'. '+(l.lesson||l)).join('\\n')+'</div></details>':'<div class="muted" style="margin-top:8px;font-size:12px">no durable lessons yet (need multi-day recurrence)</div>'}</div>
 </div>\`;}catch(e){document.getElementById('conn').textContent='● reconnecting';}}
tick();setInterval(tick,3000);
</script></body></html>`;

http.createServer((req, res) => {
  if (req.url === '/state') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(readState())); return; }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(HTML);
}).listen(PORT, () => console.log(`\n  📊  Falcon-copier dashboard → http://localhost:${PORT}\n  (reads falcon-copier/agent_dashboard.json; refreshes every 3s)\n`));
