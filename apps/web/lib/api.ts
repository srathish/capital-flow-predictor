import { parseSseStream } from "./sse";
import type {
  AgentsForTickerResponse,
  AgentsTimelineResponse,
  CatalystsResponse,
  CatalystTrackRecordResponse,
  ChartDataResponse,
  ChatMessage,
  ChatStreamEvent,
  CustomWatchlistResponse,
  ExpandedSectorResponse,
  PersonaComparisonResponse,
  FlowParams,
  FlowResponse,
  HoldingsResponse,
  HoldingsSort,
  LeadLagResponse,
  NetworkResponse,
  RedditBacktestSlice,
  RedditMentionsParams,
  RedditMentionsResponse,
  RedditRuleStats,
  RedditPredictResponse,
  RedditScorecardResponse,
  WhalesParams,
  WhalesResponse,
  ScreenerParams,
  StockScreenResponse,
  FinvizPresetsResponse,
  RankingsResponse,
  RunResponse,
  RunStatusResponse,
  SectorsResponse,
  SectorScorecardResponse,
  SectorForwardCallResponse,
  SectorRrgResponse,
  WatchlistResponse,
  WatchlistSector,
} from "./types";

const DEFAULT_BASE_URL = "http://localhost:8000";

export function baseUrl(): string {
  // NEXT_PUBLIC_API_BASE_URL is read at build time on the client; on the server
  // we also accept API_BASE_URL for SSR/RSC fetches.
  const fromEnv =
    typeof window === "undefined"
      ? process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL
      : process.env.NEXT_PUBLIC_API_BASE_URL;
  return fromEnv ?? DEFAULT_BASE_URL;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function authHeaders(): Record<string, string> {
  // NEXT_PUBLIC_API_KEY is read at build time on the client; on the server we
  // also accept the server-only API_KEY. Empty string means "no auth header" —
  // matches the API's "auth disabled when API_KEYS unset" behavior.
  const key =
    typeof window === "undefined"
      ? process.env.API_KEY ?? process.env.NEXT_PUBLIC_API_KEY
      : process.env.NEXT_PUBLIC_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
    cache: init?.cache ?? "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, `${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export { ApiError };

export const api = {
  rankings(params?: { horizon?: number; model?: string; limit?: number }): Promise<RankingsResponse> {
    const sp = new URLSearchParams();
    if (params?.horizon !== undefined) sp.set("horizon", String(params.horizon));
    if (params?.model) sp.set("model", params.model);
    if (params?.limit !== undefined) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    return getJson<RankingsResponse>(`/v1/rankings${qs ? `?${qs}` : ""}`);
  },
  watchlist(): Promise<WatchlistResponse> {
    return getJson<WatchlistResponse>(`/v1/watchlist`);
  },
  watchlistSector(sector: string): Promise<WatchlistSector> {
    return getJson<WatchlistSector>(`/v1/watchlist/${encodeURIComponent(sector)}`);
  },
  agents(ticker: string): Promise<AgentsForTickerResponse> {
    return getJson<AgentsForTickerResponse>(`/v1/agents/${encodeURIComponent(ticker)}`);
  },
  agentsTimeline(ticker: string, agent: string, limit = 30): Promise<AgentsTimelineResponse> {
    return getJson<AgentsTimelineResponse>(
      `/v1/agents/${encodeURIComponent(ticker)}/timeline?agent=${encodeURIComponent(agent)}&limit=${limit}`
    );
  },
  sectors(params?: { horizon?: number; model?: string; history?: number }): Promise<SectorsResponse> {
    const sp = new URLSearchParams();
    if (params?.horizon !== undefined) sp.set("horizon", String(params.horizon));
    if (params?.model) sp.set("model", params.model);
    if (params?.history !== undefined) sp.set("history", String(params.history));
    const qs = sp.toString();
    return getJson<SectorsResponse>(`/v1/sectors${qs ? `?${qs}` : ""}`);
  },
  sectorScorecard(params?: { horizon?: number; model?: string; lookbackRuns?: number }): Promise<SectorScorecardResponse> {
    const sp = new URLSearchParams();
    if (params?.horizon !== undefined) sp.set("horizon", String(params.horizon));
    if (params?.model) sp.set("model", params.model);
    if (params?.lookbackRuns !== undefined) sp.set("lookback_runs", String(params.lookbackRuns));
    const qs = sp.toString();
    return getJson<SectorScorecardResponse>(`/v1/sectors/scorecard${qs ? `?${qs}` : ""}`);
  },
  sectorForwardCall(params?: { horizon?: number; model?: string }): Promise<SectorForwardCallResponse> {
    const sp = new URLSearchParams();
    if (params?.horizon !== undefined) sp.set("horizon", String(params.horizon));
    if (params?.model) sp.set("model", params.model);
    const qs = sp.toString();
    return getJson<SectorForwardCallResponse>(`/v1/sectors/forward-call${qs ? `?${qs}` : ""}`);
  },
  sectorRrg(params?: { tailWeeks?: number; benchmark?: string; nWindow?: number }): Promise<SectorRrgResponse> {
    const sp = new URLSearchParams();
    if (params?.tailWeeks !== undefined) sp.set("tail_weeks", String(params.tailWeeks));
    if (params?.benchmark) sp.set("benchmark", params.benchmark);
    if (params?.nWindow !== undefined) sp.set("n_window", String(params.nWindow));
    const qs = sp.toString();
    return getJson<SectorRrgResponse>(`/v1/sectors/rrg${qs ? `?${qs}` : ""}`);
  },
  redditMentions(params: RedditMentionsParams = {}): Promise<RedditMentionsResponse> {
    const sp = new URLSearchParams();
    sp.set("sort", params.sort ?? "mentions");
    sp.set("limit", String(params.limit ?? 60));
    if (params.q) sp.set("q", params.q);
    if (params.sector) sp.set("sector", params.sector);
    if (params.excludeMeme) sp.set("exclude_meme", "true");
    if (params.watchlist) sp.set("watchlist", "true");
    if (params.backtest) sp.set("backtest", "true");
    return getJson<RedditMentionsResponse>(`/v1/reddit/mentions?${sp}`);
  },
  redditBacktest(): Promise<RedditBacktestSlice[]> {
    return getJson<RedditBacktestSlice[]>(`/v1/reddit/backtest`);
  },
  redditRules(): Promise<RedditRuleStats[]> {
    return getJson<RedditRuleStats[]>(`/v1/reddit/rules`);
  },
  redditPredict(params: { limit?: number; sort?: "pred_return" | "pred_score" } = {}): Promise<RedditPredictResponse> {
    const sp = new URLSearchParams();
    if (params.limit !== undefined) sp.set("limit", String(params.limit));
    if (params.sort) sp.set("sort", params.sort);
    const qs = sp.toString();
    return getJson<RedditPredictResponse>(`/v1/reddit/predict${qs ? `?${qs}` : ""}`);
  },
  redditScorecard(params: { windowDays?: number; modelVersion?: string } = {}): Promise<RedditScorecardResponse> {
    const sp = new URLSearchParams();
    if (params.windowDays !== undefined) sp.set("window_days", String(params.windowDays));
    if (params.modelVersion) sp.set("model_version", params.modelVersion);
    const qs = sp.toString();
    return getJson<RedditScorecardResponse>(`/v1/reddit/scorecard${qs ? `?${qs}` : ""}`);
  },
  redditCatalysts(params: {
    limit?: number;
    minScore?: number;
    ticker?: string;
    hours?: number;
  } = {}): Promise<CatalystsResponse> {
    const sp = new URLSearchParams();
    if (params.limit !== undefined) sp.set("limit", String(params.limit));
    if (params.minScore !== undefined) sp.set("min_score", String(params.minScore));
    if (params.ticker) sp.set("ticker", params.ticker);
    if (params.hours !== undefined) sp.set("hours", String(params.hours));
    const qs = sp.toString();
    return getJson<CatalystsResponse>(`/v1/reddit/catalysts${qs ? `?${qs}` : ""}`);
  },
  redditCatalystTrackRecord(params: {
    days?: number;
    minScore?: number;
  } = {}): Promise<CatalystTrackRecordResponse> {
    const sp = new URLSearchParams();
    if (params.days !== undefined) sp.set("days", String(params.days));
    if (params.minScore !== undefined) sp.set("min_score", String(params.minScore));
    const qs = sp.toString();
    return getJson<CatalystTrackRecordResponse>(
      `/v1/reddit/catalyst-track-record${qs ? `?${qs}` : ""}`,
    );
  },
  correlationNetwork(params: {
    window?: number;
    minCorrelation?: number;
    horizon?: 5 | 10 | 20;
    model?: string;
    asOf?: string;          // YYYY-MM-DD; omit for "now"
    includeMacros?: boolean;
  } = {}): Promise<NetworkResponse> {
    const sp = new URLSearchParams();
    if (params.window !== undefined) sp.set("window", String(params.window));
    if (params.minCorrelation !== undefined) sp.set("min_correlation", String(params.minCorrelation));
    if (params.horizon !== undefined) sp.set("horizon", String(params.horizon));
    if (params.model) sp.set("model", params.model);
    if (params.asOf) sp.set("as_of", params.asOf);
    if (params.includeMacros) sp.set("include_macros", "true");
    const qs = sp.toString();
    return getJson<NetworkResponse>(`/v1/network/correlation${qs ? `?${qs}` : ""}`);
  },
  leadLagNetwork(params: {
    maxP?: number;
    minLag?: number;
    maxLag?: number;
    horizon?: 5 | 10 | 20;
    model?: string;
  } = {}): Promise<LeadLagResponse> {
    const sp = new URLSearchParams();
    if (params.maxP !== undefined) sp.set("max_p", String(params.maxP));
    if (params.minLag !== undefined) sp.set("min_lag", String(params.minLag));
    if (params.maxLag !== undefined) sp.set("max_lag", String(params.maxLag));
    if (params.horizon !== undefined) sp.set("horizon", String(params.horizon));
    if (params.model) sp.set("model", params.model);
    const qs = sp.toString();
    return getJson<LeadLagResponse>(`/v1/network/lead-lag${qs ? `?${qs}` : ""}`);
  },
  expandSector(etf: string, params: {
    window?: number;
    minCorrelation?: number;
    top?: number;
  } = {}): Promise<ExpandedSectorResponse> {
    const sp = new URLSearchParams();
    if (params.window !== undefined) sp.set("window", String(params.window));
    if (params.minCorrelation !== undefined) sp.set("min_correlation", String(params.minCorrelation));
    if (params.top !== undefined) sp.set("top", String(params.top));
    const qs = sp.toString();
    return getJson<ExpandedSectorResponse>(
      `/v1/network/sector/${encodeURIComponent(etf)}/expand${qs ? `?${qs}` : ""}`
    );
  },
  flowUnusual(params: FlowParams = {}): Promise<FlowResponse> {
    const sp = new URLSearchParams();
    if (params.lookbackHours !== undefined) sp.set("lookback_hours", String(params.lookbackHours));
    if (params.ticker) sp.set("ticker", params.ticker);
    if (params.kind) sp.set("kind", params.kind);
    if (params.minPremium !== undefined) sp.set("min_premium", String(params.minPremium));
    if (params.limit !== undefined) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    return getJson<FlowResponse>(`/v1/flow/unusual${qs ? `?${qs}` : ""}`);
  },
  whaleBets(params: WhalesParams = {}): Promise<WhalesResponse> {
    const sp = new URLSearchParams();
    if (params.windowHours !== undefined) sp.set("window_hours", String(params.windowHours));
    if (params.direction) sp.set("direction", params.direction);
    if (params.minScore !== undefined) sp.set("min_score", String(params.minScore));
    if (params.limit !== undefined) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    return getJson<WhalesResponse>(`/v1/flow/whales${qs ? `?${qs}` : ""}`);
  },
  screenStocks(params: ScreenerParams = {}): Promise<StockScreenResponse> {
    const sp = new URLSearchParams();
    if (params.signal) sp.set("signal", params.signal);
    if (params.minConfidence !== undefined) sp.set("min_confidence", String(params.minConfidence));
    if (params.sector) sp.set("sector", params.sector);
    if (params.minOi !== undefined) sp.set("min_oi", String(params.minOi));
    if (params.minIvRank !== undefined) sp.set("min_iv_rank", String(params.minIvRank));
    if (params.excludeEarningsWithinDays !== undefined)
      sp.set("exclude_earnings_within_days", String(params.excludeEarningsWithinDays));
    if (params.limit !== undefined) sp.set("limit", String(params.limit));
    if (params.lookbackDays !== undefined) sp.set("lookback_days", String(params.lookbackDays));
    if (params.finvizPreset) sp.set("finviz_preset", params.finvizPreset);
    const qs = sp.toString();
    return getJson<StockScreenResponse>(`/v1/stocks/screen${qs ? `?${qs}` : ""}`);
  },
  finvizPresets(): Promise<FinvizPresetsResponse> {
    return getJson<FinvizPresetsResponse>("/v1/stocks/finviz-presets");
  },
  chartData(ticker: string, days = 180): Promise<ChartDataResponse> {
    return getJson<ChartDataResponse>(
      `/v1/agents/${encodeURIComponent(ticker)}/chart-data?days=${days}`
    );
  },
  etfHoldings(
    etf: string,
    sort: HoldingsSort = "weight",
    direction: "asc" | "desc" = "desc",
    limit = 500,
    horizon = 10,
  ): Promise<HoldingsResponse> {
    const sp = new URLSearchParams({ sort, direction, limit: String(limit), horizon: String(horizon) });
    return getJson<HoldingsResponse>(
      `/v1/sectors/${encodeURIComponent(etf)}/holdings?${sp}`
    );
  },
  agentsAtRun(ticker: string, runTs: string): Promise<AgentsForTickerResponse> {
    return getJson<AgentsForTickerResponse>(
      `/v1/agents/${encodeURIComponent(ticker)}?run_ts=${encodeURIComponent(runTs)}`
    );
  },
  runEnsemble(
    ticker: string,
    sector?: string,
    opts?: { provider?: string; tier?: string }
  ): Promise<RunResponse> {
    const params = new URLSearchParams();
    if (sector) params.set("sector", sector);
    if (opts?.provider) params.set("provider", opts.provider);
    if (opts?.tier) params.set("tier", opts.tier);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return fetch(`${baseUrl()}/v1/agents/${encodeURIComponent(ticker)}/run${qs}`, {
      method: "POST",
      headers: { Accept: "application/json", ...authHeaders() },
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ApiError(res.status, `${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
      }
      return (await res.json()) as RunResponse;
    });
  },
  getRunStatus(ticker: string, runTs: string): Promise<RunStatusResponse> {
    return getJson<RunStatusResponse>(
      `/v1/agents/${encodeURIComponent(ticker)}/runs/${encodeURIComponent(runTs)}`
    );
  },
  // --- Custom (session-keyed) watchlist ---
  listCustomWatchlist(sessionId: string): Promise<CustomWatchlistResponse> {
    return getJson<CustomWatchlistResponse>(`/v1/watchlist/custom/list`, {
      headers: { "X-Session-Id": sessionId },
    });
  },
  addToCustomWatchlist(sessionId: string, ticker: string, note?: string): Promise<CustomWatchlistResponse> {
    return fetch(`${baseUrl()}/v1/watchlist/custom/add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...authHeaders(),
        "X-Session-Id": sessionId,
      },
      body: JSON.stringify({ ticker, note }),
    }).then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
      return (await res.json()) as CustomWatchlistResponse;
    });
  },
  removeFromCustomWatchlist(sessionId: string, ticker: string): Promise<CustomWatchlistResponse> {
    return fetch(`${baseUrl()}/v1/watchlist/custom/${encodeURIComponent(ticker)}`, {
      method: "DELETE",
      headers: { Accept: "application/json", ...authHeaders(), "X-Session-Id": sessionId },
    }).then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
      return (await res.json()) as CustomWatchlistResponse;
    });
  },
  // Pairwise persona comparison
  agentsComparison(ticker: string, left: string, right: string): Promise<PersonaComparisonResponse> {
    const sp = new URLSearchParams({ left, right });
    return getJson<PersonaComparisonResponse>(
      `/v1/agents/${encodeURIComponent(ticker)}/comparison?${sp}`,
    );
  },
  chatEnsemble(
    ticker: string,
    messages: ChatMessage[],
    runTs?: string,
    signal?: AbortSignal
  ): AsyncGenerator<ChatStreamEvent> {
    return streamChat(
      `/v1/agents/${encodeURIComponent(ticker)}/chat/ensemble`,
      messages,
      runTs,
      signal
    );
  },
  chatPersona(
    ticker: string,
    persona: string,
    messages: ChatMessage[],
    runTs?: string,
    signal?: AbortSignal
  ): AsyncGenerator<ChatStreamEvent> {
    return streamChat(
      `/v1/agents/${encodeURIComponent(ticker)}/chat/persona/${encodeURIComponent(persona)}`,
      messages,
      runTs,
      signal
    );
  },
};

async function* streamChat(
  path: string,
  messages: ChatMessage[],
  runTs: string | undefined,
  signal: AbortSignal | undefined
): AsyncGenerator<ChatStreamEvent> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...authHeaders(),
    },
    body: JSON.stringify({ messages, ...(runTs ? { run_ts: runTs } : {}) }),
    signal,
  });
  yield* parseSseStream(res);
}
