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
