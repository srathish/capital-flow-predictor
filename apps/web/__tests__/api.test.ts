import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, baseUrl } from "@/lib/api";

// Capture fetch URL + init so we can assert on query-string assembly without
// hitting a real server. This is the "integration test for lib/api.ts" the
// audit called for — proves the query params get rendered correctly.

const originalFetch = global.fetch;

function mockFetch(jsonBody: unknown, init: { status?: number; statusText?: string } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  global.fetch = vi.fn(async (url: string, fetchInit?: RequestInit) => {
    calls.push({ url, init: fetchInit });
    return new Response(JSON.stringify(jsonBody), {
      status: init.status ?? 200,
      statusText: init.statusText ?? "OK",
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
  delete process.env.API_BASE_URL;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("baseUrl", () => {
  it("falls back to localhost when env unset", () => {
    expect(baseUrl()).toBe("http://localhost:8000");
  });

  it("reads NEXT_PUBLIC_API_BASE_URL on the server side", () => {
    process.env.API_BASE_URL = "https://api.example.com";
    expect(baseUrl()).toBe("https://api.example.com");
  });
});

describe("api.sectorRrg", () => {
  it("sends tail_weeks + benchmark + n_window", async () => {
    const calls = mockFetch({ asOf: "2026-05-01", rrg: [] });
    await api.sectorRrg({ tailWeeks: 8, benchmark: "SPY", nWindow: 14 });
    expect(calls[0].url).toBe(
      "http://localhost:8000/v1/sectors/rrg?tail_weeks=8&benchmark=SPY&n_window=14",
    );
  });
});

describe("api.flowUnusual", () => {
  it("includes ticker, kind, min_premium, limit when provided", async () => {
    const calls = mockFetch({ alerts: [] });
    await api.flowUnusual({ ticker: "NVDA", kind: "mega_sweep", minPremium: 1_000_000, limit: 10 });
    const url = calls[0].url;
    expect(url).toContain("ticker=NVDA");
    expect(url).toContain("kind=mega_sweep");
    expect(url).toContain("min_premium=1000000");
    expect(url).toContain("limit=10");
  });
});

describe("api.agentsTimeline", () => {
  it("uses default limit=30 and encodes the agent param", async () => {
    const calls = mockFetch({ ticker: "NVDA", agent: "buffett", entries: [] });
    await api.agentsTimeline("nvda", "buffett");
    expect(calls[0].url).toBe(
      "http://localhost:8000/v1/agents/nvda/timeline?agent=buffett&limit=30",
    );
  });
});

describe("error handling", () => {
  it("throws ApiError on non-2xx with status preserved", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response("nope", {
          status: 401,
          statusText: "Unauthorized",
          headers: { "Content-Type": "text/plain" },
        }),
    ) as typeof fetch;
    let caught: unknown;
    try {
      await api.sectors();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(401);
  });
});

describe("api.runEnsemble", () => {
  it("POSTs to the run endpoint with sector query string", async () => {
    const calls = mockFetch({ ticker: "NVDA", run_ts: "x", status: "started", expected_total: 25 });
    await api.runEnsemble("NVDA", "Technology");
    expect(calls[0].url).toBe("http://localhost:8000/v1/agents/NVDA/run?sector=Technology");
    expect(calls[0].init?.method).toBe("POST");
  });
});
