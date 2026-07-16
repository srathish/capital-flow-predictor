"""Build events + features. Writes events.json (all episodes w/ features + outcomes)."""
import json, math, random
import nv_lib as L

random.seed(42)
BAND = 0.002          # 0.2% node proximity
WIN  = 15             # velocity window (minutes)
FWD  = [5,15,30]      # forward drift horizons
PIVOT_PCTS = [0.0015, 0.0025]
GAP = 2               # episode merge gap

DAYS = [d for d,n in L.usable_days() if n>=250]

# ---- load all days ----
DAY = {d: L.load_day(d) for d in DAYS}

# ---- pooled ATM gamma shape vs |dist| in bps ----
BINW=10; NB=40  # 0..400 bps
sh_sum=[0.0]*NB; sh_cnt=[0]*NB
gh_sum=[0.0]*NB; gh_cnt=[0]*NB  # additive absolute mean
for d in DAYS:
    for mi,r in DAY[d].items():
        spot=r["spot"]
        for st,g in r["g"].items():
            if g<=0: continue
            db=abs(st-spot)/spot*1e4
            b=int(db//BINW)
            if b>=NB: continue
            sh_sum[b]+=g; sh_cnt[b]+=1
            gh_sum[b]+=g; gh_cnt[b]+=1
shape=[(sh_sum[b]/sh_cnt[b]) if sh_cnt[b] else 0.0 for b in range(NB)]
norm=shape[0] if shape[0] else 1.0
shape=[s/norm for s in shape]        # normalized, 1.0 at ATM
ghat=[(gh_sum[b]/gh_cnt[b]) if gh_cnt[b] else 0.0 for b in range(NB)]

def shp(db):
    b=int(db//BINW)
    if b>=NB: b=NB-1
    return shape[b] if shape[b]>0 else 1e-9
def gh(db):
    b=int(db//BINW)
    if b>=NB: b=NB-1
    return ghat[b]

def near_rec(day, target):
    """nearest present minute within +/-2 of target midx"""
    if target in day: return day[target]
    for dd in (1,-1,2,-2):
        if target+dd in day: return day[target+dd]
    return None

def feat_for(day, mi, spot, node, side):
    """compute velocity features for node strike over [mi-WIN, mi]. returns dict or None"""
    cur=day.get(mi); prev=near_rec(day, mi-WIN)
    if cur is None or prev is None: return None
    if node not in cur["g"] or node not in prev["g"]: return None
    g_now=cur["g"][node]; g_prev=prev["g"][node]
    v_now=cur["v"][node]; v_prev=prev["v"][node]
    sp_now=cur["spot"]; sp_prev=prev["spot"]
    d_now=abs(node-sp_now)/sp_now*1e4; d_prev=abs(node-sp_prev)/sp_prev*1e4
    raw_gvel=g_now-g_prev
    # multiplicative expected-from-approach residual
    if g_prev>0:
        exp_now=g_prev*shp(d_now)/shp(d_prev)
    else:
        exp_now=g_prev
    resid_gvel=g_now-exp_now
    # additive regression residual (cross-check)
    resid_add=raw_gvel-(gh(d_now)-gh(d_prev))
    vanna_vel=v_now-v_prev
    # supportive sign: floor->+, ceil->-
    supp = 1.0 if side=='floor' else -1.0
    supp_vanna_vel = supp*vanna_vel
    # flip toward support: crossing zero in supportive direction
    if side=='floor':
        flip = 1 if (v_prev<0 and v_now>0) else 0
    else:
        flip = 1 if (v_prev>0 and v_now<0) else 0
    return dict(g_now=g_now,g_prev=g_prev,raw_gvel=raw_gvel,resid_gvel=resid_gvel,
                resid_add=resid_add,vanna_vel=vanna_vel,supp_vanna_vel=supp_vanna_vel,
                flip=flip,d_now=d_now,v_now=v_now,v_prev=v_prev)

def build(pct):
    events=[]
    for d in DAYS:
        day=DAY[d]
        mis=sorted(day.keys())
        series=[(mi,day[mi]["spot"]) for mi in mis]
        piv=L.zigzag(series,pct)
        pivL=set(mi for mi,pr,k in piv if k=='L')
        pivH=set(mi for mi,pr,k in piv if k=='H')
        end=mis[-1]
        for side,pivset in (('floor',pivL),('ceil',pivH)):
            # build touch episodes for this side
            touch=[]  # (mi, dist_bps, node, nodeg)
            for mi in mis:
                r=day[mi]; spot=r["spot"]
                node,ng=L.strongest_node(r,spot,side,BAND)
                if node is None: continue
                dist=abs(node-spot)/spot*1e4
                touch.append((mi,dist,node,ng))
            if not touch: continue
            # segment into episodes (consecutive by mi gap<=GAP)
            episodes=[]; cur=[touch[0]]
            for k in range(1,len(touch)):
                if touch[k][0]-cur[-1][0]<=GAP: cur.append(touch[k])
                else: episodes.append(cur); cur=[touch[k]]
            episodes.append(cur)
            for ep in episodes:
                # entry = extreme approach minute (min dist to node)
                emi,edist,enode,eng = min(ep, key=lambda x:x[1])
                if emi<WIN or emi>end-5: continue
                spot=day[emi]["spot"]
                f=feat_for(day,emi,spot,enode,side)
                if f is None: continue
                # phantom mirror strike
                ph=L.nearest_strike(list(day[emi]["g"].keys()), 2*spot-enode)
                fp=feat_for(day,emi,spot,ph,side)
                # turn/non-turn tied to ENTRY minute (where features are measured)
                nearest_piv = min((abs(pm-emi) for pm in pivset), default=999)
                is_turn = 1 if nearest_piv<=3 else 0
                nonturn = 1 if nearest_piv>10 else 0   # 4..10 = ambiguous (excluded)
                # net gamma regime
                netg=sum(day[emi]["g"].values())
                # forward drift dir-adjusted (floor=long +1, ceil=short -1)
                dirn=1.0 if side=='floor' else -1.0
                drift={}
                for h in FWD:
                    fr=near_rec(day,emi+h)
                    if fr is None: drift[h]=None
                    else: drift[h]=dirn*(fr["spot"]-spot)/spot*1e4
                ev=dict(day=d,pct=pct,side=side,entry_mi=emi,ts=day[emi]["ts"],
                        spot=spot,node=enode,nodeg=eng,phantom=ph,
                        is_turn=is_turn,nonturn=nonturn,netg_sign=(1 if netg>0 else -1),
                        drift=drift,
                        raw_gvel=f["raw_gvel"],resid_gvel=f["resid_gvel"],resid_add=f["resid_add"],
                        vanna_vel=f["vanna_vel"],supp_vanna_vel=f["supp_vanna_vel"],flip=f["flip"],
                        d_now=f["d_now"],g_now=f["g_now"],g_prev=f["g_prev"],
                        ph_raw_gvel=(fp["raw_gvel"] if fp else None),
                        ph_resid_gvel=(fp["resid_gvel"] if fp else None),
                        ph_flip=(fp["flip"] if fp else None),
                        ph_supp_vanna_vel=(fp["supp_vanna_vel"] if fp else None))
                events.append(ev)
    return events

if __name__=="__main__":
    allev={}
    for pct in PIVOT_PCTS:
        ev=build(pct)
        allev[str(pct)]=ev
        nt=sum(e["is_turn"] for e in ev); nn=sum(e["nonturn"] for e in ev)
        print(f"pct={pct} episodes={len(ev)} turn={nt} nonturn={nn} amb={len(ev)-nt-nn}")
    with open("events.json","w") as fh: json.dump(allev,fh)
    # shape sanity
    print("shape[0..6]", [round(x,3) for x in shape[:7]])
    print("wrote events.json")
