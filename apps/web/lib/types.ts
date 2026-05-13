// Mirrors apps/api/src/cfp_api/schemas.py — keep in sync.

export type SignalKind = "bullish" | "bearish" | "neutral";
export type WatchlistSignal = "long" | "short" | "avoid";
export type AgentKind = "analyst" | "persona" | "synthesis" | "unknown";

// /v1/rankings
export type RankingItem = {
  rank: number;
  symbol: string;
  score: number | null;
  target_ts: string;
};

export type RankingsResponse = {
  run_ts: string;
  horizon_d: number;
  model: string;
  target_ts: string;
  rankings: RankingItem[];
};

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

// /v1/sectors/scorecard
export type ScorecardBaseline = {
  hit_rate: number | null;
  avg_top3_return: number | null;
  avg_bottom3_return: number | null;
  avg_spread: number | null;
};

// /v1/sectors/forward-call
export type ForwardCallEntry = {
  symbol: string;
  rank: number;
  score: number | null;
  // 0..1 cross-seed rank stability from the live-forecast ensemble.
  // null when the row came from a historical walk-forward fold (no ensemble).
  confidence: number | null;
};

export type HorizonDisagreement = {
  symbol: string;
  active_rank: number;
  other_horizon_d: number;
  other_rank: number;
  delta: number;
};

export type SectorForwardCallResponse = {
  horizon_d: number;
  model: string;
  run_ts: string | null;
  target_ts: string | null;
  stale_days: number | null;
  top: ForwardCallEntry[];
  bottom: ForwardCallEntry[];
  score_spread: number | null;
  conviction: "high" | "medium" | "low";
  stability_runs: number;
  disagreements: HorizonDisagreement[];
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

export type SectorScorecardResponse = {
  horizon_d: number;
  model: string;
  n_runs_evaluated: number;
  n_runs_total: number;
  hit_rate: number | null;
  avg_top3_return: number | null;
  avg_bottom3_return: number | null;
  avg_spread: number | null;
  ic_mean: number | null;
  ic_stdev: number | null;
  ic_t_stat: number | null;
  baseline: ScorecardBaseline;
  last_evaluated_run: string | null;
};

// --- Unusual options flow feed ---------------------------------------------

export type FlowAnomalyKind =
  | "mega_sweep"
  | "block_buy"
  | "ask_aggression"
  | "repeated_hits"
  | "iv_expansion"
  | "oi_explosion"
  | "daily_skew";

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

export type FinvizPreset = {
  key: string;
  label: string;
  thesis: "bullish" | "bearish";
};

export type FinvizPresetsResponse = {
  presets: FinvizPreset[];
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
