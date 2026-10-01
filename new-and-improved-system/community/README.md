# community/ — Skylit Discord research capture (read-only, personal research)

Captured 2026-10-01 via the user's own logged-in browser (CDP), **never posted or interacted** (see memory `feedback_never_post_externally`).

| folder | what | in git? |
|---|---|---|
| `screenshots/<channel>/` | every real image attachment (3.2 GB, ~12k files), named `<messageId>_<n>.<ext>` | no (gitignored) |
| `dumps/` | `dc_<channel>.json` (full message objects: author, time, text, attachment URLs, reactions, local image paths) + `.md` twins (36 MB) | no (gitignored) |
| `ledgers/` | `calls_<channel>.jsonl` — one structured record per call / level / warning / lesson / result, extracted with `claude -p`; `discord_vision.jsonl` — per-screenshot descriptions (kind, ticker, levels, pattern, P&L) | yes |
| `COMMUNITY_PLAYBOOK.md` | the synthesis: how each caller calls plays, and the deltas vs `../DOCTRINE.md` | yes |

Channels (all captured back to their true start): glitch (5,289 msgs, from 2025-07-17) · giul (1,085, 2026-07-01) · oracle-index (9,836, 2025-07-25) · oracle-non-index (2,072, 2026-05-20) · trade-ideas (5,130, 2025-07-07) · flow-ideas (684, 2026-04-14) · spx-regards (11,131, 2026-05-26).

Tooling lives in the session scratchpad (`discord_read.py`, `extract_calls.py`, `vision_batch.sh`); copies are in `tools/`.
