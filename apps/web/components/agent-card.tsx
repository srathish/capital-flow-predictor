import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceBar } from "@/components/ui/confidence-bar";
import { SignalBadge } from "@/components/ui/badge";
import type { AgentSignalEntry } from "@/lib/types";
import { formatNum } from "@/lib/utils";

const PRETTY_NAMES: Record<string, string> = {
  technicals: "Technicals",
  fundamentals: "Fundamentals",
  sentiment: "Sentiment",
  news: "News",
  buffett: "Warren Buffett",
  munger: "Charlie Munger",
  burry: "Michael Burry",
  druckenmiller: "Stanley Druckenmiller",
  cathie_wood: "Cathie Wood",
  taleb: "Nassim Taleb",
  damodaran: "Aswath Damodaran",
  graham: "Benjamin Graham",
  ackman: "Bill Ackman",
  lynch: "Peter Lynch",
  fisher: "Phil Fisher",
  pabrai: "Mohnish Pabrai",
  jhunjhunwala: "Rakesh Jhunjhunwala",
  trader: "Trader",
  risk_manager: "Risk Manager",
  portfolio_manager: "Portfolio Manager",
};

function prettyAgent(name: string): string {
  return PRETTY_NAMES[name] ?? name;
}

export function AgentCard({ s }: { s: AgentSignalEntry }) {
  const evidence =
    Array.isArray((s.payload as { key_evidence?: unknown[] })?.key_evidence)
      ? ((s.payload as { key_evidence: unknown[] }).key_evidence as string[])
      : [];
  const concerns =
    Array.isArray((s.payload as { concerns?: unknown[] })?.concerns)
      ? ((s.payload as { concerns: unknown[] }).concerns as string[])
      : [];

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="space-y-2 pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">{prettyAgent(s.agent)}</CardTitle>
          <SignalBadge signal={s.signal} />
        </div>
        <div className="flex items-center gap-2">
          <ConfidenceBar value={s.confidence} signal={s.signal} className="flex-1" />
          <span className="num min-w-[36px] text-right text-xs text-muted-foreground">
            {formatNum(s.confidence)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-3 pt-0 text-xs">
        {s.rationale && <p className="leading-relaxed">{s.rationale}</p>}
        {evidence.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Evidence
            </div>
            <ul className="space-y-1 text-muted-foreground">
              {evidence.slice(0, 5).map((e, i) => (
                <li key={i} className="leading-snug before:mr-1.5 before:content-['•']">
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}
        {concerns.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Concerns
            </div>
            <ul className="space-y-1 text-muted-foreground">
              {concerns.slice(0, 3).map((c, i) => (
                <li key={i} className="leading-snug before:mr-1.5 before:content-['•']">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
