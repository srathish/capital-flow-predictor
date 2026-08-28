"""The pipeline view — the Nest rendered as a medallion data-pipeline DAG
(SOURCES → BRONZE → SILVER → GOLD → MARTS) with flowing edges, per-node health, a live node
inspector, and a self-recovering orchestrator log. render_pipeline(state, poll_url) bakes the
state in and (when poll_url is set) refreshes from /api/pipeline.
"""

from __future__ import annotations

import json

_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NEST · PIPELINE</title>
<style>
  :root{
    --ground:#07080c; --panel:#0d1017; --panel2:#0a0c12; --line:#1b2130; --line2:#141926;
    --ink:#e7ebf2; --muted:#78839a; --dim:#454f63;
    --ok:#31d0aa; --idle:#3a4256; --warn:#ffb454; --bad:#ff5f6d; --accent:#31d0aa;
    --flow:#35d0d0; --levels:#9b8cff; --positioning:#ffb454; --filings:#6ec97a;
    --social:#ff77c8; --macro:#ff6b6b; --chart:#5b9dff; --fundamental:#4fd1a1; --catalyst:#ffd166;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;overflow:hidden}
  body{background:var(--ground);color:var(--ink);
    font:12px/1.45 ui-monospace,"SF Mono",Menlo,Consolas,monospace;-webkit-font-smoothing:antialiased}
  .app{display:grid;grid-template-rows:auto 1fr auto;height:100vh}
  /* status bar */
  .statusbar{display:flex;align-items:center;gap:6px 16px;flex-wrap:wrap;
    padding:8px 14px;border-bottom:1px solid var(--line);background:var(--panel)}
  .brand{font-weight:600;letter-spacing:.16em}
  .brand b{color:var(--accent)}
  .tabs{display:flex;gap:2px;margin-left:6px}
  .tab{padding:3px 10px;border:1px solid var(--line);border-radius:6px;color:var(--dim);
    font-size:10.5px;letter-spacing:.1em;text-decoration:none}
  .tab.on{color:var(--ink);border-color:#243247;background:#111726}
  .sb-item{color:var(--muted);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase}
  .sb-item b{color:var(--ink);font-variant-numeric:tabular-nums}
  .live{display:inline-flex;align-items:center;gap:6px;color:var(--ok)}
  .live::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ok);
    box-shadow:0 0 8px var(--ok);animation:blink 1.6s infinite}
  @keyframes blink{50%{opacity:.35}}
  .sb-item.pushed{margin-left:auto}
  /* main */
  .main{display:grid;grid-template-columns:170px 1fr 300px;min-height:0}
  .rail,.inspector{background:var(--panel2);overflow:auto}
  .rail{border-right:1px solid var(--line);padding:12px}
  .inspector{border-left:1px solid var(--line);padding:12px}
  .rail h3,.inspector h3{margin:0 0 8px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
  .rail .block{margin-bottom:16px}
  .hpair{display:flex;justify-content:space-between;padding:3px 0;color:var(--muted)}
  .hpair b{color:var(--ink);font-variant-numeric:tabular-nums}
  .legend .row{display:flex;align-items:center;gap:7px;padding:2px 0;color:var(--muted);font-size:11px}
  .swatch{width:8px;height:8px;border-radius:2px;box-shadow:0 0 6px currentColor}
  .btn{width:100%;padding:6px;margin-top:4px;background:#111726;border:1px solid var(--line);
    color:var(--muted);border-radius:6px;font:inherit;font-size:10.5px;letter-spacing:.1em;cursor:default}
  canvas{display:block;width:100%;height:100%}
  .canvas-wrap{position:relative;min-height:0}
  /* inspector */
  .insp-title{font-size:13px;font-weight:600;letter-spacing:.04em}
  .insp-sub{color:var(--dim);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px}
  .metric{display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--line2)}
  .metric span:first-child{color:var(--muted)}
  .metric b{font-variant-numeric:tabular-nums}
  .status-ok{color:var(--ok)} .status-idle{color:var(--dim)} .status-degraded{color:var(--warn)}
  .insp-note{margin-top:10px;color:var(--dim);font-size:11px;line-height:1.5}
  /* orchestrator log */
  .log{border-top:1px solid var(--line);background:var(--panel);height:172px;overflow:auto;padding:8px 14px}
  .log h3{margin:0 0 6px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);
    position:sticky;top:0;background:var(--panel)}
  .logline{display:flex;gap:12px;padding:2px 0;font-variant-numeric:tabular-nums;white-space:nowrap}
  .logline .t{color:var(--dim)}
  .l-info{color:var(--muted)} .l-good{color:var(--ok)} .l-warn{color:var(--warn)} .l-bad{color:var(--bad)}
  @media(max-width:900px){.main{grid-template-columns:1fr}.rail,.inspector{display:none}}
</style>
</head>
<body>
<div class="app">
  <div class="statusbar">
    <span class="brand">NEST <b>·</b> PIPELINE</span>
    <div class="tabs"><a class="tab on" href="/">PIPELINE</a><a class="tab" href="/field">FIELD</a></div>
    <span class="sb-item pushed live">STREAM LIVE</span>
    <span class="sb-item">NODES <b id="s-nodes">–</b></span>
    <span class="sb-item">WAVE <b id="s-wave">–</b></span>
    <span class="sb-item">THROUGHPUT <b id="s-tput">–</b>/cy</span>
    <span class="sb-item">FLOOR <b id="s-floor">–</b></span>
    <span class="sb-item">REGIME <b id="s-regime">–</b></span>
    <span class="sb-item">LLM <b>$0/d</b></span>
  </div>

  <div class="main">
    <div class="rail">
      <div class="block"><h3>Health</h3>
        <div class="hpair">healthy <b id="h-ok">–</b></div>
        <div class="hpair">idle <b id="h-idle">–</b></div>
        <div class="hpair">degraded <b id="h-deg" class="status-degraded">–</b></div>
      </div>
      <div class="block"><h3>Cadence</h3>
        <div class="hpair">cycle <b>5 min</b></div>
        <div class="hpair">gate floor <b id="h-floor">70</b></div>
        <div class="hpair">alert budget <b id="h-budget">0/3</b></div>
      </div>
      <div class="block legend"><h3>Families</h3><div id="legend"></div></div>
      <div class="block"><h3>Recovery</h3>
        <button class="btn">PER-SOURCE ISOLATION</button>
        <button class="btn">BOOT CYCLE ON DEPLOY</button>
        <button class="btn">GRADE BACKFILL 1/5/20d</button>
      </div>
    </div>

    <div class="canvas-wrap"><canvas id="dag"></canvas></div>

    <div class="inspector" id="inspector">
      <div class="insp-sub">NODE INSPECTOR</div>
      <div class="insp-title" id="i-title">— click a node —</div>
      <div class="insp-sub" id="i-family"></div>
      <div id="i-metrics"></div>
      <div class="insp-note" id="i-note">Each node is a stage in the medallion pipeline. Click a
        source to see its live rate, tracked weight, and hit rate. A source that decays to zero
        weight is the tracker working — a feed that doesn't pay costs nothing.</div>
    </div>
  </div>

  <div class="log"><h3>Orchestrator log — failures isolate, retry, then backfill</h3>
    <div id="loglines"></div></div>
</div>

<script>
const FAM={flow:'#35d0d0',levels:'#9b8cff',positioning:'#ffb454',filings:'#6ec97a',
  social:'#ff77c8',macro:'#ff6b6b',chart:'#5b9dff',fundamental:'#4fd1a1',catalyst:'#ffd166'};
const COL={ok:'#31d0aa',idle:'#3a4256',degraded:'#ffb454'};
let STATE=__STATE__; const POLL=__POLL__;
function esc(s){return String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}

const cv=document.getElementById('dag'), ctx=cv.getContext('2d');
let W=0,H=0,DPR=Math.min(2,devicePixelRatio||1),NODES=[],EDGES=[],hover=null,pinned=null;
const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;

function resize(){const r=cv.parentElement.getBoundingClientRect();W=r.width;H=r.height;
  cv.width=W*DPR;cv.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0);layout()}
addEventListener('resize',resize);

function layout(){
  const s=STATE; NODES=[]; EDGES=[];
  const colX=[0.09,0.33,0.55,0.73,0.91].map(f=>f*W);
  const pad=46, top=pad, bot=H-pad, span=bot-top;
  function place(list,cx,key){
    const n=list.length;
    list.forEach((d,i)=>{
      const y=n===1?H/2:top+span*(i/(n-1||1));
      NODES.push({...d,x:cx,y,col:key,r:key==='sources'?4.5:7});
    });
  }
  place(s.sources||[],colX[0],'sources');
  place(s.bronze||[],colX[1],'bronze');
  place(s.silver||[],colX[2],'silver');
  place(s.gold||[],colX[3],'gold');
  place(s.marts||[],colX[4],'marts');
  const byId=id=>NODES.find(n=>n.id===id);
  // edges: source -> bronze(family) -> accumulate -> gate -> synthesis -> calls; +book/alerts/calib
  (s.sources||[]).forEach(src=>{const b=byId('bronze:'+src.family); if(b)EDGES.push([byId(src.id),b,src.rate])});
  (s.bronze||[]).forEach(b=>EDGES.push([byId(b.id),byId('accumulate'),b.rate]));
  EDGES.push([byId('accumulate'),byId('gate'),STATE.sources?.length||0]);
  EDGES.push([byId('gate'),byId('synthesis'),(byId('gate')||{}).rate||0]);
  EDGES.push([byId('synthesis'),byId('calls'),(byId('synthesis')||{}).rate||0]);
  EDGES.push([byId('accumulate'),byId('book'),8]);
  EDGES.push([byId('gate'),byId('calibration'),3]);
  EDGES.push([byId('calls'),byId('alerts'),(byId('calls')||{}).rate||0]);
  EDGES=EDGES.filter(e=>e[0]&&e[1]);
  drawColumnLabels();
}
let LABELS=[];
function drawColumnLabels(){
  const s=STATE; LABELS=(s.stages||[]).map((st,i)=>({label:st.label,x:[0.09,0.33,0.55,0.73,0.91][i]*W}));
}
function fam(n){return FAM[n.family]||'#8892a6'}
function bez(a,b,t){ // point on horizontal bezier
  const mx=(a.x+b.x)/2;
  const x=(1-t)**3*a.x+3*(1-t)**2*t*mx+3*(1-t)*t*t*mx+t**3*b.x;
  const y=(1-t)**3*a.y+3*(1-t)**2*t*a.y+3*(1-t)*t*t*b.y+t**3*b.y;
  return {x,y};
}
let tphase=0;
function frame(t){
  ctx.clearRect(0,0,W,H);
  // column labels
  ctx.font='10px ui-monospace,monospace';ctx.textAlign='left';
  LABELS.forEach(l=>{ctx.fillStyle='#3a4256';ctx.fillText(l.label.toUpperCase(),l.x-18,22)});
  // edges
  if(!reduce)tphase=(tphase+0.006)%1;
  EDGES.forEach(([a,b,rate])=>{
    const mx=(a.x+b.x)/2;
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.bezierCurveTo(mx,a.y,mx,b.y,b.x,b.y);
    const active=(a.status==='ok'||a.status===undefined)&&rate>0;
    ctx.strokeStyle=active?'rgba(49,208,170,0.18)':'rgba(120,131,154,0.07)';
    ctx.lineWidth=1;ctx.stroke();
    if(active&&!reduce){ // flow particles
      const k=Math.min(3,1+Math.floor((rate||0)/20));
      for(let j=0;j<k;j++){
        const tt=(tphase+j/k)%1; const p=bez(a,b,tt);
        ctx.fillStyle='rgba(120,230,200,'+(0.9*(1-Math.abs(0.5-tt)*2)+0.1)+')';
        ctx.beginPath();ctx.arc(p.x,p.y,1.5,0,6.28);ctx.fill();
      }
    }
  });
  // nodes
  NODES.forEach(n=>{
    const c=fam(n), st=n.status||'ok';
    const ring=COL[st]||COL.ok;
    if(st==='ok'){ctx.shadowColor=c;ctx.shadowBlur=10}else{ctx.shadowBlur=0}
    ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,6.28);
    ctx.fillStyle=st==='idle'?'#161c28':c;ctx.fill();ctx.shadowBlur=0;
    ctx.lineWidth=1.4;ctx.strokeStyle=ring;
    if(st==='degraded'){ctx.setLineDash([2,2])}ctx.stroke();ctx.setLineDash([]);
    if(n===hover||n===pinned){ctx.beginPath();ctx.arc(n.x,n.y,n.r+4,0,6.28);
      ctx.strokeStyle=ring;ctx.globalAlpha=0.5;ctx.stroke();ctx.globalAlpha=1}
    // labels: sources to the left, others to the right; skip tiny source labels unless hover
    if(n.col!=='sources'||n===hover){
      ctx.font=(n.col==='sources'?'9px':'10px')+' ui-monospace,monospace';
      ctx.fillStyle=st==='idle'?'#454f63':'#c3ccdb';
      if(n.col==='sources'){ctx.textAlign='right';ctx.fillText(n.label,n.x-8,n.y+3)}
      else{ctx.textAlign='left';ctx.fillText(n.label+(n.rate?('  '+n.rate):''),n.x+11,n.y+3)}
    }
  });
  requestAnimationFrame(frame);
}
function nodeAt(mx,my){let best=null,bd=1e9;NODES.forEach(n=>{const d=(n.x-mx)**2+(n.y-my)**2;
  if(d<bd&&d<220){bd=d;best=n}});return best}
cv.addEventListener('mousemove',e=>{const r=cv.getBoundingClientRect();hover=nodeAt(e.clientX-r.left,e.clientY-r.top);
  cv.style.cursor=hover?'pointer':'default'});
cv.addEventListener('click',e=>{const r=cv.getBoundingClientRect();const n=nodeAt(e.clientX-r.left,e.clientY-r.top);
  if(n){pinned=n;showInspector(n)}});

function showInspector(n){
  document.getElementById('i-title').textContent=n.label;
  document.getElementById('i-family').innerHTML='<span class="swatch" style="color:'+fam(n)+
    ';display:inline-block;margin-right:6px"></span>'+n.col.toUpperCase()+' · '+(n.family||'');
  const m=[['status','<span class="status-'+(n.status||'ok')+'">'+(n.status||'ok').toUpperCase()+'</span>'],
    ['rate / cycle',n.rate??'—']];
  if(n.weight!==undefined)m.push(['tracked weight',n.weight]);
  if(n.hit_rate!==undefined&&n.hit_rate!==null)m.push(['5d hit rate',(n.hit_rate*100|0)+'% (n='+n.n+')']);
  else if(n.n!==undefined)m.push(['graded calls',n.n]);
  document.getElementById('i-metrics').innerHTML=m.map(([k,v])=>
    '<div class="metric"><span>'+k+'</span><b>'+v+'</b></div>').join('');
  document.getElementById('i-note').textContent=n.detail||
    (n.col==='sources'?'Raw observations from this source, normalized into Signal events. Its weight is earned from its graded record.':'');
}

function render(){
  const s=STATE;
  document.getElementById('s-nodes').textContent=s.nodes_healthy+'/'+s.nodes_total+' HEALTHY';
  document.getElementById('s-wave').textContent='#'+s.wave;
  document.getElementById('s-tput').textContent=s.throughput;
  document.getElementById('s-floor').textContent=Math.round(s.floor);
  document.getElementById('s-regime').textContent=(s.regime_tone||'neutral').toUpperCase();
  const ok=(s.sources||[]).filter(x=>x.status==='ok').length;
  const idle=(s.sources||[]).filter(x=>x.status==='idle').length;
  const deg=(s.sources||[]).filter(x=>x.status==='degraded').length;
  document.getElementById('h-ok').textContent=ok;
  document.getElementById('h-idle').textContent=idle;
  document.getElementById('h-deg').textContent=deg;
  document.getElementById('h-floor').textContent=Math.round(s.floor);
  const cy=(s.marts||[]).find(x=>x.id==='calls');
  document.getElementById('h-budget').textContent=(cy?cy.rate:0)+'/3';
  document.getElementById('legend').innerHTML=Object.entries(FAM).map(([k,v])=>
    '<div class="row"><span class="swatch" style="color:'+v+'"></span>'+k+'</div>').join('');
  document.getElementById('loglines').innerHTML=(s.log||[]).map(l=>
    '<div class="logline"><span class="t">'+esc((l.ts||'').slice(11,19))+'</span><span class="l-'+
    l.level+'">'+esc(l.msg)+'</span></div>').join('')||'<div class="logline l-info">awaiting first cycle…</div>';
  layout();
  if(pinned){const f=NODES.find(n=>n.id===pinned.id); if(f){pinned=f;showInspector(f)}}
}
async function poll(){if(!POLL)return;try{const r=await fetch(POLL,{cache:'no-store'});
  if(r.ok){STATE=await r.json();render()}}catch(e){}}
resize();render();requestAnimationFrame(frame);
if(POLL)setInterval(poll,4000);
</script>
</body>
</html>"""


def render_pipeline(state: dict, poll_url: str | None = None) -> str:
    return (_HTML
            .replace("__STATE__", json.dumps(state))
            .replace("__POLL__", json.dumps(poll_url)))
