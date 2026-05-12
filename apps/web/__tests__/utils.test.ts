import { describe, expect, it } from "vitest";
import { cn, formatNum, formatPct } from "@/lib/utils";

describe("formatPct", () => {
  it("converts fraction to percentage with default 1 decimal", () => {
    expect(formatPct(0.1234)).toBe("12.3%");
  });
  it("respects decimals override", () => {
    expect(formatPct(0.12345, 2)).toBe("12.35%");
  });
  it("returns em-dash for null/undefined/NaN", () => {
    expect(formatPct(null)).toBe("—");
    expect(formatPct(undefined)).toBe("—");
    expect(formatPct(NaN)).toBe("—");
  });
});

describe("formatNum", () => {
  it("rounds to 2 decimals by default", () => {
    expect(formatNum(1.2345)).toBe("1.23");
  });
  it("returns em-dash for missing", () => {
    expect(formatNum(null)).toBe("—");
    expect(formatNum(undefined)).toBe("—");
  });
});

describe("cn", () => {
  it("merges truthy classes", () => {
    expect(cn("a", false, "b")).toBe("a b");
  });
  it("deduplicates with twMerge for tailwind conflicts", () => {
    // twMerge keeps the last conflicting class
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
