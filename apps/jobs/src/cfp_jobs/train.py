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
from cfp_models import metrics, walk_forward
from cfp_models import panel as model_panel
from cfp_models import targets as targets_mod
from cfp_shared.universe import PREDICTION_TARGETS

from cfp_jobs.db import connect, to_psycopg_url

log = logging.getLogger(__name__)

MODEL_NAME = "xgb_v1"


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

    return {"horizons": summary, "n_predictions": n, "run_ts": run_ts.isoformat()}


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
