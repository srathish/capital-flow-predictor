"""Analyze events: tables, ATM-residual, vanna-flip, OOS AUC, monetization."""
import json, math, random
random.seed(7)

ALL=json.load(open("events.json"))
# JSON turned int drift-keys into strings; restore ints
for pct,ev in ALL.items():
    for e in ev:
        e["drift"]={int(k):v for k,v in e["drift"].items()}

def mean(xs):
    xs=[x for x in xs if x is not None]
    return sum(xs)/len(xs) if xs else float('nan')
def median(xs):
    xs=sorted(x for x in xs if x is not None)
    n=len(xs)
    if not n: return float('nan')
    return xs[n//2] if n%2 else (xs[n//2-1]+xs[n//2])/2
def frac_pos(xs):
    xs=[x for x in xs if x is not None]
    return (sum(1 for x in xs if x>0)/len(xs)) if xs else float('nan')

def rank_auc(pos, neg):
    """AUC = P(pos>neg). pos,neg lists of scores."""
    pos=[x for x in pos if x is not None]; neg=[x for x in neg if x is not None]
    if not pos or not neg: return float('nan')
    allv=sorted([(v,0) for v in neg]+[(v,1) for v in pos])
    # assign ranks with ties averaged
    ranks=[0.0]*len(allv)
    i=0
    while i<len(allv):
        j=i
        while j<len(allv) and allv[j][0]==allv[i][0]: j+=1
        r=(i+1+j)/2.0
        for k in range(i,j): ranks[k]=r
        i=j
    sum_pos=sum(ranks[k] for k in range(len(allv)) if allv[k][1]==1)
    n1=len(pos); n2=len(neg)
    U=sum_pos-n1*(n1+1)/2.0
    return U/(n1*n2)

def mannwhitney_z(pos,neg):
    """normal-approx z for U (turn vs nonturn)."""
    auc=rank_auc(pos,neg)
    n1=len([x for x in pos if x is not None]); n2=len([x for x in neg if x is not None])
    if n1==0 or n2==0: return float('nan'),auc
    U=auc*n1*n2
    mu=n1*n2/2.0; sig=math.sqrt(n1*n2*(n1+n2+1)/12.0)
    z=(U-mu)/sig if sig>0 else 0.0
    return z,auc

def two_prop_z(k1,n1,k2,n2):
    if n1==0 or n2==0: return float('nan')
    p1=k1/n1; p2=k2/n2; p=(k1+k2)/(n1+n2)
    se=math.sqrt(p*(1-p)*(1/n1+1/n2))
    return (p1-p2)/se if se>0 else 0.0

# ============ SECTION A: turn vs nonturn vs phantom velocity tables ============
def section_tables(pct):
    ev=ALL[str(pct)]
    turn=[e for e in ev if e["is_turn"]==1]
    non =[e for e in ev if e["nonturn"]==1]
    rows=[]
    for name,key in [("raw gamma vel","raw_gvel"),
                     ("resid gamma vel (mult ATM ctrl)","resid_gvel"),
                     ("resid gamma vel (additive ctrl)","resid_add"),
                     ("supportive vanna vel","supp_vanna_vel")]:
        tp=[e[key] for e in turn]; np_=[e[key] for e in non]
        z,auc=mannwhitney_z(tp,np_)
        rows.append((name, mean(tp), median(tp), frac_pos(tp),
                     mean(np_), median(np_), frac_pos(np_), auc, z))
    # flip rate
    kt=sum(e["flip"] for e in turn); kn=sum(e["flip"] for e in non)
    flip_row=("vanna FLIP rate", kt/len(turn), None, None, kn/len(non), None, None,
              None, two_prop_z(kt,len(turn),kn,len(non)))
    # phantom (real vs phantom, before turns only)
    ph=[]
    for name,rk,pk in [("gamma resid vel","resid_gvel","ph_resid_gvel"),
                       ("raw gamma vel","raw_gvel","ph_raw_gvel"),
                       ("supp vanna vel","supp_vanna_vel","ph_supp_vanna_vel")]:
        real=[e[rk] for e in turn]; phan=[e[pk] for e in turn if e[pk] is not None]
        ph.append((name, mean(real), mean(phan), rank_auc([e[rk] for e in turn],
                                                          [e[pk] for e in turn])))
    # phantom flip rate (turns)
    pf_real=sum(e["flip"] for e in turn)/len(turn)
    pf_phan=mean([e["ph_flip"] for e in turn if e["ph_flip"] is not None])
    return dict(nturn=len(turn),nnon=len(non),rows=rows,flip=flip_row,
                phantom=ph,pf_real=pf_real,pf_phan=pf_phan,turn=turn,non=non)

# ============ SECTION B: logistic OOS AUC (walk-forward) ============
FEATS=["resid_gvel","raw_gvel","supp_vanna_vel","flip","netg_sign","d_now"]
def make_xy(ev):
    X=[];Y=[]
    for e in ev:
        if e["is_turn"]==1: y=1
        elif e["nonturn"]==1: y=0
        else: continue
        X.append([float(e[f]) for f in FEATS]); Y.append(y)
    return X,Y

def standardize(X, mu=None, sd=None):
    m=len(X[0])
    if mu is None:
        mu=[sum(r[j] for r in X)/len(X) for j in range(m)]
        sd=[ (sum((r[j]-mu[j])**2 for r in X)/len(X))**0.5 or 1.0 for j in range(m)]
    Z=[[(r[j]-mu[j])/sd[j] for j in range(m)] for r in X]
    return Z,mu,sd

def train_logistic(X,Y,iters=3000,lr=0.3,l2=1e-3):
    m=len(X[0]); w=[0.0]*m; b=0.0; n=len(X)
    for _ in range(iters):
        gw=[0.0]*m; gb=0.0
        for i in range(n):
            z=b+sum(w[j]*X[i][j] for j in range(m))
            p=1/(1+math.exp(-max(-30,min(30,z))))
            e=p-Y[i]
            for j in range(m): gw[j]+=e*X[i][j]
            gb+=e
        for j in range(m): w[j]-=lr*(gw[j]/n + l2*w[j])
        b-=lr*gb/n
    return w,b

def predict(X,w,b):
    out=[]
    for r in X:
        z=b+sum(w[j]*r[j] for j in range(len(r)))
        out.append(1/(1+math.exp(-max(-30,min(30,z)))))
    return out

def section_auc(pct, feats):
    ev=ALL[str(pct)]
    days=sorted(set(e["day"] for e in ev))
    half=len(days)//2
    H1=set(days[:half]); H2=set(days[half:])
    idx=[FEATS.index(f) for f in feats]
    def sub(ev_):
        X,Y=make_xy(ev_); Xs=[[r[j] for j in idx] for r in X]; return Xs,Y
    e1=[e for e in ev if e["day"] in H1]; e2=[e for e in ev if e["day"] in H2]
    X1,Y1=sub(e1); X2,Y2=sub(e2)
    # train H1 test H2
    Z1,mu,sd=standardize(X1); w,b=train_logistic(Z1,Y1)
    Z2,_,_=standardize(X2,mu,sd); p2=predict(Z2,w,b)
    auc_h2=rank_auc([p2[i] for i in range(len(Y2)) if Y2[i]==1],
                    [p2[i] for i in range(len(Y2)) if Y2[i]==0])
    # train H2 test H1
    Z2b,mu2,sd2=standardize(X2); w2,b2=train_logistic(Z2b,Y2)
    Z1b,_,_=standardize(X1,mu2,sd2); p1=predict(Z1b,w2,b2)
    auc_h1=rank_auc([p1[i] for i in range(len(Y1)) if Y1[i]==1],
                    [p1[i] for i in range(len(Y1)) if Y1[i]==0])
    # full-sample coefs (standardized) for interpretation
    Xall,Yall=sub(ev); Zall,mu3,sd3=standardize(Xall); wall,ball=train_logistic(Zall,Yall)
    return dict(auc_h2=auc_h2,auc_h1=auc_h1,coefs=dict(zip(feats,wall)),
                n1=sum(Y1),n0=len(Y1)-sum(Y1),n1b=sum(Y2),n0b=len(Y2)-sum(Y2))

def univariate_auc(pct):
    ev=ALL[str(pct)]
    turn=[e for e in ev if e["is_turn"]==1]; non=[e for e in ev if e["nonturn"]==1]
    out={}
    for f in ["resid_gvel","raw_gvel","supp_vanna_vel","flip"]:
        out[f]=rank_auc([e[f] for e in turn],[e[f] for e in non])
    return out

# ============ SECTION C: monetization ============
# option translation (verified separately): option% per bp underlying, costs
LAMBDA=1.6           # option % return per 1bp underlying move (mid-day ATM 0DTE)
SPREAD_RT=1.1        # round-trip spread %
THETA={15:6.0,30:11.0}  # theta drag % premium over hold
def opt_pnl(drift_bps,h):
    if drift_bps is None: return None
    return max(LAMBDA*drift_bps - THETA[h] - SPREAD_RT, -100.0)

def strat_stats(ev_list, h):
    drift=[e["drift"][h] for e in ev_list]
    pnl=[opt_pnl(e["drift"][h],h) for e in ev_list]
    drift=[d for d in drift if d is not None]; pnl=[p for p in pnl if p is not None]
    n=len(drift)
    if n==0: return dict(n=0)
    return dict(n=n, drift_mean=mean(drift), drift_medpos=frac_pos(drift),
                opt_win=sum(1 for p in pnl if p>0)/len(pnl), opt_exp=mean(pnl))

def random_universe(pct):
    """random-timing entries: per day, same # as bare, random minute & dir."""
    import nv_lib as L
    ev=ALL[str(pct)]
    byday={}
    for e in ev: byday.setdefault(e["day"],[]).append(e)
    out=[]
    for day,es in byday.items():
        d=L.load_day(day); mis=sorted(d.keys()); end=mis[-1]
        cand=[m for m in mis if m>=15 and m<=end-30]
        for _ in es:
            emi=random.choice(cand); spot=d[emi]["spot"]
            dirn=random.choice([1.0,-1.0])
            drift={}
            for h in [15,30]:
                # nearest fwd
                fr=None
                for dd in (0,1,-1,2,-2):
                    if emi+h+dd in d: fr=d[emi+h+dd]; break
                drift[h]=(dirn*(fr["spot"]-spot)/spot*1e4) if fr else None
            out.append(dict(drift=drift))
    return out

def tercile_cut(ev, key, frac=2/3.0):
    vals=sorted(e[key] for e in ev)
    return vals[int(len(vals)*frac)]

def section_monetize(pct):
    ev=ALL[str(pct)]
    vcut=tercile_cut(ev,"supp_vanna_vel")
    strat={}
    strat["ORACLE turns (is_turn=1)"]=[e for e in ev if e["is_turn"]==1]
    strat["ORACLE nonturns"]=[e for e in ev if e["nonturn"]==1]
    strat["BARE (all touches)"]=ev
    strat["VANNA-VEL>0 (supportive)"]=[e for e in ev if e["supp_vanna_vel"]>0]
    strat["VANNA-VEL top-tercile"]=[e for e in ev if e["supp_vanna_vel"]>=vcut]
    strat["VANNA-FLIP flag only"]=[e for e in ev if e["flip"]==1]
    strat["OLD FILTER (resid_gvel>0 & flip)"]=[e for e in ev if e["resid_gvel"]>0 and e["flip"]==1]
    strat["PHANTOM (ph_vanna>0)"]=[e for e in ev if e["ph_supp_vanna_vel"] is not None and e["ph_supp_vanna_vel"]>0]
    res={}
    for name,lst in strat.items():
        res[name]={h:strat_stats(lst,h) for h in [15,30]}
    ru=random_universe(pct)
    res["RANDOM timing"]={h:strat_stats(ru,h) for h in [15,30]}
    return res, {k:len(v) for k,v in strat.items()}

if __name__=="__main__":
    import sys
    out={}
    for pct in [0.0015,0.0025]:
        t=section_tables(pct)
        a=section_auc(pct,FEATS)
        a_nf=section_auc(pct,[f for f in FEATS if f!="flip"])
        uni=univariate_auc(pct)
        mon,counts=section_monetize(pct)
        out[str(pct)]=dict(tables=t,auc=a,auc_noflip=a_nf,uni=uni,mon=mon,counts=counts)
        # print summary
        print("="*70); print("PCT",pct,"turns",t["nturn"],"nonturns",t["nnon"])
        print("-- velocity table (turn mean | nonturn mean | AUC | z)")
        for r in t["rows"]:
            print("  %-32s turn=%+.3g non=%+.3g AUC=%.3f z=%.2f"%(r[0],r[1],r[4],r[7],r[8]))
        print("  flip rate turn=%.3f non=%.3f z=%.2f"%(t["flip"][1],t["flip"][4],t["flip"][8]))
        print("-- real vs phantom (turns):")
        for p in t["phantom"]:
            print("  %-20s real=%+.3g phantom=%+.3g AUC(real>phan)=%.3f"%(p[0],p[1],p[2],p[3]))
        print("  flip real=%.3f phantom=%.3f"%(t["pf_real"],t["pf_phan"]))
        print("-- OOS AUC full model: H2=%.3f H1=%.3f | no-flip: H2=%.3f H1=%.3f"%(
            a["auc_h2"],a["auc_h1"],a_nf["auc_h2"],a_nf["auc_h1"]))
        print("  coefs(std):",{k:round(v,3) for k,v in a["coefs"].items()})
        print("  univariate AUC:",{k:round(v,3) for k,v in uni.items()})
        for h in [15,30]:
            print("-- monetization @%dmin:"%h)
            for name in ["ORACLE turns (is_turn=1)","ORACLE nonturns","BARE (all touches)","VANNA-VEL>0 (supportive)","VANNA-VEL top-tercile","VANNA-FLIP flag only","OLD FILTER (resid_gvel>0 & flip)","PHANTOM (ph_vanna>0)","RANDOM timing"]:
                s=mon[name][h]
                if s.get("n"):
                    print("  %-34s n=%3d drift=%+.2fbp win%%=%.2f optExp=%+.2f%%"%(
                        name,s["n"],s["drift_mean"],s["drift_medpos"],s["opt_exp"]))
    json.dump(out,open("analysis.json","w"),default=lambda o:None)
    print("\nwrote analysis.json")
