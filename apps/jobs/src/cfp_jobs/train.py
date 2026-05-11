"""XGBoost baseline training orchestration (DESIGN.md §7.1, §7.4).

Loads features and targets from Postgres, runs walk-forward CV per horizon,
writes out-of-sample predictions back to the `predictions` table, and reports
walk-forward metrics.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import pandas as pd
import psycopg
from cfp_models import metrics, walk_forward, xgb_baseline
from cfp_models import panel as model_panel
from cfp_models import targets as targets_mod
from cfp_shared.universe import PREDICTION_TARGETS

from cfp_jobs.db import connect, to_psycopg_url

log = logging.getLogger(__name__)

MODEL_NAME = "xgb_v1"

# Live-forecast knobs. Seeds were chosen for spread, not magic — five fits are
# enough to expose rank instability without doubling training time. Freshness
# tolerance is in business days; completeness is the minimum fraction of
# feature columns that must be non-null per symbol at asof.
LIVE_ENSEMBLE_SEEDS: tuple[int, ...] = (42, 137, 271, 314, 1729)
LIVE_FRESHNESS_MAX_BD: int = 3
LIVE_COMPLETENESS_MIN: float = 0.7


def _load_prices(conn: psycopg.Connection) -> pd.DataFrame:
    sql = "SELECT ts, symbol, close FROM prices_daily ORDER BY ts"
    with conn.cursor() as cur:
        cur.execute(sql)
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=cols)


def _load_features(conn: psycopg.Connection) -> pd.DataFrame:
    sql = """
        SELECT ts, symbol, feature_set, payload
        FROM features_daily
        WHERE feature_set IN ('cross_asset_v1', 'sector_v1', 'breadth_v1')
        ORDER BY ts, symbol
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=cols)


PREDICTION_UPSERT = """
INSERT INTO predictions
    (run_ts, target_ts, symbol, horizon_d, model, rank, score, confidence, explanation)
VALUES
    (%(run_ts)s, %(target_ts)s, %(symbol)s, %(horizon_d)s, %(model)s,
     %(rank)s, %(score)s, %(confidence)s, %(explanation)s)
ON CONFLICT (run_ts, target_ts, symbol, horizon_d, model) DO UPDATE SET
    rank = EXCLUDED.rank,
    score = EXCLUDED.score,
    confidence = EXCLUDED.confidence,
    explanation = EXCLUDED.explanation
"""


def _upsert_predictions(conn: psycopg.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(PREDICTION_UPSERT, rows)
    return len(rows)


def _to_utc(ts: pd.Timestamp) -> datetime:
    py = ts.to_pydatetime() if isinstance(ts, pd.Timestamp) else ts
    return py if py.tzinfo else py.replace(tzinfo=UTC)


def _business_days_between(a: pd.Timestamp, b: pd.Timestamp) -> int:
    """Count business days from a to b (signed). Uses numpy's busday_count
    semantics: half-open [a, b)."""
    import numpy as np

    a_d = pd.Timestamp(a).normalize().to_numpy().astype("datetime64[D]")
    b_d = pd.Timestamp(b).normalize().to_numpy().astype("datetime64[D]")
    return int(np.busday_count(a_d, b_d))


def _emit_live_forecast(
    features: pd.DataFrame,
    prices: pd.DataFrame,
    panel_df: pd.DataFrame,
    feature_cols: list[str],
    horizon: int,
    run_ts: datetime,
    out_rows: list[dict],
) -> dict | None:
    """Train an ensemble of final models on the full supervised panel and score
    the latest feature snapshot. Appends one row per symbol to `out_rows` with
    explanation='live_forecast' and confidence = cross-seed rank stability.

    Returns a small summary dict (asof, n_symbols, ensemble metrics) or None
    if a guard rejected the forecast.
    """
    live_panel, asof_ts = model_panel.build_scoring_panel(features, feature_cols)
    train_dates = sorted(panel_df["ts"].unique())
    if live_panel.empty or asof_ts is None or len(train_dates) < 40:
        log.info("horizon %dd: skipping live forecast (insufficient data)", horizon)
        return None
    if asof_ts <= train_dates[-1]:
        log.info(
            "horizon %dd: skipping live forecast — latest feature ts %s "
            "is not newer than last supervised ts %s",
            horizon, asof_ts, train_dates[-1],
        )
        return None

    # (3) Freshness: features must be within LIVE_FRESHNESS_MAX_BD of the
    # latest close, otherwise we'd be forecasting from stale inputs and the
    # forward target date the API computes would also be wrong.
    last_close_ts = prices["ts"].max() if not prices.empty else None
    if last_close_ts is not None:
        gap_bd = _business_days_between(pd.Timestamp(asof_ts), pd.Timestamp(last_close_ts))
        if gap_bd > LIVE_FRESHNESS_MAX_BD:
            log.warning(
                "horizon %dd: skipping live forecast — features asof %s lags "
                "last close %s by %d business days (>%d)",
                horizon, asof_ts, last_close_ts, gap_bd, LIVE_FRESHNESS_MAX_BD,
            )
            return None

    # (4) Completeness: refuse to score symbols whose feature row is mostly
    # NaN at asof — XGB tolerates NaN but a fully-empty cross-asset slice
    # would silently weaken every prediction.
    feat_block = live_panel[feature_cols]
    completeness = feat_block.notna().sum(axis=1) / max(1, len(feature_cols))
    live_panel = live_panel.assign(_completeness=completeness.to_numpy())
    keep_mask = live_panel["_completeness"] >= LIVE_COMPLETENESS_MIN
    n_dropped = int((~keep_mask).sum())
    if n_dropped:
        dropped_syms = live_panel.loc[~keep_mask, "symbol"].tolist()
        log.warning(
            "horizon %dd live forecast: dropping %d symbols below completeness "
            "threshold %.2f: %s",
            horizon, n_dropped, LIVE_COMPLETENESS_MIN, dropped_syms,
        )
    live_panel = live_panel.loc[keep_mask].drop(columns=["_completeness"]).reset_index(drop=True)
    if live_panel.empty:
        log.warning("horizon %dd: live forecast empty after completeness filter", horizon)
        return None

    # Hold out the most recent ~21 business days of the supervised panel for
    # early-stopping validation. Mirrors the walk-forward val window.
    val_n = min(21, max(5, len(train_dates) // 8))
    cutoff = train_dates[-val_n]
    final_train = panel_df[panel_df["ts"] < cutoff]
    final_val = panel_df[panel_df["ts"] >= cutoff]
    if final_train.empty or final_val.empty:
        log.warning("horizon %dd: live forecast train/val split empty", horizon)
        return None

    # (5) Seed ensemble. Each seed gives a different rank — averaging the
    # scores damps the per-fit variance, and cross-seed rank dispersion
    # becomes the per-symbol confidence signal.
    seed_score_frames: list[pd.DataFrame] = []
    seed_rank_frames: list[pd.DataFrame] = []
    for i, seed in enumerate(LIVE_ENSEMBLE_SEEDS):
        params = xgb_baseline.XgbRankParams(seed=seed)
        model_i = xgb_baseline.train(final_train, final_val, feature_cols, params)
        preds_i = xgb_baseline.predict(model_i, live_panel, feature_cols)
        seed_score_frames.append(
            preds_i[["ts", "symbol", "score"]].rename(columns={"score": f"s{i}"})
        )
        seed_rank_frames.append(
            preds_i[["ts", "symbol", "rank"]].rename(columns={"rank": f"r{i}"})
        )

    merged = seed_score_frames[0]
    for f in seed_score_frames[1:]:
        merged = merged.merge(f, on=["ts", "symbol"], how="inner")
    rank_merged = seed_rank_frames[0]
    for f in seed_rank_frames[1:]:
        rank_merged = rank_merged.merge(f, on=["ts", "symbol"], how="inner")

    score_cols = [c for c in merged.columns if c.startswith("s")]
    rank_cols = [c for c in rank_merged.columns if c.startswith("r")]
    merged["score"] = merged[score_cols].mean(axis=1)
    merged["score_std"] = merged[score_cols].std(axis=1)
    merged = merged.merge(rank_merged[["ts", "symbol", *rank_cols]], on=["ts", "symbol"])

    merged["rank"] = (
        merged.groupby("ts")["score"].rank(method="first", ascending=False).astype(int)
    )

    # Confidence: how tightly the seeds agreed on this symbol's rank. We use
    # 1 − (mean absolute deviation of seed ranks from the ensemble rank) / N,
    # so 1.0 = every seed placed the symbol at the same position the ensemble
    # did, 0.0 = seed ranks span the whole universe.
    n_syms = len(merged)
    rank_array = merged[rank_cols].to_numpy()
    ens_rank = merged["rank"].to_numpy().reshape(-1, 1)
    mad = (rank_array - ens_rank).__abs__().mean(axis=1)
    merged["confidence"] = (1.0 - mad / max(1, n_syms - 1)).clip(0.0, 1.0)

    mean_conf = float(merged["confidence"].mean())
    mean_std = float(merged["score_std"].mean())
    log.info(
        "horizon %dd live forecast: %d symbols asof=%s mean_conf=%.2f mean_score_std=%.3f",
        horizon, n_syms, asof_ts, mean_conf, mean_std,
    )

    for r in merged.itertuples():
        out_rows.append(
            {
                "run_ts": run_ts,
                "target_ts": _to_utc(r.ts),
                "symbol": str(r.symbol),
                "horizon_d": int(horizon),
                "model": MODEL_NAME,
                "rank": int(r.rank),
                "score": float(r.score),
                "confidence": float(r.confidence),
                "explanation": "live_forecast",
            }
        )

    return {
        "asof": _to_utc(asof_ts),
        "n": n_syms,
        "n_dropped": n_dropped,
        "mean_conf": mean_conf,
        "mean_score_std": mean_std,
        "n_seeds": len(LIVE_ENSEMBLE_SEEDS),
    }


def train_baseline(
    database_url: str,
    horizons: tuple[int, ...] = (5, 10, 20),
) -> dict:
    """Walk-forward XGBoost rank baseline.

    Returns a dict mapping horizon -> walk-forward summary metrics.
    """
    with connect(database_url) as conn:
        prices = _load_prices(conn)
        features = _load_features(conn)

    if prices.empty or features.empty:
        raise RuntimeError("prices_daily or features_daily is empty; run backfill+features first")

    targets_df = targets_mod.compute_targets(
        prices, target_symbols=PREDICTION_TARGETS, horizons=horizons
    )

    run_ts = datetime.now(UTC)
    summary: dict[int, dict] = {}
    all_pred_rows: list[dict] = []
    live_summary: dict[int, dict] = {}

    for h in horizons:
        log.info("=== horizon %dd ===", h)
        panel_df, feature_cols = model_panel.build_panel(features, targets_df, horizon=h)
        if panel_df.empty:
            log.warning("horizon %d: empty panel", h)
            continue

        log.info(
            "horizon %dd: panel %d rows, %d features, %d dates",
            h,
            len(panel_df),
            len(feature_cols),
            panel_df["ts"].nunique(),
        )

        preds, fold_metrics = walk_forward.run(panel_df, feature_cols)
        if preds.empty:
            log.warning("horizon %d: no folds produced", h)
            continue

        oos = metrics.summarize(preds)
        oos["n_folds"] = len(fold_metrics)
        summary[h] = oos
        log.info(
            "horizon %dd OOS: AUC=%.3f IC=%.3f Sharpe=%.2f hit=%.2f folds=%d",
            h, oos["auc"], oos["ic"], oos["sharpe"], oos["hit_rate"], oos["n_folds"],
        )

        for r in preds.itertuples():
            all_pred_rows.append(
                {
                    "run_ts": run_ts,
                    "target_ts": _to_utc(r.ts),
                    "symbol": str(r.symbol),
                    "horizon_d": int(h),
                    "model": MODEL_NAME,
                    "rank": int(r.rank),
                    "score": float(r.score),
                    "confidence": None,
                    "explanation": None,
                }
            )

        # ----- live forward forecast -----
        # The OOS predictions above only cover historical test folds (their
        # target_ts is at most last_close − horizon business days, because the
        # target join in build_panel requires t+N to be observed). To predict
        # FUTURE movement we train an ensemble of final models on the entire
        # supervised panel and score the latest feature row. The forward target
        # date is reconstructed downstream as last_feature_ts + horizon BD.
        live_info = _emit_live_forecast(
            features=features,
            prices=prices,
            panel_df=panel_df,
            feature_cols=feature_cols,
            horizon=h,
            run_ts=run_ts,
            out_rows=all_pred_rows,
        )
        if live_info is not None:
            live_summary[h] = live_info

    # Guard: detect degenerate rank distribution before persisting. Past bug saw
    # every row land at rank=1 — refuse to overwrite good data with bad data.
    if all_pred_rows:
        rank_values = [r["rank"] for r in all_pred_rows]
        unique_ranks = len(set(rank_values))
        n_unique_target_ts = len({(r["target_ts"], r["horizon_d"]) for r in all_pred_rows})
        if unique_ranks <= 1 and n_unique_target_ts > 1:
            raise RuntimeError(
                f"degenerate rank: only {unique_ranks} unique rank value(s) across "
                f"{len(all_pred_rows)} predictions. Refusing to upsert — investigate "
                f"feature pipeline / model training."
            )
        if unique_ranks < max(2, n_unique_target_ts):
            log.warning(
                "rank distribution looks suspicious: %d unique rank values across %d "
                "(target_ts, horizon) groups",
                unique_ranks,
                n_unique_target_ts,
            )

    with connect(database_url) as conn:
        n = _upsert_predictions(conn, all_pred_rows)
        conn.commit()
    log.info("predictions: upserted %d rows", n)

    return {
        "horizons": summary,
        "n_predictions": n,
        "run_ts": run_ts.isoformat(),
        "live_forecast": {
            h: {
                "asof": v["asof"].isoformat(),
                "n_symbols": v["n"],
                "n_dropped": v.get("n_dropped", 0),
                "n_seeds": v.get("n_seeds"),
                "mean_conf": v.get("mean_conf"),
                "mean_score_std": v.get("mean_score_std"),
            }
            for h, v in live_summary.items()
        },
    }


def evaluate_latest(database_url: str, horizon: int = 10) -> dict:
    """Compute walk-forward metrics from the most recent predictions in the DB."""
    sql = """
        SELECT p.target_ts AS ts, p.symbol, p.score, p.rank
        FROM predictions p
        WHERE p.horizon_d = %s
          AND p.model = %s
          AND p.run_ts = (
              SELECT MAX(run_ts) FROM predictions WHERE horizon_d = %s AND model = %s
          )
    """
    with psycopg.connect(to_psycopg_url(database_url)) as conn, conn.cursor() as cur:
        cur.execute(sql, (horizon, MODEL_NAME, horizon, MODEL_NAME))
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    preds = pd.DataFrame(rows, columns=cols)
    if preds.empty:
        return {"error": "no predictions for horizon"}

    # Re-attach realized targets from prices
    with connect(database_url) as conn:
        prices = _load_prices(conn)
    targets_df = targets_mod.compute_targets(
        prices, target_symbols=PREDICTION_TARGETS, horizons=(horizon,)
    )
    targets_df = targets_df[targets_df["horizon_d"] == horizon][["ts", "symbol", "target"]]
    targets_df["ts"] = pd.to_datetime(targets_df["ts"], utc=True)
    preds["ts"] = pd.to_datetime(preds["ts"], utc=True)
    merged = preds.merge(targets_df, on=["ts", "symbol"], how="left")

    return metrics.summarize(merged)
