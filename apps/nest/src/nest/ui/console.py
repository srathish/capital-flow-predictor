"""The CONSOLE — one screen, everything. The 3D stock galaxy is the centerpiece; the picks,
rising confluence, sector heat, signal log, source health, and regime sit in panels around
it; clicking any stock (a star or a pick) opens a detail drawer with every captured field
(momentum, quality, catalyst, LEVELS, flow, positioning, news, social). No more separate
tabs. Self-contained canvas-2D + DOM, ember terminal aesthetic.
"""

from __future__ import annotations

import json

_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NEST · CONSOLE</title>
<style>
  :root{
    --ground:#070604; --panel:#0e0b06; --panel2:#0b0906; --line:#241d12; --line2:#181209;
    --ink:#f3e7cf; --muted:#9a8a6a; --dim:#5a4f3a; --amber:#ffc24b; --gold:#ffcf6a;
    --long:#ffd27a; --bull:#ffcf6a; --bear:#ff6b5a;
    --chart:#ffcf6a; --fundamental:#9be08a; --catalyst:#ffd166; --flow:#5bd0d0;
    --levels:#b39bff; --positioning:#ffb454; --filings:#8ac97a; --social:#ff9bd0; --macro:#ff7a6a;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;overflow:hidden;background:var(--ground);color:var(--ink);
    font:11.5px/1.45 ui-monospace,"SF Mono",Menlo,Consolas,monospace;-webkit-font-smoothing:antialiased}
  .app{display:grid;grid-template-rows:auto 1fr auto;height:100vh}
  /* status bar */
  .bar{display:flex;align-items:baseline;gap:6px 15px;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--line)}
  .brand{font-weight:700;letter-spacing:.2em}.brand b{color:var(--amber)}
  .stat{color:var(--muted);font-size:10px;letter-spacing:.08em;text-transform:uppercase}
  .stat b{color:var(--amber);font-variant-numeric:tabular-nums}
  .stat.push{margin-left:auto}
  .live::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;
    background:var(--long);box-shadow:0 0 7px var(--long);margin-right:5px;animation:bl 1.7s infinite}
  @keyframes bl{50%{opacity:.4}}
  /* main 3-col */
  .main{display:grid;grid-template-columns:216px 1fr 268px;min-height:0}
  .rail{overflow:auto;padding:10px;display:flex;flex-direction:column;gap:12px}
  .rail.l{border-right:1px solid var(--line)}
  .rail.r{border-left:1px solid var(--line)}
  .card h3{margin:0 0 7px;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);
    display:flex;justify-content:space-between}
  .stagewrap{position:relative;min-height:0}
  canvas{position:absolute;inset:0;width:100%;height:100%}
  .hint{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);color:var(--dim);
    font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;pointer-events:none}
  /* picks */
  .pk{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:7px 9px;border:1px solid var(--line2);
    border-radius:8px;background:var(--panel);cursor:pointer;transition:border-color .12s}
  .pk:hover{border-color:#3a2f1a}
  .pk .t{font-weight:700;font-size:13px}
  .pk .t .dir{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;box-shadow:0 0 6px currentColor}
  .pk .cv{font-variant-numeric:tabular-nums;font-weight:600;text-align:right}
  .pk .why{grid-column:1/3;display:flex;flex-wrap:wrap;gap:3px;margin-top:2px}
  .chip{font-size:9.5px;padding:0 6px;border-radius:999px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
  .chip.fired{color:var(--amber);border-color:#4a3d16;background:#1a1608}
  .picks{display:flex;flex-direction:column;gap:5px}
  /* rising / heat */
  .rrow{display:flex;align-items:center;gap:7px;padding:2px 0}
  .rrow .tk{font-weight:600;width:46px}.rrow .cv{color:var(--muted);width:26px;text-align:right;font-variant-numeric:tabular-nums}
  .rrow .dl{color:var(--amber);flex:1;text-align:right;font-variant-numeric:tabular-nums}
  .hrow{display:flex;align-items:center;gap:7px;padding:2px 0}
  .hrow .nm{flex:1;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .hb{width:48px;height:5px;border-radius:3px;background:#1a140c;overflow:hidden}.hb i{display:block;height:100%}
  .calrow{display:flex;justify-content:space-between;color:var(--muted);padding:2px 0}
  /* bottom log strip */
  .strip{border-top:1px solid var(--line);display:grid;grid-template-columns:1.4fr 1fr;height:150px}
  .strip .col{overflow:auto;padding:8px 12px}
  .strip .col+.col{border-left:1px solid var(--line)}
  .lg{display:flex;gap:9px;padding:1px 0;white-space:nowrap;font-variant-numeric:tabular-nums}
  .lg .ts{color:var(--dim)}.lg .sr{color:var(--muted);width:96px;overflow:hidden;text-overflow:ellipsis}
  .lg .tk2{font-weight:600;width:52px}
  .fam{display:inline-block;width:7px;height:7px;border-radius:2px;margin-right:4px;vertical-align:middle}
  .hcell{display:inline-flex;align-items:center;gap:5px;margin:2px 10px 2px 0;font-size:10.5px}
  .hcell b{color:var(--ink);font-variant-numeric:tabular-nums}
  .hcell .w{color:var(--dim)}
  /* detail drawer */
  #drawer{position:fixed;top:0;right:0;bottom:0;width:380px;max-width:92vw;background:#0c0906;
    border-left:1px solid #3a2f1a;box-shadow:-20px 0 60px rgba(0,0,0,.6);z-index:20;overflow:auto;
    transform:translateX(100%);transition:transform .18s ease}
  #drawer.open{transform:none}
  .dh{position:sticky;top:0;background:#0c0906;border-bottom:1px solid var(--line);padding:14px 16px;z-index:1}
  .dh .x{position:absolute;top:12px;right:14px;color:var(--dim);cursor:pointer;font-size:16px}
  .dh .tkr{font-size:24px;font-weight:700;letter-spacing:.02em}
  .dh .meta{color:var(--muted);font-size:11px;margin-top:2px}
  .dsec{padding:11px 16px;border-bottom:1px solid var(--line2)}
  .dsec h4{margin:0 0 6px;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
  .drow{display:flex;justify-content:space-between;padding:2px 0;gap:12px}
  .drow .k{color:var(--muted)}.drow .v{color:var(--ink);text-align:right;font-variant-numeric:tabular-nums}
  .dsec.empty{display:none}
  .backdrop{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:19;display:none}
  .backdrop.on{display:block}
  @media(max-width:900px){.main{grid-template-columns:1fr}.rail.l,.stagewrap{display:none}}
</style>
</head>
<body>
<div class="app">
  <div class="bar">
    <span class="brand">NEST <b>·</b> CONSOLE</span>
    <span class="stat">UNIVERSE <b id="s-univ">–</b></span>
    <span class="stat">⚡ALERTS <b id="s-alerts">–</b></span>
    <span class="stat">REGIME <b id="s-regime">–</b></span>
    <span class="stat">GATE <b id="s-floor">–</b></span>
    <span class="stat push live" id="s-upd">UPDATED –</span>
  </div>
  <div class="main">
    <div class="rail l">
      <div class="card"><h3>Rising confluence</h3><div id="rising"></div></div>
      <div class="card"><h3>Sector heat</h3><div id="heat"></div></div>
      <div class="card"><h3>Calibration · 5d</h3><div id="cal"></div></div>
    </div>
    <div class="stagewrap"><canvas id="cv"></canvas><div class="hint">drag to orbit · scroll to zoom · click a star</div></div>
    <div class="rail r">
      <div class="card"><h3>Top picks <span style="color:var(--dim)">momentum·quality·theme</span></h3>
        <div class="picks" id="picks"></div></div>
    </div>
  </div>
  <div class="strip">
    <div class="col"><h3 style="margin:0 0 6px;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)">Signal log</h3><div id="log"></div></div>
    <div class="col"><h3 style="margin:0 0 6px;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)">Source health <span style="color:var(--dim)">rate · weight</span></h3><div id="health"></div></div>
  </div>
</div>
<div class="backdrop" id="backdrop"></div>
<div id="drawer"></div>

<script>
const FAM={chart:'#ffcf6a',fundamental:'#9be08a',catalyst:'#ffd166',flow:'#5bd0d0',
  levels:'#b39bff',positioning:'#ffb454',filings:'#8ac97a',social:'#ff9bd0',macro:'#ff7a6a'};
let STATE=__STATE__; const POLL=__POLL__;
function esc(s){return String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}

/* ---------- galaxy ---------- */
const cv=document.getElementById('cv'), ctx=cv.getContext('2d');
let W=0,H=0,DPR=Math.min(2,devicePixelRatio||1);
function resize(){const r=cv.parentElement.getBoundingClientRect();W=r.width;H=r.height;
  cv.width=W*DPR;cv.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0)}
addEventListener('resize',resize);
const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
let N=[],centers={},hub={},rotX=-0.3,rotY=0.6,dist=1.95,tDist=1.95,drag=false,lx=0,ly=0,settle=220;
const WORLD=300,FOCAL=900;
function fib(i,n){const ga=Math.PI*(3-Math.sqrt(5)),y=1-(i/Math.max(1,n-1))*2,r=Math.sqrt(Math.max(0,1-y*y)),t=ga*i;return[Math.cos(t)*r,y,Math.sin(t)*r]}
function col(n){const t=Math.min(1,n.conv/85);return n.dir==='bull'?[255,190+40*t|0,80+70*t|0]:[255,90+30*t|0,70+20*t|0]}
function ingest(){const prev={};N.forEach(n=>prev[n.id]=n);const secs=STATE.sectors||[];centers={};
  secs.forEach((s,i)=>{const p=fib(i,secs.length);centers[s]=p});
  hub={};const best={};(STATE.nodes||[]).forEach(n=>{if(!(n.sector in best)||n.conv>best[n.sector]){best[n.sector]=n.conv;hub[n.sector]=n.id}});
  N=(STATE.nodes||[]).map(nd=>{const c=centers[nd.sector]||[0,0,0],p=prev[nd.id],cc=col(nd);
    return{...nd,x:p?p.x:c[0]+(Math.random()-.5)*.4,y:p?p.y:c[1]+(Math.random()-.5)*.4,z:p?p.z:c[2]+(Math.random()-.5)*.4,
      vx:p?p.vx:0,vy:p?p.vy:0,vz:p?p.vz:0,r:cc[0],g:cc[1],b:cc[2]}});settle=Math.max(settle,140)}
function step(){const KC=.01,KG=.0016,KR=.00055,dp=.86;
  for(const n of N){const c=centers[n.sector]||[0,0,0];n._fx=(c[0]*1.15-n.x)*KC-n.x*KG;n._fy=(c[1]*1.15-n.y)*KC-n.y*KG;n._fz=(c[2]*1.15-n.z)*KC-n.z*KG}
  for(let i=0;i<N.length;i++){const a=N[i];for(let j=i+1;j<N.length;j++){const b=N[j];
    let dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z,d2=dx*dx+dy*dy+dz*dz+.02,f=KR/d2;dx*=f;dy*=f;dz*=f;a._fx+=dx;a._fy+=dy;a._fz+=dz;b._fx-=dx;b._fy-=dy;b._fz-=dz}}
  for(const n of N){n.vx=(n.vx+n._fx)*dp;n.vy=(n.vy+n._fy)*dp;n.vz=(n.vz+n._fz)*dp;n.x+=n.vx;n.y+=n.vy;n.z+=n.vz}
  if(N.length){let cx=0,cy=0,cz=0;for(const n of N){cx+=n.x;cy+=n.y;cz+=n.z}cx/=N.length;cy/=N.length;cz/=N.length;for(const n of N){n.x-=cx;n.y-=cy;n.z-=cz}}}
function proj(n){const cy=Math.cos(rotY),sy=Math.sin(rotY),cx=Math.cos(rotX),sx=Math.sin(rotX);
  let x=n.x*cy-n.z*sy,z=n.x*sy+n.z*cy,y=n.y,y2=y*cx-z*sx,z2=y*sx+z*cx;const s=FOCAL/(FOCAL+(z2+dist)*WORLD);
  return{sx:W/2+x*s*WORLD,sy:H/2+y2*s*WORLD,scale:s,z:z2}}
let hover=null;
function frame(){if(!reduce&&settle>0){step();settle--}dist+=(tDist-dist)*.1;ctx.clearRect(0,0,W,H);
  const P={};for(const n of N)P[n.id]=proj(n);
  ctx.lineWidth=1;for(const n of N){const h=hub[n.sector];if(!h||h===n.id)continue;const a=P[n.id],b=P[h];
    ctx.strokeStyle='rgba(255,190,90,'+(0.05+0.05*Math.min(1,n.conv/80))*a.scale+')';ctx.beginPath();ctx.moveTo(a.sx,a.sy);ctx.lineTo(b.sx,b.sy);ctx.stroke()}
  const ord=N.map((n,i)=>[i,P[n.id].z]).sort((p,q)=>q[1]-p[1]);
  for(const[i]of ord){const n=N[i],p=P[n.id],rad=(2.6+n.conv*.11)*p.scale;if(rad<.4)continue;
    const br=.35+.65*Math.min(1,n.conv/85),c=`rgba(${n.r},${n.g},${n.b},`;
    const gl=ctx.createRadialGradient(p.sx,p.sy,.5,p.sx,p.sy,rad*3.2);gl.addColorStop(0,c+(.9*br)+')');gl.addColorStop(.4,c+(.28*br)+')');gl.addColorStop(1,c+'0)');
    ctx.fillStyle=gl;ctx.beginPath();ctx.arc(p.sx,p.sy,rad*3.2,0,6.283);ctx.fill();
    ctx.fillStyle=c+br+')';ctx.beginPath();ctx.arc(p.sx,p.sy,rad,0,6.283);ctx.fill();
    if(n===hover){ctx.strokeStyle='#fff';ctx.beginPath();ctx.arc(p.sx,p.sy,rad+4,0,6.283);ctx.stroke()}
    if(n.conv>=42||n===hover){ctx.fillStyle='rgba(243,231,207,'+Math.min(1,br+.2)+')';ctx.font=(9+Math.min(4,n.conv/25))+'px ui-monospace';ctx.textAlign='center';ctx.fillText(n.id,p.sx,p.sy-rad-3)}}
  requestAnimationFrame(frame)}
cv.addEventListener('mousedown',e=>{drag=true;lx=e.clientX;ly=e.clientY;cv._moved=false});
addEventListener('mouseup',()=>drag=false);
cv.addEventListener('mousemove',e=>{const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
  if(drag){rotY+=(e.clientX-lx)*.005;rotX=Math.max(-1.4,Math.min(1.4,rotX+(e.clientY-ly)*.005));lx=e.clientX;ly=e.clientY;cv._moved=true;return}
  let bs=null,bd=1e9;for(const n of N){const p=proj(n),dx=p.sx-mx,dy=p.sy-my,d=dx*dx+dy*dy,rad=(2.6+n.conv*.11)*p.scale+6;if(d<rad*rad&&d<bd){bd=d;bs=n}}hover=bs;cv.style.cursor=bs?'pointer':'grab'});
cv.addEventListener('click',e=>{if(cv._moved)return;if(hover)openDrawer(hover.id)});
cv.addEventListener('wheel',e=>{e.preventDefault();tDist=Math.max(.9,Math.min(5,tDist+e.deltaY*.0016))},{passive:false});

/* ---------- panels ---------- */
let baseAge=0,baseAt=0;
function fmtAge(s){s=Math.max(0,Math.round(s));return s<60?s+'s':s<3600?Math.floor(s/60)+'m':Math.floor(s/3600)+'h'}
function tickAge(){document.getElementById('s-upd').textContent='UPDATED '+fmtAge(baseAge+(performance.now()-baseAt)/1000)+' ago'}
function pk(p){const dc=p.direction==='bull'?'var(--bull)':'var(--bear)';
  const chips=(p.why||[]).slice(0,3).map(w=>`<span class="chip">${esc(w)}</span>`).join('')+(p.gated?'<span class="chip fired">⚡</span>':'');
  return `<div class="pk" onclick="openDrawer('${p.ticker}')"><div class="t"><span class="dir" style="color:${dc}"></span>${esc(p.ticker)}</div>
    <div class="cv" style="color:${dc}">${p.conviction.toFixed(0)}</div><div class="why">${chips}</div></div>`}
function render(){const s=STATE;
  document.getElementById('s-univ').textContent=s.universe;
  document.getElementById('s-alerts').textContent=s.alerts;
  document.getElementById('s-regime').textContent=(s.regime||'neutral').toUpperCase();
  document.getElementById('s-floor').textContent=Math.round(s.floor||70);
  baseAge=0;baseAt=performance.now();tickAge();
  document.getElementById('picks').innerHTML=(s.longs||[]).map(pk).join('')||'<div style="color:var(--dim)">scanning…</div>';
  document.getElementById('rising').innerHTML=(s.rising||[]).slice(0,12).map(n=>
    `<div class="rrow"><span class="tk">${n.id}</span><span class="cv">${n.conv|0}</span><span class="dl">▲${n.delta}</span></div>`).join('')||'<div style="color:var(--dim)">— steady —</div>';
  document.getElementById('heat').innerHTML=(s.sector_heat||[]).slice(0,7).map(([nm,b])=>{
    const c=b>.55?'var(--bull)':b<.45?'var(--bear)':'var(--muted)';
    return `<div class="hrow"><span class="nm">${esc(nm)}</span><span class="hb"><i style="width:${Math.round(b*100)}%;background:${c}"></i></span></div>`}).join('')||'<div style="color:var(--dim)">—</div>';
  const cb=s.calibration||{};document.getElementById('cal').innerHTML=Object.entries(cb).map(([k,v])=>
    `<div class="calrow"><span>${k}</span><span>${v.hit_rate!=null?Math.round(v.hit_rate*100)+'% · n'+v.n:'no history'}</span></div>`).join('');
  document.getElementById('log').innerHTML=(s.signals||[]).map(x=>
    `<div class="lg"><span class="ts">${x.ts}</span><span class="sr"><span class="fam" style="background:${FAM[x.family]||'#666'}"></span>${esc(x.source)}</span>
     <span class="tk2">${esc(x.ticker)}</span><span style="color:${x.dir==='bull'?'var(--bull)':'var(--bear)'}">${x.dir}</span></div>`).join('');
  document.getElementById('health').innerHTML=(s.health||[]).filter(h=>h.rate>0||h.dir).map(h=>
    `<span class="hcell"><span class="fam" style="background:${FAM[h.family]||'#666'}"></span>${esc(h.source)} <b>${h.rate}</b><span class="w">·${h.weight}</span></span>`).join('');
}

/* ---------- detail drawer ---------- */
async function openDrawer(t){
  const d=document.getElementById('drawer'),bd=document.getElementById('backdrop');
  d.innerHTML='<div class="dh"><span class="x" onclick="closeDrawer()">✕</span><div class="tkr">'+esc(t)+'</div><div class="meta">loading…</div></div>';
  d.classList.add('open');bd.classList.add('on');
  try{const r=await fetch('/api/ticker/'+t,{cache:'no-store'});const x=await r.json();renderDrawer(x)}catch(e){}
}
function closeDrawer(){document.getElementById('drawer').classList.remove('open');document.getElementById('backdrop').classList.remove('on')}
document.getElementById('backdrop').onclick=closeDrawer;
function renderDrawer(x){
  const dc=x.direction==='bull'?'var(--bull)':'var(--bear)';
  let h=`<div class="dh"><span class="x" onclick="closeDrawer()">✕</span>
    <div class="tkr" style="color:${dc}">${esc(x.ticker)} ${x.gated?'⚡':''}</div>
    <div class="meta">${x.direction.toUpperCase()} · conviction <b style="color:var(--amber)">${x.conviction}</b> · ${esc(x.sector||'')} · ${x.n_signals} signals${x.delta?` · Δ${x.delta>0?'+':''}${x.delta}`:''}</div>
    <div class="meta">${(x.confirms||[]).length?'✓ '+x.confirms.join(' '):''} ${(x.vetoes||[]).length?'· ✕ '+x.vetoes.join(' '):''}</div></div>`;
  for(const sec of (x.sections||[])){
    const rows=(sec.rows||[]);const cls=rows.length?'dsec':'dsec empty';
    h+=`<div class="${cls}"><h4 style="color:${FAM[sec.tone]||'var(--dim)'}">${esc(sec.title)}</h4>`+
      rows.map(([k,v])=>`<div class="drow"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')+`</div>`;
  }
  document.getElementById('drawer').innerHTML=h;
}
addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer()});

async function poll(){if(!POLL)return;try{const r=await fetch(POLL,{cache:'no-store'});if(r.ok){STATE=await r.json();ingest();render()}}catch(e){}}
resize();ingest();render();requestAnimationFrame(frame);setInterval(tickAge,1000);
if(POLL)setInterval(poll,5000);
</script>
</body>
</html>"""


def render_console(state: dict, poll_url: str | None = None) -> str:
    return (_HTML
            .replace("__STATE__", json.dumps(state))
            .replace("__POLL__", json.dumps(poll_url)))
