# WALK-FORWARD RETRAINING — is Falcon's "needs to train" edge real? Test whether a model that RETRAINS on
# recent days (adapting to the drifting regime) beats a FROZEN model (trained once) — especially on the
# targets that died OOS (direction). If retraining rescues them, adaptivity is the edge. If not, the
# non-stationarity is irreducible and training only helps the already-predictable stuff (reach).
import pandas as pd, numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import roc_auc_score

df = pd.read_csv('falcon-copier/features.csv')
days = sorted(df['day'].unique())
targets = ['y_dir','y_maxUp','y_maxDn','y_reachKing','y_reachUp','y_reachDn','y_pin']
feats = [c for c in df.columns if c not in (['day','et']+targets)]
GB = lambda: GradientBoostingClassifier(n_estimators=100, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=0)

def prep(target):
    if target == 'y_dir':
        d = df[df.y_dir != 0].copy(); d['_y'] = (d.y_dir > 0).astype(int)
    else:
        d = df.copy(); d['_y'] = d[target]
    return d

def frozen(target):                                   # train first 12 days, predict last 7 (one fixed model)
    d = prep(target); tr = d[d.day.isin(days[:12])]; te = d[d.day.isin(days[12:])]
    if tr._y.nunique() < 2 or te._y.nunique() < 2: return None
    m = GB().fit(tr[feats], tr._y); return roc_auc_score(te._y, m.predict_proba(te[feats])[:, 1])

def walk(target, window=None):                        # for each test day, retrain on prior days (roll), predict it
    d = prep(target); preds, actual = [], []
    for i in range(8, len(days)):
        tr_days = days[:i] if window is None else days[max(0, i - window):i]
        tr = d[d.day.isin(tr_days)]; te = d[d.day == days[i]]
        if tr._y.nunique() < 2 or len(te) < 5 or te._y.nunique() < 1: continue
        m = GB().fit(tr[feats], tr._y); preds += list(m.predict_proba(te[feats])[:, 1]); actual += list(te._y)
    if len(set(actual)) < 2: return None
    return roc_auc_score(actual, preds)

print("target        FROZEN   WALK-FWD(expand)   WALK-FWD(roll-8d)   verdict")
for t in ['y_reachUp', 'y_reachDn', 'y_reachKing', 'y_pin', 'y_dir']:
    fz, we, wr = frozen(t), walk(t), walk(t, window=8)
    f = lambda x: f"{x:.3f}" if x is not None else "  — "
    best = max([x for x in [we, wr] if x is not None], default=0)
    verdict = "retrain HELPS" if (fz and best > fz + 0.03) else "retrain ~same" if fz and abs(best-fz)<=0.03 else "?"
    print(f"{t:12s}  {f(fz)}      {f(we)}             {f(wr)}          {verdict}")
print("\nreach targets test if adaptivity keeps the KNOWN edge; y_dir tests if retraining can RESCUE direction (it couldn't when frozen, AUC~0.51).")
