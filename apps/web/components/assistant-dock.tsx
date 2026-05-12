"use client";

/**
 * Top-level assistant dock — floating chat available on every page.
 *
 * Connects to POST /v1/assistant/chat (SSE). The backend runs a Moonshot
 * tool-calling loop with tools that wrap the rest of the app:
 *   - get_rankings, get_sectors_heatmap, get_agents_for_ticker, get_catalysts
 *   - run_ensemble (kicks off a background ensemble run)
 *   - navigate (we react to it via next/router)
 *
 * Render protocol per turn:
 *   - text events stream into the assistant's bubble
 *   - tool_call events render an inline "running tool…" card
 *   - tool_result events flip the card to ✅ done with a one-line preview
 *   - navigate tool result triggers router.push immediately
 *
 * Mounted from app/layout.tsx so it's available on every page; collapsible
 * to a single chat button bottom-right when not in use.
 */

import { useEffect, useRef, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { authHeaders, baseUrl } from "@/lib/api";
import { parseAssistantStream } from "@/lib/sse";
import type { AssistantStreamEvent, AssistantTurn } from "@/lib/types";
import { cn } from "@/lib/utils";

// Snapshot of where the user is in the app, sent on every chat turn so the
// assistant can resolve "this ticker", "here", etc. without re-prompting.
interface PageContextPayload {
  route: string | null;
  ticker: string | null;
  etf: string | null;
  tab: string | null;
  query: Record<string, string> | null;
}

// ---- Local message model — what we render inside the dock ----

interface ToolCallEntry {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  resultPreview?: string;
}

interface AssistantMessage {
  role: "assistant";
  text: string;
  toolCalls: ToolCallEntry[];
  pending: boolean;
}

interface UserMessage {
  role: "user";
  text: string;
}

type DockMessage = UserMessage | AssistantMessage;

// ---- Helpers ----

function summarizeToolResult(name: string, result: unknown): string {
  if (!result || typeof result !== "object") return "(empty)";
  const r = result as Record<string, unknown>;
  if ("error" in r) return `error: ${String(r.error).slice(0, 80)}`;
  if (name === "get_rankings") {
    const rs = (r.rankings as { rank: number; symbol: string }[] | undefined) ?? [];
    const top3 = rs.slice(0, 3).map((x) => `${x.rank}=${x.symbol}`).join(", ");
    return `${rs.length} rows · top: ${top3}`;
  }
  if (name === "get_sectors_heatmap") {
    const ss = (r.sectors as { symbol: string }[] | undefined) ?? [];
    return `${ss.length} sectors`;
  }
  if (name === "get_agents_for_ticker") {
    const sigs = (r.signals as { agent: string }[] | undefined) ?? [];
    return `${sigs.length} agent signals for ${r.ticker}`;
  }
  if (name === "get_catalysts") {
    const ps = (r.posts as { title: string }[] | undefined) ?? [];
    if (!ps.length) return "no catalyst posts in window";
    return `${ps.length} catalyst posts · top: "${ps[0].title.slice(0, 60)}…"`;
  }
  if (name === "run_ensemble") {
    return `started ${r.ticker} run · ${r.run_ts}`;
  }
  if (name === "navigate") {
    return `navigated to ${r.navigated_to}`;
  }
  return JSON.stringify(r).slice(0, 120);
}

const SUGGESTIONS = [
  "What sectors are leading right now?",
  "Run NVDA and summarize",
  "Show me catalyst posts from last 24h",
  "Open the network graph",
];

// Persist chat across page refreshes within the same browser tab. We drop the
// `pending` flag on save so a refresh mid-stream doesn't leave a ghost spinner.
const STORAGE_KEY = "bellwether.assistant.dock.v1";

function loadStoredMessages(): DockMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m: unknown): m is DockMessage => {
        if (!m || typeof m !== "object") return false;
        const r = (m as { role?: unknown }).role;
        return r === "user" || r === "assistant";
      })
      .map((m) =>
        m.role === "assistant" ? { ...m, pending: false } : m,
      );
  } catch {
    return [];
  }
}

// ---- Component ----

export function AssistantDock() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<DockMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const hydratedRef = useRef(false);

  // Rehydrate prior session on mount; runs once. We do this in an effect rather
  // than as initial useState to avoid SSR/CSR hydration mismatch on the dock.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const restored = loadStoredMessages();
    if (restored.length) setMessages(restored);
  }, []);

  // Persist on every change, but only after hydration so we don't immediately
  // overwrite stored messages with an empty initial state.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (typeof window === "undefined") return;
    try {
      if (messages.length === 0) {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } else {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
      }
    } catch {
      // sessionStorage can fail (quota, private mode) — degrade silently
    }
  }, [messages]);
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  function snapshotContext(): PageContextPayload {
    const rawTicker = params?.ticker;
    const rawEtf = params?.etf;
    const ticker = Array.isArray(rawTicker) ? rawTicker[0] : rawTicker;
    const etf = Array.isArray(rawEtf) ? rawEtf[0] : rawEtf;
    const query: Record<string, string> = {};
    if (typeof window !== "undefined") {
      new URLSearchParams(window.location.search).forEach((v, k) => {
        query[k] = v;
      });
    }
    return {
      route: pathname ?? null,
      ticker: ticker ? String(ticker).toUpperCase() : null,
      etf: etf ? String(etf).toUpperCase() : null,
      tab: query.tab ?? null,
      query: Object.keys(query).length ? query : null,
    };
  }

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages, open]);

  async function send(prompt: string) {
    if (!prompt.trim() || streaming) return;
    const userMsg: UserMessage = { role: "user", text: prompt };
    const assistantMsg: AssistantMessage = {
      role: "assistant",
      text: "",
      toolCalls: [],
      pending: true,
    };
    const nextMessages: DockMessage[] = [...messages, userMsg, assistantMsg];
    setMessages(nextMessages);
    setInput("");
    setStreaming(true);

    const turns: AssistantTurn[] = nextMessages
      .filter((m): m is UserMessage | AssistantMessage => m.role === "user" || m.role === "assistant")
      .filter((m) => m.role !== "assistant" || m.text.trim().length > 0 || m.toolCalls.length > 0)
      .map((m) => ({ role: m.role, content: m.role === "assistant" ? m.text : m.text }));
    // Replace the last assistant placeholder (it has no content yet)
    const pruned = turns.length && turns[turns.length - 1].role === "assistant" ? turns.slice(0, -1) : turns;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch(`${baseUrl()}/v1/assistant/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ messages: pruned, context: snapshotContext() }),
        signal: controller.signal,
      });

      for await (const ev of parseAssistantStream(resp)) {
        applyEvent(ev);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        applyEvent({ type: "error", message: (err as Error).message });
      }
    } finally {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") last.pending = false;
        return copy;
      });
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function applyEvent(ev: AssistantStreamEvent) {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (!last || last.role !== "assistant") return copy;
      const updated: AssistantMessage = {
        ...last,
        toolCalls: [...last.toolCalls],
      };
      if (ev.type === "text") {
        updated.text = updated.text + ev.content;
      } else if (ev.type === "tool_call") {
        updated.toolCalls.push({
          id: ev.id,
          name: ev.name,
          args: ev.args,
          status: "running",
        });
      } else if (ev.type === "tool_result") {
        const idx = updated.toolCalls.findIndex((t) => t.id === ev.id);
        if (idx >= 0) {
          const r = ev.result as Record<string, unknown>;
          updated.toolCalls[idx] = {
            ...updated.toolCalls[idx],
            status: "error" in (r ?? {}) ? "error" : "done",
            resultPreview: summarizeToolResult(ev.name, ev.result),
          };
        }
        // Honor navigate immediately
        if (ev.name === "navigate") {
          const r = ev.result as { navigated_to?: string };
          if (r?.navigated_to) {
            try {
              router.push(r.navigated_to);
            } catch {
              // ignore
            }
          }
        }
      } else if (ev.type === "error") {
        updated.text = updated.text + `\n\n[error] ${ev.message}`;
      }
      copy[copy.length - 1] = updated;
      return copy;
    });
  }

  function stop() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  return (
    <>
      {/* Collapsed: floating button bottom-right */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg ring-1 ring-primary/30 transition-transform hover:scale-105"
          title="Open assistant"
          aria-label="Open assistant"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {/* Expanded: dock panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex h-[560px] w-[400px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border bg-card px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-primary" />
              <span className="text-sm font-semibold">Bellwether assistant</span>
            </div>
            <div className="flex items-center gap-1">
              {streaming && (
                <button
                  type="button"
                  onClick={stop}
                  className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase text-signal-bearish hover:bg-muted/30"
                >
                  Stop
                </button>
              )}
              <button
                type="button"
                onClick={() => setMessages([])}
                disabled={streaming || messages.length === 0}
                className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground hover:bg-muted/30 disabled:opacity-40"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/30"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Body */}
          <div ref={scrollerRef} className="flex-1 overflow-y-auto px-3 py-3 text-sm">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Drive the dashboard with natural language. The assistant can run
                  ensembles, fetch rankings, surface catalysts, and navigate pages.
                </p>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="w-full rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className="mb-3">
                {m.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg bg-primary/15 px-3 py-1.5 text-foreground">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {m.toolCalls.map((tc) => (
                      <ToolCallCard key={tc.id} tc={tc} />
                    ))}
                    {(m.text || m.pending) && (
                      <div className="whitespace-pre-wrap leading-snug text-foreground">
                        {m.text}
                        {m.pending && (
                          <span className="ml-1 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-primary align-middle" />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-border bg-card px-3 py-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything (e.g. 'run NVDA', 'show catalysts')"
              disabled={streaming}
              className="flex-1 rounded-md bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function ToolCallCard({ tc }: { tc: ToolCallEntry }) {
  const argsPreview = Object.entries(tc.args)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  return (
    <div
      className={cn(
        "rounded-md border px-2 py-1 text-[11px]",
        tc.status === "running" && "border-primary/30 bg-primary/5",
        tc.status === "done" && "border-signal-bullish/30 bg-signal-bullish/5",
        tc.status === "error" && "border-signal-bearish/30 bg-signal-bearish/5"
      )}
    >
      <div className="flex items-center justify-between gap-2 font-mono">
        <span className="font-semibold">
          {tc.status === "running" && "↻ "}
          {tc.status === "done" && "✓ "}
          {tc.status === "error" && "✕ "}
          {tc.name}
        </span>
        <span className="truncate text-muted-foreground">{argsPreview}</span>
      </div>
      {tc.resultPreview && (
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
          {tc.resultPreview}
        </div>
      )}
    </div>
  );
}
