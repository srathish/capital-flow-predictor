import type {
  AgentsForTickerResponse,
  AgentsTimelineResponse,
  RankingsResponse,
  SectorsResponse,
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
  sectors(params?: { horizon?: number; model?: string }): Promise<SectorsResponse> {
    const sp = new URLSearchParams();
    if (params?.horizon !== undefined) sp.set("horizon", String(params.horizon));
    if (params?.model) sp.set("model", params.model);
    const qs = sp.toString();
    return getJson<SectorsResponse>(`/v1/sectors${qs ? `?${qs}` : ""}`);
  },
};
