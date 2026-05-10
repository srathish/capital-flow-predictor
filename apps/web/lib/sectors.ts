// SPDR sector ETF metadata. Single source of truth — both the Sectors heatmap
// and the Watchlist grid resolve symbols to human-readable names through here.

export type SectorTheme =
  | "secular growth"
  | "cyclical"
  | "defensive"
  | "rate-sensitive"
  | "commodity-linked"
  | "rate beneficiary";

export interface SectorMeta {
  name: string;
  theme: SectorTheme;
  drivers: string[];
}

export const SECTOR_META: Record<string, SectorMeta> = {
  XLK:  { name: "Technology",             theme: "secular growth",      drivers: ["AI capex", "rate sensitivity", "earnings momentum"] },
  XLC:  { name: "Communication Services", theme: "secular growth",      drivers: ["digital ad spend", "subscriber trends"] },
  XLY:  { name: "Consumer Discretionary", theme: "cyclical",            drivers: ["consumer sentiment", "wage growth", "credit conditions"] },
  XLI:  { name: "Industrials",            theme: "cyclical",            drivers: ["PMI trends", "capex cycle", "global trade"] },
  XLB:  { name: "Materials",              theme: "cyclical",            drivers: ["China demand", "USD strength", "commodity prices"] },
  XLE:  { name: "Energy",                 theme: "commodity-linked",    drivers: ["crude prices", "OPEC+ supply", "USD strength"] },
  XLF:  { name: "Financials",             theme: "rate beneficiary",    drivers: ["yield curve", "credit spreads", "loan demand"] },
  XLV:  { name: "Health Care",            theme: "defensive",           drivers: ["pricing power", "regulatory backdrop", "biotech pipelines"] },
  XLP:  { name: "Consumer Staples",       theme: "defensive",           drivers: ["risk-off rotation", "input costs", "USD strength"] },
  XLU:  { name: "Utilities",              theme: "rate-sensitive",      drivers: ["10Y yield", "power demand"] },
  XLRE: { name: "Real Estate",            theme: "rate-sensitive",      drivers: ["10Y yield", "cap rates", "occupancy trends"] },
};

export function sectorMetaFor(symbol: string): SectorMeta {
  return SECTOR_META[symbol] ?? { name: symbol, theme: "cyclical", drivers: [] };
}
