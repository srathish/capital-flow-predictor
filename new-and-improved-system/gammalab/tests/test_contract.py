"""Unit tests for the point-in-time contract (Appendix B Phase 1). Synthetic data only; no vendor files needed."""
from datetime import date, datetime, timedelta, timezone

import pytest

from gammalab.contract import expiry
from gammalab.contract.calendar import UncoveredDate, in_session, session
from gammalab.contract.events import MapSnapshot, PriceBar, Provenance, SignConvention
from gammalab.contract.pairing import PairingRejected, pair
from gammalab.contract.store import (BarStore, ConventionMismatch, ImmutableViolation, NoSnapshot, SnapshotStore,
                                     StaleSnapshot)

T0 = datetime(2025, 12, 15, 15, 0, tzinfo=timezone.utc)   # 10:00 ET Monday
S = timedelta(seconds=1)
M = timedelta(minutes=1)


def snap(t, lag=60 * S, gex=((1.0, 2.0), (-5.0, 3.0), (4.0, -1.0)), exps=("2025-12-15", "2025-12-16"),
         conv=SignConvention.SKYLIT_NET, rev="r0", prov=Provenance.ARCHIVED_SNAPSHOT, sym="SPY"):
    return MapSnapshot("test", sym, t, t + lag, "2025-12-15", 680.0, exps, (679.0, 680.0, 681.0), gex, None, conv, prov, rev)


def bar(t_open, c=680.0, lag=0 * S, sym="SPY"):
    return PriceBar(sym, "test", t_open, t_open + M, c, c + 0.1, c - 0.1, c, 1000, t_open + M + lag)


# ---- availability timestamps -------------------------------------------------------------------------------------------

def test_asof_never_returns_future_snapshot():
    st = SnapshotStore(SignConvention.SKYLIT_NET)
    st.add(snap(T0))                 # available T0+60s
    st.add(snap(T0 + M))             # available T0+120s
    assert st.asof("SPY", T0 + 90 * S, ttl=5 * M).provider_ts == T0
    assert st.asof("SPY", T0 + 120 * S, ttl=5 * M).provider_ts == T0 + M
    with pytest.raises(NoSnapshot):
        st.asof("SPY", T0 + 59 * S, ttl=5 * M)


def test_provider_ts_alone_does_not_make_snapshot_available():
    st = SnapshotStore(SignConvention.SKYLIT_NET)
    st.add(snap(T0, lag=10 * M))
    with pytest.raises(NoSnapshot):
        st.asof("SPY", T0 + 5 * M, ttl=60 * M)


def test_available_before_provider_ts_rejected():
    with pytest.raises(ValueError):
        snap(T0, lag=-1 * S)


def test_naive_datetimes_rejected():
    with pytest.raises(ValueError):
        snap(T0.replace(tzinfo=None))


def test_bar_not_available_before_close():
    with pytest.raises(ValueError):
        PriceBar("SPY", "t", T0, T0 + M, 1, 1, 1, 1, 1, T0 + 30 * S)


def test_synthetic_future_leak_is_invisible():
    """Insert a snapshot whose provider_ts is earlier but which was published later (late revision): queries before its
    publication must not see it."""
    st = SnapshotStore(SignConvention.SKYLIT_NET)
    st.add(snap(T0))
    st.add(snap(T0 + M, lag=10 * M, rev="late"))   # stamped 15:01, published 15:11
    assert st.asof("SPY", T0 + 5 * M, ttl=10 * M).revision_id == "r0"
    assert st.asof("SPY", T0 + 11 * M, ttl=10 * M).revision_id == "late"


# ---- immutability / revisions -------------------------------------------------------------------------------------------

def test_readding_identical_snapshot_is_idempotent():
    st = SnapshotStore(SignConvention.SKYLIT_NET)
    st.add(snap(T0)); st.add(snap(T0))
    assert len(st) == 1


def test_changed_content_same_id_raises():
    st = SnapshotStore(SignConvention.SKYLIT_NET)
    st.add(snap(T0))
    with pytest.raises(ImmutableViolation):
        st.add(snap(T0, gex=((9.0, 9.0), (9.0, 9.0), (9.0, 9.0))))


def test_revision_gets_new_id_and_both_kept():
    st = SnapshotStore(SignConvention.SKYLIT_NET)
    st.add(snap(T0)); st.add(snap(T0, gex=((9.0, 9.0), (9.0, 9.0), (9.0, 9.0)), rev="r1"))
    assert len(st) == 2


def test_hash_is_content_addressed():
    assert snap(T0).raw_hash == snap(T0).raw_hash
    assert snap(T0).raw_hash != snap(T0, gex=((1.0, 2.0), (-5.0, 3.0), (4.0, -1.5))).raw_hash


# ---- stale-map rejection -------------------------------------------------------------------------------------------------

def test_stale_snapshot_fails_closed():
    st = SnapshotStore(SignConvention.SKYLIT_NET)
    st.add(snap(T0))
    assert st.asof("SPY", T0 + 3 * M, ttl=2 * M + 1 * S)
    with pytest.raises(StaleSnapshot):
        st.asof("SPY", T0 + 4 * M, ttl=2 * M)


def test_reconstructed_blocked_when_evidence_required():
    st = SnapshotStore(SignConvention.SKYLIT_NET)
    st.add(snap(T0, prov=Provenance.RECONSTRUCTED))
    assert st.asof("SPY", T0 + 2 * M, ttl=5 * M)
    with pytest.raises(LookupError):
        st.asof("SPY", T0 + 2 * M, ttl=5 * M, allow_reconstructed=False)


# ---- sign conventions ----------------------------------------------------------------------------------------------------

def test_store_rejects_mixed_conventions():
    st = SnapshotStore(SignConvention.SKYLIT_NET)
    with pytest.raises(ConventionMismatch):
        st.add(snap(T0, conv=SignConvention.UW_OI_CALLS_POS))


def test_convention_is_part_of_the_hash():
    assert snap(T0).raw_hash != snap(T0, conv=SignConvention.UW_OI_CALLS_POS).raw_hash


def test_king_keeps_sign():
    vals = expiry.select(snap(T0), "front")
    assert expiry.king(vals, 680.0) == (680.0, -5.0)


# ---- expiry filters ------------------------------------------------------------------------------------------------------

def test_front_is_first_expiration_only():
    assert expiry.select(snap(T0), "front") == {679.0: 1.0, 680.0: -5.0, 681.0: 4.0}


def test_front_requires_true_0dte():
    s = snap(T0, exps=("2025-12-16", "2025-12-17"))
    with pytest.raises(expiry.NoZeroDTE):
        expiry.select(s, "front")


def test_first_n_sums_columns():
    assert expiry.select(snap(T0), "first_n", n=2) == {679.0: 3.0, 680.0: -2.0, 681.0: 3.0}
    assert expiry.select(snap(T0), "first_n", n=9) == expiry.select(snap(T0), "first_n", n=2)


def test_front_and_aggregate_can_disagree_in_sign():
    """Why the filter matters: strike 681 is +4 front-only but the aggregate differs; 680 is -5 front, -2 aggregate."""
    f, a = expiry.select(snap(T0), "front"), expiry.select(snap(T0), "first_n", n=2)
    assert f[681.0] != a[681.0]


def test_shape_mismatch_rejected():
    with pytest.raises(ValueError):
        snap(T0, gex=((1.0,), (2.0,), (3.0,)))


# ---- event/price pairing -------------------------------------------------------------------------------------------------

def test_pair_uses_last_closed_bar_only():
    bs = BarStore()
    bs.add_many([bar(T0 - M, c=1.0), bar(T0, c=2.0), bar(T0 + M, c=3.0)])
    s = snap(T0, lag=90 * S)               # available 15:01:30; bar 15:00 closed at 15:01, bar 15:01 closes 15:02
    assert pair(s, bs).c == 2.0


def test_pair_never_uses_open_bar_even_at_boundary():
    bs = BarStore()
    bs.add_many([bar(T0, c=2.0), bar(T0 + M, c=3.0)])
    s = snap(T0 + M, lag=60 * S - 1 * S)   # available 15:01:59, bar 15:01 closes at 15:02
    assert pair(s, bs).c == 2.0


def test_pair_rejects_gap_over_120s():
    bs = BarStore()
    bs.add_many([bar(T0 - 5 * M, c=1.0)])
    with pytest.raises(PairingRejected):
        pair(snap(T0), bs)


def test_pair_respects_bar_vendor_lag():
    bs = BarStore()
    bs.add_many([bar(T0, c=2.0, lag=30 * S), bar(T0 - M, c=1.0)])
    s = snap(T0, lag=70 * S)               # available 15:01:10; bar 15:00 available only at 15:01:30
    assert pair(s, bs).c == 1.0


def test_pair_rejects_when_no_bar():
    with pytest.raises(PairingRejected):
        pair(snap(T0), BarStore())


# ---- calendar ------------------------------------------------------------------------------------------------------------

def test_calendar_holiday_weekend_early_close():
    assert session(date(2025, 12, 25)) is None
    assert session(date(2026, 3, 14)) is None                      # Saturday (the mislabeled replay file)
    o, c = session(date(2025, 11, 28))
    assert (c - o) == timedelta(hours=3, minutes=30)
    o, c = session(date(2025, 12, 15))
    assert o == datetime(2025, 12, 15, 14, 30, tzinfo=timezone.utc)
    assert in_session(T0) and not in_session(datetime(2025, 12, 15, 21, 0, tzinfo=timezone.utc))


def test_calendar_dst():
    o, _ = session(date(2025, 7, 1))
    assert o.hour == 13


def test_calendar_refuses_uncovered_year():
    with pytest.raises(UncoveredDate):
        session(date(2030, 1, 2))
