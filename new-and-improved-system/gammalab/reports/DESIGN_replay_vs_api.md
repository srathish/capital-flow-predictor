# Pre-registration: Skylit replay archive vs Skylit API (written before any pull)

**Question.** Do the archived replay files (`~/gex-data-replay-reader/data`) match what Skylit's documented
`/v1/historical` API returns for the same instants? Purpose: decide the provenance label of the archive. No trading claim.

**Sample (fixed before pulling).** Eligible days = replay files on trading days with ≥1 frame. 5 days drawn from those with
a `.json.spxw-backup` sibling and 5 from those without, `random.Random(20261106).sample` on the sorted lists. Instants:
10:30, 12:30 and 15:00 ET on each day. One call per instant: `symbols=SPXW,SPY,QQQ`, `metric=gamma`, `maxStrikes=all`,
`maxExpirations=5`, `layout=matrix`, `includeEmpty=true`. 30 calls × 5 credits = 150 credits; the run aborts above that.

**Comparison (per symbol × instant).** Replay frame at the same UTC minute; expiration columns matched by date; strikes
present in both.
- `spot_rel` = |spot_api − spot_replay| / spot_replay
- `r_front`, `r_sum` = Pearson correlation of per-strike values, front (session-date) column and 5-column sum
- `king_front`, `king_sum` = same strike AND sign for the largest |value|
- `mrae` = median relative abs error on strikes with |value| ≥ 1% of the board max (descriptive only)

**Verdicts.** MATCH: spot_rel ≤ 0.0002, r_front ≥ 0.999, r_sum ≥ 0.999, both Kings equal. CLOSE: r_front ≥ 0.98 and
king_front equal. Otherwise DIFFER. If the front column is not the session date in either source, that cell is DIFFER.

**Decision rule.** ≥ 90% MATCH → archive label becomes "archived, sample-verified against API (run id)". Otherwise the label
stays `ARCHIVED_SNAPSHOT` with the mismatch rate recorded, and prior local tests that used the archive are flagged.

**Secondary (descriptive, no verdict).** (a) Alignment: r_sum of the API board vs replay frames at T−1, T, T+1 minutes —
which minute fits best. (b) On backup days, the same metrics for the SPXW `.spxw-backup` file vs the API, to say which SPXW
version Skylit serves today. (c) The API `asOf` and `meta.resolution` per call.
