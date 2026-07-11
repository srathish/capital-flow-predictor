#!/bin/zsh
# Weekly brain sweep: discover new material -> inbox (human-gated), reindex,
# commit + push the corpus. Installed by com.bellwether.brain-sweep.plist.
set -euo pipefail
cd "/Users/saiyeeshrathish/the final plan"

uv run --package brain brain sweep --feeds-only
uv run --package brain brain index

if ! git diff --quiet apps/brain/vault apps/brain/inbox 2>/dev/null || \
   [ -n "$(git ls-files --others --exclude-standard apps/brain/vault apps/brain/inbox)" ]; then
  git add apps/brain/vault apps/brain/inbox
  git commit -m "chore(brain): weekly sweep $(date +%F) — inbox additions await review"
  git push
fi
