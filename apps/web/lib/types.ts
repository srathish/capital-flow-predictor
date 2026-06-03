// Mirrors apps/api/src/cfp_api/schemas.py — keep in sync.

export type SignalKind = "bullish" | "bearish" | "neutral";
export type WatchlistSignal = "long" | "short" | "avoid";
export type AgentKind = "analyst" | "persona" | "synthesis" | "unknown";

// /v1/watchlist
export type WatchlistItem = {
  rank: number;
  ticker: string;
  final_signal: WatchlistSignal;
  final_confidence: number;
  target_weight: number | null;
  rationale: Record<string, unknown>;
};

export type WatchlistSector = {
  sector: string;
  items: WatchlistItem[];
};

export type WatchlistResponse = {
  run_ts: string;
  sectors: WatchlistSector[];
};

// /v1/agents/{ticker}
export type AgentSignalEntry = {
  agent: string;
  kind: AgentKind;
  signal: SignalKind;
  confidence: number;
  rationale: string | null;
  payload: Record<string, unknown>;
};

export type AgentsForTickerResponse = {
  ticker: string;
  run_ts: string;
  signals: AgentSignalEntry[];
};

export type AgentsTimelineEntry = {
  run_ts: string;
  signal: SignalKind;
  confidence: number;
  rationale: string | null;
};

export type AgentsTimelineResponse = {
  ticker: string;
  agent: string;
  entries: AgentsTimelineEntry[];
};

// /v1/agents/{ticker}/run
export type RunResponse = {
  ticker: string;
  run_ts: string;
  status: "started" | "in_progress" | "complete";
  expected_total: number;
};

// /v1/agents/{ticker}/runs/{run_ts}
export type RunStatusResponse = {
  ticker: string;
  run_ts: string;
  expected_total: number;
  completed: number;
  is_complete: boolean;
  signals: AgentSignalEntry[];
};

// /v1/agents/{ticker}/chart-data
export type OhlcvBar = {
  ts: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

export type ChartMarkerType =
  | "flow_call"
  | "flow_put"
  | "insider_buy"
  | "insider_sell"
  | "earnings";

export type ChartMarker = {
  ts: string;
  type: ChartMarkerType;
  price: number | null;
  label: string;
  detail: string | null;
  source_url?: string | null;
};

export type ChartDataResponse = {
  ticker: string;
  bars: OhlcvBar[];
  markers: ChartMarker[];
};

// /v1/network/correlation
export type NetworkBucket = "leader" | "mid" | "laggard" | "unranked";

export type NetworkNodeKind = "sector" | "macro";

export type NetworkNode = {
  id: string;
  name: string;
  rank: number | null;
  score: number | null;
  bucket: NetworkBucket;
  return_window: number | null;
  avg_correlation: number;
  kind?: NetworkNodeKind; // server defaults to "sector"
};

export type NetworkEdge = {
  source: string;
  target: string;
  correlation: number;
};

export type NetworkResponse = {
  window_days: number;
  horizon_d: number;
  min_correlation: number;
  universe: string[];
  n_obs: number;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  as_of: string | null;
};

// /v1/network/lead-lag
export type LeadLagEdge = {
  source: string;
  target: string;
  lag: number;
  p_value: number;
};

export type LeadLagResponse = {
  computed_ts: string | null;
  horizon_d: number;
  max_p: number;
  min_lag: number;
  max_lag: number;
  universe: string[];
  nodes: NetworkNode[];
  edges: LeadLagEdge[];
};

// /v1/network/sector/{etf}/expand
export type ExpandedNode = {
  id: string;
  name: string;
  is_parent: boolean;
  weight: number | null;
  return_window: number | null;
  parent_correlation: number | null;
};

export type ExpandedEdge = {
  source: string;
  target: string;
  correlation: number;
  is_tether: boolean;
};

export type ExpandedSectorResponse = {
  etf: string;
  window_days: number;
  min_correlation: number;
  n_obs: number;
  nodes: ExpandedNode[];
  edges: ExpandedEdge[];
  as_of: string | null;
};

// /v1/sectors/{etf}/holdings
export type HoldingEntry = {
  ticker: string;
  short_name: string | null;
  sector: string | null;
  weight: number | null;
  close: number | null;
  prev_price: number | null;
  return_1d: number | null;
  return_5d: number | null;
  return_20d: number | null;
  return_60d: number | null;
  week52_high: number | null;
  week52_low: number | null;
  pct_off_52w_high: number | null;
  volume: number | null;
  avg30_volume: number | null;
  volume_z: number | null;
  call_premium: number | null;
  put_premium: number | null;
  call_put_ratio: number | null;
  bullish_premium: number | null;
  bearish_premium: number | null;
  bullish_pct: number | null;
  model_score: number | null;
  model_rank: number | null;
};

export type HoldingsResponse = {
  etf: string;
  n_holdings: number;
  last_updated: string | null;
  sort: string;
  holdings: HoldingEntry[];
  median_return_1d: number | null;
  median_return_5d: number | null;
  median_return_20d: number | null;
  pct_above_5d_zero: number | null;
  pct_above_20d_zero: number | null;
};

export type HoldingsSort =
  | "weight"
  | "return_1d"
  | "return_5d"
  | "return_20d"
  | "return_60d"
  | "call_put_ratio"
  | "bullish_pct"
  | "bullish_premium"
  | "bearish_premium"
  | "ticker"
  | "pct_off_52w_high"
  | "volume_z"
  | "model_score";

// /v1/reddit/mentions
export type RedditSubMentions = {
  subreddit: string;
  mentions: number;
  rank: number | null;
};

export type RedditAudienceSkew = "wsb" | "investing" | "mixed" | "unknown";

export type RedditPredictiveSignal = "buy" | "fade" | "watch" | "neutral";

export type RedditRuleId =
  | "contrarian_top"
  | "stealth_setup"
  | "first_time_bull"
  | "wsb_only_hype"
  | "investing_accumulation"
  | "fading_hype"
  | "price_confirming_spike";

export type RedditScoreComponents = {
  spike: number;
  momentum: number;
  sentiment: number;
  audience: number;
  price_confirm: number;
  freshness: number;
  stealth_bonus: number;
};

export type RedditMentionRow = {
  ticker: string;
  name: string | null;
  sector: string | null;
  mentions_today: number;
  mentions_7d_avg: number;
  spike_ratio: number | null;
  rank_today: number | null;
  rank_7d_ago: number | null;
  rank_change_7d: number | null;
  upvotes_today: number;
  is_contrarian_warning: boolean;
  is_stealth: boolean;
  is_first_time_entrant: boolean;
  is_meme: boolean;
  sparkline_7d: number[];
  by_subreddit: RedditSubMentions[];
  audience_skew: RedditAudienceSkew;
  momentum_score: number | null;
  days_in_top20_14d: number;
  sentiment_bull_share: number | null;
  n_bullish_kw: number;
  n_bearish_kw: number;
  price_change_1d: number | null;
  price_change_5d: number | null;
  catalyst_post_count: number;
  mentions_last_6h: number;
  // Predictive layer
  pred_score: number;
  pred_return_20d_pct: number;
  pred_signal: RedditPredictiveSignal;
  pred_confidence: number;
  score_components: RedditScoreComponents;
  matched_rules: RedditRuleId[];
};

export type RedditRuleStats = {
  rule_id: RedditRuleId;
  description: string;
  expected_direction: "long" | "short";
  n_events: number;
  win_rate: number | null;
  mean_20d_return_pct: number | null;
  edge_vs_baseline_pct: number | null;
};

// /v1/reddit/predict
export type RedditModelPrediction = {
  ticker: string;
  pred_return_20d_pct: number | null;
  pred_score: number | null;
  features: Record<string, number | null> | null;
};

export type RedditPredictResponse = {
  status: "ok" | "calibrating";
  snapshot_date: string | null;
  model_version: string | null;
  trained_at: string | null;
  n_predictions: number;
  predictions: RedditModelPrediction[];
};

// /v1/reddit/scorecard
export type RedditScorecardCalibrationBucket = {
  score_bucket: string;
  n: number;
  mean_predicted_pct: number | null;
  mean_realized_pct: number | null;
  hit_rate: number | null;
};

export type RedditScorecardCall = {
  snapshot_date: string;
  ticker: string;
  predicted_pct: number;
  realized_pct: number;
  pred_score: number | null;
  error_pct: number;
};

export type RedditSubredditEdge = {
  subreddit: string;
  n_matured: number;
  mean_realized_20d_pct: number;
  hit_rate_up: number;
  mean_realized_5d_pct: number | null;
};

export type RedditAuthorEdge = {
  author: string;
  subreddit: string | null;
  n_matured: number;
  mean_realized_20d_pct: number;
  hit_rate_up: number;
};

export type RedditScorecardResponse = {
  status: "ok" | "calibrating";
  model_version: string | null;
  window_days: number;
  n_matured: number;
  hit_rate: number | null;
  mean_predicted_pct: number | null;
  mean_realized_pct: number | null;
  mean_abs_error_pct: number | null;
  bullish_hit_rate: number | null;
  bearish_hit_rate: number | null;
  calibration: RedditScorecardCalibrationBucket[];
  top_hits: RedditScorecardCall[];
  top_misses: RedditScorecardCall[];
  subreddit_edges: RedditSubredditEdge[];
  author_edges: RedditAuthorEdge[];
};

export type RedditBacktestSlice = {
  spike_threshold: number;
  n_observations: number;
  mean_5d_return_pct: number | null;
  win_rate: number | null;
};

export type RedditMentionsResponse = {
  snapshot_date: string | null;
  snapshot_age_hours: number | null;
  n_total: number;
  rows: RedditMentionRow[];
  backtest: RedditBacktestSlice[] | null;
};

export type RedditMentionsSort =
  | "mentions"
  | "spike"
  | "rank_change"
  | "momentum"
  | "predicted";

export type RedditMentionsParams = {
  sort?: RedditMentionsSort;
  limit?: number;
  q?: string;
  sector?: string;
  excludeMeme?: boolean;
  watchlist?: boolean;
  backtest?: boolean;
};

// /v1/reddit/catalysts
export type CatalystScoreBreakdown = {
  base: number;
  recency: number;
  trust: number | null;
  n_tickers: number;
  n_keywords: number;
};

export type CatalystPost = {
  id: string;
  created_at: string;
  subreddit: string;
  author: string | null;
  title: string;
  permalink: string | null;
  tickers: string[];
  keywords: string[];
  catalyst_score: number;
  hours_old: number;
  upvotes: number | null;
  num_comments: number | null;
  score_breakdown: CatalystScoreBreakdown;
  lead_ticker: string | null;
  price_at_post: number | null;
  price_next_day: number | null;
  price_now: number | null;
  return_next_day_pct: number | null;
  return_since_post_pct: number | null;
  // Source discriminant — undefined or "reddit" for reddit posts (the
  // historical shape), "news" for items emitted by the news aggregator.
  // News items leave the reddit-specific fields (upvotes, return_*) null.
  source?: "reddit" | "news";
  source_name?: string | null;   // for news: "fmp" | "polygon" | "yahoo-rss" | ...
  publisher?: string | null;     // for news: e.g. "Reuters", "Bloomberg"
  sentiment?: number | null;     // for news: -1..1 where source provides it
  primary_category?: string | null; // pre-classified on the server for news
};

// /v1/news/catalysts — server-side merge counterpart for CatalystPost
export type NewsCatalystItem = {
  id: string;
  created_at: string;
  source: "news";
  source_name: string;
  publisher: string | null;
  title: string;
  permalink: string;
  tickers: string[];
  keywords: string[];
  catalyst_score: number;
  hours_old: number;
  primary_category: string;
  sentiment: number | null;
  score_breakdown: CatalystScoreBreakdown;
};

export type NewsCatalystsResponse = {
  n_total: number;
  n_sources_used: number;
  sources_used: string[];
  items: NewsCatalystItem[];
};

export type CatalystsResponse = {
  n_total: number;
  posts: CatalystPost[];
};

// /v1/reddit/catalyst-track-record
export type CategoryTrackRecord = {
  category: string; // matches CatalystCategoryId on the client
  n_posts: number;
  n_with_return: number;
  hit_rate: number | null;
  avg_return_next_day_pct: number | null;
  median_return_next_day_pct: number | null;
  avg_return_since_post_pct: number | null;
};

export type CatalystTrackRecordResponse = {
  window_days: number;
  n_total_posts: number;
  n_total_with_return: number;
  overall_hit_rate: number | null;
  overall_avg_return_next_day_pct: number | null;
  categories: CategoryTrackRecord[];
};

// /v1/news/ticker/{ticker} and /v1/news/recent — multi-source news aggregator
export type NewsSource =
  | "fmp"
  | "polygon"
  | "yfinance"
  | "yahoo-rss"
  | "google-rss"
  | "seeking-alpha";

export type NewsItem = {
  source: NewsSource | string;
  ticker: string;
  title: string;
  url: string;
  publisher: string | null;
  published_at: string;
  summary: string | null;
  image_url: string | null;
  sentiment: number | null;
  hours_old: number;
  score: number;
};

export type TickerNewsResponse = {
  ticker: string;
  n_items: number;
  sources_used: string[];
  items: NewsItem[];
};

export type RecentNewsResponse = {
  n_tickers: number;
  items_by_ticker: Record<string, NewsItem[]>;
};

// Chat (SSE)
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatStreamEvent =
  | { type: "token"; content: string }
  | { type: "done" }
  | { type: "error"; message: string };

// /v1/assistant/chat — top-level assistant with tool calling
export type AssistantStreamEvent =
  | { type: "text"; content: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; result: unknown }
  | { type: "done" }
  | { type: "error"; message: string };

export type AssistantTurn = { role: "user" | "assistant"; content: string };

// /v1/sectors
export type SectorEntry = {
  symbol: string;
  latest_rank: number | null;
  latest_score: number | null;
  confidence: number | null;
  prior_rank: number | null;
  rank_history: number[]; // oldest → newest
  score_history: number[];
  horizon_d: number | null;
  n_constituents: number;
};

export type SectorsResponse = {
  run_ts: string | null;
  sectors: SectorEntry[];
};

// /v1/cohorts — sub-industry cohort spread analysis
export type CohortPairSpread = {
  leg_a: string;
  leg_b: string;
  n_obs: number;
  last_spread: number;
  mean_spread: number;
  std_spread: number;
  z: number;
  pctile: number | null;
  eg_beta: number | null;
  eg_adf_t: number | null;
  coint_5pct: boolean | null;
  coint_10pct: boolean | null;
};
export type CohortMember = {
  ticker: string;
  ret_window: number | null;
  rel_vs_median: number | null;
  is_leader: boolean;
  is_laggard: boolean;
  earnings_date: string | null;
  earnings_offset_days: number | null;
  earnings_session: string | null;
};
export type CohortSummary = {
  key: string;
  label: string;
  description: string;
  members: string[];
  n_members: number;
  last_close_ts: string | null;
  max_abs_z: number | null;
  max_abs_z_pair: [string, string] | null;
  max_abs_z_coint: boolean | null;
  leader: string | null;
  laggard: string | null;
  leader_earnings_offset_days: number | null;
  laggard_earnings_offset_days: number | null;
};
export type CohortDetail = {
  key: string;
  label: string;
  description: string;
  window_days: number;
  last_close_ts: string | null;
  members: CohortMember[];
  pairs: CohortPairSpread[];
};
export type CohortListResponse = {
  window_days: number;
  cohorts: CohortSummary[];
};
export type CohortsByTickerResponse = {
  ticker: string;
  cohorts: CohortSummary[];
};

// /v1/sectors/rrg — Relative Rotation Graph
export type RrgQuadrant = "leading" | "weakening" | "lagging" | "improving";

export type RrgPoint = {
  ts: string;
  rs_ratio: number;     // ~100 centered; >100 = outperforming benchmark
  rs_momentum: number;  // ~100 centered; >100 = RS-Ratio accelerating
  quadrant: RrgQuadrant;
};

export type RrgSector = {
  symbol: string;
  points: RrgPoint[];
  head_quadrant: RrgQuadrant;
  rotation: "accelerating" | "decelerating" | "stable";
  distance_from_origin: number;
};

export type SectorRrgResponse = {
  benchmark: string;
  tail_weeks: number;
  n_window: number;
  sectors: RrgSector[];
  asof: string | null;
};

// --- Unusual options flow feed ---------------------------------------------

export type FlowAnomalyKind =
  | "mega_sweep"
  | "block_buy"
  | "ask_aggression"
  | "repeated_hits"
  | "iv_expansion"
  | "oi_explosion"
  | "daily_skew"
  | "short_squeeze_setup"
  | "dealer_gamma_flip";

export type FlowCatalyst = {
  kind: "earnings";
  when: string;                 // YYYY-MM-DD
  session: string | null;       // 'pre' | 'post' | 'amc' | 'bmo' | 'unknown'
  days_until: number;           // 0 = today, 1 = tomorrow, …
  expected_move_pct: number | null;
};

export type FlowEvent = {
  ts: string;
  ticker: string;
  kind: FlowAnomalyKind;
  headline: string;
  premium: number | null;
  option_type: "call" | "put" | null;
  expiry: string | null;
  strike: number | null;
  underlying_price: number | null;
  severity: number;
  iv_end: number | null;
  iv_start: number | null;
  ask_side_pct: number | null;
  trade_count: number | null;
  volume_oi_ratio: number | null;
  alert_rule: string | null;
  option_chain: string | null;
  catalyst: FlowCatalyst | null;
};

export type FlowResponse = {
  as_of: string;
  lookback_hours: number;
  count_by_kind: Partial<Record<FlowAnomalyKind, number>>;
  events: FlowEvent[];
};

export type FlowParams = {
  lookbackHours?: number;
  ticker?: string;
  kind?: FlowAnomalyKind;
  minPremium?: number;
  limit?: number;
};

// --- Whale Conviction (derived smart-money score) --------------------------

export type WhaleBet = {
  ticker: string;
  direction: "bull" | "bear";
  score: number;
  window_hours: number;
  window_end: string;
  call_premium: number | null;
  put_premium: number | null;
  ask_side_premium: number | null;
  sweep_count: number | null;
  block_count: number | null;
  opening_share: number | null;
  vol_oi_max: number | null;
  dark_pool_above_mid_prem: number | null;
  insider_buy_7d: number | null;
  congress_buy_14d: number | null;
  iv_rank: number | null;
  against_tape: boolean | null;
  reasons: string[];
};

export type WhalesResponse = {
  as_of: string;
  window_hours: number;
  market_tide: "bull" | "bear" | null;
  count: number;
  bets: WhaleBet[];
};

export type WhalesParams = {
  windowHours?: 4 | 24;
  direction?: "bull" | "bear";
  minScore?: number;
  limit?: number;
};

// --- /v1/stocks/screen ----------------------------------------------------

export type ScreenSignal = "long" | "short" | "avoid" | "any";

export type StockScreenItem = {
  ticker: string;
  sector: string | null;
  final_signal: WatchlistSignal;
  confidence: number;
  target_weight: number | null;
  iv_rank: number | null;
  latest_iv: number | null;
  open_interest: number | null;
  liquidity_ok: boolean;
  next_earnings_date: string | null;
  days_to_earnings: number | null;
  expected_move_pct: number | null;
  near_earnings: boolean;
  composite_score: number;
  opportunity_score: number | null;
  opportunity_breakdown: Record<string, number> | null;
  run_ts: string | null;
  rationale: string | null;
  has_agent_verdict: boolean;
};

export type StockScreenResponse = {
  run_ts: string | null;
  universe_size: number;
  filtered_count: number;
  filters: Record<string, unknown>;
  items: StockScreenItem[];
};

export type ScreenerParams = {
  signal?: ScreenSignal;
  minConfidence?: number;
  sector?: string;
  minOi?: number;
  minIvRank?: number;
  excludeEarningsWithinDays?: number;
  limit?: number;
  lookbackDays?: number;
  finvizPreset?: string;
  sort?: "composite" | "opportunity" | "confidence" | "iv_rank" | "open_interest";
};

// --- /v1/stage (STAGE Scanner: Master pipeline port — see STAGE_DRIFT.md) ----

export type StagePhase = "BASE" | "HANDLE" | "NEUTRAL" | "CAUTION" | "DANGER";

export type StageConditions = {
  // BCS (5)
  stage2_trend: boolean;
  volume_dry_up: boolean;
  atr_contracted: boolean;
  ema_tight: boolean;
  in_base_zone: boolean;
  // HFS (6 — added handle_duration_ok per DRIFT.md fix #3)
  uptrend_active: boolean;
  in_pullback_zone: boolean;
  holding_ema50: boolean;
  range_tight: boolean;
  vol_dry_in_handle: boolean;
  handle_duration_ok: boolean;
};

// Master-gated breakout flags — TRUE iff ALL gates passed today.
// (Not the raw trigger-break test any more — includes G3a Grade and G3b Flow.)
export type StageFiredToday = {
  bcs_breakout: boolean;
  hfs_breakout: boolean;
  breakdown_warn: boolean;
};

export type StageDanger = { stage4: boolean; bear_stack: boolean };

// G3a — breakout quality (0-5) and its 5 components.
export type StageGradeComponents = {
  volume_surge: boolean;
  pre_break_tightness: boolean; // DRIFT.md fix #2 — replaces TV's strongBar
  range_expansion: boolean;
  bb_thrust: boolean;
  bb_expanding: boolean;
};

export type StageGrade = {
  value: number;
  min_required: number;
  ok: boolean;
  rvol: number; // repaint-fixed: volume[i] / vol_ma[i-1]
  components: StageGradeComponents;
};

// G3b — pre-breakout accumulation gate (DRIFT.md fix #1).
// Both components look BACKWARD over the prior flow_len bars, NOT the breakout bar.
export type StageFlow = {
  ok: boolean;
  obv_slope: number;
  obv_slope_positive: boolean;
  up_vol_ratio: number | null; // 999 sentinel for +inf
  up_vol_ratio_ok: boolean;
};

export type StageMasterVerdict =
  | "A-SETUP - GO"
  | "ARMED - WAIT FOR BREAK"
  | "CAUTION - NO NEW LONGS"
  | "DANGER - SKIP"
  | "WATCH / NEUTRAL";

export type StageSizingHint = "skip" | "small" | "standard" | "size_up";

// Recommended option contract sized to the scanner's targets — independent
// of what's actually trading in the flow tape (that's the cross-reference).
export type StageRecommendedPlay = {
  kind: "aggressive_call" | "call_debit_spread" | "leap_conviction";
  label: string;
  option_type: "call" | "put";
  strike: number | null;
  long_strike: number | null;
  short_strike: number | null;
  expiry: string;
  days_to_expiry: number;
  rationale: string;
};

// Plain-English read of the setup — short paragraph + sizing posture so the
// user knows at a glance how to treat this row.
export type StageRead = {
  setup_type: string;
  rarity: "rare" | "uncommon" | "common" | "n/a";
  sizing_hint: StageSizingHint;
  read: string;
};

// Target projections — statistical, not predictions. Measured move added to
// the breakout trigger at 1.0x / 1.618x / 2.0x. Time estimates use ADR_20
// with a directional efficiency band (0.25–0.5). See stage_logic.py.
export type StageTargetDays = {
  optimistic: number | null;
  expected: number | null;
  conservative: number | null;
};

export type StageTarget = {
  price: number;
  gain_pct: number;
  adr_multiple: number;
  days: StageTargetDays;
};

export type StageTargets = {
  adr_pct: number;
  adr_dollars: number;
  base_low: number;
  base_low_lookback_bars: number;
  extension_target: number;
  extension_gain_pct: number;
  stop_price: number;
  stop_pct: number;
  stop_logic: string;
  rr_to_t1: number | null;
  targets: Record<"t1" | "t2" | "t3", StageTarget>;
};

export type StageTickerResult = {
  ticker: string;
  date: string | null;
  close: number | null;
  phase: StagePhase;
  bcs_score: number;
  hfs_score: number; // now scored 0-6 (added handle_duration_ok)
  active_score: number;
  active_ready: boolean;
  trigger_level: number | null;
  distance_pct: number | null;
  pullback_pct: number | null;
  pct_from_52w_high: number | null;
  handle_duration_bars: number | null;
  conditions: StageConditions;
  fired_today: StageFiredToday;
  danger: StageDanger;
  targets: StageTargets | null;
  recommended_plays: StageRecommendedPlay[];
  read: StageRead | null;
  grade: StageGrade | null;
  flow: StageFlow | null;
  master_verdict: StageMasterVerdict;
  error: string | null;
};

export type StageScanResponse = {
  universe: string;
  requested: number;
  scanned: number;
  skipped: number;
  items: StageTickerResult[];
};

export type StageScanParams = {
  universe?: "focus" | "sp500" | "all";
  tickers?: string;
  onlyArmed?: boolean;
  limit?: number;
};

export type FinvizPreset = {
  key: string;
  label: string;
  thesis: "bullish" | "bearish";
};

export type FinvizPresetsResponse = {
  presets: FinvizPreset[];
};

export type FlowTopStrike = {
  strike: number;
  option_type: "call" | "put";
  total_premium: number;
  alert_count: number;
  largest_expiry: string | null;
};

export type FlowTopTrade = {
  ts: string;
  option_type: "call" | "put";
  strike: number;
  expiry: string | null;
  total_premium: number;
  ask_side_pct: number | null;
  alert: string | null;
  option_chain: string | null;
};

export type FlowSuggestedPlay = {
  rank: number;
  conviction: "high" | "medium" | "mixed";
  conviction_score: number;
  strike: number;
  option_type: "call" | "put";
  expiry: string;
  days_to_expiry: number;
  oi_delta_30d: number;
  current_oi: number;
  days_of_oi_increases: number | null;
  alerts_count: number;
  alerts_premium: number;
  avg_ask_side_pct: number | null;
  bucket_score: number;
  ensemble_aligned: boolean;
  ensemble_alignment_count: number;
  ensemble_opposing_count: number;
  ensemble_directional_voters: number;
  ensemble_total_voters: number;
  ensemble_pm_signal: string | null;
  contracts: number;
  risk_to_reward: string;
  target_payout_multiple: number;
  stop_loss_pct: number;
  approx_spot_target: number | null;
  // Live contract pricing + EV (added so we don't just say "buy a 420 call"
  // without telling you what it costs and what it's worth). NULL when no
  // mid found within 7d.
  current_mid: number | null;
  cost_per_contract: number | null;
  profit_at_target: number | null;
  loss_at_stop: number | null;
  ev_per_contract: number | null;
  breakeven_probability: number | null;
  price_source: string | null;
  price_as_of: string | null;
  why: string[];
  caveats: string[];
  flip_condition: string;
};

export type FlowSuggestedPlaysResponse = {
  ticker: string;
  spot: number | null;
  n_candidates_considered: number;
  gate: "proceed" | "wait" | "skip";
  gate_reason: string;
  gate_signals: Record<string, string | number | null>;
  plays: FlowSuggestedPlay[];
  method_note: string;
};

export type FlowOiGrowthStrike = {
  strike: number;
  option_type: "call" | "put";
  expiry: string | null;
  oi_delta: number;
  current_oi: number;
  days_with_data: number;
  days_of_oi_increases: number | null;
};

export type FlowExpiryBucket = {
  label: string;
  days_min: number;
  days_max: number | null;
  n_alerts: number;
  call_premium: number;
  put_premium: number;
  net_call_ask: number;
  net_put_ask: number;
  bullish_score: number;
};

export type FlowMaxPainExpiry = {
  expiry: string;
  max_pain_strike: number;
  distance_from_spot_pct: number | null;
};

export type FlowIvRankSnapshot = {
  snapshot_date: string;
  iv30: number | null;
  iv_rank_1y: number | null;
  iv_rank_1y_pct: number | null;
};

export type FlowUpcomingEarnings = {
  report_date: string;
  days_until: number;
  eps_estimate_average: number | null;
  eps_estimate_analyst_count: number | null;
  revenue_estimate_average: number | null;
  revenue_estimate_analyst_count: number | null;
};

export type FlowSectorAlignment = {
  sector: string;
  sector_lean: "bull" | "bear" | "neutral";
  sector_net_call_premium_1h: number;
  sector_net_put_premium_1h: number;
  alignment: "with-sector" | "against-sector" | "neutral";
  headline: string;
};

export type FlowIvTermPoint = {
  expiry: string;
  dte: number | null;
  iv: number | null;
  iv_atm: number | null;
};

export type FlowIvTermStructure = {
  snapshot_date: string;
  points: FlowIvTermPoint[];
  front_iv: number | null;
  back_iv: number | null;
  inverted: boolean;
  inversion_pct: number | null;
};

export type FlowSkewPoint = {
  dte: number;
  skew: number | null;
  call_iv: number | null;
  put_iv: number | null;
};

export type FlowRiskReversalSkew = {
  snapshot_date: string;
  points: FlowSkewPoint[];
  headline: string;
};

export type FlowIvVsRv = {
  snapshot_date: string;
  iv30: number | null;
  rv30: number | null;
  iv_rv_ratio: number | null;
  verdict: "cheap" | "fair" | "rich";
};

export type FlowPeerCorrelation = {
  peer_ticker: string;
  correlation: number | null;
};

export type FlowTopPeers = {
  snapshot_date: string;
  peers: FlowPeerCorrelation[];
};

export type FlowAggregateResponse = {
  ticker: string;
  days: number;
  oldest_alert_ts: string | null;
  newest_alert_ts: string | null;
  coverage_summary: string;
  n_alerts: number;
  total_premium: number;
  total_call_premium: number;
  total_put_premium: number;
  net_call_premium: number;
  net_put_premium: number;
  bullish_score: number;
  verdict: "bullish" | "bearish" | "mixed";
  verdict_reason: string;
  avg_ticket_size: number;
  leap_call_premium: number;
  leap_put_premium: number;
  expiry_buckets: FlowExpiryBucket[];
  expiry_headline: string;
  oi_growth_strikes: FlowOiGrowthStrike[];
  oi_growth_window_days: number;
  top_strikes: FlowTopStrike[];
  top_trades: FlowTopTrade[];
  iv_rank: FlowIvRankSnapshot | null;
  upcoming_earnings: FlowUpcomingEarnings | null;
  max_pain: FlowMaxPainExpiry[];
  sector_alignment: FlowSectorAlignment | null;
  iv_term_structure: FlowIvTermStructure | null;
  risk_reversal_skew: FlowRiskReversalSkew | null;
  iv_vs_rv: FlowIvVsRv | null;
  top_peers: FlowTopPeers | null;
  refresh_queued?: boolean;
};

export type FlowMover = {
  ticker: string;
  price: number | null;
  change: number | null;
  change_percent: number | null;
  volume: number | null;
};

export type FlowMoversResponse = {
  as_of: string;
  top_gainers: FlowMover[];
  top_losers: FlowMover[];
  most_active: FlowMover[];
};

export type FlowSectorTidePoint = {
  ts: string;
  net_call_premium: number | null;
  net_put_premium: number | null;
  net_volume: number | null;
};

export type FlowSectorTideResponse = {
  sector: string;
  lookback_hours: number;
  net_call_premium_sum: number;
  net_put_premium_sum: number;
  lean: "bull" | "bear" | "neutral";
  points: FlowSectorTidePoint[];
};

export type FlowCorrelationPair = {
  fst: string;
  snd: string;
  correlation: number | null;
  min_date: string | null;
  max_date: string | null;
  sample_rows: number | null;
};

export type FlowCorrelationsResponse = {
  snapshot_date: string | null;
  anchor: string;
  pairs: FlowCorrelationPair[];
};

export type CalibrationBucket = {
  label: string;
  lo: number;
  hi: number | null;
  n: number;
  hit_rate_10d: number | null;
  mean_excess_10d: number | null;
  median_excess_10d: number | null;
};

export type CalibrationResponse = {
  window_days: number;
  horizon_days: number;
  hit_threshold: number;
  n_total: number;
  overall_hit_rate: number | null;
  overall_mean_excess: number | null;
  buckets: CalibrationBucket[];
  note: string;
};

export type ReplayForwardReturn = {
  horizon_days: number;
  ticker_return: number | null;
  spy_return: number | null;
  excess_return: number | null;
  hit: boolean | null;
};

export type ReplaySignal = {
  agent: string;
  signal: string | null;
  confidence: number | null;
  rationale: string | null;
  payload: Record<string, unknown>;
};

export type ReplayResponse = {
  ticker: string;
  as_of: string;
  run_ts: string | null;
  has_bundle: boolean;
  pm_signal: string | null;
  pm_confidence: number | null;
  forward_returns: ReplayForwardReturn[];
  signals: ReplaySignal[];
};

export type CustomWatchlistEntry = {
  ticker: string;
  note: string | null;
  added_at: string;
};

export type CustomWatchlistResponse = {
  session_id: string;
  entries: CustomWatchlistEntry[];
};

export type PersonaSnapshot = {
  persona: string;
  signal: string | null;
  confidence: number | null;
  rationale: string | null;
  run_ts: string | null;
};

export type PersonaComparisonResponse = {
  ticker: string;
  left: PersonaSnapshot;
  right: PersonaSnapshot;
  agree: boolean;
  confidence_delta: number;
  summary: string;
};

export type DiscordVerdict = "bull" | "bear" | "neutral" | null;

export type DiscordTickerScore = {
  ticker: string;
  flow: DiscordVerdict;
  gex: DiscordVerdict;
  whale: DiscordVerdict;
  reddit: DiscordVerdict;
  cross_chat_count: number;
  bull_count: number;
  bear_count: number;
  in_watchlist: boolean;
  first_mover: boolean;
  side: string | null;
  strike: number | null;
  expiry: string | null;
  entry_price: number | null;
  entry_underlying: number | null;
  current_underlying: number | null;
  pnl_pct_underlying: number | null;
  status: string | null;
};

export type DiscordMessage = {
  message_id: string;
  guild_id: string;
  guild_name: string;
  channel_id: string;
  channel_name: string;
  thread_id: string | null;
  thread_name: string | null;
  author_id: string;
  author_name: string;
  author_is_bot: boolean;
  content: string;
  attachment_urls: string[];
  posted_at: string;
  tickers: string[];
  scores: DiscordTickerScore[];
  confluence: number;
  has_parsed_play: boolean;
  author_stats: DiscordAuthorStats | null;
};

export type DiscordAuthorStats = {
  author_id: string;
  author_name: string;
  total_plays: number;
  resolved_plays: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  avg_pnl_pct: number | null;
  lookback_days: number;
};

export type DiscordAuthorsResponse = {
  authors: DiscordAuthorStats[];
};

export type DiscordNotificationRule = {
  id: number;
  name: string;
  min_confluence: number;
  tickers: string[];
  channel: "ntfy" | "discord_webhook";
  target: string;
  enabled: boolean;
  created_at: string;
};

export type DiscordNotificationRulesResponse = {
  rules: DiscordNotificationRule[];
};

export type DiscordMessagesResponse = {
  messages: DiscordMessage[];
  total: number;
};

export type DiscordSource = {
  id: number;
  guild_name: string;
  channel_name: string;
  label: string | null;
  include_threads: boolean;
  enabled: boolean;
  created_at: string;
};

export type DiscordSourcesResponse = {
  sources: DiscordSource[];
};

export type DiscordInventoryChannel = {
  channel_id: string;
  channel_name: string;
  is_thread: boolean;
};

export type DiscordInventoryGuild = {
  guild_id: string;
  guild_name: string;
  channels: DiscordInventoryChannel[];
};

export type DiscordInventoryResponse = {
  guilds: DiscordInventoryGuild[];
  refreshed_at: string | null;
};

// ---------- Phase C live feeds (uw_socket-fed) ----------

export type GlobalNewsItem = {
  published_at: string;
  article_id: string;
  headline: string | null;
  source: string | null;
  url: string | null;
  tickers: string[];
  sentiment: number | null;
};

export type GlobalNewsResponse = {
  count: number;
  items: GlobalNewsItem[];
};

export type HaltItem = {
  ts: string;
  ticker: string;
  halt_code: string | null;
  halt_reason: string | null;
  market: string | null;
  resumption_ts: string | null;
  is_active: boolean;
};

export type HaltsResponse = {
  count: number;
  items: HaltItem[];
};

// /v1/admin/explosive/rescore — fire-and-forget manual scoring trigger.
// POST returns 202 immediately; UI polls /rescore/status until done.

export type RescoreTopItem = {
  ticker: string;
  stages?: number;
  score: number;
};

export type RescoreResponse = {
  status: "started" | "cooldown" | "already_running";
  cooldown_remaining: number | null;
  poll_url: string | null;
};

export type RescoreLastResult = {
  snapshot_ts: string | null;
  count: number | null;
  top: RescoreTopItem[];
  elapsed_seconds: number | null;
};

export type RescoreStatusResponse = {
  in_progress: boolean;
  cooldown_remaining: number;
  last_finish_ts: number | null;
  last_result: RescoreLastResult | null;
  last_error: string | null;
};

// Cross-tab confluence — see apps/api/.../routes/confluence.py
export type ConfluenceSourceName =
  | "explosive"
  | "delphi"
  | "whale"
  | "reddit_mentions"
  | "reddit_catalysts"
  | "flow";

export type ConfluenceSource = {
  name: ConfluenceSourceName;
  score: number | null;
  detail: string;
};

export type ConfluenceRow = {
  ticker: string;
  computed_at: string;
  n_sources: number;
  max_source_score: number | null;
  sources: ConfluenceSource[];
  summary: string | null;
};

export type ConfluenceBatchResponse = {
  generated_at: string;
  rows: ConfluenceRow[];
};

// ---------- Talon scanner ----------
export type TalonSetup = {
  ticker: string;
  grade: number;
  direction: "bull" | "bear" | "neutral";
  theme: string;
  call_dom_now: number | null;
  delta_buildup_pct: number | null;
  vanna_ratio_5d_back: number | null;
  gamma_now: number | null;
  gamma_positive: number;
  theme_coherence: number | null;
  n_gex_days: number;
  g_delta_score: number;
  g_vanna_score: number;
  g_theme_score: number;
  g_call_dom_score: number;
  // Dark pool (latest session) — display-only, no grade weight
  dp_vwap: number | null;
  dp_share_pct: number | null;
  dp_skew_pct: number | null;
  dp_volume_total: number | null;
  dp_session_date: string | null;
};

export type TalonScanResponse = {
  scan_id: string;
  scan_date: string;
  generated_at: string;
  started_at?: string;
  elapsed_seconds?: number;
  universe_total: number;
  with_gex_data: number;
  skipped_no_data: number;
  actionable_count: number;
  watchlist_count: number;
  skip_count: number;
  actionable: TalonSetup[];
  watchlist: TalonSetup[];
  skipped_tickers: string[];
  gate_weights_used: Record<string, number>;
  notes: string;
};

export type TalonScanProgress = {
  status: "idle" | "running" | "complete" | "error";
  scan_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  phase: "init" | "prewarm_gex" | "prewarm_dp" | "metrics" | "coherence" | "done" | null;
  phase_progress: number;
  phase_total: number;
  current_ticker: string | null;
  last_error: string | null;
};

export type TalonRecentScanRow = {
  scan_id: string;
  scan_date: string;
  completed_at: string;
  elapsed_seconds: number;
  universe_total: number;
  with_gex_data: number;
  actionable_count: number;
  watchlist_count: number;
  skip_count: number;
};

export type TalonRecentScansResponse = {
  count: number;
  scans: TalonRecentScanRow[];
};

export type TalonUniverseResponse = {
  count: number;
  tickers: string[];
};

// Top Plays — 3 tiered contract picks per top-20 ticker, defensible by UW data
export type TalonTier = "itm" | "atm" | "otm";

export type TalonContractPickEvidence = {
  total_ask_side_prem?: number;
  n_alerts?: number;
  has_sweep?: boolean;
  has_floor?: boolean;
  first_oi?: number | null;
  current_oi?: number | null;
  oi_growth_pct?: number | null;
  first_alert_at?: string | null;
  last_alert_at?: string | null;
  iv_latest_pct?: number | null;
  unbacked_reason?: string;
};

export type TalonContractPick = {
  tier: TalonTier;
  strike: number | null;
  expiry: string | null;
  cost_estimate: number | null;
  breakeven: number | null;
  breakeven_pct_above_price: number | null;
  confidence_score: number;
  evidence: TalonContractPickEvidence;
};

export type TalonTopPlay = {
  ticker: string;
  grade: number;
  direction: "bull" | "bear" | "neutral";
  theme: string;
  call_dom_now: number | null;
  dp_skew_pct: number | null;
  dp_share_pct: number | null;
  current_price: number;
  soft_inval: number | null;
  st_target: number | null;
  swing_targets: number[];
  all_call_walls: number[];
  all_put_walls: number[];
  picks: TalonContractPick[];
  n_picks_backed: number;
};

export type TalonTopPlaysResponse = {
  scan_id: string;
  scan_date: string;
  generated_at: string;
  top_plays: TalonTopPlay[];
  _cache_hit: boolean;
};

// ---------- Talon v2 (full Phase 1.1 → 3.3 signal stack) ----------
export type TalonV2ChartSignals = {
  atr_5: number | null;
  atr_20: number | null;
  atr_ratio: number | null;
  vol_5: number | null;
  vol_20: number | null;
  vol_ratio: number | null;
  above_20d: number | null;
  above_50d: number | null;
  above_200d: number | null;
  pct_from_high_20: number | null;
  slope_4w_pct: number | null;
  coiled_score: number | null;
  coiled: boolean;
};

export type TalonV2CatalystSignals = {
  next_earnings_date: string | null;
  dte_to_earnings: number | null;
  earnings_risk: "imminent" | "near" | "clear" | "past" | "unknown";
};

export type TalonV2WhaleSignals = {
  whale_total_prem_5d: number;
  whale_top_strike: number | null;
  whale_top_expiry: string | null;
  whale_top_strike_prem: number;
  whale_concentration_pct: number | null;
  whale_n_alerts: number;
  whale_sweep_count: number;
  whale_floor_count: number;
  whale_score: number | null;
  whale_flag: boolean;
};

export type TalonV2ShortSignals = {
  si_pct_float: number | null;
  days_to_cover: number | null;
  si_change_pct: number | null;
  squeeze_flag: boolean;
};

export type TalonV2AnalystSignals = {
  analyst_consensus_pt: number | null;
  analyst_pt_vs_spot_pct: number | null;
  analyst_recent_upgrades: number;
  analyst_recent_downgrades: number;
  analyst_skew: "bull" | "bear" | "mixed" | "unknown";
};

export type TalonV2InsiderSignals = {
  insider_recent_buys_count: number;
  insider_recent_buys_total_value: number;
  insider_cluster_flag: boolean;
};

export type TalonV2PatternSignals = {
  pattern: "flat_base" | "high_tight_flag" | "cup_with_handle" | "pullback_to_ma" | null;
  pattern_score: number | null;
  pattern_detail: Record<string, unknown> | null;
};

export type TalonV2FundSignals = {
  market_cap: number | null;
  pe_ratio: number | null;
  rev_growth_yoy: number | null;
  gross_margin: number | null;
  debt_to_equity: number | null;
  fund_quality: "high" | "mid" | "low" | "unknown";
};

export type TalonV2MAGate = {
  grade_v1?: number;
  ma_gate_adjust?: number;
};

// ---------- Talon v2 Top Plays ----------
export type TalonV2PickEvidence = TalonContractPickEvidence & {
  v2_warnings?: string[];
  v2_notes?: string[];
  v2_anchor_notes?: string[];
};

export type TalonV2ContractPick = Omit<TalonContractPick, "evidence"> & {
  evidence: TalonV2PickEvidence;
};

export type TalonV2TopPlay = {
  ticker: string;
  grade: number | null;
  grade_v1?: number;
  ma_gate_adjust?: number;
  direction: "bull" | "bear" | "neutral" | null;
  theme: string;
  current_price: number;
  soft_inval: number | null;
  st_target: number | null;
  swing_targets: number[];
  all_call_walls: number[];
  all_put_walls: number[];
  // v2 carry-through
  coiled_score: number | null;
  pattern: string | null;
  pattern_score: number | null;
  next_earnings_date: string | null;
  dte_to_earnings: number | null;
  earnings_risk: "imminent" | "near" | "clear" | "past" | "unknown";
  whale_score: number | null;
  whale_top_strike: number | null;
  whale_top_expiry: string | null;
  whale_top_strike_prem: number | null;
  whale_flag: boolean;
  squeeze_flag?: boolean;
  analyst_skew?: "bull" | "bear" | "mixed" | "unknown";
  analyst_pt_vs_spot_pct?: number | null;
  insider_cluster_flag?: boolean;
  fund_quality?: "high" | "mid" | "low" | "unknown";
  picks: TalonV2ContractPick[];
  n_picks_backed: number;
  row_warnings: string[];
};

export type TalonV2TopPlaysResponse = {
  v2_scan_id: string;
  scan_date: string;
  generated_at: string;
  top_plays: TalonV2TopPlay[];
  _cache_hit: boolean;
};

export type TalonV2Setup = TalonSetup &
  Partial<TalonV2ChartSignals> &
  Partial<TalonV2CatalystSignals> &
  Partial<TalonV2WhaleSignals> &
  Partial<TalonV2ShortSignals> &
  Partial<TalonV2AnalystSignals> &
  Partial<TalonV2InsiderSignals> &
  Partial<TalonV2PatternSignals> &
  Partial<TalonV2FundSignals> &
  TalonV2MAGate;

export type TalonV2CoiledSetup = TalonV2ChartSignals & {
  ticker: string;
  theme: string;
  grade: number | null;
  direction: "bull" | "bear" | "neutral" | null;
  chart_only?: boolean;
};

export type TalonV2ThemeSummary = {
  n_members_with_data: number;
  n_coiled: number;
  mean_coiled_score: number | null;
  coiled_tickers: string[];
  coiled_basket: boolean;
};

export type TalonV2ScanResponse = Omit<TalonScanResponse, "actionable" | "watchlist"> & {
  actionable: TalonV2Setup[];
  watchlist: TalonV2Setup[];
  v2: true;
  v2_scan_id: string;
  v2_generated_at: string;
  v2_elapsed_seconds: number;
  v2_phases_enabled: string[];
  v2_phases_disabled: string[];
  themes_summary: Record<string, TalonV2ThemeSummary>;
  coiled_themes: string[];
  coiled_setups: TalonV2CoiledSetup[];
  coiled_count: number;
  whale_setups: TalonV2Setup[];
  whale_count: number;
  pattern_setups: TalonV2Setup[];
  pattern_count: number;
  chart_only_coiled: string[];
  v2_notes: string;
};

export type TalonV2ScanPhase =
  | NonNullable<TalonScanProgress["phase"]>
  | "v1_scan"
  | "prewarm_candles"
  | "chart_signals"
  | "prewarm_earnings"
  | "catalyst_signals"
  | "prewarm_flow_alerts"
  | "whale_signals"
  | "prewarm_short"
  | "short_signals"
  | "prewarm_analyst"
  | "analyst_signals"
  | "prewarm_insider"
  | "insider_signals"
  | "pattern_signals"
  | "prewarm_fundamentals"
  | "fundamentals_signals";

export type TalonV2ScanProgress = Omit<TalonScanProgress, "phase"> & {
  phase: TalonV2ScanPhase | null;
};
