#!/usr/bin/env python3
import json, os, glob, math
from datetime import datetime
from zoneinfo import ZoneInfo
ET=ZoneInfo('America/New_York'); DATA=os.path.expanduser('~/gex-data-replay-reader/data'); HERE=os.path.dirname(os.path.abspath(__file__))
def emin(ts): d=datetime.fromisoformat(ts.replace('Z','+00:00')).astimezone(ET); return d.hour*60+d.minute
ev=[]
for f in sorted(glob.glob(os.path.join(DATA,'gex-replay-*.json'))):
    day=os.path.basename(f)[11:21]; j=json.load(open(f))
    for T in ['SPXW','SPY','QQQ']:
        ser=[]
        for fr in j['frames']:
            x=fr.get('tickers',{}).get(T)
            if not x or not x.get('strikes'): continue
            m=emin(fr['timestamp'])
            if not 570<=m<=959: continue
            s=float(x['spotPrice']); near={float(k):sum(v or 0 for v in r) for k,r in zip(x['strikes'],x['gammaValues']) if abs(float(k)/s-1)<=0.02}
            if near: ser.append((m,s,max(near.items(),key=lambda kv:abs(kv[1]))[0]))
        if len(ser)<300: continue
        for snap in range(600,841,30):
            cur=[r for r in ser if r[0]<=snap]
            if not cur: continue
            m,s,K=cur[-1]; d=abs(K-s)/s
            if not 0.003<=d<=0.015: continue
            win=[r for r in ser if snap-60<=r[0]<snap]
            if len(win)<40 or sum(1 for r in win if r[2]==K)/len(win)<0.5: continue
            M=s-(K-s); later=[r for r in ser if snap<r[0]<=959]
            def touched(L):
                side=1 if L>s else -1
                for r in later:
                    if side*(r[1]-L)>=-0.0002*L: return r[0]
                return None
            ev.append(dict(d=day,T=T,snap=snap,spot=s,K=K,dist=d,up=K>s,tK=touched(K),tM=touched(M))); break
json.dump(ev,open(os.path.join(HERE,'results_kingfly','king_target_events.json'),'w'))
def stat(rows,f):
    v=[f(r) for r in rows]; m=sum(v)/len(v); by={}
    for r,x in zip(rows,v): by.setdefault(r['d'],[]).append(x-m)
    G=len(by); se=math.sqrt(sum(sum(a)**2 for a in by.values())*G/max(1,G-1))/len(v); return m, m/se if se else float('nan'), len(v)
Phi=lambda x:0.5*(1+math.erf(x/math.sqrt(2)))
for name,lo,hi in [('build Dec–Feb','0','2026-02-27'),('holdout Mar–May','2026-03-02','9')]:
    R=[r for r in ev if lo<=r['d']<=hi]
    if not R: continue
    pk=stat(R,lambda r:1.0 if r['tK'] else 0.0); pm=stat(R,lambda r:1.0 if r['tM'] else 0.0); df=stat(R,lambda r:(1.0 if r['tK'] else 0.0)-(1.0 if r['tM'] else 0.0)); k2=stat(R,lambda r:(1.0 if r['tK'] else 0.0)-0.5)
    print(f"{name}: {len(R)} events | reached the persistent king {pk[0]:.0%} vs mirror level {pm[0]:.0%} | K1 diff {df[0]:+.0%} t {df[1]:.2f} p {1-Phi(df[1]):.3f} | K2 vs 50% t {k2[1]:.2f} p {1-Phi(k2[1]):.3f}")
    for T in ['SPXW','SPY','QQQ']:
        RT=[r for r in R if r['T']==T]
        if RT: print(f"   {T}: {len(RT)} events, king {sum(1 for r in RT if r['tK'])/len(RT):.0%} vs mirror {sum(1 for r in RT if r['tM'])/len(RT):.0%}")
# N — pinned breaks
D=json.load(open(os.path.join(HERE,'replay','skylit_all.json')))
br=[]
for s in D['sessions']:
    for x in s['breaks']:
        mp=None
        for q in s['maps']:
            if q[0]<=x['m']: mp=q
            else: break
        kn=next((n for n in mp[2] if n[0]==mp[1]),None) if mp else None
        pinned=bool(kn and kn[1]>0 and abs(mp[1]/x['entry']-1)<=0.0015)
        br.append(dict(d=s['d'],R=x['R'],opt=(x['opt'] or {}).get('pct'),pinned=pinned))
for name,lo,hi in [('build Dec–Feb','0','2026-02-27'),('holdout March','2026-03-02','9')]:
    B=[b for b in br if lo<=b['d']<=hi]; P=[b for b in B if b['pinned']]; N=[b for b in B if not b['pinned']]
    if not P or not N: print(name,'pinned',len(P),'not pinned',len(N)); continue
    mp_=sum(b['R'] for b in P)/len(P); mn=sum(b['R'] for b in N)/len(N)
    vp=sum((b['R']-mp_)**2 for b in P)/max(1,len(P)-1); vn=sum((b['R']-mn)**2 for b in N)/max(1,len(N)-1); t=(mn-mp_)/math.sqrt(vp/len(P)+vn/len(N))
    op=[b['opt'] for b in P if b['opt'] is not None]; on=[b['opt'] for b in N if b['opt'] is not None]
    print(f"N1 {name}: pinned breaks {len(P)} mean {mp_:+.2f}R (options {sum(op)/len(op):+.0f}%) | not pinned {len(N)} mean {mn:+.2f}R (options {sum(on)/len(on):+.0f}%) | diff t {t:.2f} p {1-Phi(t):.3f}")
