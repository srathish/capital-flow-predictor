import { parseSseStream } from "./sse";
import type {
  AgentsForTickerResponse,
  AgentsTimelineResponse,
  CatalystsResponse,
  ChartDataResponse,
  ChatMessage,
  ChatStreamEvent,
  HoldingsResponse,
  HoldingsSort,
  NetworkResponse,
  RedditBacktestSlice,
  RedditMentionsParams,
  RedditMentionsResponse,
  RankingsResponse,
  RunResponse,
  RunStatusResponse,
  SectorsResponse,
  SectorScorecardResponse,
  WatchlistResponse,
  WatchlistSector,
} from "./types";

const DEFAULT_BASE_URL = "http://localhost:8000";

function baseUrl(): string {
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

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
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
  correlationNetwork(params: {
    window?: number;
    minCorrelation?: number;
    horizon?: 5 | 10 | 20;
    model?: string;
  } = {}): Promise<NetworkResponse> {
    const sp = new URLSearchParams();
    if (params.window !== undefined) sp.set("window", String(params.window));
    if (params.minCorrelation !== undefined) sp.set("min_correlation", String(params.minCorrelation));
    if (params.horizon !== undefined) sp.set("horizon", String(params.horizon));
    if (params.model) sp.set("model", params.model);
    const qs = sp.toString();
    return getJson<NetworkResponse>(`/v1/network/correlation${qs ? `?${qs}` : ""}`);
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
  runEnsemble(ticker: string, sector?: string): Promise<RunResponse> {
    const qs = sector ? `?sector=${encodeURIComponent(sector)}` : "";
    return fetch(`${baseUrl()}/v1/agents/${encodeURIComponent(ticker)}/run${qs}`, {
      method: "POST",
      headers: { Accept: "application/json" },
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
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ messages, ...(runTs ? { run_ts: runTs } : {}) }),
    signal,
  });
  yield* parseSseStream(res);
}
