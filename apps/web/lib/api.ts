import { parseSseStream } from "./sse";
import type {
  AgentsForTickerResponse,
  AgentsTimelineResponse,
  CatalystsResponse,
  CatalystTrackRecordResponse,
  CohortDetail,
  CohortListResponse,
  CohortsByTickerResponse,
  ChartDataResponse,
  ChatMessage,
  ChatStreamEvent,
  CustomWatchlistResponse,
  DiscordAuthorsResponse,
  DiscordInventoryResponse,
  DiscordMessagesResponse,
  DiscordNotificationRule,
  DiscordNotificationRulesResponse,
  DiscordSource,
  DiscordSourcesResponse,
  ExpandedSectorResponse,
  CalibrationResponse,
  FlowAggregateResponse,
  FlowCorrelationsResponse,
  FlowMoversResponse,
  FlowSectorTideResponse,
  FlowSuggestedPlaysResponse,
  PersonaComparisonResponse,
  ReplayResponse,
  FlowParams,
  FlowResponse,
  HoldingsResponse,
  HoldingsSort,
  LeadLagResponse,
  NetworkResponse,
  NewsCatalystsResponse,
  RecentNewsResponse,
  RedditBacktestSlice,
  RedditMentionsParams,
  RedditMentionsResponse,
  RedditRuleStats,
  RedditPredictResponse,
  RedditScorecardResponse,
  TickerNewsResponse,
  WhalesParams,
  WhalesResponse,
  ScreenerParams,
  StageScanParams,
  StageScanResponse,
  StageTickerResult,
  StockScreenResponse,
  FinvizPresetsResponse,
  RunResponse,
  RunStatusResponse,
  SectorsResponse,
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

export function authHeaders(): Record<string, string> {
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
  cohorts(windowDays?: number): Promise<CohortListResponse> {
    const qs = windowDays !== undefined ? `?window_days=${windowDays}` : "";
    return getJson<CohortListResponse>(`/v1/cohorts${qs}`);
  },
  cohortDetail(key: string, windowDays?: number): Promise<CohortDetail> {
    const qs = windowDays !== undefined ? `?window_days=${windowDays}` : "";
    return getJson<CohortDetail>(`/v1/cohorts/${encodeURIComponent(key)}${qs}`);
  },
  cohortsByTicker(ticker: string, windowDays?: number): Promise<CohortsByTickerResponse> {
    const qs = windowDays !== undefined ? `?window_days=${windowDays}` : "";
    return getJson<CohortsByTickerResponse>(
      `/v1/cohorts/by-ticker/${encodeURIComponent(ticker)}${qs}`
    );
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
  newsForTicker(ticker: string, limit = 30): Promise<TickerNewsResponse> {
    const sp = new URLSearchParams({ limit: String(limit) });
    return getJson<TickerNewsResponse>(
      `/v1/news/ticker/${encodeURIComponent(ticker)}?${sp}`,
    );
  },
  newsRecent(tickers: string[], limit = 8): Promise<RecentNewsResponse> {
    if (tickers.length === 0) {
      return Promise.resolve({ n_tickers: 0, items_by_ticker: {} });
    }
    const sp = new URLSearchParams({
      tickers: tickers.slice(0, 25).join(","),
      limit: String(limit),
    });
    return getJson<RecentNewsResponse>(`/v1/news/recent?${sp}`);
  },
  newsCatalysts(params: {
    tickers: string[];
    hours?: number;
    minScore?: number;
    limit?: number;
  }): Promise<NewsCatalystsResponse> {
    if (params.tickers.length === 0) {
      return Promise.resolve({
        n_total: 0,
        n_sources_used: 0,
        sources_used: [],
        items: [],
      });
    }
    const sp = new URLSearchParams({
      tickers: params.tickers.slice(0, 25).join(","),
    });
    if (params.hours !== undefined) sp.set("hours", String(params.hours));
    if (params.minScore !== undefined) sp.set("min_score", String(params.minScore));
    if (params.limit !== undefined) sp.set("limit", String(params.limit));
    return getJson<NewsCatalystsResponse>(`/v1/news/catalysts?${sp}`);
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
    if (params.sort) sp.set("sort", params.sort);
    const qs = sp.toString();
    return getJson<StockScreenResponse>(`/v1/stocks/screen${qs ? `?${qs}` : ""}`);
  },
  stageScan(params: StageScanParams = {}): Promise<StageScanResponse> {
    const sp = new URLSearchParams();
    if (params.universe) sp.set("universe", params.universe);
    if (params.tickers) sp.set("tickers", params.tickers);
    if (params.onlyArmed) sp.set("only_armed", "true");
    if (params.limit !== undefined) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    return getJson<StageScanResponse>(`/v1/stage/scan${qs ? `?${qs}` : ""}`);
  },
  stageTicker(ticker: string): Promise<StageTickerResult> {
    return getJson<StageTickerResult>(`/v1/stage/${encodeURIComponent(ticker.toUpperCase())}`);
  },
  agentsReplay(ticker: string, isoDate: string): Promise<ReplayResponse> {
    return getJson<ReplayResponse>(
      `/v1/agents/${encodeURIComponent(ticker)}/replay?date=${encodeURIComponent(isoDate)}`,
    );
  },
  flowAggregate(ticker: string): Promise<FlowAggregateResponse> {
    // Server defaults to days=730 (~"all data we have"). No window param needed.
    return getJson<FlowAggregateResponse>(
      `/v1/flow/aggregate/${encodeURIComponent(ticker)}`,
    );
  },
  flowSuggestPlays(ticker: string, n = 3): Promise<FlowSuggestedPlaysResponse> {
    return getJson<FlowSuggestedPlaysResponse>(
      `/v1/flow/aggregate/${encodeURIComponent(ticker)}/suggest?n=${n}`,
    );
  },
  flowMovers(limit = 20): Promise<FlowMoversResponse> {
    return getJson<FlowMoversResponse>(`/v1/flow/movers?limit=${limit}`);
  },
  flowSectorTide(sector: string, lookbackHours = 6): Promise<FlowSectorTideResponse> {
    return getJson<FlowSectorTideResponse>(
      `/v1/flow/sector-tide/${encodeURIComponent(sector)}?lookback_hours=${lookbackHours}`,
    );
  },
  flowCorrelations(ticker: string, limit = 20): Promise<FlowCorrelationsResponse> {
    return getJson<FlowCorrelationsResponse>(
      `/v1/flow/correlations/${encodeURIComponent(ticker.toUpperCase())}?limit=${limit}`,
    );
  },
  screenerCalibration(params: { days?: number; horizon?: 5 | 10 | 20 | 60 } = {}): Promise<CalibrationResponse> {
    const sp = new URLSearchParams();
    if (params.days !== undefined) sp.set("days", String(params.days));
    if (params.horizon !== undefined) sp.set("horizon", String(params.horizon));
    const qs = sp.toString();
    return getJson<CalibrationResponse>(`/v1/stocks/screen/calibration${qs ? `?${qs}` : ""}`);
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
  discordMessages(params: {
    limit?: number;
    since?: string;
    guildName?: string;
    channelName?: string;
    q?: string;
  } = {}): Promise<DiscordMessagesResponse> {
    const sp = new URLSearchParams();
    if (params.limit !== undefined) sp.set("limit", String(params.limit));
    if (params.since) sp.set("since", params.since);
    if (params.guildName) sp.set("guild_name", params.guildName);
    if (params.channelName) sp.set("channel_name", params.channelName);
    if (params.q) sp.set("q", params.q);
    const qs = sp.toString();
    return getJson<DiscordMessagesResponse>(`/v1/discord/messages${qs ? `?${qs}` : ""}`);
  },
  discordSources(): Promise<DiscordSourcesResponse> {
    return getJson<DiscordSourcesResponse>(`/v1/discord/sources`);
  },
  discordInventory(): Promise<DiscordInventoryResponse> {
    return getJson<DiscordInventoryResponse>(`/v1/discord/inventory`);
  },
  discordAddSource(body: {
    guild_name: string;
    channel_name: string;
    label?: string | null;
    include_threads?: boolean;
  }): Promise<DiscordSource> {
    return fetch(`${baseUrl()}/v1/discord/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
      return (await res.json()) as DiscordSource;
    });
  },
  discordDeleteSource(id: number): Promise<void> {
    return fetch(`${baseUrl()}/v1/discord/sources/${id}`, {
      method: "DELETE",
      headers: { ...authHeaders() },
    }).then((res) => {
      if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
    });
  },
  discordAuthors(params: { lookbackDays?: number; minResolved?: number } = {}): Promise<DiscordAuthorsResponse> {
    const sp = new URLSearchParams();
    if (params.lookbackDays !== undefined) sp.set("lookback_days", String(params.lookbackDays));
    if (params.minResolved !== undefined) sp.set("min_resolved", String(params.minResolved));
    const qs = sp.toString();
    return getJson<DiscordAuthorsResponse>(`/v1/discord/authors${qs ? `?${qs}` : ""}`);
  },
  discordNotificationRules(): Promise<DiscordNotificationRulesResponse> {
    return getJson<DiscordNotificationRulesResponse>(`/v1/discord/notifications/rules`);
  },
  discordAddNotificationRule(body: {
    name: string;
    min_confluence: number;
    tickers: string[];
    channel: "ntfy" | "discord_webhook";
    target: string;
  }): Promise<DiscordNotificationRule> {
    return fetch(`${baseUrl()}/v1/discord/notifications/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
      return (await res.json()) as DiscordNotificationRule;
    });
  },
  discordDeleteNotificationRule(id: number): Promise<void> {
    return fetch(`${baseUrl()}/v1/discord/notifications/rules/${id}`, {
      method: "DELETE",
      headers: { ...authHeaders() },
    }).then((res) => {
      if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
    });
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
