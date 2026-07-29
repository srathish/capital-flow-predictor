# THE FULL-PICTURE MODEL — all features (incl aggregate VEX, gamma-flip, cross-expiry, charm) together,
# validated OUT-OF-SAMPLE. Q1: does aggregate VEX crack DIRECTION (drift)? Q2: reach/pin (range) edge?
import numpy as np, pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.metrics import roc_auc_score, accuracy_score
from sklearn.inspection import permutation_importance

df = pd.read_csv('research/doctrine/features.csv')
days = sorted(df['day'].unique()); cut = days[12]
tr, te = df[df['day'] < cut], df[df['day'] >= cut]
targets = ['y_dir','y_maxUp','y_maxDn','y_reachKing','y_reachUp','y_reachDn','y_pin']
feats = [c for c in df.columns if c not in (['day','et']+targets)]
print(f"features={len(feats)}  train={len(tr)}  test={len(te)}\n")

def clf(name, ytr, yte, Xtr, Xte, show_imp=False):
    if yte.nunique()<2 or ytr.nunique()<2: print(f"{name}: skip"); return None
    m = GradientBoostingClassifier(n_estimators=150, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=0).fit(Xtr, ytr)
    p = m.predict_proba(Xte)[:,1]; auc = roc_auc_score(yte, p); base = max(yte.mean(),1-yte.mean())
    print(f"{name:14s} OOS AUC {auc:.3f} · baseline {base:.2f} · {'EDGE' if auc>0.55 else 'no edge'}")
    if show_imp:
        pi = permutation_importance(m, Xte, yte, n_repeats=8, random_state=0, scoring='roc_auc')
        for f,v in sorted(zip(feats, pi.importances_mean), key=lambda x:-x[1])[:12]: print(f"      {f:16s} {v:+.4f}")
    return auc

print("=== Q1: DIRECTION (up before down) — does aggregate VEX crack the drift? ===")
d_tr, d_te = tr[tr.y_dir!=0], te[te.y_dir!=0]
clf("direction", (d_tr.y_dir>0).astype(int), (d_te.y_dir>0).astype(int), d_tr[feats], d_te[feats], show_imp=True)

print("\n=== Q2: RANGE — reach & pin (the known edge) ===")
clf("reach king", tr.y_reachKing, te.y_reachKing, tr[feats], te[feats])
clf("reach up",   tr.y_reachUp,   te.y_reachUp,   tr[feats], te[feats])
clf("reach down", tr.y_reachDn,   te.y_reachDn,   tr[feats], te[feats])
clf("pin(<4/20m)", tr.y_pin,      te.y_pin,       tr[feats], te[feats], show_imp=True)
