// Map raw catalyst keywords (from /v1/reddit/catalysts) into a small,
// trade-relevant taxonomy. The backend keyword list is broad and noisy;
// grouping into ~7 categories makes filtering and color-coding meaningful.

export type CatalystCategoryId =
  | "mna"
  | "regulatory"
  | "earnings"
  | "insider"
  | "partnership"
  | "leak"
  | "product"
  | "other";

export type CatalystCategory = {
  id: CatalystCategoryId;
  label: string;
  // Hex-ish hue used for chips/borders. Pulled from globals tokens where
  // possible; "other" intentionally falls back to muted.
  swatch: string; // CSS class for chip background
  text: string; // CSS class for chip text
  description: string;
};

export const CATALYST_CATEGORIES: Record<CatalystCategoryId, CatalystCategory> = {
  mna: {
    id: "mna",
    label: "M&A",
    swatch: "bg-[#5b21b6]/20",
    text: "text-[#c4b5fd]",
    description: "Acquisitions, mergers, buyouts, takeovers.",
  },
  regulatory: {
    id: "regulatory",
    label: "Regulatory",
    swatch: "bg-[#1d4ed8]/20",
    text: "text-[#93c5fd]",
    description: "FDA, SEC/DOJ, lawsuits, recalls, antitrust.",
  },
  earnings: {
    id: "earnings",
    label: "Earnings",
    swatch: "bg-signal-bullish/15",
    text: "text-signal-bullish",
    description: "Earnings beats/misses, guidance, EPS, revenue.",
  },
  insider: {
    id: "insider",
    label: "Insider",
    swatch: "bg-[#b45309]/20",
    text: "text-[#fcd34d]",
    description: "Insider buys/sells, Form 4, 13D/G filings.",
  },
  partnership: {
    id: "partnership",
    label: "Partnership",
    swatch: "bg-primary/15",
    text: "text-primary",
    description: "Partnerships, contracts, supplier wins.",
  },
  leak: {
    id: "leak",
    label: "Leak / Rumor",
    swatch: "bg-signal-bearish/15",
    text: "text-signal-bearish",
    description: "Leaks, rumors, unverified scoops.",
  },
  product: {
    id: "product",
    label: "Product",
    swatch: "bg-[#0f766e]/25",
    text: "text-[#5eead4]",
    description: "Product launches, releases, reveals.",
  },
  other: {
    id: "other",
    label: "Other",
    swatch: "bg-muted",
    text: "text-muted-foreground",
    description: "Catalyst keywords that didn't fit a specific bucket.",
  },
};

// Order matters: more specific buckets first so e.g. "fda approval" lands
// in `regulatory` even though "approval" alone could read as `partnership`.
const KEYWORD_RULES: Array<{ id: CatalystCategoryId; tokens: string[] }> = [
  {
    id: "regulatory",
    tokens: [
      "fda",
      "approval",
      "approved",
      "clinical",
      "trial",
      "phase 3",
      "phase 2",
      "phase iii",
      "phase ii",
      "recall",
      "doj",
      "antitrust",
      "lawsuit",
      "sued",
      "settlement",
      "ftc",
      "sec",
      "investigation",
      "subpoena",
    ],
  },
  {
    id: "earnings",
    tokens: [
      "earnings",
      "beat",
      "miss",
      "missed",
      "guidance",
      "guide",
      "guides",
      "eps",
      "revenue",
      "raised guidance",
      "lowered guidance",
      "raises",
      "lowered",
      "preannounce",
      "pre-announce",
    ],
  },
  {
    id: "insider",
    tokens: [
      "insider",
      "form 4",
      "13d",
      "13g",
      "ceo sell",
      "cfo sell",
      "ceo buy",
      "insider buy",
      "insider sell",
    ],
  },
  {
    id: "mna",
    tokens: [
      "acquisition",
      "acquire",
      "acquires",
      "acquired",
      "merger",
      "merge",
      "buyout",
      "takeover",
      "take private",
      "spinoff",
      "spin-off",
    ],
  },
  {
    id: "partnership",
    tokens: [
      "partnership",
      "partner",
      "partners",
      "deal",
      "contract",
      "awarded",
      "supplier",
      "win",
      "wins",
    ],
  },
  {
    id: "product",
    tokens: [
      "launch",
      "launches",
      "release",
      "released",
      "unveil",
      "unveils",
      "announce",
      "announces",
      "announced",
      "reveal",
      "reveals",
      "rollout",
    ],
  },
  {
    id: "leak",
    tokens: [
      "leak",
      "leaked",
      "rumor",
      "rumored",
      "scoop",
      "alleged",
      "report",
      "reports",
      "sources say",
      "according to sources",
    ],
  },
];

export function classifyKeywords(keywords: string[]): {
  primary: CatalystCategoryId;
  all: CatalystCategoryId[];
} {
  const hits = new Set<CatalystCategoryId>();
  const lowered = keywords.map((k) => k.toLowerCase());
  for (const rule of KEYWORD_RULES) {
    for (const t of rule.tokens) {
      if (lowered.some((k) => k === t || k.includes(t))) {
        hits.add(rule.id);
        break;
      }
    }
  }
  if (hits.size === 0) hits.add("other");
  // Primary: first matched rule (rules are ordered by specificity).
  const ordered = KEYWORD_RULES.map((r) => r.id).filter((id) => hits.has(id));
  const primary = (ordered[0] ?? "other") as CatalystCategoryId;
  return { primary, all: Array.from(hits) };
}

export const ALL_CATEGORIES: CatalystCategoryId[] = [
  "mna",
  "regulatory",
  "earnings",
  "insider",
  "partnership",
  "leak",
  "product",
  "other",
];
