"""The learning loop — periodic, HUMAN-GATED self-improvement.

Once a month the Nest re-runs a lookahead-safe backtest of its selection signals over recent
history, measures each one's out-of-sample edge (IC / t-stat / OOS-consistency / long-short
spread vs SPY), and — where the measured edge has DIVERGED materially from the prior currently
in config — writes a PROPOSAL. It never rewrites itself: a proposal sits in NEST_HOME/
proposals.json (and posts to Discord) until a human runs `nest learn apply`, which merges the
approved priors into NEST_HOME/prior_overrides.json (which config.prior_of reads on top of the
code defaults). Learning that *proposes* structure and asks before changing anything that
touches money — the right amount of autonomy.
"""
