"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ChatMessage } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PERSONA_OPTIONS: { value: string; label: string }[] = [
  { value: "ensemble", label: "Ensemble synthesis" },
  { value: "buffett", label: "Warren Buffett" },
  { value: "burry", label: "Michael Burry" },
  { value: "druckenmiller", label: "Stanley Druckenmiller" },
  { value: "taleb", label: "Nassim Taleb" },
  { value: "soros", label: "George Soros" },
  { value: "simons", label: "Jim Simons (quant)" },
  { value: "klarman", label: "Seth Klarman" },
  { value: "greenblatt", label: "Joel Greenblatt" },
  { value: "minervini", label: "Mark Minervini" },
  { value: "cathie_wood", label: "Cathie Wood" },
  { value: "damodaran", label: "Aswath Damodaran" },
  { value: "lynch", label: "Peter Lynch" },
  { value: "ackman", label: "Bill Ackman" },
];

type Props = {
  ticker: string;
  runTs?: string;
  /** Personas that don't have signals on this run are disabled in the dropdown. */
  availableAgents?: Set<string>;
};

export function ChatPanel({ ticker, runTs, availableAgents }: Props) {
  const [target, setTarget] = useState<string>("ensemble");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Reset history when the ticker changes — different stock, different conversation.
    setMessages([]);
    setError(null);
  }, [ticker]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;

    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const stream =
      target === "ensemble"
        ? api.chatEnsemble(ticker, next, runTs, ctrl.signal)
        : api.chatPersona(ticker, target, next, runTs, ctrl.signal);

    try {
      for await (const ev of stream) {
        if (ev.type === "token") {
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant") {
              copy[copy.length - 1] = { ...last, content: last.content + ev.content };
            }
            return copy;
          });
        } else if (ev.type === "error") {
          setError(ev.message);
          break;
        } else {
          break;
        }
      }
    } catch (e) {
      if ((e as { name?: string })?.name !== "AbortError") {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <Card className="flex h-[640px] flex-col">
      <CardHeader className="flex-shrink-0 space-y-2 pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">Talk to the agents</CardTitle>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={streaming}
            className="rounded-full border border-border bg-card px-3 py-1 text-xs"
          >
            {PERSONA_OPTIONS.map((opt) => {
              const isPersona = opt.value !== "ensemble";
              const disabled = isPersona && availableAgents && !availableAgents.has(opt.value);
              return (
                <option key={opt.value} value={opt.value} disabled={disabled}>
                  {opt.label}
                  {disabled ? " (not in run)" : ""}
                </option>
              );
            })}
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          {target === "ensemble"
            ? "Synthesizer voice with all 17 agent verdicts as context."
            : "In-character follow-up with the persona's stance on this ticker."}
        </p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 overflow-hidden pt-0">
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm"
        >
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
              Ask about the verdict, push back on a thesis, or compare two agents.
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === "user"
                      ? "ml-6 rounded-md bg-primary/10 px-3 py-2 text-foreground"
                      : "mr-6 rounded-md bg-card px-3 py-2 text-foreground shadow-sm"
                  }
                >
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {m.role === "user" ? "You" : target === "ensemble" ? "Ensemble" : prettyLabel(target)}
                  </div>
                  <div className="whitespace-pre-wrap leading-relaxed">
                    {streaming && i === messages.length - 1 && m.role === "assistant" && !m.content ? (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                        thinking
                        <span className="inline-flex">
                          {[0, 1, 2].map((d) => (
                            <span
                              key={d}
                              className="ml-[1px] animate-pulse"
                              style={{ animationDelay: `${d * 0.2}s` }}
                            >
                              .
                            </span>
                          ))}
                        </span>
                      </span>
                    ) : (
                      <>
                        {m.content}
                        {streaming && i === messages.length - 1 && m.role === "assistant" && (
                          <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-primary align-middle" />
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {error && (
          <div className="rounded-md border border-signal-bearish/30 bg-signal-bearish/10 px-2 py-1 text-xs text-signal-bearish">
            {error}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex flex-shrink-0 gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask about ${ticker.toUpperCase()}…`}
            disabled={streaming}
            className="flex-1 rounded-full border border-border bg-card px-4 py-2 text-sm placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-full border border-border bg-muted px-4 py-2 text-sm font-semibold hover:bg-muted/70"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              Send
            </button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function prettyLabel(value: string): string {
  return PERSONA_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
