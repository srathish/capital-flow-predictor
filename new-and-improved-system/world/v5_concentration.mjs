import fs from 'fs';
const R=JSON.parse(fs.readFileSync('world/results_v5/wide_holdout.json'));
const addD=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
const P=new Map(); const ld=t=>{if(!P.has(t)){const b=JSON.parse(fs.readFileSync('.cache/wdaily/'+t+'.json'));P.set(t,b)}return P.get(t)};
const at=(b,d)=>{let r=-1;for(let i=0;i<b.length;i++){if(b[i].d<=d)r=i;else break}return r};
const fwd=(t,d)=>{const b=ld(t),j=at(b,d)+1,k=at(b,addD(d,182));return j>0&&j<b.length&&k>j&&b[k].d>=addD(d,172)?b[k].c/b[j].c-1:null};
const all=[];let hit=0,tot=0;
for(const r of R){const xs=r.picksA.map(p=>({t:p.t,mo:r.mo,f:fwd(p.t,r.M)})).filter(x=>x.f!=null);
 // implied median = mean(picks) - A excess
 const m=xs.reduce((s,x)=>s+x.f,0)/xs.length-r.A; for(const x of xs){x.ex=x.f-m;all.push(x);tot++;if(x.ex>0)hit++}}
const ex=all.map(x=>x.ex).sort((a,b)=>a-b),mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
console.log('pick-months',tot,'beat median',(hit/tot*100).toFixed(0)+'%','mean',(mean(ex)*100).toFixed(1)+'%','median pick',(ex[ex.length>>1]*100).toFixed(1)+'%');
const byT=new Map();for(const x of all)byT.set(x.t,(byT.get(x.t)??0)+x.ex);const top=[...byT].sort((a,b)=>b[1]-a[1]);
const S=all.reduce((s,x)=>s+x.ex,0);console.log('distinct names',byT.size,'top5 names share of total excess',(top.slice(0,5).reduce((s,x)=>s+x[1],0)/S*100).toFixed(0)+'%',top.slice(0,8).map(x=>x[0]+' '+(x[1]*100).toFixed(0)).join(' '));
const drop=new Set(top.slice(0,5).map(x=>x[0]));console.log('mean excess without top-5 names',(mean(all.filter(x=>!drop.has(x.t)).map(x=>x.ex))*100).toFixed(1)+'%');
