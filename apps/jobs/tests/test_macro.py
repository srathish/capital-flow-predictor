from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
from cfp_jobs.ingestion.macro import fetch_series


def test_fetch_series_filters_nans() -> None:
    dates = pd.date_range("2024-01-01", periods=5, freq="D")
    series = pd.Series([4.25, np.nan, 4.30, 4.28, np.nan], index=dates)

    fake_fred = MagicMock()
    fake_fred.get_series.return_value = series

    with patch("cfp_jobs.ingestion.macro.Fred", return_value=fake_fred):
        rows = fetch_series("fake_key", "DGS10", datetime(2024, 1, 1, tzinfo=UTC))

    assert len(rows) == 3
    assert all(r["series_id"] == "DGS10" for r in rows)
    assert rows[0]["value"] == 4.25
    assert rows[0]["ts"].tzinfo is not None


def test_fetch_series_empty() -> None:
    fake_fred = MagicMock()
    fake_fred.get_series.return_value = pd.Series([], dtype=float)

    with patch("cfp_jobs.ingestion.macro.Fred", return_value=fake_fred):
        rows = fetch_series("fake_key", "DGS10", datetime(2024, 1, 1, tzinfo=UTC))

    assert rows == []
