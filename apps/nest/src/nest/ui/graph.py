"""NEXUS — the 3D stock galaxy. An orbitable, self-contained (no external libs) 3D
force-directed field: every tracked stock is a glowing node that grows with its conviction,
pulled into sector "islands," connected to its sector hub. Drag to orbit, scroll to zoom.
A side rail shows names whose confluence is rising and the sector heat. Ember terminal
aesthetic. Renders in pure canvas-2D with a hand-rolled 3D projection so it runs anywhere.
"""

from __future__ import annotations

import json

_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NEST · NEXUS</title>
<style>
  :root{
    --ground:#070604; --ink:#f3e7cf; --muted:#9a8a6a; --dim:#5a4f3a; --line:#241d12;
    --amber:#ffc24b; --gold:#ffcf6a; --rust:#ff6b5a; --long:#ffd27a; --panel:rgba(18,14,8,.72);
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;overflow:hidden;background:var(--ground);color:var(--ink);
    font:11.5px/1.45 ui-monospace,"SF Mono",Menlo,Consolas,monospace;-webkit-font-smoothing:antialiased}
  #cv{position:fixed;inset:0;display:block}
  .bar{position:fixed;top:0;left:0;right:0;display:flex;gap:6px 16px;align-items:baseline;
    flex-wrap:wrap;padding:9px 14px;background:linear-gradient(#0a0805,rgba(10,8,5,0));z-index:5}
  .brand{font-weight:700;letter-spacing:.2em}.brand b{color:var(--amber)}
  .tabs{display:flex;gap:3px;margin-left:2px}
  .tab{padding:2px 10px;border:1px solid var(--line);border-radius:6px;color:var(--dim);
    font-size:10px;letter-spacing:.12em;text-decoration:none}
  .tab.on{color:var(--ink);border-color:#3a2f1a;background:#140f08}
  .stat{color:var(--muted);font-size:10px;letter-spacing:.08em;text-transform:uppercase}
  .stat b{color:var(--amber);font-variant-numeric:tabular-nums}
  .stat.push{margin-left:auto}
  .panel{position:fixed;background:var(--panel);border:1px solid var(--line);border-radius:10px;
    padding:10px 12px;backdrop-filter:blur(3px);z-index:5}
  .panel h3{margin:0 0 7px;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}
  #rising{top:52px;right:12px;width:210px;max-height:52vh;overflow:auto}
  #heat{bottom:14px;right:12px;width:210px}
  #legend{bottom:14px;left:12px;width:200px}
  .rrow{display:flex;align-items:center;gap:8px;padding:2.5px 0}
  .rrow .tk{font-weight:600;color:var(--ink);width:52px}
  .rrow .cv{color:var(--muted);font-variant-numeric:tabular-nums;width:30px;text-align:right}
  .rrow .dl{color:var(--amber);font-variant-numeric:tabular-nums;flex:1;text-align:right}
  .rrow .sec{color:var(--dim);font-size:9.5px;width:48px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .hrow{display:flex;align-items:center;gap:7px;padding:2px 0}
  .hrow .nm{flex:1;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .hb{width:52px;height:5px;border-radius:3px;background:#1a140c;overflow:hidden}
  .hb i{display:block;height:100%}
  .leg{display:flex;align-items:center;gap:7px;color:var(--muted);padding:2px 0}
  .dot{width:9px;height:9px;border-radius:50%;box-shadow:0 0 8px currentColor}
  .hint{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);color:var(--dim);
    font-size:10px;letter-spacing:.1em;z-index:5;text-transform:uppercase}
  #tip{position:fixed;pointer-events:none;background:#140f08;border:1px solid #3a2f1a;border-radius:7px;
    padding:6px 9px;z-index:9;display:none;font-size:11px}
  #tip b{color:var(--amber)}
  .live{color:var(--long)}
</style>
</head>
<body>
<canvas id="cv"></canvas>
<div class="bar">
  <span class="brand">NEST <b>×</b> NEXUS</span>
  <div class="tabs"><a class="tab" href="/">FINDS</a><a class="tab on" href="/nexus">NEXUS</a><a class="tab" href="/pipeline">PIPELINE</a><a class="tab" href="/field">FIELD</a></div>
  <span class="stat push">UNIVERSE <b id="s-univ">–</b></span>
  <span class="stat">SHOWN <b id="s-shown">–</b></span>
  <span class="stat">REGIME <b id="s-regime">–</b></span>
  <span class="stat">FLOOR <b id="s-floor">–</b></span>
  <span class="stat live" id="s-upd">LIVE</span>
</div>
<div class="panel" id="rising"><h3>Rising confluence</h3><div id="rising-b"></div></div>
<div class="panel" id="heat"><h3>Sector heat</h3><div id="heat-b"></div></div>
<div class="panel" id="legend"><h3>Legend</h3>
  <div class="leg"><span class="dot" style="color:#ffcf6a"></span>bull · size = conviction</div>
  <div class="leg"><span class="dot" style="color:#ff6b5a"></span>bear</div>
  <div class="leg" style="color:var(--dim)">islands = sectors · lines to sector hub</div>
</div>
<div class="hint">drag to orbit · scroll to zoom · hover a star</div>
<div id="tip"></div>

<script>
let STATE=__STATE__; const POLL=__POLL__;
const cv=document.getElementById('cv'), ctx=cv.getContext('2d');
let W=0,H=0,DPR=Math.min(2,devicePixelRatio||1);
function resize(){W=innerWidth;H=innerHeight;cv.width=W*DPR;cv.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0)}
addEventListener('resize',resize);
const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;

// ---- graph state ----
let N=[];                 // nodes {id,conv,dir,sector,delta, x,y,z, vx,vy,vz, r,g,b}
let centers={};           // sector -> unit-sphere center
let hub={};               // sector -> node id (max conviction)
let rotX=-0.30, rotY=0.6, dist=1.95, targetDist=1.95;
let dragging=false, lastX=0, lastY=0, autov=0.0016;
const WORLD=330, FOCAL=920;

function fib(i,n){ // fibonacci sphere point
  const ga=Math.PI*(3-Math.sqrt(5)); const y=1-(i/(Math.max(1,n-1)))*2; const r=Math.sqrt(Math.max(0,1-y*y));
  const th=ga*i; return [Math.cos(th)*r, y, Math.sin(th)*r];
}
function colorFor(n){ // bull gold, bear rust; brighter with conviction
  const t=Math.min(1,n.conv/85);
  if(n.dir==='bull') return [255, 190+40*t|0, 80+70*t|0];
  return [255, 90+30*t|0, 70+20*t|0];
}
function ingest(){
  const prev={}; N.forEach(n=>prev[n.id]=n);
  const secs=(STATE.sectors||[]); centers={};
  secs.forEach((s,i)=>{const p=fib(i,secs.length); centers[s]=[p[0],p[1],p[2]]});
  // sector hubs
  hub={}; const best={};
  (STATE.nodes||[]).forEach(n=>{if(!(n.sector in best)||n.conv>best[n.sector]){best[n.sector]=n.conv;hub[n.sector]=n.id}});
  N=(STATE.nodes||[]).map(nd=>{
    const c=centers[nd.sector]||[0,0,0]; const p=prev[nd.id];
    const col=colorFor(nd);
    return {...nd,
      x:p?p.x:c[0]+(Math.random()-.5)*.4, y:p?p.y:c[1]+(Math.random()-.5)*.4,
      z:p?p.z:c[2]+(Math.random()-.5)*.4, vx:p?p.vx:0, vy:p?p.vy:0, vz:p?p.vz:0,
      r:col[0],g:col[1],b:col[2]};
  });
}
function step(){ // one light force iteration (clusters into sector islands)
  const KspringC=0.010, Kgrav=0.0016, Krep=0.00055, damp=0.86;
  for(const n of N){
    const c=centers[n.sector]||[0,0,0];
    let fx=(c[0]*1.15-n.x)*KspringC, fy=(c[1]*1.15-n.y)*KspringC, fz=(c[2]*1.15-n.z)*KspringC;
    fx-=n.x*Kgrav; fy-=n.y*Kgrav; fz-=n.z*Kgrav;
    n._fx=fx; n._fy=fy; n._fz=fz;
  }
  for(let i=0;i<N.length;i++){const a=N[i];
    for(let j=i+1;j<N.length;j++){const b=N[j];
      let dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z; let d2=dx*dx+dy*dy+dz*dz+0.02; const inv=Krep/d2;
      const f=inv; dx*=f;dy*=f;dz*=f; a._fx+=dx;a._fy+=dy;a._fz+=dz; b._fx-=dx;b._fy-=dy;b._fz-=dz;
    }}
  for(const n of N){ n.vx=(n.vx+n._fx)*damp; n.vy=(n.vy+n._fy)*damp; n.vz=(n.vz+n._fz)*damp;
    n.x+=n.vx; n.y+=n.vy; n.z+=n.vz; }
  // keep the cloud centered: lock its centroid to the origin so it never drifts off-screen
  if(N.length){let cx=0,cy=0,cz=0; for(const n of N){cx+=n.x;cy+=n.y;cz+=n.z}
    cx/=N.length;cy/=N.length;cz/=N.length;
    for(const n of N){n.x-=cx;n.y-=cy;n.z-=cz}}
}
function project(n){
  const cy=Math.cos(rotY),sy=Math.sin(rotY),cx=Math.cos(rotX),sx=Math.sin(rotX);
  let x=n.x*cy - n.z*sy, z=n.x*sy + n.z*cy, y=n.y;
  let y2=y*cx - z*sx, z2=y*sx + z*cx;
  const scale=FOCAL/(FOCAL + (z2+dist)*WORLD);
  return {sx:W/2 + x*scale*WORLD, sy:H/2 + y2*scale*WORLD, scale, z:z2};
}
let hover=null;
function frame(){
  if(!reduce) step();
  if(!dragging) rotY+=autov;
  dist += (targetDist-dist)*0.1;
  ctx.clearRect(0,0,W,H);
  // faint core glow
  const g=ctx.createRadialGradient(W/2,H/2,20,W/2,H/2,Math.min(W,H)*0.6);
  g.addColorStop(0,'rgba(120,80,20,0.05)');g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  const P={}; for(const n of N) P[n.id]=project(n);
  // edges: node -> sector hub
  ctx.lineWidth=1;
  for(const n of N){const h=hub[n.sector]; if(!h||h===n.id)continue; const a=P[n.id],b=P[h];
    const al=0.05+0.06*Math.min(1,n.conv/80);
    ctx.strokeStyle='rgba(255,190,90,'+al*a.scale+')';
    ctx.beginPath();ctx.moveTo(a.sx,a.sy);ctx.lineTo(b.sx,b.sy);ctx.stroke();}
  // nodes back-to-front
  const order=N.map((n,i)=>[i,P[n.id].z]).sort((p,q)=>q[1]-p[1]);
  for(const [i] of order){const n=N[i], p=P[n.id];
    const rad=(2.6+n.conv*0.11)*p.scale; if(rad<0.4)continue;
    const bright=0.35+0.65*Math.min(1,n.conv/85);
    const col=`rgba(${n.r},${n.g},${n.b},`;
    const gl=ctx.createRadialGradient(p.sx,p.sy,0.5,p.sx,p.sy,rad*3.2);
    gl.addColorStop(0,col+(0.9*bright)+')'); gl.addColorStop(0.4,col+(0.28*bright)+')'); gl.addColorStop(1,col+'0)');
    ctx.fillStyle=gl;ctx.beginPath();ctx.arc(p.sx,p.sy,rad*3.2,0,6.283);ctx.fill();
    ctx.fillStyle=col+bright+')';ctx.beginPath();ctx.arc(p.sx,p.sy,rad,0,6.283);ctx.fill();
    if(n===hover){ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.sx,p.sy,rad+4,0,6.283);ctx.stroke();}
    if(n.conv>=40 || n===hover){ctx.fillStyle='rgba(243,231,207,'+Math.min(1,bright+0.2)+')';
      ctx.font=(9+Math.min(4,n.conv/25))+'px ui-monospace,monospace';ctx.textAlign='center';
      ctx.fillText(n.id,p.sx,p.sy-rad-3);}
  }
  requestAnimationFrame(frame);
}
// interaction
cv.addEventListener('mousedown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY});
addEventListener('mouseup',()=>dragging=false);
addEventListener('mousemove',e=>{
  if(dragging){rotY+=(e.clientX-lastX)*0.005;rotX+=(e.clientY-lastY)*0.005;
    rotX=Math.max(-1.4,Math.min(1.4,rotX));lastX=e.clientX;lastY=e.clientY;return}
  // hover pick
  let best=null,bd=1e9; for(const n of N){const p=project(n);const dx=p.sx-e.clientX,dy=p.sy-e.clientY;
    const d=dx*dx+dy*dy;const rad=(2.6+n.conv*0.11)*p.scale+6; if(d<rad*rad&&d<bd){bd=d;best=n}}
  hover=best; const tip=document.getElementById('tip');
  if(best){tip.style.display='block';tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY+12)+'px';
    tip.innerHTML=`<b>${best.id}</b> · ${best.dir} · conv ${best.conv}<br><span style="color:#9a8a6a">${best.sector} · Δ${best.delta>=0?'+':''}${best.delta} · ${best.fam} families</span>`;}
  else tip.style.display='none';
});
cv.addEventListener('wheel',e=>{e.preventDefault();targetDist=Math.max(0.9,Math.min(5,targetDist+e.deltaY*0.0016))},{passive:false});
// touch
let pinch=0;
cv.addEventListener('touchstart',e=>{if(e.touches.length===1){dragging=true;lastX=e.touches[0].clientX;lastY=e.touches[0].clientY}
  else if(e.touches.length===2){pinch=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY)}},{passive:true});
cv.addEventListener('touchmove',e=>{if(e.touches.length===1&&dragging){const t=e.touches[0];
    rotY+=(t.clientX-lastX)*0.006;rotX+=(t.clientY-lastY)*0.006;rotX=Math.max(-1.4,Math.min(1.4,rotX));lastX=t.clientX;lastY=t.clientY}
  else if(e.touches.length===2){const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    if(pinch)targetDist=Math.max(0.9,Math.min(5,targetDist*(pinch/d)));pinch=d}},{passive:true});
cv.addEventListener('touchend',()=>{dragging=false;pinch=0});

function panels(){
  const s=STATE;
  document.getElementById('s-univ').textContent=s.universe;
  document.getElementById('s-shown').textContent=s.shown;
  document.getElementById('s-regime').textContent=(s.regime||'neutral').toUpperCase();
  document.getElementById('s-floor').textContent=Math.round(s.floor||70);
  document.getElementById('rising-b').innerHTML=(s.rising||[]).map(n=>
    `<div class="rrow"><span class="tk">${n.id}</span><span class="cv">${n.conv|0}</span>
     <span class="sec">${(n.sector||'').slice(0,7)}</span><span class="dl">▲${n.delta}</span></div>`).join('')
     ||'<div style="color:var(--dim)">— steady —</div>';
  document.getElementById('heat-b').innerHTML=(s.sector_heat||[]).slice(0,7).map(([nm,b])=>{
    const col=b>0.55?'#ffcf6a':b<0.45?'#ff6b5a':'#9a8a6a';
    return `<div class="hrow"><span class="nm">${nm}</span><span class="hb"><i style="width:${Math.round(b*100)}%;background:${col}"></i></span></div>`;
  }).join('')||'<div style="color:var(--dim)">—</div>';
}
async function poll(){if(!POLL)return;try{const r=await fetch(POLL,{cache:'no-store'});
  if(r.ok){STATE=await r.json();ingest();panels()}}catch(e){}}
resize();ingest();panels();requestAnimationFrame(frame);
if(POLL)setInterval(poll,5000);
</script>
</body>
</html>"""


def render_graph(state: dict, poll_url: str | None = None) -> str:
    return (_HTML
            .replace("__STATE__", json.dumps(state))
            .replace("__POLL__", json.dumps(poll_url)))
