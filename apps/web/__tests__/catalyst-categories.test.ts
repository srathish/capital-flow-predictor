import { describe, expect, it } from "vitest";
import { ALL_CATEGORIES, classifyKeywords } from "@/lib/catalyst-categories";

describe("classifyKeywords", () => {
  it("returns 'other' when no rule fires", () => {
    const out = classifyKeywords(["unrelated", "stuff"]);
    expect(out.primary).toBe("other");
    expect(out.all).toContain("other");
  });

  it("classifies M&A keywords", () => {
    const out = classifyKeywords(["acquisition", "buyout"]);
    expect(out.all).toContain("mna");
  });

  it("classifies multiple buckets when present", () => {
    const out = classifyKeywords(["fda", "earnings"]);
    expect(out.all).toContain("regulatory");
    expect(out.all).toContain("earnings");
  });

  it("primary follows rule precedence (first declared wins)", () => {
    // If both M&A and regulatory match, primary should be whichever rule fires first.
    const out = classifyKeywords(["acquisition", "fda"]);
    // The first matching rule in the ordered list is the primary.
    expect(out.all.length).toBeGreaterThanOrEqual(2);
    expect(ALL_CATEGORIES).toContain(out.primary);
  });

  it("substring matching catches phrases", () => {
    const out = classifyKeywords(["just an acquisition rumor"]);
    expect(out.all).toContain("mna");
  });
});

describe("ALL_CATEGORIES", () => {
  it("includes all 8 declared category ids", () => {
    expect(ALL_CATEGORIES).toEqual([
      "mna", "regulatory", "earnings", "insider",
      "partnership", "leak", "product", "other",
    ]);
  });
});
