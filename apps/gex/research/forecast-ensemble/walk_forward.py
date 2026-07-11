"""Walk-forward evaluation of the weak-signal ensemble (DESIGN.md protocol).

Primary: L2 logistic on y_up (next-session open->close sign), SPY rows.
- expanding window, first train >=120 SPY sessions, predict next 20, roll 20
- lambda frozen from inner walk-forward on the FIRST training window only
Success bars (pre-registered): OOS hit >=52.5% AND logloss < base-rate;
placebo >=95th pct (label-permutation + circular date-shift); no single
family >=52.5% alone; drop-one family keeps ensemble >=51.5%.
Secondary (Amendment A1): 3-class macro acc vs baseline; chop AUC >= 0.55.
Stability cuts: QQQ, odd/even days, half-splits.

Run: /opt/homebrew/bin/python3.12 walk_forward.py
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score

HERE = Path(__file__).resolve().parent
OUT = HERE / "outputs"
rng = np.random.default_rng(77)

TRAIN_MIN, STEP = 120, 20
LAMBDAS = [100.0, 10.0, 1.0, 0.1, 0.01]  # C values for sklearn (C=1/lambda-ish)


def load(ticker="SPY"):
    df = pd.read_csv(OUT / "features.csv", parse_dates=["date"])
    df = df[df["ticker"] == ticker].sort_values("date").reset_index(drop=True)
    fams = json.load(open(OUT / "families.json"))
    feat_cols = [c for c in df.columns if c in fams]
    return df, feat_cols, fams


def folds(n):
    out, start = [], TRAIN_MIN
    while start < n:
        out.append((np.arange(0, start), np.arange(start, min(n, start + STEP))))
        start += STEP
    return out


def fit_predict(X, y, tr, te, C):
    m = LogisticRegression(C=C, max_iter=2000, solver="lbfgs")
    m.fit(X[tr], y[tr])
    return m.predict_proba(X[te])[:, 1], m


def walk(X, y, C, feat_idx=None):
    """Returns OOS prob vector aligned to fold test rows + index list."""
    if feat_idx is not None:
        X = X[:, feat_idx]
    probs, idxs = [], []
    for tr, te in folds(len(y)):
        if len(np.unique(y[tr])) < 2:
            continue
        p, _ = fit_predict(X, y, tr, te, C)
        probs.append(p)
        idxs.append(te)
    return np.concatenate(probs), np.concatenate(idxs)


def pick_C(X, y):
    """Inner walk-forward on FIRST training window only; frozen after."""
    inner_n = TRAIN_MIN
    Xi, yi = X[:inner_n], y[:inner_n]
    best, best_ll = None, np.inf
    for C in LAMBDAS:
        ps, idx = [], []
        start = 60
        while start < inner_n:
            tr = np.arange(0, start)
            te = np.arange(start, min(inner_n, start + 20))
            if len(np.unique(yi[tr])) < 2:
                start += 20
                continue
            p, _ = fit_predict(Xi, yi, tr, te, C)
            ps.append(p); idx.append(te)
            start += 20
        if not ps:
            continue
        ll = log_loss(yi[np.concatenate(idx)], np.clip(np.concatenate(ps), 1e-6, 1 - 1e-6))
        if ll < best_ll:
            best_ll, best = ll, C
    return best


def hit(y, p):
    return float(((p > 0.5).astype(int) == y).mean())


def main():
    df, feat_cols, fams = load("SPY")
    X = df[feat_cols].to_numpy()
    y = df["y_up"].to_numpy()
    n = len(df)
    print(f"SPY rows={n} feats={len(feat_cols)}")

    C = pick_C(X, y)
    print(f"frozen C={C}")

    p, idx = walk(X, y, C)
    yo = y[idx]
    base = max(yo.mean(), 1 - yo.mean())
    h = hit(yo, p)
    ll = log_loss(yo, np.clip(p, 1e-6, 1 - 1e-6))
    ll_base = log_loss(yo, np.full_like(p, y[:TRAIN_MIN].mean()))
    res = dict(oos_n=int(len(yo)), hit=h, base=float(base), logloss=ll, logloss_base=ll_base, C=C)
    print("PRIMARY:", res)

    # stability cuts
    dates = df["date"].to_numpy()[idx]
    dser = pd.to_datetime(pd.Series(dates))
    odd = dser.dt.day % 2 == 1
    half = np.arange(len(yo)) < len(yo) // 2
    cuts = dict(
        odd=hit(yo[odd.values], p[odd.values]), even=hit(yo[~odd.values], p[~odd.values]),
        h1=hit(yo[half], p[half]), h2=hit(yo[~half], p[~half]),
    )
    dfq, fq, _ = load("QQQ")
    pq, iq = walk(dfq[fq].to_numpy(), dfq["y_up"].to_numpy(), C)
    cuts["qqq"] = hit(dfq["y_up"].to_numpy()[iq], pq)
    print("CUTS:", {k: round(v, 3) for k, v in cuts.items()})

    # single-family + drop-one ablations
    fam_names = sorted(set(fams[c] for c in feat_cols))
    single, drop = {}, {}
    for fam in fam_names:
        fi = [i for i, c in enumerate(feat_cols) if fams[c] == fam]
        di = [i for i, c in enumerate(feat_cols) if fams[c] != fam]
        ps, is_ = walk(X, y, C, fi)
        single[fam] = hit(y[is_], ps)
        pd_, id_ = walk(X, y, C, di)
        drop[fam] = hit(y[id_], pd_)
    print("SINGLE-FAMILY:", {k: round(v, 3) for k, v in single.items()})
    print("DROP-ONE:", {k: round(v, 3) for k, v in drop.items()})

    # placebos (200 reps each) on the primary hit metric
    REPS = 200
    perm_hits = np.empty(REPS)
    for r in range(REPS):
        yp = rng.permutation(y)
        pp, ip = walk(X, yp, C)
        perm_hits[r] = hit(yp[ip], pp)
    shift_hits = np.empty(REPS)
    for r in range(REPS):
        k = int(rng.integers(10, n - 10))
        ys = np.roll(y, k)
        pp, ip = walk(X, ys, C)
        shift_hits[r] = hit(ys[ip], pp)
    pct_perm = float((h > perm_hits).mean())
    pct_shift = float((h > shift_hits).mean())
    print(f"PLACEBO perm: pctile={pct_perm:.3f} (mean {perm_hits.mean():.3f})")
    print(f"PLACEBO shift: pctile={pct_shift:.3f} (mean {shift_hits.mean():.3f})")

    # secondary: chop
    ych = df["y_chop"].to_numpy()
    pch, ich = walk(X, ych, C)
    chop_auc = roc_auc_score(ych[ich], pch)
    print(f"CHOP AUC (OOS): {chop_auc:.3f} | chop base rate {ych.mean():.3f}")

    # coefficients on full data (interpretability, correlational only)
    m = LogisticRegression(C=C, max_iter=2000).fit(X, y)
    coefs = pd.Series(m.coef_[0], index=feat_cols).sort_values(key=abs, ascending=False)
    mch = LogisticRegression(C=C, max_iter=2000).fit(X, ych)
    coefs_ch = pd.Series(mch.coef_[0], index=feat_cols).sort_values(key=abs, ascending=False)

    json.dump(dict(primary=res, cuts=cuts, single=single, drop=drop,
                   placebo=dict(perm=pct_perm, shift=pct_shift,
                                perm_mean=float(perm_hits.mean()),
                                shift_mean=float(shift_hits.mean())),
                   chop_auc=float(chop_auc),
                   top_coefs_up=coefs.head(15).round(4).to_dict(),
                   top_coefs_chop=coefs_ch.head(15).round(4).to_dict()),
              open(OUT / "walkforward_results.json", "w"), indent=1)
    print("wrote outputs/walkforward_results.json")


if __name__ == "__main__":
    main()
