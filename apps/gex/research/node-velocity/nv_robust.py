"""Robustness: floor/ceil split, sign convention, day-clustered permutation p-value."""
import json, random, math
random.seed(3)
from nv_analyze import rank_auc, ALL

ev=ALL["0.0015"]
turn=[e for e in ev if e["is_turn"]==1]; non=[e for e in ev if e["nonturn"]==1]

def auc_key(t,n,key): return rank_auc([e[key] for e in t],[e[key] for e in n])

print("== supportive vanna vel AUC, pooled and by side ==")
for side in ["pooled","floor","ceil"]:
    t=[e for e in turn if side=="pooled" or e["side"]==side]
    n=[e for e in non if side=="pooled" or e["side"]==side]
    print(f"  {side:6s} nturn={len(t):3d} nnon={len(n):3d} vanna_vel_AUC={auc_key(t,n,'supp_vanna_vel'):.3f} "
          f"resid_gvel_AUC={auc_key(t,n,'resid_gvel'):.3f} raw_gvel_AUC={auc_key(t,n,'raw_gvel'):.3f}")

# raw signed vanna vel sign check: floor turns should have +vanna_vel, ceil turns -vanna_vel
def mean(xs): return sum(xs)/len(xs)
fl=[e for e in turn if e["side"]=="floor"]; ce=[e for e in turn if e["side"]=="ceil"]
print("  floor turns mean raw vanna_vel = %+.3e (expect >0)"%mean([e["vanna_vel"] for e in fl]))
print("  ceil  turns mean raw vanna_vel = %+.3e (expect <0)"%mean([e["vanna_vel"] for e in ce]))

# ---- day-clustered permutation test for supp_vanna_vel AUC ----
# Null: turn/nonturn labels exchangeable WITHIN the constraint that we permute
# by shuffling the per-DAY set of labels across events (preserve day clustering by
# permuting labels at the day level is hard; instead do a block permutation:
# shuffle labels within each day, preserving each day's turn count -> destroys
# turn<->feature link but keeps intraday autocorrelation of features).
import collections
byday=collections.defaultdict(list)
allc=[e for e in ev if e["is_turn"]==1 or e["nonturn"]==1]
for e in allc: byday[e["day"]].append(e)
obs=rank_auc([e["supp_vanna_vel"] for e in allc if e["is_turn"]==1],
             [e["supp_vanna_vel"] for e in allc if e["nonturn"]==1])
def perm_auc():
    P=[];N=[]
    for d,es in byday.items():
        labs=[1 if e["is_turn"]==1 else 0 for e in es]
        random.shuffle(labs)
        for e,l in zip(es,labs):
            (P if l==1 else N).append(e["supp_vanna_vel"])
    return rank_auc(P,N)
B=2000; ge=sum(1 for _ in range(B) if perm_auc()>=obs)
print("\n== day-clustered permutation (within-day label shuffle) ==")
print(f"  observed vanna_vel AUC={obs:.3f}  perm p(>=obs)={(ge+1)/(B+1):.4f}  (B={B})")

# same for resid_gvel (anti-signal, expect low AUC / p near 1)
obs_r=rank_auc([e["resid_gvel"] for e in allc if e["is_turn"]==1],
               [e["resid_gvel"] for e in allc if e["nonturn"]==1])
def perm_auc_r():
    P=[];N=[]
    for d,es in byday.items():
        labs=[1 if e["is_turn"]==1 else 0 for e in es]; random.shuffle(labs)
        for e,l in zip(es,labs): (P if l==1 else N).append(e["resid_gvel"])
    return rank_auc(P,N)
le=sum(1 for _ in range(B) if perm_auc_r()<=obs_r)
print(f"  observed resid_gvel AUC={obs_r:.3f}  perm p(<=obs)={(le+1)/(B+1):.4f}")
