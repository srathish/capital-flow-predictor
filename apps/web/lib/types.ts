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
};

export type ChartDataResponse = {
  ticker: string;
  bars: OhlcvBar[];
  markers: ChartMarker[];
};

// /v1/network/correlation
export type NetworkBucket = "leader" | "mid" | "laggard" | "unranked";

export type NetworkNode = {
  id: string;
  name: string;
  rank: number | null;
  score: number | null;
  bucket: NetworkBucket;
  return_window: number | null;
  avg_correlation: number;
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
};

export type HoldingsResponse = {
  etf: string;
  n_holdings: number;
  last_updated: string | null;
  sort: string;
  holdings: HoldingEntry[];
};

export type HoldingsSort =
  | "weight"
  | "return_1d"
  | "return_5d"
  | "return_20d"
  | "return_60d"
  | "call_put_ratio"
  | "bullish_pct"
  | "ticker"
  | "pct_off_52w_high"
  | "volume_z";

// /v1/reddit/mentions
export type RedditSubMentions = {
  subreddit: string;
  mentions: number;
  rank: number | null;
};

export type RedditMentionRow = {
  ticker: string;
  name: string | null;
  mentions_today: number;
  mentions_7d_avg: number;
  spike_ratio: number | null;
  rank_today: number | null;
  rank_7d_ago: number | null;
  rank_change_7d: number | null;
  upvotes_today: number;
  is_contrarian_warning: boolean;
  is_stealth: boolean;
  sparkline_7d: number[];
  by_subreddit: RedditSubMentions[];
};

export type RedditMentionsResponse = {
  snapshot_date: string | null;
  n_total: number;
  rows: RedditMentionRow[];
};

export type RedditMentionsSort = "mentions" | "spike" | "rank_change";

// /v1/reddit/catalysts
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
};

export type CatalystsResponse = {
  n_total: number;
  posts: CatalystPost[];
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

// /v1/sectors
export type SectorEntry = {
  symbol: string;
  latest_rank: number | null;
  latest_score: number | null;
  horizon_d: number | null;
  n_constituents: number;
};

export type SectorsResponse = {
  run_ts: string | null;
  sectors: SectorEntry[];
};
